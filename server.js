const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms and their host's playback state
const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', ({ roomId, userName, role }) => {
        socket.join(roomId);
        socket.userName = userName;
        socket.roomId = roomId;
        socket.role = role;

        if (!rooms[roomId]) {
            rooms[roomId] = { hostId: null, state: null };
        }
        if (role === 'host') {
            rooms[roomId].hostId = socket.id;
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
            // The host is sending a playback command; broadcast to viewers
            socket.to(socket.roomId).emit('sync-event', data);
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('system-message', `${socket.userName} disconnected.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});