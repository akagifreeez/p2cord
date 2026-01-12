use anyhow::{Result, Context};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::Arc;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
// use webrtc::track::track_local::TrackLocalWriter; // Trait for write_sample
use webrtc::media::Sample;
use audiopus::{coder::Encoder as OpusEncoder, Application, Channels, SampleRate};
use tokio::sync::mpsc;
use bytes::Bytes;
use std::time::Duration;
use tauri::Emitter;

use std::sync::atomic::{AtomicBool, Ordering};

pub fn start_audio_capture(app: tauri::AppHandle, track: Arc<TrackLocalStaticSample>, is_muted: Arc<AtomicBool>, vad_tx: mpsc::UnboundedSender<bool>, running_flag: Arc<AtomicBool>) -> Result<cpal::Stream> {
    let host = cpal::default_host();
    let device = host.default_input_device().context("No input device")?;
    println!("Using input device: {}", device.name()?);

    // Try to find a config with 48kHz
    let mut supported_configs_range = device.supported_input_configs()?;
    let supported_config = supported_configs_range
        .find(|c| c.max_sample_rate().0 >= 48000 && c.min_sample_rate().0 <= 48000)
        .or_else(|| device.supported_input_configs().ok()?.next())
        .context("No supported input config")?
        .with_sample_rate(cpal::SampleRate(48000)); // Try to force 48k

    let config: cpal::StreamConfig = supported_config.into();
    let sample_rate = config.sample_rate.0;
    let channels = config.channels;
    
    println!("Input config: Rate={}, Channels={}", sample_rate, channels);

    // Create Opus Encoder
    // We target 48kHz Stereo for Opus
    let mut encoder = OpusEncoder::new(
        SampleRate::Hz48000,
        Channels::Stereo,
        Application::Voip
    )?;

    // Channel to bridge Sync CPAL callback -> Async WebRTC Writer
    let (tx, mut rx) = mpsc::unbounded_channel::<Bytes>();

    // Spawn Async Task to write to Track
    let flag_for_writer = running_flag.clone();
    tauri::async_runtime::spawn(async move {
        println!("Audio Sender Task Started");
        while let Some(data) = rx.recv().await {
            // Check flag
            if !flag_for_writer.load(Ordering::Relaxed) {
                break;
            }

            // Write to WebRTC track
            // 20ms frame @ 48kHz = 960 samples.
            // Duration is roughly 20ms.
            let sample = Sample {
                data,
                duration: Duration::from_millis(20),
                ..Default::default()
            };
            
            if let Err(e) = track.write_sample(&sample).await {
                eprintln!("Failed to write audio sample: {}", e);
                break;
            }
        }
        println!("Audio Sender Task Ended");
    });

    let err_fn = |err| eprintln!("an error occurred on stream: {}", err);
    
    // Accumulation Buffer
    // We want 20ms frames. 48000Hz * 0.02s = 960 samples per channel.
    // If Stereo: 1920 samples total.
    const FRAME_SIZE_PER_CHANNEL: usize = 960;
    
    // Buffer to hold interleaved samples
    let mut buffer: Vec<f32> = Vec::with_capacity(FRAME_SIZE_PER_CHANNEL * 2);
    let mut packet_count = 0u64;

    // VAD State
    let mut vad_hangover_frames = 0;
    const VAD_THRESHOLD: f32 = 0.005; // Adjustable threshold
    const VAD_HANGOVER: usize = 10;   // 10 frames * 20ms = 200ms
    let mut was_talking = false;
    
    // Helper to calc RMS
    fn calculate_rms(samples: &[f32]) -> f32 {
        let sum_sq: f32 = samples.iter().map(|&x| x * x).sum();
        (sum_sq / samples.len() as f32).sqrt()
    }
    
    let stream = device.build_input_stream(
        &config,
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            // Check running flag
            if !running_flag.load(Ordering::Relaxed) {
                // Ideally we stop the stream here, but we can't easily.
                // We just stop processing and return early.
                // The stream will be dropped/paused when the main thread holder drops it? 
                // No, CPAL streams are active until dropped.
                // Since this closure captures `running_flag`, we check it.
                return; 
            }

            if packet_count % 200 == 0 {
                 println!("Audio Callback Active: {} frames received. First sample: {:.4}", packet_count, data.get(0).unwrap_or(&0.0));
                 
                 // Silence Check (logging only)
                 let is_silence = data.iter().take(100).all(|&x| x.abs() < 0.0001);
                 if is_silence {
                     println!("⚠ マイク入力が無音の可能性があります (Silence Detected)");
                 }
            }

            // Check Mute State
            if is_muted.load(Ordering::Relaxed) {
                if packet_count % 100 == 0 {
                    println!("マイクミュート中 - サンプル破棄");
                }
                
                // Muted = Force Silence
                if was_talking {
                    was_talking = false;
                    let _ = app.emit("voice-activity", false);
                    let _ = vad_tx.send(false); // Send false to VAD channel when muted
                }
                
                packet_count += 1;
                buffer.clear();
                return;
            }

            // Append incoming data to buffer
            if channels == 1 {
                // Mono to Stereo
                for &sample in data {
                    buffer.push(sample);
                    buffer.push(sample);
                }
            } else if channels == 2 {
                buffer.extend_from_slice(data);
            } else {
                // > 2 channels, just take first 2? naive
                for chunk in data.chunks(channels as usize) {
                    if chunk.len() >= 2 {
                        buffer.push(chunk[0]);
                        buffer.push(chunk[1]);
                    }
                }
            }

            // Check if we have enough for a frame (Stereo 20ms)
            while buffer.len() >= FRAME_SIZE_PER_CHANNEL * 2 {
                let frame_len = FRAME_SIZE_PER_CHANNEL * 2;
                let frame_slice = &buffer[0..frame_len];
                
                // VAD Logic
                let rms = calculate_rms(frame_slice);
                let is_active = rms > VAD_THRESHOLD;
                
                if is_active {
                    vad_hangover_frames = VAD_HANGOVER;
                } else if vad_hangover_frames > 0 {
                    vad_hangover_frames -= 1;
                }
                
                let is_talking = vad_hangover_frames > 0;
                
                // Emit Event on State Change
                if is_talking != was_talking {
                    was_talking = is_talking;
                    // Emit to Frontend
                    if let Err(e) = app.emit("voice-activity", is_talking) {
                        eprintln!("Failed to emit VAD event: {}", e);
                    } else {
                        let _ = vad_tx.send(is_talking);
                        // Debug log
                        // println!("VAD State Changed: {}", is_talking);
                    }
                }

                // DTX: Send only if talking
                if is_talking {
                    // Encode
                    let mut output = [0u8; 4000]; 
                    match encoder.encode_float(frame_slice, &mut output) {
                        Ok(len) => {
                            let bytes = Bytes::copy_from_slice(&output[0..len]);
                            let _ = tx.send(bytes);
                            
                            packet_count += 1;
                            if packet_count % 50 == 0 {
                                 println!("音声キャプチャ: パケットエンコード #{} ({} bytes) RMS={:.4}", packet_count, len, rms);
                            }
                        },
                        Err(e) => eprintln!("Opusエンコードエラー: {}", e),
                    }
                } else {
                    // DTX active: Skip sending
                    // Maybe send Comfort Noise later?
                    packet_count += 1; // Keep counting
                }

                // Remove processed samples
                buffer.drain(0..frame_len);
            }
        },
        err_fn,
        None
    )?;

    stream.play()?; 
    println!("音声ストリーム開始 (Capture Device: {:?})", device.name().unwrap_or("Unknown".into()));
    
    // We return the Stream. It must be kept alive by the caller.
    Ok(stream)
}

