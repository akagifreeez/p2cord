// Interfaces (Should ideally be shared/imported)
import { linkify } from '../utils/textUtils';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface Channel {
    id: string;
    name: string;
    kind: 'Text' | 'Voice' | 'Category' | 'Forum' | 'PublicThread' | 'PrivateThread' | 'AnnouncementThread';
    parent_id?: string;
    position: number;
    last_message_id?: string;
}

export interface Attachment {
    id: string;
    filename: string;
    url: string;
    content_type?: string;
    width?: number;
    height?: number;
    size?: number; // Optional
}

export interface Embed {
    title?: string;
    description?: string;
    url?: string;
    color?: number;
    image?: { url: string };
    thumbnail?: { url: string };
}

export interface Message {
    id: string;
    channel_id: string;
    guild_id?: string; // Added to fix TS error
    content: string;
    author: string;
    author_id?: string;
    timestamp: string;
    embeds: Embed[];
    attachments: Attachment[];
    referenced_message?: Message;
    message_snapshots?: MessageSnapshot[];
    kind: string; // "Default", "UserJoin", "ChannelPin", etc.
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

interface ChannelChatProps {
    status: string;
    selectedChannel: string | null;
    channelName?: string;
    channels: Channel[]; // Needed for referencing channel names in search results
    messages: Message[];
    searchResults: Message[] | null;
    searchQuery: string;
    isSearching: boolean;
    isLoadingChannel: boolean;
    isLoadingMore: boolean;
    showScrollButton: boolean;

    // Actions
    setSearchQuery: (query: string) => void;
    handleSearch: () => void;
    clearSearch: () => void;
    handleSendMessage: (content: string, replyToId?: string | null) => void;
    onMessageDelete: (messageId: string) => void;
    scrollToBottom: () => void;
    handleMessagesScroll: (e: React.UIEvent<HTMLDivElement>) => void;

    // Refs
    messagesContainerRef: React.RefObject<HTMLDivElement>;
    messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function ChannelChat({
    status,
    selectedChannel,
    channelName,
    channels,
    messages,
    searchResults,
    searchQuery,
    isSearching,
    isLoadingChannel,
    isLoadingMore,
    showScrollButton,
    setSearchQuery,
    handleSearch,
    clearSearch,
    handleSendMessage,
    onMessageDelete,
    scrollToBottom,
    handleMessagesScroll,
    messagesContainerRef,
    messagesEndRef
}: ChannelChatProps) {

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: Message } | null>(null);
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const handleContextMenu = (e: React.MouseEvent, msg: Message) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
    };

    const handleDeleteMessage = async (channelId: string, messageId: string) => {
        if (!confirm("Are you sure you want to delete this message?")) return;
        try {
            await invoke('delete_message', { channelId, messageId });
            onMessageDelete(messageId); // Optimistic / Local update
        } catch (e) {
            console.error("Failed to delete message:", e);
        }
    };

    const handleCopyLink = (msg: Message) => {
        const link = `https://discord.com/channels/${msg.guild_id}/${msg.channel_id}/${msg.id}`;
        navigator.clipboard.writeText(link);
    };

