const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const searchProviders = [
    { type: 'piped', base: 'https://pipedapi.kavin.rocks' },
    { type: 'piped', base: 'https://api.piped.projectsegfau.lt' },
    { type: 'invidious', base: 'https://inv.nadeko.net' },
    { type: 'invidious', base: 'https://invidious.fdn.fr' }
];

const extractYtId = (raw = '') => {
    const match = String(raw).match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    if (match && match[2] && match[2].length === 11) return match[2];
    return null;
};

const normalizeSearchItem = (item) => {
    const ytId = extractYtId(item?.url || '') || item?.id || item?.videoId || item?.videoIdOrNull;
    if (!ytId || ytId.length !== 11) return null;

    return {
        ytId,
        title: item?.title || item?.name || 'YouTube video',
        uploader: item?.uploaderName || item?.author || item?.uploader || 'YouTube',
        thumb: item?.thumbnail || item?.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`,
        duration: Number.isFinite(item?.duration) ? item.duration : (Number.isFinite(item?.lengthSeconds) ? item.lengthSeconds : -1)
    };
};

const fetchSearchResults = async (query) => {
    for (const provider of searchProviders) {
        try {
            const url = provider.type === 'piped'
                ? `${provider.base}/search?q=${encodeURIComponent(query)}&filter=videos`
                : `${provider.base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
            const res = await fetch(url, { headers: { 'accept': 'application/json' } });
            if (!res.ok) continue;
            const data = await res.json();
            const items = provider.type === 'piped' ? (data?.items || []) : (Array.isArray(data) ? data : []);
            const normalized = items.map(normalizeSearchItem).filter(Boolean);
            if (normalized.length > 0) return normalized;
        } catch (_error) {
            continue;
        }
    }
    return [];
};

app.get('/api/search-youtube', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
        res.json({ items: [] });
        return;
    }

    const items = await fetchSearchResults(q);
    res.json({ items: items.slice(0, 8) });
});

// Store active rooms and their host playback snapshots
const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', ({ roomId, userName, role }) => {
        socket.join(roomId);
        socket.userName = userName;
        socket.roomId = roomId;
        socket.role = role;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                hostId: null,
                state: {
                    load: null,
                    playback: null
                }
            };
        }
        if (role === 'host') {
            rooms[roomId].hostId = socket.id;
        }

        if (role === 'viewer' && rooms[roomId].state) {
            const { load, playback } = rooms[roomId].state;
            if (load) {
                socket.emit('sync-event', load);
            }
            if (playback) {
                socket.emit('sync-event', playback);
            }
        }

        // Announce to the room that someone joined
        socket.to(roomId).emit('system-message', `${userName} joined the room as a ${role}.`);
    });

    socket.on('chat-message', (msg) => {
        if (socket.roomId) {
            // Broadcast to everyone else in the room
            socket.to(socket.roomId).emit('chat-message', {
                userName: socket.userName,
                msg: msg
            });
        }
    });

    socket.on('sync-event', (data) => {
        if (socket.roomId && socket.role === 'host') {
            const room = rooms[socket.roomId];
            if (room && room.state) {
                if (data.action === 'load') {
                    room.state.load = data;
                    room.state.playback = null;
                } else if (['play', 'pause', 'seek'].includes(data.action)) {
                    room.state.playback = data;
                }
            }
            // The host is sending a playback command; broadcast to viewers
            socket.to(socket.roomId).emit('sync-event', data);
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            const room = rooms[socket.roomId];
            if (room && room.hostId === socket.id) {
                room.hostId = null;
            }
            socket.to(socket.roomId).emit('system-message', `${socket.userName} disconnected.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
