const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const instanceId = process.env.INSTANCE_ID || `pid-${process.pid}`;

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : ["https://nerdshive.online", "http://localhost:3000", "https://nerdshive.vercel.app" ]
);

const app = express();
app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 200,
}));
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
  
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

if (process.env.REDIS_URL) {
  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const Redis = require('ioredis');
    const shouldUseTls =
      process.env.REDIS_TLS === 'true' ||
      process.env.REDIS_URL.startsWith('rediss://') ||
      process.env.REDIS_URL.includes('upstash.io');

    const redisOptions = {
      maxRetriesPerRequest: null,
      ...(shouldUseTls ? { tls: {} } : {}),
    };

    const pubClient = new Redis(process.env.REDIS_URL, redisOptions);
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    console.log(`[BOOT:${instanceId}] Redis adapter enabled (tls=${shouldUseTls})`);
  } catch (error) {
    console.error(`[BOOT:${instanceId}] Failed to enable Redis adapter`, error);
  }
}

const intentQueues = {
  hiring: [],
  looking_for_job: [],
  project_teammate: [],
};

const activeMatches = new Map();

function roomFor(a, b) {
  return [a, b].sort().join(':');
}

function removeFromQueues(socketId) {
  Object.keys(intentQueues).forEach((intent) => {
    intentQueues[intent] = intentQueues[intent].filter((entry) => entry.socketId !== socketId);
  });
}

function leaveMatch(socket) {
  const partnerSocketId = activeMatches.get(socket.id);
  if (!partnerSocketId) return;

  activeMatches.delete(socket.id);
  activeMatches.delete(partnerSocketId);

  const roomId = roomFor(socket.id, partnerSocketId);
  socket.leave(roomId);
  io.to(partnerSocketId).emit('left');
}

function popValidPartner(intent, currentSocketId) {
  const queue = intentQueues[intent];
  if (!queue) return null;

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate) break;
    if (candidate.socketId === currentSocketId) continue;
    if (!candidate.peerId) continue;
    return candidate;
  }

  return null;
}

io.on('connection', (socket) => {
  console.log(`[CONNECT:${instanceId}]`, socket.id);

  socket.on('join_queue', ({ intent, peerId }) => {
    const queue = intentQueues[intent];
    if (!queue || !peerId) {
      socket.emit('queue_error', { message: 'Invalid queue payload' });
      return;
    }

    removeFromQueues(socket.id);
    leaveMatch(socket);

    const partner = popValidPartner(intent, socket.id);
    if (partner) {
      console.log(`[MATCH:${instanceId}] intent=${intent} ${socket.id} <-> ${partner.socketId}`);

      const roomId = roomFor(socket.id, partner.socketId);
      socket.join(roomId);
      io.in(partner.socketId).socketsJoin(roomId);

      activeMatches.set(socket.id, partner.socketId);
      activeMatches.set(partner.socketId, socket.id);

      socket.emit('match_found', { peerId: partner.peerId, roomId, isInitiator: true });
      io.to(partner.socketId).emit('match_found', { peerId, roomId, isInitiator: false });
    } else {
      queue.push({ socketId: socket.id, peerId });
      console.log(`[QUEUE:${instanceId}] intent=${intent} socket=${socket.id} size=${queue.length}`);
      socket.emit('queued', { intent });
    }
  });

  socket.on('skip', () => {
    console.log(`[SKIP:${instanceId}] socket=${socket.id}`);
    removeFromQueues(socket.id);
    leaveMatch(socket);
  });

  socket.on('disconnect', () => {
    console.log(`[DISCONNECT:${instanceId}] socket=${socket.id}`);
    removeFromQueues(socket.id);
    leaveMatch(socket);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
