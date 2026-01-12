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

#[derive(Deserialize, Debug)]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
    pub discriminator: String,
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
}
