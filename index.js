const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const allowedOrigins = ["https://nerdshive.online", "http://localhost:3000"];

const app = express();

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true,
}));

app.options('*', cors()); // For preflight

app.get('/', (req, res) => {
  res.send('Socket server is running');
});

const server = http.createServer(app);

const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
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
    removeFromAllQueues(socket.id);
    leaveAllRooms(socket);
  });

  socket.on('disconnect', () => {
    removeFromAllQueues(socket.id);
    leaveAllRooms(socket);
  });

  function removeFromAllQueues(id) {
    for (const key in intentQueues) {
      intentQueues[key] = intentQueues[key].filter((userId) => userId !== id);
    }
  }

  function leaveAllRooms(sock) {
    const rooms = Array.from(sock.rooms);
    rooms.forEach((roomId) => {
      if (roomId !== sock.id) {
        io.to(roomId).emit('left');
        sock.leave(roomId);
      }
    });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
