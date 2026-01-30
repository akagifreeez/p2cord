import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useSessionStore } from './stores/sessionStore';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { VoiceLayout } from './components/VoiceLayout';
import { ChannelChat } from './components/ChannelChat';
import { MemberSidebar, SimpleRole, MemberWithPresence } from './components/MemberSidebar';
import { useWebRTC } from './hooks/useWebRTC';
import { useWindowPosition } from './hooks/useWindowPosition';
import { registerCoreCommands } from './services/commands/definitions/core';

interface Guild {
    id: string;
    name: string;
    icon?: string;
}

interface Channel {
    id: string;
    name: string;
    kind: string;
    parent_id?: string;
    position: number;
    last_message_id?: string;
}

interface Embed {
    title?: string;
    description?: string;
    url?: string;
    color?: number;
    footer?: { text: string; icon_url?: string };
    image?: { url: string };
    thumbnail?: { url: string };
}

interface Attachment {
    id: string;
    url: string;
    filename: string;
    content_type?: string;
    width?: number;
    height?: number;
}

interface Message {
    id: string;
    guild_id: string;
    channel_id: string;
    content: string;
    author: string;
    author_id?: string;
    timestamp: string;
    embeds: Embed[];
    attachments: Attachment[];
    referenced_message?: Message;
    message_snapshots?: MessageSnapshot[];
    kind: string;
}

export interface MessageSnapshot {
    message: {
        content: string;
        author: string;
        timestamp: string;
        embeds: Embed[];
        attachments: Attachment[];
    }
}

interface SimpleMessage {
    id: string;
    guild_id: string;
    channel_id: string;
    author_id: string;
    author: string; // Correct field name from Rust
    // author_avatar: string; // Rust definition doesn't seem to have this?
    content: string;
    timestamp: string;
    embeds: Embed[];
    attachments: Attachment[]; // Rust sends Vec<DiscordAttachment> objects, not string
    referenced_message?: SimpleMessage | null;
    message_snapshots?: MessageSnapshot[];
    kind: string;
}

type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible';

const STATUS_CONFIG: Record<UserStatus, { label: string, color: string, indicatorColor: string }> = {
    online: { label: 'Online', color: 'text-green-500', indicatorColor: 'bg-green-500' },
    idle: { label: 'Idle', color: 'text-yellow-500', indicatorColor: 'bg-yellow-500' },
    dnd: { label: 'Do Not Disturb', color: 'text-red-500', indicatorColor: 'bg-red-500' },
    invisible: { label: 'Invisible', color: 'text-gray-500', indicatorColor: 'bg-gray-500' },
};


