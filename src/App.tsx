import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useSessionStore } from './stores/sessionStore';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { VoiceLayout } from './components/VoiceLayout';
import { ChannelChat } from './components/ChannelChat';

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
}

interface SimpleMessage {
    id: string;
    author_id: string; // From backend (author.id)
    author_name: string;
    author_avatar: string;
    content: string;
    timestamp: string;
    attachments?: string; // JSON string
}

function App() {
    const [token, setToken] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [status, setStatus] = useState('');
    const [myId, setMyId] = useState<string | null>(null); // Logged-in User ID

    const [guilds, setGuilds] = useState<Guild[]>([]);
    // Use global store
    const {
        currentGuildId: selectedGuild,
        currentChannelId: selectedChannel,
        setCurrentGuild,
        setCurrentChannel,
        connectedVoiceChannelId,
        setConnectedVoiceChannel,
        remoteSpeakers,
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
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Message[] | null>(null);
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
            const res = await invoke<{ message: string, user_id: string, username: string }>('init_client', { token: tokenToUse });
            setStatus(res.message);
            setMyId(res.user_id);
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
            setChannels(res.sort((a, b) => a.kind.localeCompare(b.kind)));
        } catch (e) {
            setStatus(`Error fetching channels: ${e}`);
        }
    };

    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [showScrollButton, setShowScrollButton] = useState(false);
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

                // VOICE: Join P2P
                console.log("Joining Voice Channel:", channelId);
                setVoiceTransitioning(true);
                setConnectedVoiceChannel(channelId);
                clearPeers();
                setMessages([]);
                setIsLoadingChannel(false);

                try {
                    // Start P2P
                    await invoke('join_room', {
                        guildId: selectedGuild,
                        channelId: channelId
                    });
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
                        author: m.author_name,
                        author_id: m.author_id, // Ensure author_id is passed
                        timestamp: m.timestamp,
                        guild_id: selectedGuild!,
                        channel_id: channelId,
                        embeds: [],
                        attachments: m.attachments ? JSON.parse(m.attachments) : [],
                    }));

                    if (currentFetchId === fetchIdRef.current) {
                        setMessages(prev => { // prev unused warning might persist if not used, but setMessages expects a function or value
                            // If we have cache, merge? For now just overwrite or simple strategy
                            return mapped.reverse();
                        });
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
            setMessages([]);
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
                    author: m.author_name,
                    timestamp: m.timestamp,
                    guild_id: selectedGuild!,
                    channel_id: channelId,
                    embeds: [],
                    attachments: m.attachments ? JSON.parse(m.attachments) : [],
                }));

                if (currentFetchId !== fetchIdRef.current) {
                    console.log("[App] Fetch ID mismatch, ignoring result");
                    return;
                }

                setMessages(prev => {
                    if (beforeId) return [...prev, ...mapped.reverse()]; // Load more (top)
                    return mapped.reverse(); // Initial load
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
        if (isLoadingMore || !selectedChannel || messages.length === 0) return;
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

    const handleSendMessage = async (content: string) => {
        if (!content.trim() || !selectedChannel || !selectedGuild) return;
        try {
            await invoke('send_message', {
                guildId: selectedGuild,
                channelId: selectedChannel,
                content: content.trim()
            });
            // Optimistic update or wait for event is fine. 
            // We listen to 'message_create' so it should appear automatically.
        } catch (e) {
            console.error("Failed to send message:", e);
            setStatus(`Send Error: ${e}`);
        }
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

                        return (
                            <div className="space-y-4">
                                {orphans.length > 0 && (
                                    <div className="space-y-1">
                                        {orphans.map(c => renderChannelItem(c))}
                                    </div>
                                )}
                                {categories.sort((a, b) => (Number(a.id) - Number(b.id))).map(cat => (
                                    <div key={cat.id}>
                                        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 px-1 hover:text-gray-300">
                                            {cat.name}
                                        </div>
                                        <div className="space-y-1">
                                            {channelMap[cat.id]?.map(c => renderChannelItem(c))}
                                        </div>
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
                <div className="bg-[#050505] p-2 flex items-center gap-2 border-t border-gray-800">
                    <div className="relative group cursor-pointer">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold border transition-all duration-200 ${localSpeaking
                            ? 'bg-green-500/20 text-green-400 border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                            : 'bg-terminal-green/20 text-terminal-green border-terminal-green/30'
                            }`}>
                            {localSpeaking && (
                                <div className="absolute inset-0 rounded-full border-2 border-green-500 animate-ping opacity-75"></div>
                            )}
                            P
                        </div>
                        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-black rounded-full"></div>
                    </div>
                    <div className="flex-1 min-w-0 pointer-events-none">
                        <div className="text-xs font-bold text-white truncate">Player</div>
                        <div className="text-[10px] text-gray-500 truncate">Online</div>
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
                    messages={messages as any} // Cast might be needed due to local interface definition
                    onSendMessage={handleSendMessage}
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
                    status={status}
                    selectedChannel={selectedChannel}
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
                    scrollToBottom={scrollToBottom}
                    handleMessagesScroll={handleMessagesScroll}

                    messagesContainerRef={messagesContainerRef}
                    messagesEndRef={messagesEndRef}
                />
            )}
        </div>
    );
}

export default App;
