// Interfaces (Should ideally be shared/imported)
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
    content: string;
    author: string;
    author_id?: string;
    timestamp: string;
    embeds: Embed[];
    attachments: Attachment[];
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
    handleSendMessage: (content: string) => void;
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
    scrollToBottom,
    handleMessagesScroll,
    messagesContainerRef,
    messagesEndRef
}: ChannelChatProps) {

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
                        (searchResults || messages).map((m) => (
                            <div key={m.id} className="group hover:bg-gray-900 p-2 -mx-2 rounded transition-colors duration-200">
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
                        ))
                    )}
                    <div ref={messagesEndRef} />
                </div>

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
                    <input
                        type="text"
                        placeholder={selectedChannel ? `Message #${channelName || 'unknown'}` : "Select a channel"}
                        className={`w-full bg-gray-800 border border-gray-700 p-3 rounded text-white focus:outline-none focus:border-terminal-green ${!selectedChannel ? 'cursor-not-allowed opacity-50' : ''}`}
                        disabled={!selectedChannel}
                        onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                                const input = e.currentTarget;
                                const content = input.value;
                                if (content.trim()) {
                                    await handleSendMessage(content);
                                    input.value = '';
                                }
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
