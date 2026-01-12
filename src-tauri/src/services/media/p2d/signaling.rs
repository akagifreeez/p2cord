use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use url::Url;
use anyhow::{Result, Context};

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum SignalingMessage {
    Join { room_id: String, client_id: String },
    Leave { room_id: String, client_id: String },
    Ping { room_id: String, client_id: String },
    Welcome { room_id: String, client_id: String },
    Offer { sdp: String, room_id: String },
    Answer { sdp: String, room_id: String },
    IceCandidate { candidate: String, room_id: String },
    VoiceActivity { is_speaking: bool, client_id: String, room_id: String },
}

use futures::stream::{SplitSink, SplitStream};
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub type WsWrite = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;
pub type WsRead = SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;

pub async fn connect_signaling(room_id: String) -> Result<(WsWrite, WsRead)> {
    let url = Url::parse("ws://localhost:8080").context("Invalid URL")?;
    println!("Connecting to signaling server at {} for room {}", url, room_id);

    let (ws_stream, _) = connect_async(url).await.context("Failed to connect")?;
    println!("Connected to signaling server");

    let (mut write, read) = ws_stream.split();

    // Send Join Message
    // Handled in mod.rs to allow client_id generation
    // let join_msg = SignalingMessage::Join { room_id: room_id.clone() };
    // let json = serde_json::to_string(&join_msg)?;
    // write.send(Message::Text(json)).await?;

    Ok((write, read))
}
