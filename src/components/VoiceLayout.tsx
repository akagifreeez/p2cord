import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '../stores/sessionStore';
import { ChannelChat, Message } from './ChannelChat';
import { useState, useRef } from 'react';

interface VoiceLayoutProps {
    messages?: Message[];
    onSendMessage?: (text: string) => void;
    myId?: string | null;

    // Scroll & Pagination
    isLoadingMore?: boolean;
    showScrollButton?: boolean;
    onLoadMore?: () => void;
    onScrollToBottom?: () => void;
    onMessagesScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
    messagesContainerRef?: React.RefObject<HTMLDivElement>;
    messagesEndRef?: React.RefObject<HTMLDivElement>;
}

// Reusing VideoGridItem design (adapted for Avatar-only for now)
function GridItem({
    label,
    isLocal = false,
    isSpeaking = false,
    clientId
}: {
    label: string,
    isLocal?: boolean,
    isSpeaking?: boolean,
    clientId: string
}) {
    return (
        <div className={`relative aspect-video glass-card overflow-hidden group border transition-all duration-300 ${isSpeaking ? 'border-green-500/50 shadow-[0_0_20px_rgba(34,197,94,0.2)]' : 'border-white/5 hover:border-white/20'}`}>
            <div className="w-full h-full flex flex-col items-center justify-center bg-black/20">
                {/* Avatar Circle */}
                <div className={`relative w-24 h-24 rounded-full flex items-center justify-center text-4xl font-bold border-4 transition-all duration-300 ${isSpeaking
                    ? 'bg-green-500/20 text-green-400 border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.4)] scale-110'
                    : 'bg-white/10 text-gray-400 border-white/10 group-hover:bg-white/20 group-hover:text-white'
                    }`}>
                    {label[0].toUpperCase()}
                    {isSpeaking && (
                        <div className="absolute inset-0 rounded-full border-4 border-green-500 animate-ping opacity-50"></div>
                    )}
                </div>

                {/* Status Badge */}
                {isSpeaking && (
                    <div className="mt-4 px-3 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded-full border border-green-500/30 animate-pulse">
                        SPEAKING
                    </div>
                )}
            </div>

            {/* Label Overlay */}
            <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/60 backdrop-blur text-xs font-bold text-white border border-white/10 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                <span className="truncate max-w-[150px]">{label}</span>
                {isLocal && <span className="text-cyan-400 text-[10px] ml-1">(YOU)</span>}
            </div>

            {/* ID Overlay (Debug) */}
            <div className="absolute top-2 right-2 text-[10px] text-gray-600 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                {clientId.slice(0, 8)}
            </div>
        </div>
    );
}