pub fn start_audio_playback(is_deafened: Arc<AtomicBool>) -> Result<std::sync::mpsc::Sender<Vec<f32>>> {
    let host = cpal::default_host();
    let device = host.default_output_device().context("No output device")?;
    println!("Using output device: {}", device.name()?);

    // Try to find a config with 48kHz
    let mut supported_configs_range = device.supported_output_configs()?;
    let supported_config = supported_configs_range
        .find(|c| c.max_sample_rate().0 >= 48000 && c.min_sample_rate().0 <= 48000)
        .or_else(|| device.supported_output_configs().ok()?.next())
        .context("No supported output config")?
        .with_sample_rate(cpal::SampleRate(48000));

    let config: cpal::StreamConfig = supported_config.into();
    
    println!("Output config: {:?}", config);
    let device_sample_rate = config.sample_rate.0;

    let (tx, rx) = std::sync::mpsc::channel::<Vec<f32>>();
    
    std::thread::spawn(move || {
        use std::collections::VecDeque;
        let mut buffer = VecDeque::new();
        let mut rx_count = 0u64;
        
        let err_fn = |err| eprintln!("an error occurred on output stream: {}", err);
        
        // Resampling & Jitter Buffer State
        let source_sample_rate = 48000.0;
        let target_sample_rate = device_sample_rate as f32;
        let mut fractional_pos = 0.0;
        let ratio = source_sample_rate / target_sample_rate;
        
        // Jitter Buffer Settings
        // 48000Hz * 0.08s = 3840 samples (approx 80ms)
        const INITIAL_BUFFER_TARGET: usize = 3840; 
        let mut buffering = true;

        println!("Resampling: Source {} -> Target {} (Ratio: {})", source_sample_rate, target_sample_rate, ratio);

        let stream_result = device.build_output_stream(
            &config,
            move |output_data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                // 1. Try to fetch new packets from channel
                while let Ok(packet) = rx.try_recv() {
                    buffer.extend(packet);
                    rx_count += 1;
                    if rx_count % 50 == 0 {
                        println!("音声再生: デコーダからパケット受信 (queue: {} samples)", buffer.len());
                    }
                }

                // Jitter Buffer Logic
                if buffering {
                    if buffer.len() >= INITIAL_BUFFER_TARGET {
                        buffering = false;
                        println!("バッファ充填完了 - 再生開始 (queue: {})", buffer.len());
                    } else {
                        // Still buffering, output silence
                        for sample in output_data.iter_mut() {
                            *sample = 0.0;
                        }
                        return;
                    }
                } else if buffer.len() == 0 {
                    // Underrun occured
                    println!("バッファ不足 - 再バッファリング開始");
                    buffering = true;
                    for sample in output_data.iter_mut() {
                        *sample = 0.0;
                    }
                    return;
                }
                
                // Check Deafen State
                let deaf = is_deafened.load(Ordering::Relaxed);
                
                // 2. Fill output buffer with Linear Interpolation
                for sample in output_data.iter_mut() {
                    if deaf {
                        *sample = 0.0;
                        // Still advance logic? No, just output 0 and don't drain buffer? 
                        // If we don't drain, buffer overflows. We MUST drain.
                        // So fall through to logic, but set *sample = 0.0 at end.
                    }

                    // Linear Interpolation
                    // We need sample at 'fractional_pos'
                    let idx = 0; // We consume from front
                    
                    let curr_val = *buffer.get(idx).unwrap_or(&0.0);
                    // Safe get for next
                    let next_val = *buffer.get(idx + 1).unwrap_or(&curr_val); 
                    
                    // LERP: A + (B-A)*t
                    let interpolated = curr_val + (next_val - curr_val) * fractional_pos;
                    
                    if deaf {
                        *sample = 0.0;
                    } else {
                        *sample = interpolated;
                    }
                    
                    fractional_pos += ratio;
                    
                    while fractional_pos >= 1.0 {
                        buffer.pop_front();
                        fractional_pos -= 1.0;
                    }
                }
            },
            err_fn,
            None
        );

        match stream_result {
            Ok(stream) => {
                if let Err(e) = stream.play() {
                    eprintln!("Failed to play output stream: {}", e);
                    return;
                }
                println!("音声再生ストリーム開始");

                // Keep thread alive
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                }
            },
            Err(e) => eprintln!("Failed to build output stream: {}", e),
        }
    });

    Ok(tx)
}
