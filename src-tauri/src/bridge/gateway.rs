use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use serde_json::Value;
use std::time::Duration;
use futures_util::{StreamExt, SinkExt};

const GATEWAY_URL: &str = "wss://gateway.discord.gg/?v=10&encoding=json";

use tokio::sync::mpsc::UnboundedSender;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct GatewaySender(pub Arc<Mutex<Option<UnboundedSender<Message>>>>);
pub struct SessionState(pub Arc<Mutex<Option<String>>>);

#[tauri::command]
pub async fn start_gateway(app: AppHandle, token: String, state: State<'_, GatewaySender>, session_state: State<'_, SessionState>) -> Result<(), String> {
    let state_clone = state.0.clone();
    let session_clone = session_state.0.clone();
    tokio::spawn(async move {
        loop {
            println!("Connecting to Gateway...");
            match connect_to_gateway(&app, &token, state_clone.clone(), session_clone.clone()).await {
                Ok(_) => println!("Gateway connection closed, reconnecting..."),
                Err(e) => {
                    eprintln!("Gateway error: {}", e);
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn update_status(status: String, state: State<'_, GatewaySender>) -> Result<(), String> {
    let sender_guard = state.0.lock().unwrap();
    if let Some(sender) = &*sender_guard {
        // Construct Presence Update payload
        let payload = serde_json::json!({
            "op": 3,
            "d": {
                "since": null,
                "activities": [],
                "status": status,
                "afk": false
            }
        });
        
        sender.send(Message::Text(payload.to_string())).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Gateway not connected".to_string())
    }
}

/// OP 14: Lazy Request - メンバーリストを購読
#[tauri::command]
pub async fn subscribe_member_list(
    guild_id: String, 
    channel_id: String, 
    state: State<'_, GatewaySender>
) -> Result<(), String> {
    let sender_guard = state.0.lock().unwrap();
    if let Some(sender) = &*sender_guard {
        println!("[Gateway] Sending OP 14 Lazy Request for guild: {}, channel: {}", guild_id, channel_id);
        
        // OP 14: Lazy Request payload
        let payload = serde_json::json!({
            "op": 14,
            "d": {
                "guild_id": guild_id,
                "typing": true,
                "threads": true,
                "activities": true,
                "members": [],
                "channels": {
                    (channel_id): [[0, 99]]  // 最初の100人を要求
                }
            }
        });
        
        sender.send(Message::Text(payload.to_string())).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Gateway not connected".to_string())
    }
}

async fn connect_to_gateway(
    app: &AppHandle,
    token: &str,
    sender_state: Arc<Mutex<Option<UnboundedSender<Message>>>>,
    session_state: Arc<Mutex<Option<String>>>
) -> Result<(), String> {
    let url = Url::parse(GATEWAY_URL).map_err(|e| e.to_string())?;
    let (ws_stream, _) = connect_async(url).await.map_err(|e| e.to_string())?;
    println!("Connected to Discord Gateway");

    let (mut write, mut read) = ws_stream.split();

    // Channel for sending messages to the WebSocket Write task
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    
    // Store sender in state
    {
        let mut guard = sender_state.lock().unwrap();
        *guard = Some(tx.clone());
    }
    
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
                        
                        // READY イベントで session_id を取得
                        if t == "READY" {
                            if let Some(session_id) = v["d"]["session_id"].as_str() {
                                println!("Received READY event, session_id: {}", session_id);
                                if let Ok(mut lock) = session_state.lock() {
                                    *lock = Some(session_id.to_string());
                                }
                            }
                        }

                        if t == "MESSAGE_CREATE" {
                            match serde_json::from_value::<crate::services::models::SimpleMessage>(map_message(&v["d"])) {
                                Ok(m) => {
                                    // DBに保存
                                    if let Some(db_state) = app.try_state::<crate::store::DatabaseState>() {
                                        if let Ok(conn) = db_state.conn.lock() {
                                            let _ = crate::store::save_message(&conn, &m);
                                        }
                                    }
                                    let _ = app.emit("message_create", m);
                                },
                                Err(e) => {
                                    println!("[Gateway] Failed to parse message: {:?}", e);
                                }
                            }
                        }
                        else if t == "MESSAGE_DELETE" {
                            let id = v["d"]["id"].as_str().unwrap_or("").to_string();
                            let channel_id = v["d"]["channel_id"].as_str().unwrap_or("").to_string();
                            let guild_id = v["d"]["guild_id"].as_str().unwrap_or("").to_string();
                            
                            // Emit event to frontend
                            let payload = serde_json::json!({
                                "id": id,
                                "channel_id": channel_id,
                                "guild_id": guild_id
                            });
                            let _ = app.emit("message_delete", payload);
                        }
                        // PRESENCE_UPDATE: ステータス変更
                        else if t == "PRESENCE_UPDATE" {
                            handle_presence_update(app, &v["d"]);
                        }
                        // VOICE_STATE_UPDATE: ボイス状態変更
                        else if t == "VOICE_STATE_UPDATE" {
                            handle_voice_state_update(app, &v["d"]);
                        }
                        // TYPING_START: タイピング中
                        else if t == "TYPING_START" {
                            handle_typing_start(app, &v["d"]);
                        }
                        // GUILD_MEMBER_LIST_UPDATE: OP 14 レスポンス
                        else if t == "GUILD_MEMBER_LIST_UPDATE" {
                            handle_member_list_update(app, &v["d"]);
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
    let author_id = d["author"]["id"].as_str().unwrap_or("").to_string();
    let embeds = d.get("embeds").unwrap_or(&serde_json::json!([])).clone();
    let attachments = d.get("attachments").unwrap_or(&serde_json::json!([])).clone();
    let guild_id = d["guild_id"].as_str().unwrap_or("").to_string();
    
    // Referenced Message Mapping (Simplified to avoid recursion complexity in single pass)
    let referenced_message = if let Some(rm) = d.get("referenced_message").filter(|v| !v.is_null()) {
        let rm_author_name = rm["author"]["username"].as_str().unwrap_or("Unknown").to_string();
        let rm_author_id = rm["author"]["id"].as_str().unwrap_or("").to_string();
        let rm_embeds = rm.get("embeds").unwrap_or(&serde_json::json!([])).clone();
        let rm_attachments = rm.get("attachments").unwrap_or(&serde_json::json!([])).clone();

        Some(serde_json::json!({
            "id": rm["id"],
            "guild_id": rm.get("guild_id").and_then(|v| v.as_str()).unwrap_or(&guild_id), // Fallback to current guild
            "channel_id": rm["channel_id"],
            "content": rm["content"],
            "author": rm_author_name,
            "author_id": rm_author_id,
            "timestamp": rm["timestamp"],
            "embeds": rm_embeds,
            "attachments": rm_attachments,
            "referenced_message": null,
            "message_snapshots": [],
            "kind": "Default"
        }))
    } else {
        None
    };
    
    // Message Snapshots Mapping
    let message_snapshots = if let Some(snapshots) = d.get("message_snapshots").and_then(|v| v.as_array()) {
        snapshots.iter().map(|s| {
            let msg = &s["message"];
            let s_author_name = msg["author"]["username"].as_str().unwrap_or("Unknown").to_string();
            let s_embeds = msg.get("embeds").unwrap_or(&serde_json::json!([])).clone();
            let s_attachments = msg.get("attachments").unwrap_or(&serde_json::json!([])).clone();
            
            serde_json::json!({
                "message": {
                    "content": msg["content"],
                    "author": s_author_name,
                    "timestamp": msg["timestamp"],
                    "embeds": s_embeds,
                    "attachments": s_attachments
                }
            })
        }).collect::<Vec<_>>()
    } else {
        vec![]
    };

    // Message Type Mapping
    let kind_val = d.get("type").and_then(|v| v.as_u64()).unwrap_or(0);
    let kind = match kind_val {
        0 | 19 => "Default",
        6 => "ChannelPinnedMessage",
        7 => "UserJoin",
        8 => "GuildBoost",
        9 => "GuildBoostTier1",
        10 => "GuildBoostTier2",
        11 => "GuildBoostTier3",
        12 => "ChannelFollowAdd",
        18 => "ThreadCreated",
        21 => "ThreadStarterMessage",
        _ => "Default",
    }.to_string();

    serde_json::json!({
        "id": d["id"],
        "guild_id": guild_id,
        "channel_id": d["channel_id"],
        "content": d["content"],
        "author": author_name,
        "author_id": author_id,
        "timestamp": d["timestamp"],
        "embeds": embeds,
        "attachments": attachments,
        "referenced_message": referenced_message,
        "message_snapshots": message_snapshots,
        "kind": kind
    })
}

// --- Gateway イベントハンドラー ---

/// PRESENCE_UPDATE イベント処理
fn handle_presence_update(app: &AppHandle, d: &Value) {
    let user_id = d["user"]["id"].as_str().unwrap_or("").to_string();
    let guild_id = d["guild_id"].as_str().unwrap_or("").to_string();
    let status = d["status"].as_str().unwrap_or("offline").to_string();
    
    // アクティビティを抽出
    let activities: Vec<serde_json::Value> = d["activities"]
        .as_array()
        .map(|arr| arr.iter().map(|a| {
            serde_json::json!({
                "name": a["name"].as_str().unwrap_or(""),
                "type": a["type"].as_u64().unwrap_or(0),
                "state": a["state"],
                "details": a["details"],
            })
        }).collect())
        .unwrap_or_default();
    
    // クライアントステータス
    let client_status = serde_json::json!({
        "desktop": d["client_status"]["desktop"],
        "mobile": d["client_status"]["mobile"],
        "web": d["client_status"]["web"],
    });
    
    // GuildStateに保存
    if let Some(state) = app.try_state::<crate::services::guild_state::GuildStateHandle>() {
        if let Ok(mut store) = state.lock() {
            let user = crate::services::models::DiscordUser {
                id: user_id.clone(),
                username: d["user"]["username"].as_str().unwrap_or("Unknown").to_string(),
                discriminator: d["user"]["discriminator"].as_str().unwrap_or("0").to_string(),
                avatar: d["user"]["avatar"].as_str().map(|s| s.to_string()),
            };
            
            let activities_vec: Vec<crate::services::models::Activity> = d["activities"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|a| {
                    serde_json::from_value(a.clone()).ok()
                }).collect())
                .unwrap_or_default();
            
            let client_status_obj: crate::services::models::ClientStatus = 
                serde_json::from_value(d["client_status"].clone()).unwrap_or_default();
            
            store.ensure_member_exists(&guild_id, user, status.clone(), activities_vec, client_status_obj);
        }
    }
    
    // フロントエンドにemit
    let payload = serde_json::json!({
        "user_id": user_id,
        "guild_id": guild_id,
        "status": status,
        "activities": activities,
        "client_status": client_status,
    });
    let _ = app.emit("presence_update", payload);
}

/// VOICE_STATE_UPDATE イベント処理
fn handle_voice_state_update(app: &AppHandle, d: &Value) {
    let user_id = d["user_id"].as_str().unwrap_or("").to_string();
    let channel_id = d["channel_id"].as_str().map(|s| s.to_string());
    let guild_id = d["guild_id"].as_str().unwrap_or("").to_string();
    let self_mute = d["self_mute"].as_bool().unwrap_or(false);
    let self_deaf = d["self_deaf"].as_bool().unwrap_or(false);
    let mute = d["mute"].as_bool().unwrap_or(false);
    let deaf = d["deaf"].as_bool().unwrap_or(false);
    
    // GuildStateに保存
    if let Some(state) = app.try_state::<crate::services::guild_state::GuildStateHandle>() {
        if let Ok(mut store) = state.lock() {
            let voice_state = crate::services::models::VoiceState {
                user_id: user_id.clone(),
                channel_id: channel_id.clone(),
                guild_id: Some(guild_id.clone()),
                self_mute,
                self_deaf,
                mute,
                deaf,
            };
            store.update_voice_state(&guild_id, voice_state);
        }
    }
    
    // フロントエンドにemit
    let payload = serde_json::json!({
        "user_id": user_id,
        "channel_id": channel_id,
        "guild_id": guild_id,
        "self_mute": self_mute,
        "self_deaf": self_deaf,
        "mute": mute,
        "deaf": deaf,
    });
    let _ = app.emit("voice_state_update", payload);
}

/// TYPING_START イベント処理
fn handle_typing_start(app: &AppHandle, d: &Value) {
    let user_id = d["user_id"].as_str().unwrap_or("").to_string();
    let channel_id = d["channel_id"].as_str().unwrap_or("").to_string();
    let guild_id = d["guild_id"].as_str().map(|s| s.to_string());
    let timestamp = d["timestamp"].as_u64().unwrap_or(0);
    
    let payload = serde_json::json!({
        "user_id": user_id,
        "channel_id": channel_id,
        "guild_id": guild_id,
        "timestamp": timestamp,
    });
    let _ = app.emit("typing_start", payload);
}

/// GUILD_MEMBER_LIST_UPDATE (OP 14 レスポンス) 処理
fn handle_member_list_update(app: &AppHandle, d: &Value) {
    let guild_id = d["guild_id"].as_str().unwrap_or("").to_string();
    
    // ops配列を処理
    if let Some(ops) = d["ops"].as_array() {
        for op in ops {
            let op_type = op["op"].as_str().unwrap_or("");
            
            match op_type {
                "SYNC" => {
                    // メンバーリストの同期
                    if let Some(items) = op["items"].as_array() {
                        for item in items {
                            if let Some(member_data) = item.get("member") {
                                process_member_item(app, &guild_id, member_data);
                            }
                        }
                    }
                },
                "INSERT" | "UPDATE" => {
                    // 単一メンバーの挿入/更新
                    if let Some(item) = op.get("item") {
                        if let Some(member_data) = item.get("member") {
                            process_member_item(app, &guild_id, member_data);
                        }
                    }
                },
                "DELETE" => {
                    // メンバー削除（オフライン等）
                    // 現時点では無視（プレゼンスで処理）
                },
                _ => {}
            }
        }
    }
    
    // member_countを通知
    let member_count = d["member_count"].as_u64().unwrap_or(0);
    let online_count = d["online_count"].as_u64().unwrap_or(0);
    
    let payload = serde_json::json!({
        "guild_id": guild_id,
        "member_count": member_count,
        "online_count": online_count,
    });
    let _ = app.emit("member_list_update", payload);
}

/// メンバーアイテムを処理してストアに保存
fn process_member_item(app: &AppHandle, guild_id: &str, member_data: &Value) {
    let user_data = &member_data["user"];
    let user_id = user_data["id"].as_str().unwrap_or("").to_string();
    
    if user_id.is_empty() {
        return;
    }
    
    let user = crate::services::models::DiscordUser {
        id: user_id.clone(),
        username: user_data["username"].as_str().unwrap_or("Unknown").to_string(),
        discriminator: user_data["discriminator"].as_str().unwrap_or("0").to_string(),
        avatar: user_data["avatar"].as_str().map(|s| s.to_string()),
    };
    
    let roles: Vec<String> = member_data["roles"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|r| r.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    
    let nick = member_data["nick"].as_str().map(|s| s.to_string());
    let joined_at = member_data["joined_at"].as_str().unwrap_or("").to_string();
    
    // プレゼンス情報（GUILD_MEMBER_LIST_UPDATEにはプレゼンスが含まれる場合がある）
    let presence = &member_data["presence"];
    let status = presence["status"].as_str().unwrap_or("offline").to_string();
    
    let activities: Vec<crate::services::models::Activity> = presence["activities"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|a| serde_json::from_value(a.clone()).ok()).collect())
        .unwrap_or_default();
    
    let client_status: crate::services::models::ClientStatus = 
        serde_json::from_value(presence["client_status"].clone()).unwrap_or_default();
    
    // ストアに保存
    if let Some(state) = app.try_state::<crate::services::guild_state::GuildStateHandle>() {
        if let Ok(mut store) = state.lock() {
            let member_with_presence = crate::services::models::MemberWithPresence {
                user,
                roles,
                nick,
                joined_at,
                status,
                activities,
                client_status,
            };
            store.upsert_member(guild_id, member_with_presence);
        }
    }
}

