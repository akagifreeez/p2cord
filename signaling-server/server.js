import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

// Room Management: room_id -> Set<ws>
const rooms = new Map();

console.log('Signaling Server (Room-Enabled) running on ws://localhost:8080');

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
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    ws.room_id = null;
    ws.client_id = null;

    ws.on('message', (message) => {
        const msgStr = message.toString();

        try {
            const data = JSON.parse(msgStr);

            if (data.type === 'Join') {
                // Leave previous room if any
                if (ws.room_id && ws.room_id !== data.room_id) {
                    // Send Leave to old room
                    const leaveMsg = JSON.stringify({ type: 'Leave', room_id: ws.room_id, client_id: ws.client_id });
                    broadcastToRoom(ws.room_id, leaveMsg);
                    leaveRoom(ws);
                }

                // Join new room
                ws.room_id = data.room_id;
                ws.client_id = data.client_id;
                joinRoom(ws, data.room_id);

                // Broadcast Join to room members (excluding self)
                broadcastToRoom(data.room_id, msgStr, ws);

            } else if (data.room_id) {
                // Any message with room_id gets broadcast only to that room
                broadcastToRoom(data.room_id, msgStr, ws);
            } else {
                // Fallback: broadcast to current room
                if (ws.room_id) {
                    broadcastToRoom(ws.room_id, msgStr, ws);
                }
            }

        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${ws.client_id}`);

        if (ws.room_id && ws.client_id) {
            // Automatically broadcast Leave to the room
            const leaveMsg = JSON.stringify({ type: 'Leave', room_id: ws.room_id, client_id: ws.client_id });
            broadcastToRoom(ws.room_id, leaveMsg);
            leaveRoom(ws);
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

