use crate::services::models::{
    DiscordGuild, DiscordChannel, DiscordMessage, 
    SimpleGuild, SimpleChannel, SimpleMessage
};
use reqwest::Client;

const API_BASE: &str = "https://discord.com/api/v10";

fn map_channel_type(kind: u8) -> String {
    match kind {
        0 => "Text".to_string(),
        1 => "DM".to_string(),
        2 => "Voice".to_string(),
        3 => "GroupDM".to_string(),
        4 => "Category".to_string(),
        5 => "News".to_string(),
        10 => "AnnouncementThread".to_string(),
        11 => "PublicThread".to_string(),
        12 => "PrivateThread".to_string(),
        15 => "Forum".to_string(),
        _ => format!("Type({})", kind),
    }
}

pub async fn fetch_guilds(client: &Client) -> Result<Vec<SimpleGuild>, String> {
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

pub async fn fetch_channels(client: &Client, guild_id: String) -> Result<Vec<SimpleChannel>, String> {
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
        last_message_id: c.last_message_id,
    }).collect())
}

pub async fn fetch_active_threads(client: &Client, guild_id: String) -> Result<Vec<SimpleChannel>, String> {
    let res = client.get(format!("{}/guilds/{}/threads/active", API_BASE, guild_id))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("API Error: Status {} - {}", res.status(), res.text().await.unwrap_or_default()));
    }

    // Active threads response: { "threads": [ ... ], "members": [ ... ] }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    
    let mut simple_channels = Vec::new();

    if let Some(threads) = body["threads"].as_array() {
        println!("Found active threads: {}", threads.len());
        for t_value in threads {
             if let Ok(c) = serde_json::from_value::<DiscordChannel>(t_value.clone()) {
                simple_channels.push(SimpleChannel {
                    id: c.id,
                    name: c.name.unwrap_or_else(|| "Unknown Thread".to_string()),
                    kind: map_channel_type(c.kind),
                    parent_id: c.parent_id,
                    last_message_id: c.last_message_id,
                });
             } else {
                 println!("Failed to parse thread: {:?}", t_value);
             }
        }
    } else {
        println!("No threads array in response: {:?}", body);
    }

    Ok(simple_channels)
}

pub async fn fetch_archived_threads(client: &Client, channel_id: String) -> Result<Vec<SimpleChannel>, String> {
    let res = client.get(format!("{}/channels/{}/threads/archived/public", API_BASE, channel_id))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
         return Err(format!("API Error: Status {} - {}", res.status(), res.text().await.unwrap_or_default()));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut simple_channels = Vec::new();

    if let Some(threads) = body["threads"].as_array() {
        for t_value in threads {
             if let Ok(c) = serde_json::from_value::<DiscordChannel>(t_value.clone()) {
                // Ensure parent_id is set to channel_id (it should be, but just in case)
                let mut channel = SimpleChannel {
                    id: c.id,
                    name: c.name.unwrap_or_else(|| "Unknown Archived Thread".to_string()),
                    kind: map_channel_type(c.kind),
                    parent_id: Some(channel_id.clone()), // Explicitly link to parent
                    last_message_id: c.last_message_id,
                };
                // Archived threads data sometimes misses parent_id or it's implied
                if channel.parent_id.is_none() {
                    channel.parent_id = Some(channel_id.clone());
                }
                simple_channels.push(channel);
             }
        }
    }

    Ok(simple_channels)
}

