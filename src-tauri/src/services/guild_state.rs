// Guild Member/Presence/Voice State ストア
// Gateway経由で受信したメンバー情報を保持する

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use crate::services::models::{
    DiscordUser, Activity, ClientStatus, MemberWithPresence, VoiceState
};

/// ギルドごとのメンバー・プレゼンス・ボイス状態を管理
#[derive(Default)]
pub struct GuildMemberStore {
    // guild_id -> { user_id -> MemberWithPresence }
    pub members: HashMap<String, HashMap<String, MemberWithPresence>>,
    // guild_id -> { user_id -> VoiceState }
    pub voice_states: HashMap<String, HashMap<String, VoiceState>>,
}

impl GuildMemberStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// メンバーを追加/更新
    pub fn upsert_member(&mut self, guild_id: &str, member: MemberWithPresence) {
        let guild_members = self.members.entry(guild_id.to_string()).or_insert_with(HashMap::new);
        guild_members.insert(member.user.id.clone(), member);
    }

    /// プレゼンスを更新（メンバーが存在する場合）
    pub fn update_presence(
        &mut self,
        guild_id: &str,
        user_id: &str,
        status: String,
        activities: Vec<Activity>,
        client_status: ClientStatus,
    ) {
        if let Some(guild_members) = self.members.get_mut(guild_id) {
            if let Some(member) = guild_members.get_mut(user_id) {
                member.status = status;
                member.activities = activities;
                member.client_status = client_status;
            }
        }
    }

    /// メンバーがまだ存在しない場合、最小限の情報で追加
    pub fn ensure_member_exists(
        &mut self,
        guild_id: &str,
        user: DiscordUser,
        status: String,
        activities: Vec<Activity>,
        client_status: ClientStatus,
    ) {
        let guild_members = self.members.entry(guild_id.to_string()).or_insert_with(HashMap::new);
        if !guild_members.contains_key(&user.id) {
            guild_members.insert(user.id.clone(), MemberWithPresence {
                user,
                roles: vec![],
                nick: None,
                joined_at: String::new(),
                status,
                activities,
                client_status,
            });
        } else {
            // 既存メンバーのプレゼンスを更新
            if let Some(member) = guild_members.get_mut(&user.id.clone()) {
                member.status = status;
                member.activities = activities;
                member.client_status = client_status;
            }
        }
    }

    /// ボイス状態を更新
    pub fn update_voice_state(&mut self, guild_id: &str, voice_state: VoiceState) {
        let guild_voice = self.voice_states.entry(guild_id.to_string()).or_insert_with(HashMap::new);
        
        // channel_id が None の場合はボイスチャンネルから退出
        if voice_state.channel_id.is_none() {
            guild_voice.remove(&voice_state.user_id);
        } else {
            guild_voice.insert(voice_state.user_id.clone(), voice_state);
        }
    }

    /// ギルドのメンバー一覧を取得
    pub fn get_members(&self, guild_id: &str) -> Vec<MemberWithPresence> {
        self.members.get(guild_id)
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default()
    }

    /// ギルドのボイス状態一覧を取得
    pub fn get_voice_states(&self, guild_id: &str) -> Vec<VoiceState> {
        self.voice_states.get(guild_id)
            .map(|v| v.values().cloned().collect())
            .unwrap_or_default()
    }

    /// ギルドをクリア
    pub fn clear_guild(&mut self, guild_id: &str) {
        self.members.remove(guild_id);
        self.voice_states.remove(guild_id);
    }
}

/// Tauriで管理するための型エイリアス
pub type GuildStateHandle = Arc<Mutex<GuildMemberStore>>;

/// 新しいGuildStateHandleを作成
pub fn create_guild_state() -> GuildStateHandle {
    Arc::new(Mutex::new(GuildMemberStore::new()))
}
