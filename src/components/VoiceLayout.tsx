import { useSessionStore } from '../stores/sessionStore';
import { ChannelChat, Message } from './ChannelChat';
import { useRef, useEffect, useState, useMemo } from 'react';
import type { UseWebRTCReturn } from '../hooks/useWebRTC';
import { QualitySettings, loadQualityConfig, saveQualityConfig, type QualityConfig } from './QualitySettings';


// Screen Share Preview Component
function ScreenSharePreview({ stream }: { stream: MediaStream }) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div className="relative aspect-video glass-card overflow-hidden border-2 border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.3)] col-span-full lg:col-span-2">
            <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-contain bg-black"
            />
            <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-cyan-500/20 backdrop-blur text-xs font-bold text-cyan-400 border border-cyan-500/30 flex items-center gap-2">
                <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
                SCREEN SHARING
            </div>
            <div className="absolute bottom-3 right-3 px-3 py-1 rounded-full bg-black/60 backdrop-blur text-xs font-bold text-white border border-white/10">
                YOUR SCREEN
            </div>
        </div>
    );
}

// Remote Audio Player - invisible component to play remote peer audio
function RemoteAudioPlayer({ streams }: { streams: Map<string, MediaStream> }) {
    const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

    useEffect(() => {
        // Create/update audio elements for each remote stream
        streams.forEach((stream, peerId) => {
            let audioEl = audioRefs.current.get(peerId);

            if (!audioEl) {
                // Create new audio element
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                audioEl.id = `remote-audio-${peerId}`;
                document.body.appendChild(audioEl);
                audioRefs.current.set(peerId, audioEl);
                console.log(`[Audio] Created audio element for peer: ${peerId}`);
            }

            // Update stream if different
            if (audioEl.srcObject !== stream) {
                audioEl.srcObject = stream;
                audioEl.play().catch(e => console.error('[Audio] Play failed:', e));
                console.log(`[Audio] Playing stream for peer: ${peerId}`);
            }
        });

        // Remove audio elements for disconnected peers
        audioRefs.current.forEach((audioEl, peerId) => {
            if (!streams.has(peerId)) {
                audioEl.srcObject = null;
                audioEl.remove();
                audioRefs.current.delete(peerId);
                console.log(`[Audio] Removed audio element for peer: ${peerId}`);
            }
        });
    }, [streams]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            audioRefs.current.forEach((audioEl) => {
                audioEl.srcObject = null;
                audioEl.remove();
            });
            audioRefs.current.clear();
        };
    }, []);

    return null; // This component doesn't render anything visible
}