pub async fn fetch_forum_active_threads(client: &Client, guild_id: String, channel_id: String) -> Result<Vec<SimpleChannel>, String> {
     // Use Search API to find threads in the channel (workaround for user token)
     // Query: channel_id={channel_id}
     let url = format!("{}/guilds/{}/messages/search?channel_id={}", API_BASE, guild_id, channel_id);
     
     println!("[fetch_forum_active_threads] Requesting URL: {}", url);

     let res = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
         return Err(format!("API Error: Status {} - {}", res.status(), res.text().await.unwrap_or_default()));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    
    let mut simple_channels = Vec::new();

    if let Some(threads_val) = body.get("threads").and_then(|t| t.as_array()) {
        println!("[fetch_forum_active_threads] Found {} threads in search response", threads_val.len());
        
        for t_val in threads_val {
            if let Ok(c) = serde_json::from_value::<DiscordChannel>(t_val.clone()) {
                // Filter out archived threads (we fetch them separately and want 'Active' ones)
                let is_archived = c.thread_metadata.as_ref().map(|m| m.archived).unwrap_or(false);
                
                if !is_archived {
                    let mut channel = SimpleChannel {
                        id: c.id,
                        name: c.name.unwrap_or_else(|| "Unknown Thread".to_string()),
                        kind: map_channel_type(c.kind),
                        parent_id: Some(channel_id.clone()),
                        last_message_id: c.last_message_id,
                    };
                    if channel.parent_id.is_none() {
                        channel.parent_id = Some(channel_id.clone());
                    }
                    simple_channels.push(channel);
                }
            } else {
                println!("[fetch_forum_active_threads] Failed to parse thread: {:?}", t_val);
            }
        }
    } else {
        println!("[fetch_forum_active_threads] No 'threads' array in search response");
    }

    println!("[fetch_forum_active_threads] Returning {} active threads", simple_channels.len());
    Ok(simple_channels)
}

pub async fn fetch_messages(client: &Client, channel_id: String, before_id: Option<String>) -> Result<Vec<SimpleMessage>, String> {
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

    // Note: SimpleMessage requires guild_id, but generic channel fetch might not have it contextually if not passed.
    // However, the function caller usually knows the guild_id.
    // We will return generic SimpleMesssage with "unknown" guild_id if strictly necessary, 
    // OR update the signature of fetch_messages to take guild_id.
    // But wait, fetch_messages_with_guid exists below. 
    // fetch_messages seems redundant or needs to be removed/merged.
    // For now, let's map it using empty string for guild_id as placeholder or remove this function if unused.
    // The previous implementation had a "return Ok(vec![])" placeholder.
    
    // Better approach: Since we have fetch_messages_with_guid, let's just make this function behave correctly or delegate.
    // But simpler: just map it.
    
    Ok(messages.into_iter().map(|m| SimpleMessage {
        id: m.id,
        guild_id: "".to_string(), // Missing context
        channel_id: m.channel_id,
        content: m.content,
        author: m.author.username,
        author_id: m.author.id,
        timestamp: m.timestamp,
        embeds: m.embeds,
        attachments: m.attachments,
    }).collect())
}

pub async fn fetch_messages_with_guid(client: &Client, guild_id: String, channel_id: String, before_id: Option<String>) -> Result<Vec<SimpleMessage>, String> {
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

    Ok(messages.into_iter().map(|m| SimpleMessage {
        id: m.id,
        guild_id: guild_id.clone(),
        channel_id: m.channel_id,
        content: m.content,
        author: m.author.username,
        author_id: m.author.id,
        timestamp: m.timestamp,
        embeds: m.embeds,
        attachments: m.attachments,
    }).collect())
}

pub async fn send_message(client: &Client, guild_id: String, channel_id: String, content: String) -> Result<SimpleMessage, String> {
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
        author_id: m.author.id,
        timestamp: m.timestamp,
        embeds: m.embeds,
        attachments: m.attachments,
    })
}

pub async fn search_discord(client: &Client, guild_id: String, query: String) -> Result<Vec<SimpleMessage>, String> {
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
        return Ok(vec![]);
    }

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
                        author_id: m.author.id.clone(),
                        timestamp: m.timestamp.clone(),
                        embeds: m.embeds.clone(),
                        attachments: m.attachments.clone(),
                    };
                    simple_messages.push(simple);
                }
            }
        }
    }

    Ok(simple_messages)
}