    return (
        <div className="flex-1 flex flex-col bg-black relative h-full">
            <div className="p-4 border-b border-gray-800 flex flex-col gap-2 bg-black/50 backdrop-blur z-10">
                <div className="flex justify-between items-center">
                    <span className="font-bold text-lg text-terminal-green">
                        {selectedChannel ? `#${channelName || 'unknown'}` : 'Chat'}
                    </span>
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

            {/* Message List Wrapper */}
            <div className="flex-1 relative flex flex-col overflow-hidden">
                <div
                    key={selectedChannel || 'empty'}
                    ref={messagesContainerRef}
                    className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar"
                    // style={{ visibility: 'visible' }}
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
                        (searchResults || messages).map((m) => {
                            const isSystemMessage = m.kind !== 'Default' && m.kind !== 'Reply';

                            if (isSystemMessage) {
                                return (
                                    <div key={m.id} className="group hover:bg-gray-900/50 px-4 py-1 rounded flex items-center justify-center gap-2 text-gray-400 text-sm my-2 select-none">
                                        <div className="flex-1 h-px bg-gray-800/50"></div>
                                        {m.kind === 'UserJoin' && <span className="text-terminal-green">→</span>}
                                        {m.kind === 'ChannelPinnedMessage' && <span>📌</span>}
                                        {m.kind === 'ThreadCreated' && <span>🧵</span>}
                                        <span className="font-medium">
                                            {m.kind === 'UserJoin' && `${m.author} joined the server.`}
                                            {m.kind === 'ChannelPinnedMessage' && `${m.author} pinned a message.`}
                                            {m.kind === 'ThreadCreated' && `${m.author} started a thread: ${m.content}`}
                                            {!['UserJoin', 'ChannelPinnedMessage', 'ThreadCreated'].includes(m.kind) && `System Message: ${m.kind}`}
                                        </span>
                                        <span className="text-xs text-gray-600 ml-1">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        <div className="flex-1 h-px bg-gray-800/50"></div>
                                    </div>
                                );
                            }

                            return (
                                <div
                                    key={m.id}
                                    className="group hover:bg-gray-900 p-2 -mx-2 rounded transition-colors duration-200"
                                    onContextMenu={(e) => handleContextMenu(e, m)}
                                >
                                    {m.referenced_message && (
                                        <div className="flex items-center gap-2 mb-0.5 ml-4 opacity-70 text-xs">
                                            <div className="w-8 border-t-2 border-l-2 border-gray-600 rounded-tl-lg h-3 -mb-3 mr-1"></div>
                                            <div className="flex items-center gap-1 cursor-pointer hover:text-white text-gray-400" onClick={() => {/* TODO: Scroll to message */ }}>
                                                <span className="font-bold">@{m.referenced_message.author}</span>
                                                <span className="truncate max-w-[300px]">{m.referenced_message.content}</span>
                                            </div>
                                        </div>
                                    )}
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

                                    {/* Forwarded Messages (Snapshots) */}
                                    {m.message_snapshots && m.message_snapshots.map((snapshot, idx) => (
                                        <div key={idx} className="mt-1 mb-1 ml-0 border-l-4 border-gray-600 bg-gray-800/30 p-2 rounded text-sm relative">
                                            <div className="text-xs text-gray-400 font-bold mb-1 flex items-center gap-1">
                                                <span className="text-[10px] uppercase tracking-wider bg-gray-700 px-1 rounded">Forwarded</span>
                                                {snapshot.message.author}
                                            </div>
                                            <div className="whitespace-pre-wrap dark:text-gray-300 text-gray-800">
                                                {linkify(snapshot.message.content)}
                                            </div>
                                            {/* Attachments in forward */}
                                            {snapshot.message.attachments && snapshot.message.attachments.length > 0 && (
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    {snapshot.message.attachments.map(att => (
                                                        <div key={att.id} className="max-w-xs">
                                                            {att.content_type?.startsWith('image/') ? (
                                                                <img src={att.url} alt={att.filename} className="rounded-lg max-h-48 cursor-pointer hover:opacity-90" onClick={() => window.open(att.url, '_blank')} />
                                                            ) : (
                                                                <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-1">
                                                                    <span className="text-lg">📎</span> {att.filename}
                                                                </a>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    <div className="mt-1 text-gray-300 whitespace-pre-wrap break-words">{linkify(m.content)}</div>

                                    {/* Embeds Rendering */}
                                    {m.embeds && m.embeds.map((embed, idx) => (
                                        <div key={idx} className="mt-2 border-l-4 bg-gray-900 rounded p-3" style={{ borderLeftColor: embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#202225' }}>
                                            <div className="flex gap-4">
                                                <div className="flex-1 min-w-0">
                                                    {embed.title && <div className="font-bold text-white mb-1">{embed.title}</div>}
                                                    {embed.description && <div className="text-gray-300 text-sm whitespace-pre-wrap break-words">{embed.description}</div>}
                                                    {embed.image && <img src={embed.image.url} alt="Embed" className="mt-2 max-w-full rounded" style={{ maxHeight: '300px' }} />}
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
                                                <img
                                                    src={att.url}
                                                    alt={att.filename}
                                                    width={att.width}
                                                    height={att.height}
                                                    className="max-w-full rounded bg-gray-900"
                                                    style={{
                                                        maxHeight: '350px',
                                                        height: 'auto', // Preserve aspect ratio if width is constrained
                                                        width: 'auto',  // Allow width to shrink if height is constrained
                                                        aspectRatio: att.width && att.height ? `${att.width}/${att.height}` : undefined
                                                    }}
                                                />
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
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Render Context Menu */}
                {contextMenu && (
                    <div
                        className="fixed z-50 bg-[#111] border border-gray-800 rounded shadow-xl py-1 w-48 text-sm"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                    >
                        <button
                            className="w-full text-left px-3 py-2 hover:bg-gray-800 text-gray-300 hover:text-white flex items-center gap-2"
                            onClick={() => {
                                setReplyingTo(contextMenu.message);
                                setContextMenu(null);
                            }}
                        >
                            <span>↩️</span> Reply
                        </button>
                        <button
                            className="w-full text-left px-3 py-2 hover:bg-gray-800 text-gray-300 hover:text-white flex items-center gap-2"
                            onClick={() => {
                                handleCopyLink(contextMenu.message);
                                setContextMenu(null);
                            }}
                        >
                            <span>🔗</span> Copy Message Link
                        </button>
                        {/* Copy Image Link (First image attachment) */}
                        {contextMenu.message.attachments?.some(a => a.content_type?.startsWith('image/')) && (
                            <button
                                className="w-full text-left px-3 py-2 hover:bg-gray-800 text-gray-300 hover:text-white flex items-center gap-2"
                                onClick={() => {
                                    const img = contextMenu.message.attachments.find(a => a.content_type?.startsWith('image/'));
                                    if (img) navigator.clipboard.writeText(img.url);
                                    setContextMenu(null);
                                }}
                            >
                                <span>🖼️</span> Copy Image Link
                            </button>
                        )}
                        <div className="h-px bg-gray-800 my-1"></div>
                        <button
                            className="w-full text-left px-3 py-2 hover:bg-red-900/50 text-red-400 hover:text-red-300 flex items-center gap-2"
                            onClick={() => {
                                handleDeleteMessage(contextMenu.message.channel_id, contextMenu.message.id);
                                setContextMenu(null);
                            }}
                        >
                            <span>🗑️</span> Delete Message
                        </button>
                    </div>
                )}

                {/* Scroll Button */}
                {showScrollButton && (
                    <button
                        onClick={scrollToBottom}
                        className="absolute bottom-20 right-8 bg-gray-800 p-2 rounded-full shadow-lg hover:bg-gray-700 animate-bounce transition-all"
                    >
                        ⬇
                    </button>
                )}

                {/* Input Area */}
                <div className="p-4 bg-gray-900 border-t border-gray-800">
                    {replyingTo && (
                        <div className="flex items-center justify-between bg-gray-800 p-2 rounded-t text-xs text-gray-400 border-b border-gray-700 mb-0">
                            <span className="flex items-center gap-1">
                                <span>Replying to</span>
                                <span className="font-bold text-blue-400">@{replyingTo.author}</span>
                            </span>
                            <button onClick={() => setReplyingTo(null)} className="hover:text-white">✕</button>
                        </div>
                    )}
                    <input
                        type="text"
                        placeholder={selectedChannel ? `Message #${channelName || 'unknown'}` : "Select a channel"}
                        className={`w-full bg-gray-800 border border-gray-700 p-3 rounded ${replyingTo ? 'rounded-t-none' : ''} text-white focus:outline-none focus:border-terminal-green ${!selectedChannel ? 'cursor-not-allowed opacity-50' : ''}`}
                        disabled={!selectedChannel}
                        onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                                const input = e.currentTarget;
                                const content = input.value;
                                if (content.trim()) {
                                    await handleSendMessage(content, replyingTo?.id);
                                    input.value = '';
                                    setReplyingTo(null);
                                }
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
