import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const wss = new WebSocketServer({ port: 8080 });

// Room Management: room_id -> Set<ws>
const rooms = new Map();

console.log('Signaling Server (Room-Enabled + Browser WebRTC) running on ws://localhost:8080');

function joinRoom(ws, roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(ws);
    console.log(`[Room ${roomId}] Client ${ws.client_id} joined. Members: ${rooms.get(roomId).size}`);
}

function leaveRoom(ws) {
    if (ws.room_id && rooms.has(ws.room_id)) {
        rooms.get(ws.room_id).delete(ws);
        console.log(`[Room ${ws.room_id}] Client ${ws.client_id} left. Members: ${rooms.get(ws.room_id).size}`);

        // Clean up empty rooms
        if (rooms.get(ws.room_id).size === 0) {
            rooms.delete(ws.room_id);
            console.log(`[Room ${ws.room_id}] Empty, deleted.`);
        }
    }
}

function broadcastToRoom(roomId, message, excludeWs = null) {
    if (!rooms.has(roomId)) return;

    rooms.get(roomId).forEach((client) => {
        if (client !== excludeWs && client.readyState === 1) { // 1 = OPEN
            client.send(typeof message === 'string' ? message : JSON.stringify(message));
        }
    });
}

// Get list of participants in a room
function getParticipants(roomId, excludeId = null) {
    if (!rooms.has(roomId)) return [];

    const participants = [];
    rooms.get(roomId).forEach((client) => {
        if (client.client_id && client.client_id !== excludeId) {
            participants.push({
                id: client.client_id,
                name: client.client_name || undefined,
                joinedAt: client.joined_at || Date.now()
            });
        }
    });
    return participants;
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    ws.room_id = null;
    ws.client_id = null;
    ws.client_name = null;
    ws.joined_at = null;

    ws.on('message', (message) => {
        const msgStr = message.toString();

        try {
            const data = JSON.parse(msgStr);

            // === RUST CLIENT FORMAT (type: 'Join') ===
            if (data.type === 'Join') {
                // Leave previous room if any
                if (ws.room_id && ws.room_id !== data.room_id) {
                    const leaveMsg = JSON.stringify({ type: 'Leave', room_id: ws.room_id, client_id: ws.client_id });
                    broadcastToRoom(ws.room_id, leaveMsg);
                    leaveRoom(ws);
                }

                // Join new room
                ws.room_id = data.room_id;
                ws.client_id = data.client_id;
                ws.joined_at = Date.now();
                joinRoom(ws, data.room_id);

                // Broadcast Join to room members (excluding self)
                broadcastToRoom(data.room_id, msgStr, ws);
            }

            // === BROWSER CLIENT FORMAT (type: 'room:join') ===
            else if (data.type === 'room:join') {
                const payload = data.payload || {};
                const roomCode = payload.roomCode || data.roomId;
                const clientName = payload.name || 'Anonymous';

                // Generate unique client ID
                const clientId = randomUUID();

                // Leave previous room if any
                if (ws.room_id && ws.room_id !== roomCode) {
                    broadcastToRoom(ws.room_id, {
                        type: 'peer:left',
                        payload: { peerId: ws.client_id }
                    });
                    leaveRoom(ws);
                }

                // Join new room
                ws.room_id = roomCode;
                ws.client_id = clientId;
                ws.client_name = clientName;
                ws.joined_at = Date.now();
                joinRoom(ws, roomCode);

                // Get existing participants
                const participants = getParticipants(roomCode, clientId);

                // Send room:joined response to the client
                ws.send(JSON.stringify({
                    type: 'room:joined',
                    timestamp: Date.now(),
                    payload: {
                        roomId: roomCode,
                        roomCode: roomCode,
                        myId: clientId,
                        participants: participants
                    }
                }));

                // Broadcast peer:joined to other room members
                broadcastToRoom(roomCode, {
                    type: 'peer:joined',
                    timestamp: Date.now(),
                    payload: { peerId: clientId, name: clientName }
                }, ws);
            }

            // === BROWSER: room:create ===
            else if (data.type === 'room:create') {
                const roomId = randomUUID().slice(0, 8);
                const clientId = randomUUID();
                const clientName = data.payload?.name || 'Host';

                ws.room_id = roomId;
                ws.client_id = clientId;
                ws.client_name = clientName;
                ws.joined_at = Date.now();
                joinRoom(ws, roomId);

                ws.send(JSON.stringify({
                    type: 'room:created',
                    timestamp: Date.now(),
                    payload: { roomCode: roomId, roomId: roomId }
                }));

                ws.send(JSON.stringify({
                    type: 'room:joined',
                    timestamp: Date.now(),
                    payload: {
                        roomId: roomId,
                        roomCode: roomId,
                        myId: clientId,
                        participants: []
                    }
                }));
            }

            // === BROWSER: room:leave ===
            else if (data.type === 'room:leave') {
                if (ws.room_id && ws.client_id) {
                    broadcastToRoom(ws.room_id, {
                        type: 'peer:left',
                        timestamp: Date.now(),
                        payload: { peerId: ws.client_id }
                    }, ws);
                    leaveRoom(ws);
                    ws.room_id = null;
                    ws.client_id = null;
                }
            }

            // === BROWSER: peer:offer ===
            else if (data.type === 'peer:offer') {
                const targetId = data.targetId;
                if (!targetId || !ws.room_id) return;

                // Find target client
                if (rooms.has(ws.room_id)) {
                    rooms.get(ws.room_id).forEach((client) => {
                        if (client.client_id === targetId && client.readyState === 1) {
                            client.send(JSON.stringify({
                                type: 'peer:offer',
                                senderId: ws.client_id,
                                timestamp: Date.now(),
                                payload: data.payload
                            }));
                        }
                    });
                }
            }

            // === BROWSER: peer:answer ===
            else if (data.type === 'peer:answer') {
                const targetId = data.targetId;
                if (!targetId || !ws.room_id) return;

                if (rooms.has(ws.room_id)) {
                    rooms.get(ws.room_id).forEach((client) => {
                        if (client.client_id === targetId && client.readyState === 1) {
                            client.send(JSON.stringify({
                                type: 'peer:answer',
                                senderId: ws.client_id,
                                timestamp: Date.now(),
                                payload: data.payload
                            }));
                        }
                    });
                }
            }

            // === BROWSER: peer:ice ===
            else if (data.type === 'peer:ice') {
                const targetId = data.targetId;
                if (!targetId || !ws.room_id) return;

                if (rooms.has(ws.room_id)) {
                    rooms.get(ws.room_id).forEach((client) => {
                        if (client.client_id === targetId && client.readyState === 1) {
                            client.send(JSON.stringify({
                                type: 'peer:ice',
                                senderId: ws.client_id,
                                timestamp: Date.now(),
                                payload: data.payload
                            }));
                        }
                    });
                }
            }

            // === RUST/FALLBACK: Broadcast to room ===
            else if (data.room_id) {
                broadcastToRoom(data.room_id, msgStr, ws);
            } else if (ws.room_id) {
                broadcastToRoom(ws.room_id, msgStr, ws);
            }

        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${ws.client_id}`);

        if (ws.room_id && ws.client_id) {
            // Send peer:left for browser clients
            broadcastToRoom(ws.room_id, {
                type: 'peer:left',
                timestamp: Date.now(),
                payload: { peerId: ws.client_id }
            });
            // Also send Leave for Rust clients
            broadcastToRoom(ws.room_id, JSON.stringify({
                type: 'Leave',
                room_id: ws.room_id,
                client_id: ws.client_id
            }));
            leaveRoom(ws);
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});
