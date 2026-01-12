use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct DiscordState {
    pub client: Arc<Mutex<Option<reqwest::Client>>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
        }
    }
}

// --- Discord API Models (Deserialization) ---

#[derive(Deserialize, Debug)]
struct DiscordUser {
    id: String,
    username: String,
    discriminator: String,
    // global_name: Option<String>,
}

#[derive(Deserialize, Debug)]
struct DiscordGuild {
    id: String,
    name: String,
    icon: Option<String>,
}

#[derive(Deserialize, Debug)]
struct DiscordChannel {
    id: String,
    name: Option<String>, // DMs might not have name
    #[serde(rename = "type")]
    kind: u8,
    parent_id: Option<String>,
}

#[derive(Deserialize, Debug)]
struct DiscordMessage {
    id: String,
    content: String,
    author: DiscordUser,
    timestamp: String,
    channel_id: String,
    embeds: Vec<DiscordEmbed>,
    attachments: Vec<DiscordAttachment>,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct DiscordAttachment {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub proxy_url: String,
    pub content_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct DiscordEmbed {
    pub title: Option<String>,
    pub description: Option<String>,
    pub url: Option<String>,
    pub color: Option<u32>,
    pub footer: Option<DiscordEmbedFooter>,
    pub image: Option<DiscordEmbedImage>,
    pub thumbnail: Option<DiscordEmbedThumbnail>,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct DiscordEmbedFooter {
    pub text: String,
    pub icon_url: Option<String>,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct DiscordEmbedImage {
    pub url: String,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct DiscordEmbedThumbnail {
    pub url: String,
}

// --- Frontend Models (Serialization) ---

#[derive(Serialize)]
pub struct SimpleGuild {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Serialize)]
pub struct SimpleChannel {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub parent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SimpleMessage {
    pub id: String,
    pub guild_id: String,
    pub channel_id: String,
    pub content: String,
    pub author: String,
    pub timestamp: String,
    pub embeds: Vec<DiscordEmbed>,
    pub attachments: Vec<DiscordAttachment>,
}

// --- Commands ---

const API_BASE: &str = "https://discord.com/api/v10";

#[tauri::command]
pub async fn init_client(token: String, state: State<'_, DiscordState>) -> Result<String, String> {
    // ヘッダーの構築 (Bot prefixなし、そのまま使う)
    let mut headers = HeaderMap::new();
    let mut auth_val = HeaderValue::from_str(&token).map_err(|_| "Invalid token format")?;
    auth_val.set_sensitive(true);
    headers.insert(AUTHORIZATION, auth_val);

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())?;

    // ログイン確認
    let res = client.get(format!("{}/users/@me", API_BASE))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Login failed: Status {}", res.status()));
    }

    let user: DiscordUser = res.json().await.map_err(|e| format!("Json parse error: {}", e))?;

    // State更新
    {
        let mut c = state.client.lock().unwrap();
        *c = Some(client);
    }

    Ok(format!("Logged in as: {}#{}", user.username, user.discriminator))
}

#[tauri::command]
pub async fn get_guilds(state: State<'_, DiscordState>) -> Result<Vec<SimpleGuild>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let res = client.get(format!("{}/users/@me/guilds", API_BASE))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("API Error: Status {} - {}", res.status(), res.text().await.unwrap_or_default()));
    }

    let guilds: Vec<DiscordGuild> = res.json().await.map_err(|e| e.to_string())?;

    Ok(guilds.into_iter().map(|g| SimpleGuild {
        id: g.id,
        name: g.name,
        icon: g.icon,
    }).collect())
}

#[tauri::command]
pub async fn get_channels(guild_id: String, state: State<'_, DiscordState>) -> Result<Vec<SimpleChannel>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let res = client.get(format!("{}/guilds/{}/channels", API_BASE, guild_id))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("API Error: Status {} - {}", res.status(), res.text().await.unwrap_or_default()));
    }

    let channels: Vec<DiscordChannel> = res.json().await.map_err(|e| e.to_string())?;

    Ok(channels.into_iter().map(|c| SimpleChannel {
        id: c.id,
        name: c.name.unwrap_or_else(|| "Unknown".to_string()),
        kind: map_channel_type(c.kind),
        parent_id: c.parent_id,
    }).collect())
}

#[tauri::command]
pub async fn get_messages(
    guild_id: String,
    channel_id: String, 
    before_id: Option<String>, 
    state: State<'_, DiscordState>,
    db_state: State<'_, crate::database::DatabaseState>,
) -> Result<Vec<SimpleMessage>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let url = match before_id {
        Some(before) => format!("{}/channels/{}/messages?limit=50&before={}", API_BASE, channel_id, before),
        None => format!("{}/channels/{}/messages?limit=50", API_BASE, channel_id),
    };

