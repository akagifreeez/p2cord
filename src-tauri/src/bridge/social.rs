use tauri::State;
use crate::services::models::{SimpleGuild, SimpleChannel, SimpleMessage, SimpleRole, SimpleMember};
use crate::services::state::DiscordState;
use crate::services::social;
use crate::store::DatabaseState as DbState; 

#[tauri::command]
pub async fn get_guilds(state: State<'_, DiscordState>) -> Result<Vec<SimpleGuild>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    social::fetch_guilds(&client).await
}

#[tauri::command]
pub async fn get_roles(guild_id: String, state: State<'_, DiscordState>) -> Result<Vec<SimpleRole>, String> {
    println!("[get_roles] Called for guild: {}", guild_id);
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let result = social::fetch_roles(&client, guild_id).await;
    match &result {
        Ok(roles) => println!("[get_roles] Fetched {} roles", roles.len()),
        Err(e) => println!("[get_roles] Error: {}", e),
    }
    result
}

#[tauri::command]
pub async fn get_members(guild_id: String, state: State<'_, DiscordState>) -> Result<Vec<SimpleMember>, String> {
    println!("[get_members] Called for guild: {}", guild_id);
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let result = social::fetch_members(&client, guild_id).await;
    match &result {
        Ok(members) => println!("[get_members] Fetched {} members", members.len()),
        Err(e) => println!("[get_members] Error: {}", e),
    }
    result
}

/// Gateway経由で収集したメンバー情報を取得（プレゼンス付き）
#[tauri::command]
pub fn get_guild_members_from_store(
    guild_id: String, 
    state: State<'_, crate::services::guild_state::GuildStateHandle>
) -> Result<Vec<crate::services::models::MemberWithPresence>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok(store.get_members(&guild_id))
}

/// Gateway経由で収集したボイス状態を取得
#[tauri::command]
pub fn get_voice_states(
    guild_id: String, 
    state: State<'_, crate::services::guild_state::GuildStateHandle>
) -> Result<Vec<crate::services::models::VoiceState>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok(store.get_voice_states(&guild_id))
}

#[tauri::command]
pub async fn get_channels(guild_id: String, state: State<'_, DiscordState>) -> Result<Vec<SimpleChannel>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let mut channels = social::fetch_channels(&client, guild_id.clone()).await?;
    
    // Fetch active threads (ignore error to keep channels working if threads fail)
    match social::fetch_active_threads(&client, guild_id).await {
        Ok(threads) => channels.extend(threads),
        Err(e) => println!("Failed to fetch active threads: {}", e),
    }

    Ok(channels)
}

#[tauri::command]
pub async fn get_archived_threads(channel_id: String, state: State<'_, DiscordState>) -> Result<Vec<SimpleChannel>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    social::fetch_archived_threads(&client, channel_id).await
}

#[tauri::command]
pub async fn get_forum_active_threads(guild_id: String, channel_id: String, state: State<'_, DiscordState>) -> Result<Vec<SimpleChannel>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    social::fetch_forum_active_threads(&client, guild_id, channel_id).await
}

#[tauri::command]
pub async fn get_messages(
    guild_id: String,
    channel_id: String, 
    before_id: Option<String>, 
    state: State<'_, DiscordState>,
    db_state: State<'_, DbState>,
) -> Result<Vec<SimpleMessage>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let messages = social::fetch_messages_with_guid(&client, guild_id, channel_id, before_id).await?;

    // Save to Cache (Store)
    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        crate::store::save_messages(&conn, &messages).ok();
    }

    Ok(messages)
}

#[tauri::command]
pub async fn send_message(guild_id: String, channel_id: String, content: String, reply_to: Option<String>, state: State<'_, DiscordState>) -> Result<SimpleMessage, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    social::send_message(&client, guild_id, channel_id, content, reply_to).await
}

#[tauri::command]
pub async fn delete_message(channel_id: String, message_id: String, state: State<'_, DiscordState>) -> Result<(), String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    social::delete_message(&client, channel_id, message_id).await
}

#[tauri::command]
pub async fn fetch_all_history(
    guild_id: String,
    channel_id: String,
    state: State<'_, DiscordState>,
    db_state: State<'_, DbState>,
) -> Result<u32, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    // Note: fetch_all_history logic involves loop and state updates, easier to keep in Bridge?
    // Or move pure loop logic to Service.
    // Service functions are usually stateless or single request.
    // But fetch_all_history saves to DB periodically.
    // For strict separation, Bridge should coordinate.
    // Let's implement the loop here using social service for fetching.
    
    let mut total_fetched: u32 = 0;
    let mut before_id: Option<String> = None;
    let max_iterations = 20;

    for _ in 0..max_iterations {
        let messages = social::fetch_messages_with_guid(&client, guild_id.clone(), channel_id.clone(), before_id.clone()).await;

        match messages {
            Ok(msgs) => {
                if msgs.is_empty() { break; }
                
                // Save to DB
                {
                     let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
                     crate::store::save_messages(&conn, &msgs).ok();
                }

                total_fetched += msgs.len() as u32;
                before_id = msgs.last().map(|m| m.id.clone());
                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            },
            Err(_) => break,
        }
    }

    Ok(total_fetched)
}

#[tauri::command]
pub async fn search_discord_api(
    guild_id: String,
    query: String,
    state: State<'_, DiscordState>,
    db_state: State<'_, DbState>,
) -> Result<Vec<SimpleMessage>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let messages = social::search_discord(&client, guild_id, query).await?;

    // Save to DB
    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        for m in &messages {
            crate::store::save_message(&conn, m).ok();
        }
    }

    Ok(messages)
}

// =============================
// Application Commands (BOT Slash Commands)
// =============================

#[tauri::command]
pub async fn get_application_commands(
    guild_id: Option<String>,
    state: State<'_, DiscordState>
) -> Result<Vec<social::ApplicationCommand>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    social::fetch_application_commands(&client, guild_id).await
}

#[tauri::command]
pub async fn send_interaction(
    channel_id: String,
    guild_id: Option<String>,
    application_id: String,
    data: social::InteractionData,
    session_id: String,
    state: State<'_, DiscordState>
) -> Result<(), String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    social::send_interaction(&client, channel_id, guild_id, application_id, data, session_id).await
}