function App() {

    const webrtc = useWebRTC({ signalingUrl: 'ws://localhost:8080' });

    // ウィンドウ位置管理（マルチモニター対応）
    useWindowPosition();

    // Register built-in slash commands
    useEffect(() => {
        registerCoreCommands();
    }, []);

    // Listen for real-time messages
    useEffect(() => {
        const unlistenPromise = listen<SimpleMessage>('message_create', (event) => {
            const msg = event.payload;
            console.log("[App] Realtime Message:", msg);

            // Only add if it belongs to the current channel
            if (selectedChannelRef.current === msg.channel_id) {
                const newMsg: Message = {
                    id: msg.id,
                    guild_id: msg.guild_id || "",
                    channel_id: msg.channel_id!,
                    content: msg.content,
                    author: msg.author,
                    author_id: msg.author_id,
                    timestamp: msg.timestamp,
                    embeds: msg.embeds || [],
                    attachments: msg.attachments || [],
                    referenced_message: msg.referenced_message ? {
                        id: msg.referenced_message.id,
                        guild_id: msg.referenced_message.guild_id || "",
                        channel_id: msg.referenced_message.channel_id,
                        content: msg.referenced_message.content,
                        author: msg.referenced_message.author,
                        author_id: msg.referenced_message.author_id,
                        timestamp: msg.referenced_message.timestamp,
                        embeds: msg.referenced_message.embeds || [],
                        attachments: msg.referenced_message.attachments || [],
                        referenced_message: undefined, // Avoid infinite recursion
                        kind: msg.referenced_message.kind || 'Default'
                    } : undefined,
                    message_snapshots: msg.message_snapshots || [],
                    kind: msg.kind || 'Default'
                };

                setMessages(prev => {
                    if (prev.some(m => m.id === newMsg.id)) return prev;
                    return [newMsg, ...prev];
                });
            }
        });

        // Command Events
        const clearChatHandler = () => {
            // Clear messages for current channel only, locally
            setMessages([]);
            console.log("[App] Chat cleared by command");
        };

        const systemMessageHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const sysMsg: Message = {
                id: 'system-' + Date.now(),
                guild_id: selectedGuild || '',
                channel_id: selectedChannelRef.current || '',
                content: detail,
                author: 'System',
                timestamp: new Date().toISOString(),
                embeds: [],
                attachments: [],
                kind: 'System'
            };
            setMessages(prev => [...prev, sysMsg]);
        };

        window.addEventListener('p2cord:clear-chat', clearChatHandler);
        window.addEventListener('p2cord:system-message', systemMessageHandler);

        const unlistenDeletePromise = listen<{ id: string, channel_id: string, guild_id: string }>('message_delete', (event) => {
            const { id, channel_id } = event.payload;
            console.log("[App] Message Deleted:", id);
            if (selectedChannelRef.current === channel_id) {
                setMessages(prev => prev.filter(m => m.id !== id));
            }
        });

        return () => {
            unlistenPromise.then(unlisten => unlisten());
            unlistenDeletePromise.then(unlisten => unlisten());
            window.removeEventListener('p2cord:clear-chat', clearChatHandler);
            window.removeEventListener('p2cord:system-message', systemMessageHandler);
        };
    }, []);

    const [token, setToken] = useState('');
    const [myId, setMyId] = useState<string | null>(null); // Logged-in User ID
    const [myUser, setMyUser] = useState<{ username: string, discriminator: string, avatar: string | null } | null>(null);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [status, setStatus] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[] | null>(null);
    const [showScrollButton, setShowScrollButton] = useState(false);

    const [guilds, setGuilds] = useState<Guild[]>([]);
    // Use global store
    const {
        currentGuildId: selectedGuild,
        currentChannelId: selectedChannel,
        setCurrentGuild,
        setCurrentChannel,
        connectedVoiceChannelId,
        setConnectedVoiceChannel,
        remoteSpeakers: _remoteSpeakers,
        setRemoteSpeaker,
        addPeer,
        removePeer,
        clearPeers,
        localSpeaking,
        setLocalSpeaking,
        isVoiceTransitioning,
        setVoiceTransitioning,
    } = useSessionStore();

    // Derived local state or keeping same variable names for minimal refactor
    const [channels, setChannels] = useState<Channel[]>([]);
    const selectedChannelRef = useRef<string | null>(null); // Ref to track selected channel in listener

    useEffect(() => {
        selectedChannelRef.current = selectedChannel;
    }, [selectedChannel]);

    // Sync Audio State on Mount
    useEffect(() => {
        invoke<{ isMuted: boolean, isDeafened: boolean }>('get_audio_state')
            .then(state => {
                setIsMuted(state.isMuted);
                setIsDeafened(state.isDeafened);
            })
            .catch(e => console.error("Failed to get audio state:", e));
    }, []);

    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoadingChannel, setIsLoadingChannel] = useState(false);
    // const [isSwitchingChannel, setIsSwitchingChannel] = useState(false); // Removed masking logic
    const fetchIdRef = useRef(0); // フェッチバージョン管理用
    const hasMoreRef = useRef(true); // 追加読み込み可能かどうかのフラグ

    // Collapsed Categories State
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

    // User Status State
    const [userStatus, setUserStatus] = useState<UserStatus>('online');
    const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
    const statusMenuRef = useRef<HTMLDivElement>(null);

    // Members & Roles State
    const [roles, setRoles] = useState<SimpleRole[]>([]);
    const [members, setMembers] = useState<MemberWithPresence[]>([]);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const [showMemberSidebar] = useState(true);

    const fetchGuildData = async (guildId: string) => {
        console.log(`[App] Fetching guild data for ${guildId}`);
        setIsLoadingMembers(true);
        try {
            // ロールはREST APIで取得可能
            const fetchedRoles = await invoke<SimpleRole[]>('get_roles', { guildId });
            console.log(`[App] Fetched ${fetchedRoles.length} roles.`);
            setRoles(fetchedRoles);

            // メンバーはGatewayストアから取得（Gateway経由で随時更新される）
            const storedMembers = await invoke<MemberWithPresence[]>('get_guild_members_from_store', { guildId });
            console.log(`[App] Got ${storedMembers.length} members from store.`);
            setMembers(storedMembers);
        } catch (e) {
            console.error("Failed to fetch guild data:", e);
            setStatus(`Guild Data Error: ${e}`);
        } finally {
            setIsLoadingMembers(false);
        }
    };

    // メインバーリスト購読（チャンネル選択時）
    const subscribeToMemberList = async (guildId: string, channelId: string) => {
        try {
            await invoke('subscribe_member_list', { guildId, channelId });
            console.log(`[App] Subscribed to member list for guild: ${guildId}, channel: ${channelId}`);
        } catch (e) {
            console.error("Failed to subscribe to member list:", e);
        }
    };

    // Gateway イベントリスナー: メンバーリスト更新時にストアからリフレッシュ
    useEffect(() => {
        const unlistenMemberList = listen('member_list_update', async (event: any) => {
            const { guild_id, member_count, online_count } = event.payload;
            console.log(`[App] Member list update: guild=${guild_id}, members=${member_count}, online=${online_count}`);

            // 現在のギルドの場合、メンバーリストを更新
            if (guild_id === selectedGuild) {
                const storedMembers = await invoke<MemberWithPresence[]>('get_guild_members_from_store', { guildId: guild_id });
                setMembers(storedMembers);
            }
        });

        const unlistenPresence = listen('presence_update', async (event: any) => {
            const { user_id, guild_id, status } = event.payload;
            console.log(`[App] Presence update: user=${user_id}, guild=${guild_id}, status=${status}`);

            // 現在のギルドの場合、メンバーリストを更新
            if (guild_id === selectedGuild) {
                const storedMembers = await invoke<MemberWithPresence[]>('get_guild_members_from_store', { guildId: guild_id });
                setMembers(storedMembers);
            }
        });

        return () => {
            unlistenMemberList.then(unlisten => unlisten());
            unlistenPresence.then(unlisten => unlisten());
        };
    }, [selectedGuild]);


    // Close status menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (statusMenuRef.current && !statusMenuRef.current.contains(event.target as Node)) {
                setIsStatusMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const toggleCategory = (categoryId: string) => {
        setCollapsedCategories(prev => {
            const next = new Set(prev);
            if (next.has(categoryId)) {
                next.delete(categoryId);
            } else {
                next.add(categoryId);
            }
            return next;
        });
    };

    // Audio State
    const [isMuted, setIsMuted] = useState(false);
    const [isDeafened, setIsDeafened] = useState(false);

    const handleToggleMute = async () => {
        try {
            const newState = await invoke<boolean>('toggle_mute');
            setIsMuted(newState);
        } catch (e) {
            console.error("Failed to toggle mute:", e);
        }
    };

    const handleToggleDeafen = async () => {
        try {
            const newState = await invoke<boolean>('toggle_deafen');
            setIsDeafened(newState);
        } catch (e) {
            console.error("Failed to toggle deafen:", e);
        }
    };

    // VAD State (Global)
    // const [isSpeaking, setIsSpeaking] = useState(false); // Removed local state

    useEffect(() => {
        const unlistenPromise = listen<boolean>('voice-activity', (event) => {
            setLocalSpeaking(event.payload);
        });

        const unlistenRemotePromise = listen<{ client_id: string, is_speaking: boolean }>('remote-voice-activity', (event) => {
            console.log("Remote VAD:", event.payload);
            setRemoteSpeaker(event.payload.client_id, event.payload.is_speaking);
        });

        const unlistenJoinPromise = listen<string>('peer-joined', (event) => {
            console.log("Peer Joined:", event.payload);
            addPeer(event.payload);
        });

        const unlistenLeavePromise = listen<string>('peer-left', (event) => {
            console.log("Peer Left:", event.payload);
            removePeer(event.payload);
        });

        return () => {
            unlistenPromise.then(unlisten => unlisten());
            unlistenRemotePromise.then(unlisten => unlisten());
            unlistenJoinPromise.then(unlisten => unlisten());
            unlistenLeavePromise.then(unlisten => unlisten());
        };
    }, []);

    // Search state

    const [isSearching, setIsSearching] = useState(false);

    const [isFetchingHistory, setIsFetchingHistory] = useState(false);
    const channelOpenTimeRef = useRef<number | null>(null);

    // 10分タイマーで全履歴取得開始
    useEffect(() => {
        if (!selectedChannel || !selectedGuild) {
            channelOpenTimeRef.current = null;
            return;
        }

        channelOpenTimeRef.current = Date.now();

        const checkTimer = setInterval(async () => {
            const openTime = channelOpenTimeRef.current;
            if (!openTime || !selectedChannel || !selectedGuild) return;

            const elapsed = Date.now() - openTime;
            if (elapsed >= 10 * 60 * 1000 && !isFetchingHistory) { // 10分
                setIsFetchingHistory(true);
                setStatus('Fetching history in background...');
                try {
                    const fetched = await invoke<number>('fetch_all_history', {
                        guildId: selectedGuild,
                        channelId: selectedChannel
                    });
                    setStatus(`Background fetch complete: ${fetched} messages saved`);
                } catch (e) {
                    setStatus(`Background fetch failed: ${e}`);
                }
                setIsFetchingHistory(false);
                clearInterval(checkTimer);
            }
        }, 30000); // 30秒ごとにチェック

        return () => clearInterval(checkTimer);
    }, [selectedChannel, selectedGuild, isFetchingHistory]);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Load token from localStorage on mount and try auto-login
    useEffect(() => {
        const savedToken = localStorage.getItem('discord_token');
        if (savedToken) {
            setToken(savedToken);
            setStatus('Auto-logging in...');
            handleLoginWithToken(savedToken);
        }
    }, []);

    const handleLoginWithToken = async (tokenToUse: string) => {
        try {
            // Updated to expect LoginResponse object
            const res = await invoke<{
                message: string,
                user_id: string,
                username: string,
                discriminator: string,
                avatar: string | null
            }>('init_client', { token: tokenToUse });
            setStatus(res.message);
            setMyId(res.user_id);
            setMyUser({ username: res.username, discriminator: res.discriminator, avatar: res.avatar });
            setIsLoggedIn(true);
            localStorage.setItem('discord_token', tokenToUse); // Save on success
            fetchGuilds();

            // Start Gateway
            invoke('start_gateway', { token: tokenToUse });

            // Listen for real-time messages
            await listen<Message>('message_create', (event) => {
                const newMsg = event.payload;
                // Filter by current channel using Ref. Prevent duplicates by checking ID.
                if (selectedChannelRef.current === newMsg.channel_id) {
                    setMessages(prev => {
                        if (prev.some(m => m.id === newMsg.id)) return prev; // Skip duplicate
                        return [...prev, newMsg];
                    });
                }
            });
        } catch (e) {
            setStatus(`Error: ${e}`);
            localStorage.removeItem('discord_token'); // Remove invalid token
        }
    };

    const handleLogin = async () => {
        await handleLoginWithToken(token);
    };

    const handleLogout = () => {
        localStorage.removeItem('discord_token');
        setIsLoggedIn(false);
        setToken('');
        setGuilds([]);
        setChannels([]);
        setMessages([]);
        setStatus('Logged out');
    };

    const fetchGuilds = async () => {
        try {
            const res = await invoke<Guild[]>('get_guilds');
            setGuilds(res);
        } catch (e) {
            setStatus(`Error fetching guilds: ${e}`);
        }
    };

    const fetchChannels = async (guildId: string) => {
        setCurrentGuild(guildId);
        setCurrentChannel(null);
        setMessages([]);
        try {
            const res = await invoke<Channel[]>('get_channels', { guildId });
            setChannels(res);
            fetchGuildData(guildId); // Fetch members/roles when guild changes
        } catch (e) {
            setStatus(`Error fetching channels: ${e}`);
        }
    };

    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const messagesContainerRef = useRef<HTMLDivElement>(null);

    const fetchMessages = async (channelId: string, beforeId?: string) => {
        const currentFetchId = ++fetchIdRef.current;

        // Find channel type
        const targetChannel = channels.find(c => c.id === channelId);
        console.log("fetchMessages called for:", channelId, "Found Channel:", targetChannel);

        const isVoice = targetChannel?.kind === 'Voice' || targetChannel?.kind === 'voice';

        if (!beforeId) {
            // Channel Selection
            setCurrentChannel(channelId); // Always update view
            setSearchQuery('');
            setSearchResults(null);
            setShowScrollButton(false);

            // Gateway OP 14: Subscribe to member list for this channel
            if (selectedGuild) {
                subscribeToMemberList(selectedGuild, channelId);
            }

            if (isVoice) {
                // Prevent duplicate join if already in this voice channel
                if (channelId === connectedVoiceChannelId) {
                    console.log("Already in voice channel:", channelId);
                    return;
                }

                // Prevent rapid toggling
                if (isVoiceTransitioning) {
                    console.log("Voice operation in progress, please wait...");
                    return;
                }

                // VOICE: Join P2P (Browser WebRTC)
                console.log("Joining Voice Channel:", channelId);
                setVoiceTransitioning(true);
                setConnectedVoiceChannel(channelId);
                setConnectedVoiceChannel(channelId);
                setMessages([]);
                hasMoreRef.current = true;
                setIsLoadingChannel(false);

                try {
                    // Start Browser WebRTC session
                    webrtc.joinRoom(channelId, 'User');
                    // Start microphone automatically
                    await webrtc.startMicrophone();
                } catch (e) {
                    console.error("Failed to join voice:", e);
                    setStatus(`Voice Error: ${e}`);
                } finally {
                    // Allow next operation after delay
                    setTimeout(() => setVoiceTransitioning(false), 1000);
                }

                // VOICE CHAT: Fetch messages for the voice channel (independent of P2P connection)
                setIsLoadingChannel(true);

                // 1. Cache
                try {
                    const cachedMsgs = await invoke<Message[]>('get_cached_messages', { channelId, limit: 50 });
                    if (currentFetchId === fetchIdRef.current) { // Ensure we are still on the target channel
                        if (cachedMsgs.length > 0) {
                            setMessages(cachedMsgs.reverse());
                            setIsLoadingChannel(false);
                        }
                    }
                } catch { }

                // 2. API Fetch
                try {
                    const fetchedMsgs = await invoke<SimpleMessage[]>('fetch_messages', {
                        guildId: selectedGuild,
                        channelId: channelId,
                    });

                    const mapped: Message[] = fetchedMsgs.map(m => ({
                        id: m.id,
                        content: m.content,
                        author: m.author, // Fixed: author_name -> author
                        author_id: m.author_id,
                        timestamp: m.timestamp,
                        guild_id: selectedGuild!,
                        channel_id: channelId,
                        embeds: m.embeds || [],
                        attachments: m.attachments || [], // Fixed: no JSON.parse needed
                        referenced_message: m.referenced_message ? {
                            id: m.referenced_message.id,
                            guild_id: m.referenced_message.guild_id || "",
                            channel_id: m.referenced_message.channel_id,
                            content: m.referenced_message.content,
                            author: m.referenced_message.author,
                            author_id: m.referenced_message.author_id,
                            timestamp: m.referenced_message.timestamp,
                            embeds: m.referenced_message.embeds || [],
                            attachments: m.referenced_message.attachments || [],
                            kind: m.referenced_message.kind || 'Default'
                        } : undefined,
                        message_snapshots: m.message_snapshots || [],
                        kind: m.kind || 'Default'
                    }));

                    if (currentFetchId === fetchIdRef.current) {
                        setMessages(mapped.reverse());
                    }
                } catch (e) {
                    console.error("Failed to fetch voice text messages:", e);
                } finally {
                    if (currentFetchId === fetchIdRef.current) {
                        setIsLoadingChannel(false);
                    }
                }

                return; // Stop here for Voice (Text flow below is skipped)
            }

            // TEXT: Only fetch messages, DO NOT touch P2P
            // setIsSwitchingChannel(true);
            // setIsSwitchingChannel(true);
            setMessages([]);
            hasMoreRef.current = true;
            setIsLoadingChannel(true);

            // 1. Cache
            try {
                const cachedMsgs = await invoke<Message[]>('get_cached_messages', { channelId, limit: 50 });
                if (currentFetchId !== fetchIdRef.current) return;
                if (cachedMsgs.length > 0) {
                    setMessages(cachedMsgs.reverse());
                    setIsLoadingChannel(false);
                }
            } catch { }
        }

        if (!selectedGuild) return;

        if (!isVoice) {
            // 2. API Fetch (Text Only)
            try {
                console.log("[App] Invoking fetch_messages for:", selectedGuild, channelId);
                // Use new `fetch_messages` command
                const fetchedMsgs = await invoke<SimpleMessage[]>('fetch_messages', {
                    guildId: selectedGuild,
                    channelId: channelId,
                });
                console.log("[App] fetch_messages success, items:", fetchedMsgs.length);

                // Mapping SimpleMessage -> Message
                const mapped: Message[] = fetchedMsgs.map(m => ({
                    id: m.id,
                    content: m.content,
                    author: m.author,
                    author_id: m.author_id,
                    timestamp: m.timestamp,
                    guild_id: selectedGuild!,
                    channel_id: channelId,
                    embeds: m.embeds || [],
                    attachments: m.attachments || [],
                    referenced_message: m.referenced_message ? {
                        id: m.referenced_message.id,
                        guild_id: m.referenced_message.guild_id || "",
                        channel_id: m.referenced_message.channel_id,
                        content: m.referenced_message.content,
                        author: m.referenced_message.author,
                        author_id: m.referenced_message.author_id,
                        timestamp: m.referenced_message.timestamp,
                        embeds: m.referenced_message.embeds || [],
                        attachments: m.referenced_message.attachments || [],
                        kind: m.referenced_message.kind || 'Default'
                    } : undefined,
                    message_snapshots: m.message_snapshots || [],
                    kind: m.kind || 'Default'
                }));

                if (fetchedMsgs.length === 0) {
                    hasMoreRef.current = false;
                }

                if (currentFetchId !== fetchIdRef.current) {
                    console.log("[App] Fetch ID mismatch, ignoring result");
                    return;
                }

                setMessages(prev => {
                    const allMessages = beforeId ? [...prev, ...mapped] : mapped;
                    const uniqueMap = new Map();
                    allMessages.forEach(m => uniqueMap.set(m.id, m));
                    const uniqueMessages = Array.from(uniqueMap.values()) as Message[];
                    // Sort by timestamp (Oldest -> Newest)
                    uniqueMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    return uniqueMessages;
                });

            } catch (e) {
                console.error("[App] fetch_messages failed:", e);
                if (currentFetchId === fetchIdRef.current) {
                    setStatus(`Fetch Error: ${e}`);
                }
            } finally {
                if (currentFetchId === fetchIdRef.current) {
                    setIsLoadingChannel(false);
                    // requestAnimationFrame(() => setIsSwitchingChannel(false));
                }
            }
        }

        // FORUM: Fetch archived threads AND active threads (via posts/messages) to populate the list
        if (targetChannel?.kind === 'Forum') {
            try {
                // 1. Fetch Archived
                const archived = await invoke<Channel[]>('get_archived_threads', { channelId });

                // 2. Fetch Active (via Search API)
                // Note: user tokens can't use `active threads` endpoint, so we use Search API to find threads.
                // Requires guildId as well.
                const active = await invoke<Channel[]>('get_forum_active_threads', { guildId: selectedGuild, channelId });

                setChannels(prev => {
                    const existingIds = new Set(prev.map(c => c.id));
                    const combined = [...archived, ...active];
                    // No global filtering here. We want to store ALL threads.
                    // Filtering for "Recency" will be done at the rendering level for Sidebar only.

                    const newThreads = combined.filter(t => !existingIds.has(t.id));
                    if (newThreads.length === 0) return prev;
                    // Just append new threads without re-sorting the entire list
                    return [...prev, ...newThreads];
                });
            } catch (e) {
                console.error("Failed to fetch forum threads:", e);
            }
        }
    };

    // 同期的スクロールとマスク解除制御 (Removed Masking)
    useLayoutEffect(() => {
        // if (isSwitchingChannel) {
        // メッセージがある場合、またはロード完了かつメッセージ0の場合
        if (messages.length > 0 || (!isLoadingChannel && messages.length === 0)) {
            // 1. 強制スクロール (Paint前)
            if (messagesEndRef.current) {
                messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
            }
            // 2. マスク解除 (Paint許可)
            // requestAnimationFrame(() => {
            //     setIsSwitchingChannel(false);
            // });
        }
        // }
    }, [messages, isLoadingChannel]);


    const loadOlderMessages = async () => {
        if (isLoadingMore || !selectedChannel || messages.length === 0 || !hasMoreRef.current) return;
        setIsLoadingMore(true);
        const oldestMessage = messages[0];
        await fetchMessages(selectedChannel, oldestMessage.id);
        setIsLoadingMore(false);
    };

    const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        if (target.scrollTop < 50) {
            loadOlderMessages();
        }
        const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
        setShowScrollButton(!isNearBottom);
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        // 通常のメッセージ受信時（チャンネル切り替え以外）
        if (/*!isSwitchingChannel &&*/ !showScrollButton && messagesEndRef.current && !isLoadingChannel && messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            const isRecent = new Date().getTime() - new Date(lastMsg.timestamp).getTime() < 5000;
            if (isRecent) {
                messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [messages, showScrollButton, isLoadingChannel]);

    const handleSearch = async () => {
        if (!searchQuery.trim() || !selectedGuild) return;
        setIsSearching(true);
        setStatus('Searching...');

        try {
            const localResults = await invoke<Message[]>('search_messages', {
                guildId: selectedGuild,
                query: searchQuery.trim()
            });
            setSearchResults(localResults);

            try {
                const apiResults = await invoke<Message[]>('search_discord_api', {
                    guildId: selectedGuild,
                    query: searchQuery.trim()
                });

                if (apiResults.length > 0) {
                    setSearchResults(prev => {
                        const existing = prev || [];
                        const existingIds = new Set(existing.map(m => m.id));
                        const newMessages = apiResults.filter(m => !existingIds.has(m.id));
                        const merged = [...existing, ...newMessages];
                        merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                        return merged;
                    });
                    setStatus(`Found ${localResults.length} local + ${apiResults.length} from API`);
                } else {
                    setStatus(`Found ${localResults.length} results`);
                }
            } catch {
                setStatus(`Found ${localResults.length} results (API unavailable)`);
            }
        } catch (e) {
            setStatus(`Search Error: ${e}`);
        }
        setIsSearching(false);
    };

    const handleSendMessage = async (content: string, replyToId: string | null = null) => {
        if (!content.trim() || !selectedChannel || !selectedGuild) return;
        try {
            await invoke('send_message', {
                guildId: selectedGuild,
                channelId: selectedChannel,
                content: content.trim(),
                replyTo: replyToId
            });
            // Optimistic update or wait for event is fine. 
            // We listen to 'message_create' so it should appear automatically.
        } catch (e) {
            console.error("Failed to send message:", e);
            setStatus(`Send Error: ${e}`);
        }
    };

    const handleMessageDeleted = (messageId: string) => {
        setMessages(prev => prev.filter(m => m.id !== messageId));
    };

    const clearSearch = () => {
        setSearchQuery('');
        setSearchResults(null);
    };

    if (!isLoggedIn) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-black text-terminal-green font-mono">
                <h1 className="text-4xl mb-8 font-bold border-b border-terminal-green pb-2">P2Cord Login</h1>
                <div className="w-96 flex flex-col gap-4">
                    <input
                        type="password"
                        placeholder="Discord User Token"
                        className="p-3 bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:border-terminal-green"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                    />
                    <button
                        onClick={handleLogin}
                        className="p-3 bg-terminal-green text-black font-bold rounded hover:bg-opacity-80 transition"
                    >
                        LOGIN
                    </button>
                    <div className="text-sm text-gray-500 mt-2">{status}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-black text-gray-300 font-mono overflow-hidden">
            {/* Sidebar: Guilds */}
            <div className="w-64 border-r border-gray-800 flex flex-col">
                <div className="p-4 border-b border-gray-800 font-bold text-lg text-terminal-green flex justify-between items-center">
                    <span>Servers</span>
                    <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-400">Logout</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {guilds.map((g) => (
                        <div
                            key={g.id}
                            onClick={() => fetchChannels(g.id)}
                            className={`p-3 cursor-pointer hover:bg-gray-900 truncate ${selectedGuild === g.id ? 'bg-gray-800 text-white' : ''}`}
                        >
                            {g.name}
                        </div>
                    ))}
                </div>
            </div>

            {/* Sidebar: Channels */}
            <div className="w-64 border-r border-gray-800 flex flex-col bg-gray-950">
                <div className="p-4 border-b border-gray-800 font-bold text-lg text-terminal-green">Channels</div>
                <div className="flex-1 overflow-y-auto p-2">
                    {(() => {
                        // 1. Classification
                        const categories = channels.filter(c => c.kind === 'Category');
                        const threads = channels.filter(c =>
                            c.kind === 'PublicThread' ||
                            c.kind === 'PrivateThread' ||
                            c.kind === 'AnnouncementThread'
                        );
                        // Standard channels include Text, Voice, Forum, etc. Exclude Categories and Threads.
                        const standardChannels = channels.filter(c =>
                            c.kind !== 'Category' &&
                            c.kind !== 'PublicThread' &&
                            c.kind !== 'PrivateThread' &&
                            c.kind !== 'AnnouncementThread'
                        );

                        // 2. Maps
                        const channelMap: Record<string, Channel[]> = {}; // Category ID -> Channels
                        const threadMap: Record<string, Channel[]> = {};  // Channel ID -> Threads
                        const orphans: Channel[] = []; // Channels with no category
                        // Map Threads to Parents
                        threads.forEach(t => {
                            if (t.parent_id) {
                                if (!threadMap[t.parent_id]) threadMap[t.parent_id] = [];
                                threadMap[t.parent_id].push(t);
                            }
                        });

                        // Map Channels to Categories
                        standardChannels.forEach(c => {
                            if (c.parent_id) {
                                if (!channelMap[c.parent_id]) channelMap[c.parent_id] = [];
                                channelMap[c.parent_id].push(c);
                            } else {
                                orphans.push(c);
                            }
                        });

                        const getIcon = (kind: string) => {
                            if (kind === 'Voice') return '🔊';
                            if (kind === 'Forum') return '🗨️';
                            if (kind.includes('Thread')) return '└';
                            return '#';
                        };

                        const renderChannelItem = (c: Channel, isThread = false) => (
                            <div key={c.id}>
                                <div
                                    onClick={(e) => { e.stopPropagation(); fetchMessages(c.id); }}
                                    className={`
                                        ${isThread ? 'ml-6 border-l-2 border-gray-800' : 'ml-2'} 
                                        p-1 px-2 cursor-pointer hover:bg-gray-900 rounded truncate text-sm flex items-center 
                                        ${selectedChannel === c.id ? 'bg-gray-800 text-white' : 'text-gray-400'}
                                    `}
                                >
                                    <span className="text-gray-600 mr-1 text-xs w-4 flex justify-center">{getIcon(c.kind)}</span>
                                    {c.name}
                                </div>
                                {!isThread && threadMap[c.id] && (
                                    <div className="space-y-0.5 mt-0.5">
                                        {threadMap[c.id]
                                            .filter(t => {
                                                // Sidebar Filter: Show only threads updated in last 5 days
                                                const idToUse = t.last_message_id || t.id;
                                                if (!idToUse) return false;
                                                const timestamp = Number(BigInt(idToUse) >> 22n) + 1420070400000;
                                                const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
                                                return (Date.now() - timestamp) <= FIVE_DAYS_MS;
                                            })
                                            .sort((a, b) => {
                                                // Sort by last_message_id (descending) -> newest first
                                                const idA = BigInt(a.last_message_id || a.id);
                                                const idB = BigInt(b.last_message_id || b.id);
                                                return idA < idB ? 1 : -1;
                                            })
                                            .map(t => renderChannelItem(t, true))}
                                    </div>
                                )}
                            </div>
                        );

                        // Helper to determine sort order based on channel type (Text-like first, then Voice-like)
                        const getChannelTypeOrder = (kind: string) => {
                            // Text-like (Text, News, Forum, etc.) -> 0
                            // Voice-like (Voice, Stage) -> 1
                            if (['Voice', 'Stage'].includes(kind)) return 1;
                            return 0;
                        };

                        const sortChannels = (channels: Channel[]) => {
                            return channels.sort((a, b) => {
                                // 1. Sort by Type Group (Text-like vs Voice-like)
                                const typeA = getChannelTypeOrder(a.kind);
                                const typeB = getChannelTypeOrder(b.kind);
                                if (typeA !== typeB) return typeA - typeB;

                                // 2. Sort by Position
                                const posDiff = a.position - b.position;
                                if (posDiff !== 0) return posDiff;

                                // 3. Fallback to Name
                                return a.name.localeCompare(b.name);
                            });
                        };

                        return (
                            <div className="space-y-4">
                                {orphans.length > 0 && (
                                    <div className="space-y-1">
                                        {sortChannels(orphans).map(c => renderChannelItem(c))}
                                    </div>
                                )}
                                {categories.sort((a, b) => a.position - b.position).map(cat => (
                                    <div key={cat.id}>
                                        <div
                                            className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 px-1 hover:text-gray-300 cursor-pointer flex items-center gap-1 select-none"
                                            onClick={() => toggleCategory(cat.id)}
                                        >
                                            <svg className={`w-3 h-3 transition-transform ${collapsedCategories.has(cat.id) ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                            {cat.name}
                                        </div>
                                        {!collapsedCategories.has(cat.id) && (
                                            <div className="space-y-1">
                                                {sortChannels(channelMap[cat.id] || []).map(c => renderChannelItem(c))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>

                {/* Voice Connection Bar */}
                {connectedVoiceChannelId && (
                    <div className="bg-[#1a1a1a] border-t border-black/50 p-2">
                        <div className="flex items-center justify-between group">
                            <div className="flex-1 min-w-0">
                                <div className="text-green-500 text-[10px] font-bold uppercase tracking-wider mb-0.5 animate-pulse">Voice Connected</div>
                                <div className="text-gray-200 text-xs font-medium truncate flex items-center gap-1">
                                    <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                                    {channels.find(c => c.id === connectedVoiceChannelId)?.name || 'Unknown Channel'}
                                </div>
                            </div>
                            <button
                                onClick={async () => {
                                    try {
                                        await invoke('leave_room');
                                    } catch (e) {
                                        console.error("Failed to leave room:", e);
                                    }
                                    setConnectedVoiceChannel(null);
                                    clearPeers();
                                }}
                                className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                title="Disconnect"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>
                )}

                {/* User Area */}
                <div className="bg-[#050505] p-2 flex items-center gap-2 border-t border-gray-800 relative">
                    {/* Status Menu Popup */}
                    {isStatusMenuOpen && (
                        <div
                            ref={statusMenuRef}
                            className="absolute bottom-14 left-2 w-56 bg-[#111] border border-gray-800 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-100"
                        >
                            <div className="p-1 space-y-0.5">
                                {(Object.keys(STATUS_CONFIG) as UserStatus[]).map((status) => (
                                    <div
                                        key={status}
                                        onClick={() => {
                                            setUserStatus(status);
                                            setIsStatusMenuOpen(false);
                                            // Call backend to update Discord presence
                                            invoke('update_status', { status })
                                                .catch(e => console.error("Failed to update status:", e));
                                        }}
                                        className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-white/10 cursor-pointer group"
                                    >
                                        <div className={`w-3 h-3 rounded-full ${STATUS_CONFIG[status].indicatorColor} border border-black/50`}></div>
                                        <span className={`text-sm font-medium ${status === userStatus ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>
                                            {STATUS_CONFIG[status].label}
                                        </span>
                                        {status === userStatus && (
                                            <svg className="w-3 h-3 text-white ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div
                        className="relative group cursor-pointer"
                        onClick={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                    >
                        {myUser?.avatar ? (
                            <img src={myUser.avatar} alt="Profile" className={`w-8 h-8 rounded-full object-cover border transition-all duration-200 ${localSpeaking
                                ? 'border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                                : 'border-gray-800'
                                }`} />
                        ) : (
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold border transition-all duration-200 ${localSpeaking
                                ? 'bg-green-500/20 text-green-400 border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                                : 'bg-terminal-green/20 text-terminal-green border-terminal-green/30'
                                }`}>
                                {(myUser?.username || "P")[0].toUpperCase()}
                            </div>
                        )}
                        {localSpeaking && (
                            <div className="absolute inset-0 rounded-full border-2 border-green-500 animate-ping opacity-75 pointer-events-none"></div>
                        )}
                        <div className={`absolute bottom-0 right-0 w-3 h-3 ${STATUS_CONFIG[userStatus].indicatorColor} border-2 border-[#050505] rounded-full`}></div>
                    </div>
                    <div
                        className="flex-1 min-w-0 cursor-pointer hover:bg-white/5 rounded px-1 -ml-1 py-0.5 transition-colors"
                        onClick={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                    >
                        <div className="text-xs font-bold text-white truncate">{myUser?.username || "Player"}</div>
                        <div className="text-[10px] text-gray-500 truncate">{STATUS_CONFIG[userStatus].label}</div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleToggleMute}
                            className={`p-1.5 rounded hover:bg-gray-800 transition-colors ${isMuted ? 'text-red-500 relative' : 'text-gray-400'}`}
                            title={isMuted ? "Unmute" : "Mute"}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {isMuted ? (
                                    <>
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16" className="text-red-500" />
                                    </>
                                ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                )}
                            </svg>
                        </button>
                        <button
                            onClick={handleToggleDeafen}
                            className={`p-1.5 rounded hover:bg-gray-800 transition-colors ${isDeafened ? 'text-red-500 relative' : 'text-gray-400'}`}
                            title={isDeafened ? "Undeafen" : "Deafen"}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {isDeafened ? (
                                    <>
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16" className="text-red-500" />
                                    </>
                                ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                )}
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* Main: Chat or Voice */}
            {(selectedChannel && (channels.find(c => c.id === selectedChannel)?.kind === 'Voice' || channels.find(c => c.id === selectedChannel)?.kind === 'voice')) ? (
                // VOICE LAYOUT with CHAT
                <VoiceLayout
                    webrtc={webrtc}
                    messages={messages as any} // Cast might be needed due to local interface definition
                    onSendMessage={handleSendMessage}
                    onMessageDelete={handleMessageDeleted}
                    myId={myId}

                    isLoadingMore={isLoadingMore}
                    showScrollButton={showScrollButton}
                    onLoadMore={loadOlderMessages}
                    onScrollToBottom={scrollToBottom}
                    onMessagesScroll={handleMessagesScroll}

                    messagesContainerRef={messagesContainerRef}
                    messagesEndRef={messagesEndRef}
                />
            ) : (selectedChannel && channels.find(c => c.id === selectedChannel)?.kind === 'Forum') ? (
                <div className="flex-1 flex flex-col bg-black relative">
                    <div className="p-4 border-b border-gray-800 flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                            <span className="font-bold text-lg text-terminal-green">
                                Forum: {channels.find(c => c.id === selectedChannel)?.name}
                            </span>
                        </div>
                        <div className="text-sm text-gray-500">Select a post to view</div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {channels.filter(c => c.parent_id === selectedChannel).length === 0 ? (
                            <div className="text-center text-gray-500 mt-10">No active posts found in this forum.</div>
                        ) : (
                            channels.filter(c => c.parent_id === selectedChannel).map(thread => (
                                <div
                                    key={thread.id}
                                    onClick={(e) => { e.stopPropagation(); fetchMessages(thread.id); }}
                                    className="p-4 bg-gray-900 border border-gray-800 rounded-lg cursor-pointer hover:bg-gray-800 hover:border-gray-700 transition-all group"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-gray-500 group-hover:text-cyan-400">└</span>
                                        <h3 className="font-bold text-gray-200 group-hover:text-white">{thread.name}</h3>
                                    </div>
                                    <div className="text-xs text-gray-500 ml-5">
                                        Click to open thread
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            ) : (
                <ChannelChat
                    status={'' /* エラー表示を無効化 */}
                    selectedChannel={selectedChannel}
                    selectedGuild={selectedGuild}
                    channelName={channels.find(c => c.id === selectedChannel)?.name}
                    channels={channels as any} // Cast to compatible type
                    messages={messages}
                    searchResults={searchResults}
                    searchQuery={searchQuery}
                    isSearching={isSearching}
                    isLoadingChannel={isLoadingChannel}
                    isLoadingMore={isLoadingMore}
                    showScrollButton={showScrollButton}

                    setSearchQuery={setSearchQuery}
                    handleSearch={handleSearch}
                    clearSearch={clearSearch}
                    handleSendMessage={handleSendMessage}
                    onMessageDelete={handleMessageDeleted}
                    scrollToBottom={scrollToBottom}
                    handleMessagesScroll={handleMessagesScroll}

                    messagesContainerRef={messagesContainerRef}
                    messagesEndRef={messagesEndRef}
                />
            )}

            {/* Right Sidebar: Member List */}
            {selectedGuild && showMemberSidebar && (
                <MemberSidebar members={members} roles={roles} loading={isLoadingMembers} />
            )}

        </div>
    );
}

export default App;
