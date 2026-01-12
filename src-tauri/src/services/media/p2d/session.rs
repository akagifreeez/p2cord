use anyhow::Result;
use webrtc::api::APIBuilder;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::RTCPeerConnection;
use std::sync::Arc;

use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::api::media_engine::MIME_TYPE_OPUS;
use webrtc::interceptor::registry::Registry;

use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::sdp::sdp_type::RTCSdpType;
use webrtc::ice_transport::ice_candidate::{RTCIceCandidate, RTCIceCandidateInit};
use tokio::sync::mpsc::Sender;

use std::sync::atomic::AtomicBool;

pub struct P2DSession {
    pub pc: Arc<RTCPeerConnection>,
    pub audio_track: Arc<TrackLocalStaticSample>,
}

impl P2DSession {
    pub async fn new(candidate_tx: Sender<String>, is_deafened: Arc<AtomicBool>) -> Result<Self> {
        // ... (MediaEngine, API setup same as before ...)
        // Create a MediaEngine object to configure the supported codec
        let mut m = MediaEngine::default();
        m.register_default_codecs()?;

        // Create a InterceptorRegistry. This is the user configurable RTP/RTCP Pipeline.
        let mut registry = Registry::new();
        registry = register_default_interceptors(registry, &mut m)?;

        // Create the API object with the MediaEngine
        let api = APIBuilder::new()
            .with_media_engine(m)
            .with_interceptor_registry(registry)
            .build();

        // Prepare the configuration
        let config = RTCConfiguration {
            ice_servers: vec![RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_owned()],
                ..Default::default()
            }],
            ..Default::default()
        };

        // Create a new RTCPeerConnection
        let pc = api.new_peer_connection(config).await?;

        // ICE接続状態の監視
        pc.on_ice_connection_state_change(Box::new(move |peer_connection_state: webrtc::ice_transport::ice_connection_state::RTCIceConnectionState| {
            println!("ICE接続状態変更: {}", peer_connection_state);
            Box::pin(async {})
        }));

        // On ICE Candidate
        let tx = candidate_tx.clone();
        pc.on_ice_candidate(Box::new(move |c: Option<RTCIceCandidate>| {
            let tx2 = tx.clone();
            Box::pin(async move {
                if let Some(candidate) = c {
                    if let Ok(json) = candidate.to_json() {
                         if let Ok(s) = serde_json::to_string(&json) {
                             let _ = tx2.send(s).await;
                         }
                    }
                }
            })
        }));

        // On Track (Receiver)
        let is_deafened_clone = is_deafened.clone();
        pc.on_track(Box::new(move |track, _, _| {
            let deaf_flag = is_deafened_clone.clone();
            Box::pin(async move {
                println!("トラック受信: {:?}", track.kind());
                
                if track.kind() == webrtc::rtp_transceiver::rtp_codec::RTPCodecType::Audio {
                    use audiopus::{coder::Decoder as OpusDecoder, Channels, SampleRate};
                    use crate::services::media::p2d::audio;
                    
                    println!("音声トラックを受信。再生パイプラインを開始します...");
                    
                    match audio::start_audio_playback(deaf_flag) {
                        Ok(tx) => {
                            // Stream is managed internally by audio::start_audio_playback thread
                            
                            // Decoder setup
                            let mut decoder = OpusDecoder::new(SampleRate::Hz48000, Channels::Stereo).unwrap();
                            let mut buf = [0.0f32; 1920 * 2]; // Max buffer size just in case

                            let mut pkt_count = 0u64;
                            while let Ok((rtp, _)) = track.read_rtp().await {
                                pkt_count += 1;
                                if pkt_count % 50 == 0 {
                                    println!("RTP受信: パケット #{} ({} bytes)", pkt_count, rtp.payload.len());
                                }

                                // Decode
                                // Input needs to be Option<&[u8]>. Output needs to be &mut [f32].
                                match decoder.decode_float(Some(&rtp.payload[..]), &mut buf[..], false) {
                                    Ok(len) => {
                                        // len is samples per channel. Stereo = len*2 total samples.
                                        let data = buf[0..len*2].to_vec();
                                        if let Err(e) = tx.send(data) {
                                            eprintln!("再生チャネルが閉じられました: {}", e);
                                            break;
                                        }
                                    },
                                    Err(e) => eprintln!("Opusデコードエラー: {}", e),
                                }
                            }
                        },
                        Err(e) => eprintln!("音声再生の開始に失敗しました: {}", e),
                    }
                }
            })
        }));

        // Create Audio Track (Opus)
        let audio_track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_OPUS.to_owned(),
                ..Default::default()
            },
            "audio".to_owned(),
            "p2cord".to_owned(),
        ));

        // Add this track to the PeerConnection
        pc.add_track(Arc::clone(&audio_track) as Arc<dyn TrackLocal + Send + Sync>)
            .await?;

        Ok(Self { 
            pc: Arc::new(pc),
            audio_track,
        })
    }
    
    pub async fn set_remote_description(&self, sdp: String, sdp_type: RTCSdpType) -> Result<()> {
        let mut desc = RTCSessionDescription::default();
        desc.sdp_type = sdp_type;
        desc.sdp = sdp;
        
        self.pc.set_remote_description(desc).await?;
        Ok(())
    }

    pub async fn add_ice_candidate(&self, candidate: String) -> Result<()> {
        let ice: RTCIceCandidateInit = serde_json::from_str(&candidate)?;
        self.pc.add_ice_candidate(ice).await?;
        Ok(())
    }

    pub async fn create_offer(&self) -> Result<String> {
        // Create Data Channel for verification
        let _dc = self.pc.create_data_channel("chat", None).await?;

        let offer = self.pc.create_offer(None).await?;
        self.pc.set_local_description(offer.clone()).await?;
        
        Ok(offer.sdp)
    }

    pub async fn create_answer(&self) -> Result<String> {
        let answer = self.pc.create_answer(None).await?;
        self.pc.set_local_description(answer.clone()).await?;
        Ok(answer.sdp)
    }
}
