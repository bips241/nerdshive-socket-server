const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const allowedOrigins = [
    "https://nerdshive.online",
    "https://nerdshive.vercel.app",
    "http://localhost:3000"
  ];
  
  const io = new Server(server, {
    path: '/socket.io',
    cors: {
      origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: ["GET", "POST"],
      credentials: true
    }
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