interface VoiceLayoutProps {
    webrtc: UseWebRTCReturn; // WebRTC hook passed from App
    messages?: Message[];
    onSendMessage?: (text: string) => void;
    onMessageDelete?: (id: string) => void;
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
    clientId,
    videoStream,
    onClick
}: {
    label: string,
    isLocal?: boolean,
    isSpeaking?: boolean,
    clientId: string,
    videoStream?: MediaStream,
    onClick?: () => void
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    // Check if stream actually has video tracks
    const hasVideo = videoStream && videoStream.getVideoTracks().length > 0;

    useEffect(() => {
        if (videoRef.current && videoStream && hasVideo) {
            videoRef.current.srcObject = videoStream;
        }
    }, [videoStream, hasVideo]);

    return (
        <div
            onClick={onClick}
            className={`relative aspect-video glass-card overflow-hidden group border transition-all duration-300 ${isSpeaking ? 'border-green-500/50 shadow-[0_0_20px_rgba(34,197,94,0.2)]' : 'border-white/5 hover:border-white/20'} ${onClick ? 'cursor-pointer' : ''}`}
        >
            {hasVideo ? (
                <div className="w-full h-full bg-black relative">
                    <video
                        ref={videoRef}
                        autoPlay
                        muted // Remote audio is handled by RemoteAudioPlayer
                        playsInline
                        className="w-full h-full object-contain"
                    />
                </div>
            ) : (
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
            )}

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
    webrtc,
    messages = [],
    onSendMessage = () => { },
    onMessageDelete = () => { },
    myId: _myId = null,
    isLoadingMore = false,
    showScrollButton = false,
    onLoadMore: _onLoadMore = () => { },
    onScrollToBottom = () => { },
    onMessagesScroll = () => { },
    messagesContainerRef,
    messagesEndRef
}: VoiceLayoutProps) {
    // webrtc is now passed as prop from App

    const {
        connectedVoiceChannelId,
        setConnectedVoiceChannel,
        setConnectionStatus,
    } = useSessionStore();

    // Get transitioning state from store
    const isVoiceTransitioning = useSessionStore(state => state.isVoiceTransitioning);
    const setVoiceTransitioning = useSessionStore(state => state.setVoiceTransitioning);

    // Quality Config State
    const [qualityConfig, setQualityConfig] = useState<QualityConfig>(() => loadQualityConfig());

    const handleQualityChange = (newConfig: QualityConfig) => {
        setQualityConfig(newConfig);
        saveQualityConfig(newConfig);
    };

    // Toggle Mute (now using browser WebRTC)
    const handleToggleMute = () => {
        webrtc.toggleMute();
    };

    // 画面共有メニュー表示状態
    const [showShareMenu, setShowShareMenu] = useState(false);

    // 画面共有ボタンのクリック処理
    const handleShareButtonClick = async () => {
        if (!webrtc.isScreenSharing) {
            // 共有していない場合は直接共有開始
            await webrtc.startScreenShare(qualityConfig);
        } else {
            // 共有中の場合はメニューを表示
            setShowShareMenu(!showShareMenu);
        }
    };

    // 追加共有
    const handleAddAnotherShare = async () => {
        setShowShareMenu(false);
        await webrtc.startScreenShare(qualityConfig);
    };

    // 全共有停止
    const handleStopAllShares = () => {
        setShowShareMenu(false);
        webrtc.stopScreenShare();
    };

    // Disconnect (now using browser WebRTC)
    const handleDisconnect = async () => {
        if (isVoiceTransitioning) {
            console.log("Operation in progress, please wait...");
            return;
        }

        setVoiceTransitioning(true);

        // Stop screen sharing if active
        if (webrtc.isScreenSharing) {
            webrtc.stopScreenShare();
        }

        // Leave WebRTC room
        webrtc.leaveRoom();

        // Update UI state
        setConnectedVoiceChannel(null);
        setConnectionStatus(false);

        setTimeout(() => setVoiceTransitioning(false), 1000);
    };

    // Build participants list from WebRTC
    const participants = useMemo(() => [
        { id: webrtc.myId || 'me', name: 'Me', isLocal: true },
        ...Array.from(webrtc.participants.keys()).map(id => ({
            id,
            name: webrtc.participants.get(id)?.name || `User ${id.slice(0, 4)}`,
            isLocal: false
        }))
    ], [webrtc.myId, webrtc.participants]);

    // Flatten remote video items to avoid new MediaStream during render
    const remoteVideoItems = useMemo(() => {
        const items: any[] = [];
        console.log(`[VoiceLayout] Recalculating remoteVideoItems. RemoteStreams count: ${webrtc.remoteStreams.size}`);

        Array.from(webrtc.remoteStreams).forEach(([peerId, stream]) => {
            const participant = webrtc.participants.get(peerId);
            const allTracks = stream.getVideoTracks();
            const videoTracks = allTracks.filter(t => t.readyState === 'live');
            const isSpeaking = webrtc.remoteSpeakingStates.get(peerId);

            console.log(`[VoiceLayout] Peer ${peerId}: All video tracks: ${allTracks.length}, Live tracks: ${videoTracks.length}`);

            if (videoTracks.length > 0) {
                videoTracks.forEach((track, trackIndex) => {
                    items.push({
                        key: `${peerId}-track-${trackIndex}`,
                        peerId,
                        label: `${participant?.name || peerId.slice(0, 6)}${videoTracks.length > 1 ? ` #${trackIndex + 1}` : ''}`,
                        isSpeaking,
                        videoStream: new MediaStream([track])
                    });
                });
            } else {
                items.push({
                    key: peerId,
                    peerId,
                    label: participant?.name || peerId.slice(0, 6),
                    isSpeaking,
                    videoStream: undefined
                });
            }
        });
        return items;
    }, [webrtc.remoteStreams, webrtc.participants, webrtc.remoteSpeakingStates]);

    const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);

    // フォーカス中の特定ストリームキー（複数ストリームがある場合を区別）
    const [focusedStreamKey, setFocusedStreamKey] = useState<string | null>(null);

    // レイアウトモード: 'auto' = 通常（フォーカス自動）, 'grid' = 全画面グリッド, 'sideBySide' = 横並び
    const [layoutMode, setLayoutMode] = useState<'auto' | 'grid' | 'sideBySide'>('auto');

    // フォーカス中のストリームアイテムを取得
    const focusedVideoItem = useMemo(() => {
        if (!focusedStreamKey) return null;
        return remoteVideoItems.find(item => item.key === focusedStreamKey) || null;
    }, [focusedStreamKey, remoteVideoItems]);


    const focusedParticipant = useMemo(() => {
        if (focusedPeerId === 'me') return { id: 'me', name: 'Me', isLocal: true };
        const p = participants.find(p => p.id === focusedPeerId);
        return p;
    }, [focusedPeerId, participants]);

    // フォーカスモード: auto または grid でフォーカス中の場合（sideBySide以外）
    const isFocusedMode = layoutMode !== 'sideBySide' && !!focusedPeerId;

    // Auto-focus logic: If a new video stream appears, focus it.
    // Only works in 'auto' layout mode - in grid/sideBySide, user has manual control.
    useEffect(() => {
        // gridやsideBySideモードでは自動フォーカスしない
        if (layoutMode !== 'auto') return;

        // Detect new screen shares (or any video)
        webrtc.remoteStreams.forEach((stream, peerId) => {
            const videoTrack = stream.getVideoTracks()[0];
            const hasActiveVideo = videoTrack && videoTrack.readyState === 'live' && !videoTrack.muted;

            // If we have ACTIVE video and nobody is focused, or we want to prioritize new shares...
            // Simple logic: Focus if having video and current focus is null.
            if (hasActiveVideo && focusedPeerId === null) {
                setFocusedPeerId(peerId);
            }
        });

        // Check if focused peer is still valid and has video (optional, keeping focus on avatar is also fine)
        if (focusedPeerId) {
            if (focusedPeerId !== 'me') {
                // Unfocus if:
                // 1. Participant is gone
                if (!webrtc.participants.has(focusedPeerId)) {
                    setFocusedPeerId(null);
                }
            }
        }
    }, [webrtc.remoteStreams, webrtc.participants, focusedPeerId, layoutMode]);

    const handleSendMessage = (text: string) => {
        if (onSendMessage) {
            onSendMessage(text);
        }
    };

    return (
        <div className="flex-1 flex flex-col bg-[#0a0a12] overflow-hidden relative z-10">
            {/* Remote Audio Playback (invisible) */}
            <RemoteAudioPlayer streams={webrtc.remoteStreams} />

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
                    </h1>

                    {/* Layout Mode Toggle */}
                    <div className="flex items-center bg-white/5 rounded-lg p-1 border border-white/10">
                        <button
                            onClick={() => setLayoutMode('auto')}
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${layoutMode === 'auto' ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                            title="自動フォーカス"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => { setLayoutMode('grid'); setFocusedPeerId(null); }}
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${layoutMode === 'grid' ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                            title="グリッド表示"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => { setLayoutMode('sideBySide'); setFocusedPeerId(null); }}
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${layoutMode === 'sideBySide' ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                            title="横並び表示"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                            </svg>
                        </button>
                    </div>
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
                    {isFocusedMode && (focusedVideoItem || focusedParticipant) ? (
                        <div className="flex flex-col h-full gap-4">
                            {/* Main Focused View */}
                            <div className="flex-1 min-h-0 bg-black/40 rounded-xl overflow-hidden relative border border-white/10 shadow-2xl">
                                {focusedVideoItem ? (
                                    // 特定のストリームがフォーカスされている場合
                                    <GridItem
                                        key={focusedVideoItem.key}
                                        clientId={focusedVideoItem.peerId}
                                        label={focusedVideoItem.label}
                                        isLocal={false}
                                        isSpeaking={focusedVideoItem.isSpeaking}
                                        videoStream={focusedVideoItem.videoStream}
                                        onClick={() => { setLayoutMode('grid'); setFocusedPeerId(null); setFocusedStreamKey(null); }}
                                    />
                                ) : focusedParticipant ? (
                                    // ピア単位でフォーカス（ビデオなしまたは旧ロジック）
                                    <GridItem
                                        key={focusedParticipant.id}
                                        clientId={focusedParticipant.id}
                                        label={focusedParticipant.name}
                                        isLocal={focusedParticipant.isLocal}
                                        isSpeaking={focusedParticipant.isLocal ? webrtc.isSpeaking : webrtc.remoteSpeakingStates.get(focusedParticipant.id)}
                                        videoStream={focusedParticipant.isLocal ? undefined : webrtc.remoteStreams.get(focusedParticipant.id)}
                                        onClick={() => { setLayoutMode('grid'); setFocusedPeerId(null); setFocusedStreamKey(null); }}
                                    />
                                ) : null}
                                <div className="absolute top-4 left-4 bg-black/60 px-3 py-1 rounded-full text-xs font-bold text-white pointer-events-none">
                                    FOCUSED VIEW
                                </div>
                            </div>

                            {/* Filmstrip (Other participants) */}
                            <div className="h-40 flex gap-4 overflow-x-auto p-2 min-h-[160px]">
                                {/* 自分の画面共有 */}
                                {Array.from(webrtc.localStreams).map(([streamId, stream]) => (
                                    <div key={streamId} className="w-64 flex-shrink-0 relative aspect-video glass-card border border-white/5">
                                        <ScreenSharePreview stream={stream} />
                                        <button
                                            onClick={() => webrtc.stopScreenShare(streamId)}
                                            className="absolute top-2 right-2 p-1.5 rounded-full bg-red-500/80 hover:bg-red-500 text-white border border-white/20 transition-colors z-10"
                                            title="Stop sharing this screen"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}

                                {/* リモートのビデオストリーム（フォーカス中のもの以外） */}
                                {remoteVideoItems
                                    .filter(item => item.key !== focusedStreamKey && item.videoStream)
                                    .map(item => (
                                        <div key={item.key} className="w-64 flex-shrink-0">
                                            <GridItem
                                                clientId={item.peerId}
                                                label={item.label}
                                                isLocal={false}
                                                isSpeaking={item.isSpeaking}
                                                videoStream={item.videoStream}
                                                onClick={() => { setFocusedPeerId(item.peerId); setFocusedStreamKey(item.key); }}
                                            />
                                        </div>
                                    ))
                                }

                                {/* ビデオを持たない参加者（フォーカス中以外） */}
                                {participants
                                    .filter((p: any) => !p.isLocal && p.id !== focusedPeerId && !remoteVideoItems.some(item => item.peerId === p.id && item.videoStream))
                                    .map((p: any) => (
                                        <div key={`avatar-${p.id}`} className="w-64 flex-shrink-0">
                                            <GridItem
                                                clientId={p.id}
                                                label={p.name}
                                                isLocal={false}
                                                isSpeaking={webrtc.remoteSpeakingStates.get(p.id)}
                                                videoStream={undefined}
                                                onClick={() => setFocusedPeerId(p.id)}
                                            />
                                        </div>
                                    ))
                                }

                                {/* 自分（画面共有していない場合） */}
                                {!webrtc.isScreenSharing && (
                                    <div className="w-64 flex-shrink-0">
                                        <GridItem
                                            clientId={webrtc.myId || 'me'}
                                            label="Me"
                                            isLocal={true}
                                            isSpeaking={webrtc.isSpeaking}
                                            videoStream={undefined}
                                            onClick={() => { }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : layoutMode === 'sideBySide' ? (
                        /* 横並びレイアウト - 全ストリームを均等に横並び */
                        <div className="flex h-full gap-4 overflow-x-auto">
                            {/* ローカル画面共有 */}
                            {Array.from(webrtc.localStreams).map(([streamId, stream]) => (
                                <div key={streamId} className="flex-1 min-w-[400px] relative group">
                                    <div className="h-full bg-black/40 rounded-xl overflow-hidden border border-white/10">
                                        <ScreenSharePreview stream={stream} />
                                    </div>
                                    <button
                                        onClick={() => webrtc.stopScreenShare(streamId)}
                                        className="absolute top-2 right-2 p-1.5 rounded-full bg-red-500/80 hover:bg-red-500 text-white border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                    <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white">
                                        自分の共有
                                    </div>
                                </div>
                            ))}

                            {/* リモートビデオストリーム - クリックで拡大 */}
                            {remoteVideoItems.filter(item => item.videoStream).map((item) => (
                                <div
                                    key={item.key}
                                    className="flex-1 min-w-[400px] cursor-pointer hover:ring-2 hover:ring-cyan-500/50 rounded-xl transition-all"
                                    onClick={() => { setLayoutMode('auto'); setFocusedPeerId(item.peerId); setFocusedStreamKey(item.key); }}
                                >
                                    <div className="h-full bg-black/40 rounded-xl overflow-hidden border border-white/10 relative">
                                        <GridItem
                                            clientId={item.peerId}
                                            label={item.label}
                                            isLocal={false}
                                            isSpeaking={item.isSpeaking}
                                            videoStream={item.videoStream}
                                        />
                                        <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-gray-400">
                                            クリックで拡大
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* ストリームがない場合のプレースホルダ */}
                            {webrtc.localStreams.size === 0 && remoteVideoItems.filter(item => item.videoStream).length === 0 && (
                                <div className="flex-1 flex items-center justify-center text-gray-500">
                                    画面共有がありません
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                            {/* 自分の画面共有プレビュー（全ストリームを表示） */}
                            {Array.from(webrtc.localStreams).map(([streamId, stream]) => (
                                <div key={streamId} className="relative group">
                                    <ScreenSharePreview stream={stream} />
                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => webrtc.stopScreenShare(streamId)}
                                            className="p-1.5 rounded-full bg-red-500/80 hover:bg-red-500 text-white border border-white/20"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}

                            {/* Remote Video Streams - Optimized mapping */}
                            {remoteVideoItems.map((item) => (
                                <GridItem
                                    key={item.key}
                                    clientId={item.peerId}
                                    label={item.label}
                                    isLocal={false}
                                    isSpeaking={item.isSpeaking}
                                    videoStream={item.videoStream}
                                    onClick={() => { setFocusedPeerId(item.peerId); setFocusedStreamKey(item.key); }}
                                />
                            ))}

                            {/* 自分のアバター（ビデオ共有していない場合） */}
                            {!webrtc.isScreenSharing && (
                                <GridItem
                                    clientId={webrtc.myId || 'me'}
                                    label="Me"
                                    isLocal={true}
                                    isSpeaking={webrtc.isSpeaking}
                                    videoStream={undefined}
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Chat Panel (Right) - Reusing ChannelChat */}
                <div className="w-96 border-l border-white/10 bg-black/40 flex flex-col">
                    <ChannelChat
                        status={webrtc.isConnected ? "Connected" : "Disconnected"}
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
                        handleSendMessage={handleSendMessage}
                        onMessageDelete={onMessageDelete}
                        scrollToBottom={onScrollToBottom}
                        handleMessagesScroll={onMessagesScroll}

                        messagesContainerRef={messagesContainerRef as any}
                        messagesEndRef={messagesEndRef as any}
                    />
                </div>
            </div>

            {/* Controls */}
            <div className="h-24 bg-black/40 backdrop-blur-md border-t border-white/10 px-8 flex items-center justify-center gap-6 z-20 relative">

                {/* Quality Settings Panel (Absolute positioned above) */}
                <div className="absolute bottom-28 left-8 z-30 w-80">
                    <QualitySettings
                        config={qualityConfig}
                        onChange={handleQualityChange}
                        disabled={webrtc.isScreenSharing}
                    />
                </div>
                {/* Mute Toggle */}
                <button
                    onClick={handleToggleMute}
                    className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${webrtc.isMuted
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                        : 'bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                        }`}
                    title={webrtc.isMuted ? "Unmute" : "Mute"}
                >
                    {webrtc.isMuted ? (
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

                {/* Screen Share Button with Dropdown */}
                <div className="relative">
                    <button
                        onClick={handleShareButtonClick}
                        className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${webrtc.isScreenSharing
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                            : 'bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                            }`}
                        title={webrtc.isScreenSharing ? "Share Options" : "Share Screen"}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                    </button>

                    {/* Dropdown Menu */}
                    {showShareMenu && (
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 glass-panel rounded-xl border border-white/10 shadow-2xl overflow-hidden z-50">
                            <button
                                onClick={handleAddAnotherShare}
                                className="w-full px-4 py-3 text-left text-white hover:bg-white/10 flex items-center gap-3 transition-colors"
                            >
                                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                別の画面を追加
                            </button>
                            <div className="border-t border-white/10"></div>
                            <button
                                onClick={handleStopAllShares}
                                className="w-full px-4 py-3 text-left text-red-400 hover:bg-red-500/10 flex items-center gap-3 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                すべての共有を停止
                            </button>
                        </div>
                    )}
                </div>

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
