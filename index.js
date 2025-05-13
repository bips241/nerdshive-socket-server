const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');

const allowedOrigins = ["https://nerdshive.online", "http://localhost:3000"];

const app = express();
const server = http.createServer(app);

// CORS config
app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 200,
}));

// Manual CORS headers for Express
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// Health check
app.get('/', (req, res) => {
    res.send('Socket server with PeerJS is running');
});

// -------------------- PeerJS Server --------------------
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/peerjs',
});
app.use('/peerjs', peerServer);

// -------------------- Socket.IO Server --------------------
const io = new Server(server, {
    path: '/socket.io',
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
    },
});

const intentQueues = {
    hiring: [],
    looking_for_job: [],
    project_teammate: [],
};

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join_queue', ({ intent }) => {
        const queue = intentQueues[intent];
        if (!queue) return;

        const partnerId = queue.shift();
        if (partnerId) {
            socket.join(partnerId);
            socket.emit('match_found', { peerId: partnerId });
            io.to(partnerId).emit('match_found', { peerId: socket.id });
        } else {
            queue.push(socket.id);
        }
    });

    socket.on('skip', () => {
        for (const key in intentQueues) {
            intentQueues[key] = intentQueues[key].filter((id) => id !== socket.id);
        }

        const rooms = Array.from(socket.rooms);
        rooms.forEach((roomId) => {
            if (roomId !== socket.id) {
                io.to(roomId).emit('left');
                socket.leave(roomId);
            }
        });
    });

    socket.on('disconnect', () => {
        for (const key in intentQueues) {
            intentQueues[key] = intentQueues[key].filter((id) => id !== socket.id);
        }

        for (const roomId of Array.from(socket.rooms)) {
            if (roomId !== socket.id) {
                socket.to(roomId).emit('left');
                socket.leave(roomId);
            }
        }
    });
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
