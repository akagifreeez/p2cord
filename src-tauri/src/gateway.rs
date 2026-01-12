use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use serde_json::Value;
use std::time::Duration;
use futures_util::{StreamExt, SinkExt};

const GATEWAY_URL: &str = "wss://gateway.discord.gg/?v=10&encoding=json";

#[tauri::command]
pub async fn start_gateway(app: AppHandle, token: String) {
    tokio::spawn(async move {
        loop {
            println!("Connecting to Gateway...");
            match connect_to_gateway(&app, &token).await {
                Ok(_) => println!("Gateway connection closed, reconnecting..."),
                Err(e) => {
                    eprintln!("Gateway error: {}", e);
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    });
}

async fn connect_to_gateway(app: &AppHandle, token: &str) -> Result<(), String> {
    let url = Url::parse(GATEWAY_URL).map_err(|e| e.to_string())?;
    let (ws_stream, _) = connect_async(url).await.map_err(|e| e.to_string())?;
    println!("Connected to Discord Gateway");

    let (mut write, mut read) = ws_stream.split();

    // Channel for sending messages to the WebSocket Write task
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    
    // Spawn Write Task
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(e) = write.send(msg).await {
                eprintln!("WebSocket Write Error: {}", e);
                break;
            }
        }
    });

    // We need to send Identify when we receive Hello (or just after connecting, but Hello gives heartbeat interval)

    let token_clone = token.to_string();
    let tx_clone = tx.clone();

    while let Some(msg) = read.next().await {
        let msg = msg.map_err(|e| e.to_string())?;
        match msg {
            Message::Text(text) => {
                let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                let op = v["op"].as_u64().unwrap_or(0);
                
                match op {
                    10 => { // Hello
                        let heartbeat_interval = v["d"]["heartbeat_interval"].as_u64().unwrap_or(41250);
                        println!("Hello received. Heartbeat interval: {}", heartbeat_interval);
                        
                        // Send Identify
                        let identify = serde_json::json!({
                            "op": 2,
                            "d": {
                                "token": token_clone,
                                "properties": {
                                    "os": "windows",
                                    "browser": "p2d",
                                    "device": "p2d"
                                },
                                "capabilities": 16381,
                                "compress": false,
                                "presence": {
                                    "status": "online",
                                    "since": 0,
                                    "activities": [],
                                    "afk": false
                                }
                            }
                        });
                        tx_clone.send(Message::Text(identify.to_string())).map_err(|e| e.to_string())?;

                        // Spawn Heartbeat Loop
                        let tx_hb = tx_clone.clone();
                        let interval = heartbeat_interval;
                        tokio::spawn(async move {
                            loop {
                                tokio::time::sleep(Duration::from_millis(interval)).await;
                                let hb = serde_json::json!({ "op": 1, "d": null });
                                if let Err(_) = tx_hb.send(Message::Text(hb.to_string())) {
                                    break;
                                }
                            }
                        });
                    },
                    0 => { // Dispatch
                        let t = v["t"].as_str().unwrap_or("");
                        if t == "MESSAGE_CREATE" {
                             if let Ok(m) = serde_json::from_value::<crate::discord::SimpleMessage>(map_message(&v["d"])) {
                                 // DBに保存
                                 if let Some(db_state) = app.try_state::<crate::database::DatabaseState>() {
                                     if let Ok(conn) = db_state.conn.lock() {
                                         let _ = crate::database::save_message(&conn, &m);
                                     }
                                 }
                                 let _ = app.emit("message_create", m);
                             }
                        }
                    },
                    _ => {}
                }
            },
            Message::Close(_) => {
                return Err("Connection Closed".to_string());
            }
            _ => {}
        }
    }
    
    Ok(())
}

fn map_message(d: &Value) -> Value {
    // This helper maps raw Gateway Dispatch JSON to SimpleMessage JSON structure 
    let author_name = d["author"]["username"].as_str().unwrap_or("Unknown").to_string();
    let embeds = d.get("embeds").unwrap_or(&serde_json::json!([])).clone();
    let attachments = d.get("attachments").unwrap_or(&serde_json::json!([])).clone();
    let guild_id = d["guild_id"].as_str().unwrap_or("").to_string();
    
    serde_json::json!({
        "id": d["id"],
        "guild_id": guild_id,
        "channel_id": d["channel_id"],
        "content": d["content"],
        "author": author_name,
        "timestamp": d["timestamp"],
        "embeds": embeds,
        "attachments": attachments
    })
}
