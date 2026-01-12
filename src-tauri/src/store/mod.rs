// database.rs - SQLiteによるメッセージ永続化と検索

use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use tauri::State;

use crate::services::models::{SimpleMessage, DiscordEmbed, DiscordAttachment};

pub struct DatabaseState {
    pub conn: Arc<Mutex<Connection>>,
}

impl DatabaseState {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        let db_path = app_data_dir.join("messages.db");
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        
        // テーブル作成 (新規DB用)
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL DEFAULT '',
                channel_id TEXT NOT NULL,
                content TEXT,
                author TEXT,
                timestamp TEXT,
                embeds TEXT,
                attachments TEXT,
                attachment_filenames TEXT
            );
            "
        ).map_err(|e| e.to_string())?;
        
        // 既存DBのマイグレーション: guild_id カラムが存在しない場合に追加
        // エラーは無視（既にカラムが存在する場合）
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''", []);
        
        // インデックス作成 (マイグレーション後に実行)
        conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_channel ON messages(channel_id);
            CREATE INDEX IF NOT EXISTS idx_guild ON messages(guild_id);
            CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(channel_id, timestamp DESC);
            "
        ).map_err(|e| e.to_string())?;

        // FTS5テーブル作成 (存在しない場合のみ)
        let fts_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='messages_fts'",
            [],
            |row| row.get(0)
        ).unwrap_or(false);

        if !fts_exists {
            conn.execute_batch(
                "CREATE VIRTUAL TABLE messages_fts USING fts5(id, content, attachment_filenames, tokenize='unicode61');"
            ).map_err(|e| format!("FTS create error: {}", e))?;
        }

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }
}

// メッセージを保存
pub fn save_message(conn: &Connection, msg: &SimpleMessage) -> Result<(), String> {
    // 添付ファイル名を抽出 (スペース区切り)
    let attachment_filenames: String = msg.attachments.iter()
        .map(|a| a.filename.clone())
        .collect::<Vec<_>>()
        .join(" ");

    let embeds_json = serde_json::to_string(&msg.embeds).unwrap_or_default();
    let attachments_json = serde_json::to_string(&msg.attachments).unwrap_or_default();

    conn.execute(
        "INSERT OR REPLACE INTO messages (id, guild_id, channel_id, content, author, timestamp, embeds, attachments, attachment_filenames)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            msg.id,
            msg.guild_id,
            msg.channel_id,
            msg.content,
            msg.author,
            msg.timestamp,
            embeds_json,
            attachments_json,
            attachment_filenames,
        ],
    ).map_err(|e| e.to_string())?;

    // FTS更新 (重複防止のため先に削除)
    conn.execute(
        "DELETE FROM messages_fts WHERE id = ?1",
        params![msg.id],
    ).ok(); // エラーは無視
    
    conn.execute(
        "INSERT INTO messages_fts (id, content, attachment_filenames) VALUES (?1, ?2, ?3)",
        params![msg.id, msg.content, attachment_filenames],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// 複数メッセージを一括保存
pub fn save_messages(conn: &Connection, messages: &[SimpleMessage]) -> Result<(), String> {
    for msg in messages {
        save_message(conn, msg)?;
    }
    Ok(())
}

// キャッシュからメッセージ取得
#[tauri::command]
pub fn get_cached_messages(
    channel_id: String,
    before_id: Option<String>,
    limit: Option<u32>,
    state: State<'_, DatabaseState>,
) -> Result<Vec<SimpleMessage>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50) as i64;

    let mut messages = Vec::new();

    // before_idがある場合とない場合で別々にクエリ実行
    if let Some(before) = &before_id {
        let mut stmt = conn.prepare(
            "SELECT id, guild_id, channel_id, content, author, timestamp, embeds, attachments 
             FROM messages 
             WHERE channel_id = ?1 AND timestamp < (SELECT timestamp FROM messages WHERE id = ?2)
             ORDER BY timestamp DESC LIMIT ?3"
        ).map_err(|e| e.to_string())?;
        
        let mut rows = stmt.query(params![channel_id, before, limit]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let g_id: String = row.get(1).map_err(|e| e.to_string())?;
            let ch_id: String = row.get(2).map_err(|e| e.to_string())?;
            let content: String = row.get(3).map_err(|e| e.to_string())?;
            let author: String = row.get(4).map_err(|e| e.to_string())?;
            let timestamp: String = row.get(5).map_err(|e| e.to_string())?;
            let embeds_json: String = row.get(6).map_err(|e| e.to_string())?;
            let attachments_json: String = row.get(7).map_err(|e| e.to_string())?;
            
            let embeds: Vec<DiscordEmbed> = serde_json::from_str(&embeds_json).unwrap_or_default();
            let attachments: Vec<DiscordAttachment> = serde_json::from_str(&attachments_json).unwrap_or_default();
            
            messages.push(SimpleMessage {
                id, guild_id: g_id, channel_id: ch_id, content, author, timestamp, embeds, attachments,
            });
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, guild_id, channel_id, content, author, timestamp, embeds, attachments 
             FROM messages 
             WHERE channel_id = ?1
             ORDER BY timestamp DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        
        let mut rows = stmt.query(params![channel_id, limit]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let g_id: String = row.get(1).map_err(|e| e.to_string())?;
            let ch_id: String = row.get(2).map_err(|e| e.to_string())?;
            let content: String = row.get(3).map_err(|e| e.to_string())?;
            let author: String = row.get(4).map_err(|e| e.to_string())?;
            let timestamp: String = row.get(5).map_err(|e| e.to_string())?;
            let embeds_json: String = row.get(6).map_err(|e| e.to_string())?;
            let attachments_json: String = row.get(7).map_err(|e| e.to_string())?;
            
            let embeds: Vec<DiscordEmbed> = serde_json::from_str(&embeds_json).unwrap_or_default();
            let attachments: Vec<DiscordAttachment> = serde_json::from_str(&attachments_json).unwrap_or_default();
            
            messages.push(SimpleMessage {
                id, guild_id: g_id, channel_id: ch_id, content, author, timestamp, embeds, attachments,
            });
        }
    }

    Ok(messages)
}