export function VoiceLayout({
    messages = [],
    onSendMessage = () => { },
    myId = null,
    isLoadingMore = false,
    showScrollButton = false,
    onLoadMore = () => { },
    onScrollToBottom = () => { },
    onMessagesScroll = () => { },
    messagesContainerRef,
    messagesEndRef
}: VoiceLayoutProps) {
    const {
        connectedVoiceChannelId,
        remoteSpeakers,
        connectedPeers,
        isMuted,
        isScreenSharing,
        localSpeaking,
        setMediaStatus,
        setConnectedVoiceChannel,
        isConnected, // Correct property name
        setConnectionStatus,
        clearPeers,
    } = useSessionStore();

    // Get transitioning state from store
    const isVoiceTransitioning = useSessionStore(state => state.isVoiceTransitioning);
    const setVoiceTransitioning = useSessionStore(state => state.setVoiceTransitioning);

    // Toggle Mute
    const handleToggleMute = async () => {
        try {
            const newState = await invoke<boolean>('toggle_mute');
            setMediaStatus({ isMuted: newState });
        } catch (e) {
            console.error("Failed to toggle mute:", e);
        }
    };

    // Toggle Screen Share
    const handleToggleScreenShare = async () => {
        // Placeholder for Screen Sharing logic
        // If enabling: 
        // 1. Trigger Screen Capture (Rust or JS)
        // 2. Negotiate video track
        const newState = !isScreenSharing;
        setMediaStatus({ isScreenSharing: newState });
        console.log("Screen Share Toggled:", newState);
        // Toast or visual feedback handled by state change in UI
        if (newState) {
            // TODO: Invoke Rust backend to start screen capture
        } else {
            // TODO: Invoke Rust backend to stop
        }
    };

    // Disconnect
    const handleDisconnect = async () => {
        // Prevent rapid toggling
        if (isVoiceTransitioning) {
            console.log("Operation in progress, please wait...");
            return;
        }

        setVoiceTransitioning(true);
        try {
            // Call backend to stop the P2P session
            await invoke('leave_room');
        } catch (e) {
            console.error("Failed to leave room:", e);
        }

        // Update UI state
        setConnectedVoiceChannel(null);
        setConnectionStatus(false);
        clearPeers();

        // Allow next operation after delay
        setTimeout(() => setVoiceTransitioning(false), 1000);
    };

    const participants = [
        { id: 'me', name: 'Me', isLocal: true },
        ...connectedPeers.map(id => ({ id, name: `User ${id.slice(0, 4)}`, isLocal: false }))
    ];

    return (
        <div className="flex-1 flex flex-col bg-[#0a0a12] overflow-hidden relative z-10">
            {/* Background Effects */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/5 rounded-full blur-[120px]"></div>
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-500/5 rounded-full blur-[120px]"></div>
            </div>

            {/* Header */}
            <div className="h-16 px-6 flex items-center justify-between border-b border-white/5 bg-black/20 backdrop-blur z-20">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                        <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                        Voice Channel
                        {connectedVoiceChannelId && <span className="text-xs font-normal text-gray-500 ml-2 font-mono">ID: {connectedVoiceChannelId}</span>}
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_#22c55e]"></span>
                    <span className="text-xs font-bold text-gray-300">{participants.length} CONNECTED</span>
                </div>
            </div>

            {/* Grid & Chat Split View */}
            <div className="flex-1 flex overflow-hidden z-10 relative">
                {/* Voice Grid (Left) */}
                <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                        {participants.map(p => {
                            // Determine speaking state
                            const isSpeaking = p.isLocal
                                ? localSpeaking
                                : remoteSpeakers[p.id] || false;

                            return (
                                <GridItem
                                    key={p.id}
                                    clientId={p.id}
                                    label={p.name}
                                    isLocal={p.isLocal}
                                    isSpeaking={isSpeaking}
                                />
                            );
                        })}
                    </div>
                </div>

                {/* Chat Panel (Right) - Reusing ChannelChat */}
                <div className="w-96 border-l border-white/10 bg-black/40 flex flex-col">
                    <ChannelChat
                        status={isConnected ? "Connected" : "Disconnected"}
                        selectedChannel={connectedVoiceChannelId}
                        channelName="Voice Chat"
                        channels={[]} // Not needed contextually for voice chat list
                        messages={messages}
                        searchResults={null}
                        searchQuery=""
                        isSearching={false}
                        isLoadingChannel={false}
                        isLoadingMore={isLoadingMore}
                        showScrollButton={showScrollButton}

                        setSearchQuery={() => { }}
                        handleSearch={() => { }}
                        clearSearch={() => { }}
                        handleSendMessage={onSendMessage}
                        scrollToBottom={onScrollToBottom}
                        handleMessagesScroll={onMessagesScroll}

                        messagesContainerRef={messagesContainerRef as any}
                        messagesEndRef={messagesEndRef as any}
                    />
                </div>
            </div>

            {/* Controls */}
            <div className="h-24 bg-black/40 backdrop-blur-md border-t border-white/10 px-8 flex items-center justify-center gap-6 z-20">
                {/* Mute Toggle */}
                <button
                    onClick={handleToggleMute}
                    className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isMuted
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                        : 'bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                        }`}
                    title={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                    ) : (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                    )}
                </button>

                {/* Screen Share Toggle */}
                <button
                    onClick={handleToggleScreenShare}
                    className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isScreenSharing
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                        : 'bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                        }`}
                    title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                </button>

                <button
                    onClick={handleDisconnect}
                    className="px-8 py-3 rounded-full bg-red-600 hover:bg-red-500 text-white font-bold shadow-[0_0_20px_rgba(220,38,38,0.4)] flex items-center gap-3 transition-all transform hover:scale-105"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    Disconnect
                </button>
            </div>
        </div>
    );
}
