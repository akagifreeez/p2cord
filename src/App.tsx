import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
    timestamp: string;
    embeds: Embed[];
    attachments: Attachment[];
}

function App() {
    const [token, setToken] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [status, setStatus] = useState('');

    const [guilds, setGuilds] = useState<Guild[]>([]);
    const [selectedGuild, setSelectedGuild] = useState<string | null>(null);

    const [channels, setChannels] = useState<Channel[]>([]);
    const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
    const selectedChannelRef = useRef<string | null>(null); // Ref to track selected channel in listener

    useEffect(() => {
        selectedChannelRef.current = selectedChannel;
    }, [selectedChannel]);

    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoadingChannel, setIsLoadingChannel] = useState(false);
    const [isSwitchingChannel, setIsSwitchingChannel] = useState(false); // チャンネル切り替え中のオーバーレイ制御
    const fetchIdRef = useRef(0); // フェッチバージョン管理用

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Message[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);

    // Background fetch state
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
            const res = await invoke<string>('init_client', { token: tokenToUse });
            setStatus(res);
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
        setSelectedGuild(guildId);
        setSelectedChannel(null);
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

        if (!beforeId) {
            // チャンネル新規選択: 即座にマスク表示 (Overlay)
            setSelectedChannel(channelId);
            setIsSwitchingChannel(true);
            setSearchQuery('');
            setSearchResults(null);
            setMessages([]);
            setIsLoadingChannel(true);
            setShowScrollButton(false);

            // 1. キャッシュ取得
            try {
                const cachedMsgs = await invoke<Message[]>('get_cached_messages', { channelId, limit: 50 });
                if (currentFetchId !== fetchIdRef.current) return;

                if (cachedMsgs.length > 0) {
                    setMessages(cachedMsgs.reverse());
                    setIsLoadingChannel(false);
                    // note: オーバーレイ除去とスクロールは useLayoutEffect で行う
                } else {
                    // キャッシュなし
                    setIsLoadingChannel(true);
                    // メッセージ0件の場合も useLayoutEffect でマスクを外す
                }
            } catch {
                setIsLoadingChannel(true);
            }
        }

        if (!selectedGuild) return;

        // 2. APIフェッチ
        try {
            const res = await invoke<Message[]>('get_messages', { guildId: selectedGuild, channelId, beforeId });
            if (currentFetchId !== fetchIdRef.current) return;

            if (beforeId) {
                // 過去ログ読み込み時はそのまま追加(スクロール最適化は別途必要かもだが一旦保持)
                setMessages(prev => [...res.reverse(), ...prev]);
            } else {
                setMessages(res.reverse());
                setIsLoadingChannel(false);
                // オーバーレイ除去とスクロールは useLayoutEffect で行う
            }
        } catch (e) {
            if (currentFetchId === fetchIdRef.current) {
                setStatus(`Error fetching messages: ${e}`);
                setIsLoadingChannel(false);
                // エラー時もマスク解除が必要
                requestAnimationFrame(() => setIsSwitchingChannel(false));
            }
        }
    };

    // 同期的スクロールとマスク解除制御
    useLayoutEffect(() => {
        if (isSwitchingChannel) {
            // メッセージがある場合、またはロード完了かつメッセージ0の場合
            if (messages.length > 0 || (!isLoadingChannel && messages.length === 0)) {
                // 1. 強制スクロール (Paint前)
                if (messagesEndRef.current) {
                    messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
                }

                // 2. マスク解除 (Paint許可)
                // requestAnimationFrameを使って次の描画フレームで解除することで、
                // スクロール位置が確定した状態を描画させる
                requestAnimationFrame(() => {
                    setIsSwitchingChannel(false);
                });
            }
        }
    }, [messages, isSwitchingChannel, isLoadingChannel]);


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
        if (!isSwitchingChannel && !showScrollButton && messagesEndRef.current && !isLoadingChannel && messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            const isRecent = new Date().getTime() - new Date(lastMsg.timestamp).getTime() < 5000;
            if (isRecent) {
                messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [messages, isSwitchingChannel, showScrollButton, isLoadingChannel]);

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
                        const categories = channels.filter(c => c.kind === 'Category');
                        const textChannels = channels.filter(c => c.kind !== 'Category');
                        const categoryMap: Record<string, Channel[]> = {};
                        const orphans: Channel[] = [];

                        textChannels.forEach(c => {
                            if (c.parent_id) {
                                if (!categoryMap[c.parent_id]) categoryMap[c.parent_id] = [];
                                categoryMap[c.parent_id].push(c);
                            } else {
                                orphans.push(c);
                            }
                        });

                        const renderChannel = (c: Channel) => (
                            <div
                                key={c.id}
                                onClick={() => fetchMessages(c.id)}
                                className={`ml-2 p-1 px-2 cursor-pointer hover:bg-gray-900 rounded truncate text-sm flex items-center ${selectedChannel === c.id ? 'bg-gray-800 text-white' : 'text-gray-400'}`}
                            >
                                <span className="text-gray-600 mr-1 text-xs">{c.kind.includes('Voice') ? '🔊' : '#'}</span>
                                {c.name}
                            </div>
                        );

                        return (
                            <div className="space-y-4">
                                {orphans.length > 0 && (
                                    <div className="space-y-1">
                                        {orphans.map(renderChannel)}
                                    </div>
                                )}
                                {categories.sort((a, b) => (Number(a.id) - Number(b.id))).map(cat => (
                                    <div key={cat.id}>
                                        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 px-1 hover:text-gray-300">
                                            {cat.name}
                                        </div>
                                        <div className="space-y-1">
                                            {categoryMap[cat.id]?.map(renderChannel)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            </div>

            {/* Main: Chat */}
            <div className="flex-1 flex flex-col bg-black relative">
                <div className="p-4 border-b border-gray-800 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                        <span className="font-bold text-lg text-terminal-green">Chat</span>
                        <span className="text-sm text-gray-500">{status}</span>
                    </div>
                    {/* Search Bar */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Search messages..."
                            className="flex-1 bg-gray-900 border border-gray-700 px-3 py-1 rounded text-white text-sm focus:outline-none focus:border-terminal-green"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            disabled={!selectedChannel}
                        />
                        {searchResults !== null && (
                            <button onClick={clearSearch} className="text-xs text-gray-400 hover:text-white px-2">
                                Clear ({searchResults.length})
                            </button>
                        )}
                    </div>
                </div>

                {/* Message List Wrapper (Relative for overlay) */}
                <div className="flex-1 relative flex flex-col overflow-hidden">
                    {/* Overlay for Instant Switching (Iron Curtain) */}
                    {isSwitchingChannel && (
                        <div className="absolute inset-0 bg-black z-50 flex items-center justify-center">
                            <div className="text-terminal-green font-bold animate-pulse">Loading...</div>
                        </div>
                    )}

                    <div
                        key={selectedChannel || 'empty'}
                        ref={messagesContainerRef}
                        className="flex-1 overflow-y-auto p-4 space-y-4"
                        onScroll={handleMessagesScroll}
                    >
                        {isLoadingChannel && (
                            <div className="text-center text-gray-500 text-sm py-4">Loading messages...</div>
                        )}
                        {isSearching && (
                            <div className="text-center text-gray-500 text-sm py-2">Searching...</div>
                        )}
                        {isLoadingMore && !searchResults && (
                            <div className="text-center text-gray-500 text-sm py-2">Loading older messages...</div>
                        )}
                        {(searchResults || messages).length === 0 ? (
                            <div className="text-center text-gray-600 mt-10">
                                {searchResults !== null ? 'No search results' : 'Select a channel to view messages'}
                            </div>
                        ) : (
                            (searchResults || messages).map((m) => (
                                <div key={m.id} className="group hover:bg-gray-900 p-2 -mx-2 rounded">
                                    <div className="flex items-baseline gap-2 flex-wrap">
                                        <span className="font-bold text-blue-400">{m.author}</span>
                                        <span className="text-xs text-gray-600">
                                            {searchResults
                                                ? new Date(m.timestamp).toLocaleString()
                                                : new Date(m.timestamp).toLocaleTimeString()}
                                        </span>
                                        {searchResults && m.channel_id !== selectedChannel && (
                                            <span className="text-xs bg-gray-800 text-gray-400 px-1 rounded">
                                                #{channels.find(c => c.id === m.channel_id)?.name || 'unknown'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 text-gray-300 whitespace-pre-wrap break-words">{m.content}</div>

                                    {/* Embeds Rendering */}
                                    {m.embeds && m.embeds.map((embed, idx) => (
                                        <div key={idx} className="mt-2 border-l-4 bg-gray-900 rounded p-3" style={{ borderLeftColor: embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#202225' }}>
                                            <div className="flex gap-4">
                                                <div className="flex-1 min-w-0">
                                                    {embed.title && <div className="font-bold text-white mb-1">{embed.title}</div>}
                                                    {embed.description && <div className="text-gray-300 text-sm whitespace-pre-wrap break-words">{embed.description}</div>}
                                                    {embed.image && <img src={embed.image.url} alt="Embed" className="mt-2 max-w-full rounded" style={{ maxHeight: '300px' }} />}
                                                    {embed.footer && (
                                                        <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                                                            {embed.footer.icon_url && <img src={embed.footer.icon_url} alt="" className="w-4 h-4 rounded-full" />}
                                                            <span>{embed.footer.text}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                {embed.thumbnail && (
                                                    <div className="flex-shrink-0">
                                                        <img src={embed.thumbnail.url} alt="Thumbnail" className="w-20 h-20 rounded object-cover" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Attachments Rendering */}
                                    {m.attachments && m.attachments.map((att) => (
                                        <div key={att.id} className="mt-2">
                                            {att.content_type?.startsWith('image/') ? (
                                                <img src={att.url} alt={att.filename} className="max-w-full rounded" style={{ maxHeight: '350px' }} />
                                            ) : (
                                                <div className="bg-gray-800 p-2 rounded flex items-center gap-2 max-w-sm border border-gray-700">
                                                    <div className="text-2xl">📄</div>
                                                    <div className="overflow-hidden">
                                                        <div className="font-bold text-sm truncate text-gray-300">{att.filename}</div>
                                                        <a href={att.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">Download</a>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Scroll to Bottom Button */}
                    {showScrollButton && (
                        <button
                            onClick={scrollToBottom}
                            className="absolute bottom-4 right-6 bg-gray-800 hover:bg-gray-700 text-white rounded-full p-3 shadow-lg transition"
                            title="Scroll to bottom"
                        >
                            ↓
                        </button>
                    )}
                </div>

                {/* Input Placeholder */}
                <div className="p-4 border-t border-gray-800">
                    <input
                        type="text"
                        placeholder={selectedChannel ? `Message #${channels.find(c => c.id === selectedChannel)?.name}` : "Select a channel"}
                        className={`w-full bg-gray-900 border border-gray-700 p-3 rounded text-white focus:outline-none focus:border-terminal-green ${!selectedChannel ? 'cursor-not-allowed opacity-50' : ''}`}
                        disabled={!selectedChannel}
                        onKeyDown={async (e) => {
                            if (e.key === 'Enter' && selectedChannel && selectedGuild) {
                                const input = e.currentTarget;
                                const content = input.value.trim();
                                if (!content) return;

                                input.value = ''; // Clear immediately
                                try {
                                    await invoke<Message>('send_message', { guildId: selectedGuild, channelId: selectedChannel, content });
                                    // Gateway will handle adding the message via MESSAGE_CREATE event
                                } catch (err) {
                                    setStatus(`Send Failed: ${err}`);
                                    input.value = content; // Revert on failure
                                }
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );
}

export default App;
