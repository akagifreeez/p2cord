// P2D Core Module
use cpal::traits::{DeviceTrait, HostTrait};
use anyhow::Result;
use tauri::Emitter;

pub mod signaling;
pub mod session;
pub mod audio;

use crate::services::state::{AudioState, ActiveSession};
use uuid::Uuid;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::collections::HashMap;
use tokio::time::{Duration, Instant};

pub fn init(app: &tauri::AppHandle, room_id: String, state: AudioState) -> ActiveSession {
    println!("P2D Core Initialized for room: {}", room_id);
    
    // Audio Running Flag
    let running_flag = Arc::new(AtomicBool::new(true));
    let running_flag_clone = running_flag.clone();

    // Spawn signaling task
    let room_clone = room_id.clone();
    let app_handle = app.clone(); 
    let audio_app_handle = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        // Generate Local Client ID
        let local_client_id = Uuid::new_v4().to_string();
        println!("My Client ID: {}", local_client_id);

        // VAD channel (lives for entire session)
        let (vad_tx, mut vad_rx) = tokio::sync::mpsc::unbounded_channel::<bool>();

        // Start Audio Capture Thread (Once) - uses a placeholder track initially
        // Audio capture will be connected to the actual track in each PC cycle
        let flag_for_thread = running_flag_clone.clone();
        let is_muted_clone = state.is_muted.clone();
        let is_deafened_clone = state.is_deafened.clone();
        let app_for_audio = audio_app_handle.clone();

        use futures::StreamExt;
        use futures::SinkExt;
        use tokio_tungstenite::tungstenite::protocol::Message;

        // Peer heartbeat tracking
        let mut peer_last_ping: HashMap<String, Instant> = HashMap::new();

        // 2. Reconnection Loop (now includes PeerConnection creation)
        loop {
            // Check if we should stop
            if !running_flag_clone.load(Ordering::Relaxed) {
                println!("Session stopped (flag checked in signaling loop).");
                break;
            }

            // Create new PeerConnection for this connection cycle
            println!("WebRTCセッションを作成中...");
            let (ice_tx, mut ice_rx) = tokio::sync::mpsc::channel::<String>(32);
            
            let session = match session::P2DSession::new(ice_tx, is_deafened_clone.clone()).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("WebRTCセッション作成失敗: {}. Retrying in 3s...", e);
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
            };
            println!("WebRTCセッション作成完了");

            // Create per-cycle audio flag (so we can stop audio when this PC cycle ends)
            let audio_cycle_flag = Arc::new(AtomicBool::new(true));
            let audio_cycle_flag_clone = audio_cycle_flag.clone();
            
            // Start Audio Capture for THIS PC cycle
            let audio_track_clone = session.audio_track.clone();
            let vad_tx_clone = vad_tx.clone();
            let main_flag_clone = flag_for_thread.clone();
            let muted_clone = is_muted_clone.clone();
            let app_audio_clone = app_for_audio.clone();
            
            std::thread::spawn(move || {
                match audio::start_audio_capture(app_audio_clone, audio_track_clone, muted_clone, vad_tx_clone, audio_cycle_flag_clone.clone()) {
                    Ok(_stream) => {
                        println!("音声キャプチャ開始成功 - ストリーム維持");
                        // Run until either main flag or cycle flag is false
                        while audio_cycle_flag_clone.load(Ordering::Relaxed) && main_flag_clone.load(Ordering::Relaxed) {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }
                        println!("Stopping Audio Thread & Dropping Stream");
                    },
                    Err(e) => eprintln!("音声キャプチャ開始失敗: {}", e),
                }
            });
            
            println!("シグナリングサーバーに接続を試みます...");
            let (mut ws_write, mut ws_read) = match signaling::connect_signaling(room_clone.clone()).await {
                Ok(streams) => {
                    println!("シグナリング接続成功");
                    streams
                },
                Err(e) => {
                    eprintln!("Signaling Error: {}. Retrying in 3s...", e);
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    // Close the PC before retrying
                    let _ = session.pc.close().await;
                    continue;
                }
            };

            // Send Join (Re-announce presence)
            let join_msg = signaling::SignalingMessage::Join {
                room_id: room_clone.clone(),
                client_id: local_client_id.clone(),
            };
            if let Ok(json) = serde_json::to_string(&join_msg) {
                 if let Err(e) = ws_write.send(Message::Text(json)).await {
                      eprintln!("Failed to send Join: {}", e);
                 }
            }

            // Signaling Loop State
            let mut remote_description_set = false;
            let mut pending_candidates: Vec<String> = Vec::new();
            let mut did_offer = false;
            let mut heartbeat_interval = tokio::time::interval(Duration::from_secs(2));
            let mut peer_timeout_check = tokio::time::interval(Duration::from_secs(1));
            let mut should_reset_pc = false;

            // Clear old peer tracking for new connection
            peer_last_ping.clear();

            println!("シグナリングループ開始...");

            loop {
                // Check stop flag
                if !running_flag_clone.load(Ordering::Relaxed) {
                    break;
                }

                // Check if we need to reset PC due to timeout
                if should_reset_pc {
                    println!("Peer timeout detected. Resetting PeerConnection...");
                    break;
                }

                tokio::select! {
                    Some(msg) = ws_read.next() => {
                        match msg {
                            Ok(Message::Text(text)) => {
                                println!("シグナリング受信: {}", text);
                                if let Ok(sig_msg) = serde_json::from_str::<signaling::SignalingMessage>(&text) {
                                    match sig_msg {
                                        signaling::SignalingMessage::Join { client_id: remote_id, .. } => {
                                            println!("Peer Join Detected: {}", remote_id);
                                            let _ = app_handle.emit("peer-joined", remote_id.clone());
                                            
                                            // 1. Reply with Welcome
                                            let welcome_msg = signaling::SignalingMessage::Welcome {
                                                room_id: room_clone.clone(),
                                                client_id: local_client_id.clone(),
                                            };
                                            if let Ok(json) = serde_json::to_string(&welcome_msg) {
                                                let _ = ws_write.send(Message::Text(json)).await;
                                            }

                                            // 2. Compare IDs to decide who Offers
                                            if !did_offer && local_client_id > remote_id {
                                                println!("My ID > Remote ID. Sending Offer...");
                                                did_offer = true;
                                                match session.create_offer().await {
                                                    Ok(sdp) => {
                                                        let offer_msg = signaling::SignalingMessage::Offer { sdp, room_id: room_clone.clone() };
                                                        if let Ok(json) = serde_json::to_string(&offer_msg) {
                                                                let _ = ws_write.send(Message::Text(json)).await;
                                                        }
                                                    },
                                                    Err(e) => eprintln!("Offer creation failed: {}", e),
                                                }
                                            }
                                        },
                                        signaling::SignalingMessage::Leave { client_id: remote_id, .. } => {
                                            // Ignore Leave for our own client_id (happens when our old WS closes)
                                            if remote_id == local_client_id {
                                                println!("Ignoring self-Leave message");
                                                continue;
                                            }
                                            
                                            println!("Peer Leave Detected: {}", remote_id);
                                            peer_last_ping.remove(&remote_id);
                                            match app_handle.emit("peer-left", remote_id.clone()) {
                                                Ok(_) => println!("peer-left emitted successfully"),
                                                Err(e) => eprintln!("peer-left emit FAILED: {}", e),
                                            }
                                            // Reset PC to accept new connections from rejoining peers
                                            should_reset_pc = true;
                                        },
                                        signaling::SignalingMessage::Ping { client_id: remote_id, .. } => {
                                            // Update peer's last ping time
                                            peer_last_ping.insert(remote_id, Instant::now());
                                        },
                                        signaling::SignalingMessage::Welcome { client_id: remote_id, .. } => {
                                                println!("Peer Welcome Received: {}", remote_id);
                                                let _ = app_handle.emit("peer-joined", remote_id.clone());

                                                if !did_offer && local_client_id > remote_id {
                                                println!("My ID > Remote ID. Sending Offer...");
                                                did_offer = true;
                                                match session.create_offer().await {
                                                    Ok(sdp) => {
                                                        let offer_msg = signaling::SignalingMessage::Offer { sdp, room_id: room_clone.clone() };
                                                        if let Ok(json) = serde_json::to_string(&offer_msg) {
                                                                let _ = ws_write.send(Message::Text(json)).await;
                                                        }
                                                    },
                                                    Err(e) => eprintln!("Offer creation failed: {}", e),
                                                }
                                                }
                                        },
                                        signaling::SignalingMessage::Answer { sdp, .. } => {
                                            println!("Answer受信。Remote Descriptionを設定中...");
                                            if let Err(e) = session.set_remote_description(sdp, webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Answer).await {
                                                eprintln!("Remote Description設定失敗: {}", e);
                                            } else {
                                                println!("Remote Description設定成功");
                                                remote_description_set = true;
                                                for candidate in pending_candidates.drain(..) {
                                                    println!("保留中のICE Candidateを追加...");
                                                    if let Err(e) = session.add_ice_candidate(candidate).await {
                                                        eprintln!("ICE Candidate追加失敗: {}", e);
                                                    }
                                                }
                                            }
                                        },
                                        signaling::SignalingMessage::Offer { sdp, .. } => {
                                            println!("Offer受信。Remote Description設定とAnswer送信...");
                                            if let Err(e) = session.set_remote_description(sdp, webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Offer).await {
                                                eprintln!("Remote Offer設定失敗: {}", e);
                                            } else {
                                                remote_description_set = true;
                                                for candidate in pending_candidates.drain(..) {
                                                    if let Err(e) = session.add_ice_candidate(candidate).await {
                                                        eprintln!("ICE Candidate追加失敗: {}", e);
                                                    }
                                                }
                                                match session.create_answer().await {
                                                    Ok(answer_sdp) => {
                                                        println!("Answer作成: {}", answer_sdp);
                                                        let answer_msg = signaling::SignalingMessage::Answer {
                                                            sdp: answer_sdp,
                                                            room_id: room_clone.clone(),
                                                        };
                                                        if let Ok(json) = serde_json::to_string(&answer_msg) {
                                                            if let Err(e) = ws_write.send(Message::Text(json)).await {
                                                                eprintln!("Answer送信失敗: {}", e);
                                                            }
                                                        }
                                                    },
                                                    Err(e) => eprintln!("Answer作成失敗: {}", e),
                                                }
                                            }
                                        },
                                        signaling::SignalingMessage::IceCandidate { candidate, .. } => {
                                            println!("リモートICE Candidate受信");
                                            if remote_description_set {
                                                if let Err(e) = session.add_ice_candidate(candidate).await {
                                                    eprintln!("ICE Candidate追加失敗: {}", e);
                                                }
                                            } else {
                                                println!("ICE Candidateをバッファリング中 (Remote Description未設定)");
                                                pending_candidates.push(candidate);
                                            }
                                        },
                                        signaling::SignalingMessage::VoiceActivity { client_id, is_speaking, .. } => {
                                            let payload = serde_json::json!({
                                                "client_id": client_id,
                                                "is_speaking": is_speaking
                                            });
                                            let _ = app_handle.emit("remote-voice-activity", payload);
                                        },
                                    }
                                }
                            },
                            Ok(Message::Close(_)) => {
                                println!("WS切断 (Close Frame)");
                                break; 
                            },
                            Err(e) => {
                                eprintln!("WSエラー: {}", e);
                                break;
                            },
                            _ => {}
                        }
                    },
                    
                    Some(candidate_json) = ice_rx.recv() => {
                            println!("ローカルICE Candidate送信...");
                            let ice_msg = signaling::SignalingMessage::IceCandidate {
                                candidate: candidate_json,
                                room_id: room_clone.clone(),
                            };
                            if let Ok(json) = serde_json::to_string(&ice_msg) {
                                if let Err(e) = ws_write.send(Message::Text(json)).await {
                                    eprintln!("ICE Candidate送信失敗: {}", e);
                                }
                            }
                    },

                    Some(is_speaking) = vad_rx.recv() => {
                         let vad_msg = signaling::SignalingMessage::VoiceActivity {
                             is_speaking,
                             room_id: room_clone.clone(),
                             client_id: local_client_id.clone(),
                         };
                         if let Ok(json) = serde_json::to_string(&vad_msg) {
                              let _ = ws_write.send(Message::Text(json)).await;
                         }
                    },

                    // Heartbeat: send Ping every 2 seconds
                    _ = heartbeat_interval.tick() => {
                        let ping_msg = signaling::SignalingMessage::Ping {
                            room_id: room_clone.clone(),
                            client_id: local_client_id.clone(),
                        };
                        if let Ok(json) = serde_json::to_string(&ping_msg) {
                            let _ = ws_write.send(Message::Text(json)).await;
                        }
                    },

                    // Check for peer timeouts every 1 second
                    _ = peer_timeout_check.tick() => {
                        let now = Instant::now();
                        for (peer_id, last_ping) in peer_last_ping.iter() {
                            if now.duration_since(*last_ping) > Duration::from_secs(6) {
                                println!("Peer {} timed out (no ping for 6s)", peer_id);
                                let _ = app_handle.emit("peer-left", peer_id.clone());
                                should_reset_pc = true;
                            }
                        }
                    }
                }
            } // End Signaling Loop

            // Stop audio capture for this PC cycle
            audio_cycle_flag.store(false, Ordering::SeqCst);
            
            // Close PC properly before continuing
            println!("Closing PeerConnection before reconnect...");
            let _ = session.pc.close().await;
            
            // Wait for audio thread to stop
            tokio::time::sleep(Duration::from_millis(500)).await;

            if !running_flag_clone.load(Ordering::Relaxed) {
                 println!("Signaling loop terminated by stop flag.");
                 break;
            }
            
            println!("シグナリング切断。3秒後に再接続します...");
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        }
    });

    // Basic Audio Device Check
    if let Err(e) = list_audio_devices() {
        eprintln!("Error listing audio devices: {}", e);
    }

    ActiveSession {
        handle,
        running_flag // Move ownership correctly now 
    }
}

fn list_audio_devices() -> Result<()> {
    let host = cpal::default_host();
    println!("Audio Host: {:?}", host.id());

    // Input Devices
    println!("--- Input Devices ---");
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                println!("Input: {}", name);
            }
        }
    }

    // Default Input
    if let Some(def_in) = host.default_input_device() {
        println!("Default Input: {}", def_in.name()?);
    } else {
        println!("No default input device found");
    }

    Ok(())
}
