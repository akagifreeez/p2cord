use serde::{Deserialize, Serialize};

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
    pub position: i32,
    pub last_message_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SimpleMessage {
    pub id: String,
    pub guild_id: String,
    pub channel_id: String,
    pub content: String,
    pub author: String,
    pub author_id: String,
    pub timestamp: String,
    pub embeds: Vec<DiscordEmbed>,

    pub attachments: Vec<DiscordAttachment>,
    pub referenced_message: Option<Box<SimpleMessage>>,
    pub message_snapshots: Vec<MessageSnapshot>,
    pub kind: String, // "Default", "UserJoin", "ChannelPin", etc.
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageSnapshot {
    pub message: SimpleMessageSnapshotData,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SimpleMessageSnapshotData {
    pub content: String,
    pub author: String,
    pub timestamp: String,
    pub embeds: Vec<DiscordEmbed>,
    pub attachments: Vec<DiscordAttachment>,
}

#[derive(Serialize, Clone)]
pub struct SimpleRole {
    pub id: String,
    pub name: String,
    pub color: u32,
    pub position: i32,
    pub hoist: bool,
}

#[derive(Serialize, Clone)]
pub struct SimpleMember {
    pub user: DiscordUser, // Reuse DiscordUser for simplicity as it has id, username, avatar
    pub roles: Vec<String>, // Role IDs
    pub nick: Option<String>,
    pub joined_at: String,
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

// --- Internal API Models (Deserialization) ---

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
    pub discriminator: String,
    pub avatar: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct DiscordGuild {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct DiscordChannel {
    pub id: String,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub kind: u8,
    pub parent_id: Option<String>,
    pub position: Option<i32>,
    pub thread_metadata: Option<DiscordThreadMetadata>,
    pub last_message_id: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct DiscordThreadMetadata {
    pub archived: bool,
}

#[derive(Deserialize, Debug)]
pub struct DiscordMessage {
    pub id: String,
    pub content: String,
    pub author: DiscordUser,
    pub timestamp: String,
    pub channel_id: String,
    pub embeds: Vec<DiscordEmbed>,
    pub attachments: Vec<DiscordAttachment>,
    pub thread: Option<DiscordChannel>,
    #[serde(default)]
    pub referenced_message: Option<Box<DiscordMessage>>,
    #[serde(default)]
    pub message_snapshots: Option<Vec<DiscordMessageSnapshot>>,
    #[serde(rename = "type", default)]
    pub kind: u8,
}

#[derive(Deserialize, Debug)]
pub struct DiscordMessageSnapshot {
    pub message: DiscordMessageSnapshotData,
}

#[derive(Deserialize, Debug)]
pub struct DiscordMessageSnapshotData {
    pub content: String,
    pub author: Option<DiscordUser>,
    pub timestamp: String,
    pub embeds: Vec<DiscordEmbed>,
    pub attachments: Vec<DiscordAttachment>,
}

#[derive(Deserialize, Debug)]
pub struct DiscordRole {
    pub id: String,
    pub name: String,
    pub color: u32,
    pub position: i32,
    pub hoist: bool,
    // permissions, managed, mentionable... (omitted)
}

#[derive(Deserialize, Debug)]
pub struct DiscordMember {
    pub user: Option<DiscordUser>, // Sometimes minimal objects missing user? usually present in member list
    pub roles: Vec<String>,
    pub nick: Option<String>,
    pub joined_at: String,
}

// --- Gateway Presence/Voice Models ---

/// アクティビティ情報 (Playing, Listening, etc.)
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Activity {
    pub name: String,
    #[serde(rename = "type", default)]
    pub activity_type: u8,  // 0=Playing, 1=Streaming, 2=Listening, 3=Watching, 4=Custom, 5=Competing
    pub state: Option<String>,
    pub details: Option<String>,
    pub emoji: Option<ActivityEmoji>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ActivityEmoji {
    pub name: Option<String>,
    pub id: Option<String>,
    pub animated: Option<bool>,
}

/// クライアントステータス (デスクトップ/モバイル/Web)
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ClientStatus {
    pub desktop: Option<String>,
    pub mobile: Option<String>,
    pub web: Option<String>,
}

/// プレゼンス情報
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MemberPresence {
    pub user_id: String,
    pub guild_id: String,
    pub status: String,  // "online", "idle", "dnd", "offline", "invisible"
    #[serde(default)]
    pub activities: Vec<Activity>,
    #[serde(default)]
    pub client_status: ClientStatus,
}

/// メンバー + プレゼンス（フロントエンド用の統合型）
#[derive(Serialize, Clone, Debug)]
pub struct MemberWithPresence {
    pub user: DiscordUser,
    pub roles: Vec<String>,
    pub nick: Option<String>,
    pub joined_at: String,
    pub status: String,
    pub activities: Vec<Activity>,
    pub client_status: ClientStatus,
}

/// ボイス状態
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VoiceState {
    pub user_id: String,
    pub channel_id: Option<String>,
    pub guild_id: Option<String>,
    #[serde(default)]
    pub self_mute: bool,
    #[serde(default)]
    pub self_deaf: bool,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub deaf: bool,
}

/// タイピング開始イベント
#[derive(Serialize, Clone, Debug)]
pub struct TypingStart {
    pub user_id: String,
    pub channel_id: String,
    pub guild_id: Option<String>,
    pub timestamp: u64,
}

#[derive(Deserialize, Debug)]
pub struct DiscordDMChannel {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: u8,
    pub last_message_id: Option<String>,
    pub recipients: Vec<DiscordUser>,
    pub name: Option<String>,
    pub icon: Option<String>,
    pub owner_id: Option<String>,
}

