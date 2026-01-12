import { create } from 'zustand';

interface SessionState {
    currentGuildId: string | null;
    currentChannelId: string | null;
    connectedVoiceChannelId: string | null;

    // P2P / Media State
    isConnected: boolean;
    isScreenSharing: boolean;
    isMicEnabled: boolean;
    isMuted: boolean;
    localSpeaking: boolean;

    // Actions
    setCurrentGuild: (guildId: string | null) => void;
    setCurrentChannel: (channelId: string | null) => void;
    setConnectedVoiceChannel: (channelId: string | null) => void;
    setConnectionStatus: (isConnected: boolean) => void;
    setMediaStatus: (status: Partial<{ isScreenSharing: boolean, isMicEnabled: boolean, isMuted: boolean }>) => void;
    setLocalSpeaking: (isSpeaking: boolean) => void;

    // Remote VAD
    remoteSpeakers: Record<string, boolean>;
    setRemoteSpeaker: (clientId: string, isSpeaking: boolean) => void;

    // Peers
    connectedPeers: string[];
    addPeer: (clientId: string) => void;
    removePeer: (clientId: string) => void;
    clearPeers: () => void;

    // Voice Transition (debounce)
    isVoiceTransitioning: boolean;
    setVoiceTransitioning: (isTransitioning: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
    currentGuildId: null,
    currentChannelId: null,
    connectedVoiceChannelId: null,

    isConnected: false,
    isScreenSharing: false,
    isMicEnabled: false,
    isMuted: false,
    localSpeaking: false,

    setCurrentGuild: (guildId) => set({ currentGuildId: guildId }),
    setCurrentChannel: (channelId) => set({ currentChannelId: channelId }),
    setConnectedVoiceChannel: (channelId) => set({ connectedVoiceChannelId: channelId }),
    setConnectionStatus: (isConnected) => set({ isConnected }),
    setMediaStatus: (status) => set((state) => ({ ...state, ...status })),
    setLocalSpeaking: (isSpeaking) => set({ localSpeaking: isSpeaking }),

    remoteSpeakers: {},
    setRemoteSpeaker: (clientId, isSpeaking) => set((state) => ({
        remoteSpeakers: {
            ...state.remoteSpeakers,
            [clientId]: isSpeaking
        }
    })),

    connectedPeers: [],
    addPeer: (clientId) => set((state) => {
        if (state.connectedPeers.includes(clientId)) return state;
        return { connectedPeers: [...state.connectedPeers, clientId] };
    }),
    removePeer: (clientId) => set((state) => ({
        connectedPeers: state.connectedPeers.filter(id => id !== clientId)
    })),
    clearPeers: () => set({ connectedPeers: [] }),

    isVoiceTransitioning: false,
    setVoiceTransitioning: (isTransitioning) => set({ isVoiceTransitioning: isTransitioning }),
}));