// メッセージ検索 (FTS5) - サーバー全体検索
#[tauri::command]
pub fn search_messages(
    guild_id: String,
    query: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<SimpleMessage>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // FTSで検索し、guild_idでフィルタ (サーバー全体)
    let sql = "
        SELECT m.id, m.guild_id, m.channel_id, m.content, m.author, m.timestamp, m.embeds, m.attachments
        FROM messages_fts fts
        JOIN messages m ON fts.id = m.id
        WHERE messages_fts MATCH ?1 AND m.guild_id = ?2
        ORDER BY m.timestamp DESC
        LIMIT 500
    ";

    let fts_query = format!("\"{}\"", query.replace("\"", "\"\"")); // エスケープ

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![fts_query, guild_id]).map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let g_id: String = row.get(1).map_err(|e| e.to_string())?;
        let ch_id: String = row.get(2).map_err(|e| e.to_string())?;
        let content: String = row.get(3).map_err(|e| e.to_string())?;
        let author: String = row.get(4).map_err(|e| e.to_string())?;
        let timestamp: String = row.get(5).map_err(|e| e.to_string())?;
        let embeds_json: String = row.get(6).map_err(|e| e.to_string())?;
        let attachments_json: String = row.get(7).map_err(|e| e.to_string())?;

        let embeds: Vec<DiscordEmbed> = serde_json::from_str(&embeds_json).unwrap_or_default();
        let attachments: Vec<DiscordAttachment> = serde_json::from_str(&attachments_json).unwrap_or_default();
        
        messages.push(SimpleMessage {
            id,
            guild_id: g_id,
            channel_id: ch_id,
            content,
            author,
            timestamp,
            embeds,
            attachments,
        });
    }

    Ok(messages)
}