    let res = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("API Error: Status {} - {}", res.status(), res.text().await.unwrap_or_default()));
    }

    let messages: Vec<DiscordMessage> = res.json().await.map_err(|e| e.to_string())?;

    let simple_messages: Vec<SimpleMessage> = messages.into_iter().map(|m| SimpleMessage {
        id: m.id,
        guild_id: guild_id.clone(),
        channel_id: m.channel_id,
        content: m.content,
        author: m.author.username,
        timestamp: m.timestamp,
        embeds: m.embeds,
        attachments: m.attachments,
    }).collect();

    // DBに保存
    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        crate::database::save_messages(&conn, &simple_messages).ok(); // エラーは無視
    }

    Ok(simple_messages)
}

#[tauri::command]
pub async fn send_message(guild_id: String, channel_id: String, content: String, state: State<'_, DiscordState>) -> Result<SimpleMessage, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let map = serde_json::json!({
        "content": content
    });

    let res = client.post(format!("{}/channels/{}/messages", API_BASE, channel_id))
        .json(&map)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("API Error: Status {} - {}", res.status(), res.text().await.unwrap_or_default()));
    }

    let m: DiscordMessage = res.json().await.map_err(|e| e.to_string())?;

    Ok(SimpleMessage {
        id: m.id,
        guild_id,
        channel_id: m.channel_id,
        content: m.content,
        author: m.author.username,
        timestamp: m.timestamp,
        embeds: m.embeds,
        attachments: m.attachments,
    })
}

// バックグラウンドで全履歴を取得 (10分経過後に呼ばれる)
#[tauri::command]
pub async fn fetch_all_history(
    guild_id: String,
    channel_id: String,
    state: State<'_, DiscordState>,
    db_state: State<'_, crate::database::DatabaseState>,
) -> Result<u32, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let mut total_fetched: u32 = 0;
    let mut before_id: Option<String> = None;
    let max_iterations = 20; // 最大20回 (約1000件) で制限

    for _ in 0..max_iterations {
        let url = match &before_id {
            Some(before) => format!("{}/channels/{}/messages?limit=50&before={}", API_BASE, channel_id, before),
            None => format!("{}/channels/{}/messages?limit=50", API_BASE, channel_id),
        };

        let res = client.get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            break; // エラー時は終了
        }

        let messages: Vec<DiscordMessage> = res.json().await.map_err(|e| e.to_string())?;
        
        if messages.is_empty() {
            break; // もう取得するメッセージがない
        }

        let simple_messages: Vec<SimpleMessage> = messages.iter().map(|m| SimpleMessage {
            id: m.id.clone(),
            guild_id: guild_id.clone(),
            channel_id: m.channel_id.clone(),
            content: m.content.clone(),
            author: m.author.username.clone(),
            timestamp: m.timestamp.clone(),
            embeds: m.embeds.clone(),
            attachments: m.attachments.clone(),
        }).collect();

        // DBに保存
        {
            let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
            crate::database::save_messages(&conn, &simple_messages).ok();
        }

        total_fetched += simple_messages.len() as u32;
        before_id = messages.last().map(|m| m.id.clone());

        // レート制限対策: 1秒待つ
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
    }

    Ok(total_fetched)
}

// Discord APIで検索 (ハイブリッド検索用)
#[tauri::command]
pub async fn search_discord_api(
    guild_id: String,
    query: String,
    state: State<'_, DiscordState>,
    db_state: State<'_, crate::database::DatabaseState>,
) -> Result<Vec<SimpleMessage>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    // Discord Search API (非公式、User Token用)
    let url = format!(
        "{}/guilds/{}/messages/search?content={}",
        API_BASE,
        guild_id,
        urlencoding::encode(&query)
    );

    let res = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        // エラー時は空配列を返す（ローカル検索にフォールバック）
        return Ok(vec![]);
    }

    // Discord Search APIのレスポンス形式: { "messages": [[msg1], [msg2], ...] }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    
    let mut simple_messages: Vec<SimpleMessage> = Vec::new();
    
    if let Some(messages_array) = body["messages"].as_array() {
        for msg_wrapper in messages_array {
            if let Some(msg) = msg_wrapper.as_array().and_then(|arr| arr.first()) {
                if let Ok(m) = serde_json::from_value::<DiscordMessage>(msg.clone()) {
                    let simple = SimpleMessage {
                        id: m.id.clone(),
                        guild_id: guild_id.clone(),
                        channel_id: m.channel_id.clone(),
                        content: m.content.clone(),
                        author: m.author.username.clone(),
                        timestamp: m.timestamp.clone(),
                        embeds: m.embeds.clone(),
                        attachments: m.attachments.clone(),
                    };
                    
                    // DBにも保存
                    {
                        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
                        crate::database::save_message(&conn, &simple).ok();
                    }
                    
                    simple_messages.push(simple);
                }
            }
        }
    }

    Ok(simple_messages)
}


fn map_channel_type(kind: u8) -> String {
    match kind {
        0 => "Text".to_string(),
        1 => "DM".to_string(),
        2 => "Voice".to_string(),
        3 => "GroupDM".to_string(),
        4 => "Category".to_string(),
        5 => "News".to_string(),
        _ => format!("Type({})", kind),
    }
}
