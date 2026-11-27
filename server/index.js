const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { clerkMiddleware, getAuth, verifyToken } = require('@clerk/express');
const questionsStore = require('./questions-store');
const aiGenerator = require('./ai-quiz-generator');

aiGenerator.initEnv();

const rawOrigins = String(process.env.CLIENT_ORIGIN || '').trim();
const allowedOrigins = rawOrigins
  ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
  : null;
const corsOriginOption = allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : '*';

function isClerkEnabled() {
  return Boolean(
    process.env.CLERK_SECRET_KEY &&
    process.env.CLERK_SECRET_KEY.trim() &&
    process.env.CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_PUBLISHABLE_KEY.trim()
  );
}

function getRequestUserId(req) {
  if (!isClerkEnabled()) return null;
  try {
    const auth = getAuth(req);
    return auth?.userId || null;
  } catch (e) {
    return null;
  }
}

async function verifySocketUser(token) {
  if (!isClerkEnabled() || !token || typeof token !== 'string') return null;
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY.trim()
    });
    return payload?.sub || null;
  } catch (e) {
    return null;
  }
}

const userAiHistory = new Map();
const USER_AI_WINDOW_MS = 60 * 60 * 1000;
const USER_AI_MAX_PER_HOUR = 25;

function consumeUserAiQuota(userId) {
  if (!userId) return { allowed: true };
  const now = Date.now();
  const recent = (userAiHistory.get(userId) || []).filter((ts) => now - ts < USER_AI_WINDOW_MS);
  if (recent.length >= USER_AI_MAX_PER_HOUR) {
    userAiHistory.set(userId, recent);
    const waitMin = Math.max(1, Math.ceil((USER_AI_WINDOW_MS - (now - recent[0])) / 60000));
    return { allowed: false, waitMin };
  }
  recent.push(now);
  userAiHistory.set(userId, recent);
  return { allowed: true };
}

function refundUserAiQuota(userId) {
  if (!userId) return;
  const recent = userAiHistory.get(userId);
  if (Array.isArray(recent) && recent.length > 0) {
    recent.pop();
  }
}

const app = express();

function getLanIp() {
  const nets = os.networkInterfaces();
  let candidate = null;

  for (const name of Object.keys(nets)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes('*') ||
      lowerName.includes('loopback') ||
      lowerName.includes('vethernet') ||
      lowerName.includes('virtualbox') ||
      lowerName.includes('vmware') ||
      lowerName.includes('wsl')
    ) {
      continue;
    }

    for (const net of nets[name]) {
      const isIPv4 = net.family === 'IPv4' || net.family === 4;
      if (isIPv4 && !net.internal) {
        if (
          lowerName.includes('wi-fi') ||
          lowerName.includes('wifi') ||
          lowerName.includes('wlan') ||
          lowerName.includes('wireless') ||
          lowerName.includes('ethernet')
        ) {
          return net.address;
        }
        if (!candidate) candidate = net.address;
      }
    }
  }
  return candidate || 'localhost';
}



async function purgeOrphanImages(roomsMap) {
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const referencedFiles = await questionsStore.listReferencedImages();

    // Check all active game rooms
    if (roomsMap instanceof Map) {
      roomsMap.forEach((room) => {
        (room.questions || []).forEach((q) => {
          const img = q.imageUrl || q.image;
          if (typeof img === 'string' && img.startsWith('/uploads/')) {
            referencedFiles.add(path.basename(img));
          }
        });
      });
    }

    let deletedCount = 0;
    let bytesFreed = 0;
    const now = Date.now();
    const GRACE_PERIOD_MS = 15 * 60 * 1000; // 15m grace period for in-progress uploads

    const allFiles = fs.readdirSync(uploadsDir);
    allFiles.forEach((file) => {
      if (!referencedFiles.has(file)) {
        const filePath = path.join(uploadsDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > GRACE_PERIOD_MS) {
            bytesFreed += stat.size;
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (e) {}
      }
    });

    const dbDeletedCount = await questionsStore.purgeDbOrphanImages(referencedFiles, GRACE_PERIOD_MS);
    deletedCount += dbDeletedCount;

    return {
      deletedCount,
      bytesFreed,
      mbFreed: (bytesFreed / (1024 * 1024)).toFixed(2)
    };
  } catch (err) {
    console.error('Error during purgeOrphanImages:', err);
    return { deletedCount: 0, bytesFreed: 0, mbFreed: '0.00' };
  }
}

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, WEBP, and GIF images are allowed.'));
    }
  }
});

app.use(cors({ origin: corsOriginOption }));
app.use(express.json());
if (isClerkEnabled()) {
  app.use(
    clerkMiddleware({
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY.trim(),
      secretKey: process.env.CLERK_SECRET_KEY.trim()
    })
  );
}

app.use('/uploads', express.static(uploadsDir));
app.get('/uploads/:filename', async (req, res) => {
  try {
    const safeName = path.basename(req.params.filename || '');
    if (!safeName) return res.status(404).end();
    const imgRow = await questionsStore.getUploadedImage(safeName);
    if (!imgRow || !imgRow.data) return res.status(404).end();
    res.setHeader('Content-Type', imgRow.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.promises.writeFile(path.join(uploadsDir, safeName), imgRow.data).catch(() => {});
    return res.send(imgRow.data);
  } catch (e) {
    return res.status(404).end();
  }
});

app.post('/api/upload-image', (req, res) => {
  if (isClerkEnabled() && !getRequestUserId(req)) {
    return res.status(401).json({ error: 'Please sign in to upload question images.' });
  }
  upload.single('image')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    try {
      if (questionsStore.isUsingDb()) {
        const buffer = await fs.promises.readFile(req.file.path);
        await questionsStore.saveUploadedImage(req.file.filename, req.file.mimetype, buffer);
      }
    } catch (dbErr) {
      console.error('[Upload Image] Failed to persist image to DB:', dbErr.message);
    }
    res.json({ imageUrl: `/uploads/${req.file.filename}` });
  });
});


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOriginOption, methods: ['GET', 'POST'] }
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake?.auth?.token;
    socket.data.userId = await verifySocketUser(token);
  } catch (e) {
    socket.data.userId = null;
  }
  next();
});

const rooms = new Map();

const POWERS = {
  blind: { id: 'blind', name: 'Blackout', icon: '🌑', desc: 'Blind every other player for 10 seconds.' },
  steal: { id: 'steal', name: 'Heist', icon: '🪝', desc: 'Steal 50% of one rival\'s round earnings if they answer correctly.' },
  hint: { id: 'hint', name: 'Oracle', icon: '🔮', desc: 'Eliminate two wrong answers this round.' },
  freeze: { id: 'freeze', name: 'Deep Freeze', icon: '❄️', desc: 'Freeze one rival out for 10 seconds.' },
  scramble: { id: 'scramble', name: 'Scramble', icon: '🌀', desc: 'Shuffle answer colors for everyone else.' }
};

const SHAPES = ['triangle', 'diamond', 'circle', 'square'];

const POWER_SELECT_DURATION_MS = 120000;
const FREEZE_DURATION_MS = 10000;
const POWER_COOLDOWN_MS = 120000;

function generatePin() {
  let pin;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(pin));
  return pin;
}

function clearRoomTimers(room) {
  if (!room) return;
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  if (room.phaseTimer) {
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
  }
}

function scoreFor(isCorrect, timeLeft, timeLimit, streak) {
  if (!isCorrect) return 0;
  const base = 600;
  const speed = Math.floor((Math.max(0, timeLeft) / (timeLimit * 1000)) * 400);
  const streakBonus = Math.min(streak, 5) * 50;
  return base + speed + streakBonus;
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    streak: p.streak,
    isHost: p.isHost,
    power: p.power,
    powerCooldownUntil: p.powerCooldownUntil || 0,
    powerUsed: !!p.powerUsed,
    frozen: p.frozen,
    connected: p.connected,
    powerChosen: !!p.power
  };
}

function defaultRoomSettings() {
  return {
    powerMode: 'choose',
    powerCooldownSec: 120,
    shuffleQuestions: false
  };
}

function roomSnapshot(room) {
  return {
    pin: room.pin,
    gameName: room.gameName || null,
    state: room.state,
    host: room.host ? { id: room.host.id, name: room.host.name, avatar: room.host.avatar } : null,
    players: room.players.map(publicPlayer),
    questions: room.questions,
    questionIndex: room.questionIndex,
    totalQuestions: room.questions.length,
    paused: !!room.paused,
    pausedAt: room.paused ? room.pausedAt : null,
    locked: !!room.locked,
    settings: room.settings || defaultRoomSettings(),
    powerSelectStartedAt: room.powerSelectStartedAt || null,
    powerSelectDurationMs: POWER_SELECT_DURATION_MS,
    isDoublePoints: !!room.isDoublePoints,
    lanIp: getLanIp(),
    chatMessages: (room.chatMessages || []).slice(-50)
  };
}

function sanitizeQuestion(q) {
  return {
    type: q.type,
    text: q.text,
    options: q.options,
    timeLimit: q.timeLimit,
    image: (typeof (q.imageUrl || q.image) === 'string' && ((q.imageUrl || q.image).startsWith('http://') || (q.imageUrl || q.image).startsWith('https://') || (q.imageUrl || q.image).startsWith('/uploads/'))) ? (q.imageUrl || q.image) : null,
        imageUrl: (typeof (q.imageUrl || q.image) === 'string' && ((q.imageUrl || q.image).startsWith('http://') || (q.imageUrl || q.image).startsWith('https://') || (q.imageUrl || q.image).startsWith('/uploads/'))) ? (q.imageUrl || q.image) : null,
    min: q.min,
    max: q.max,
    pairs: q.pairs ? q.pairs.map(p => ({ left: p.left, right: p.right })) : []
  };
}

io.on('connection', (socket) => {
  socket.data.pin = null;

  socket.on('syncAuth', async ({ authToken } = {}, cb) => {
    if (!isClerkEnabled()) {
      socket.data.userId = null;
      return cb && cb({ ok: true, userId: null });
    }
    const verified = await verifySocketUser(authToken);
    socket.data.userId = verified || null;
    if (cb) cb({ ok: true, userId: socket.data.userId });
  });

  socket.on('createRoom', async ({ gameName, authToken }, cb) => {
    let hostUserId = null;
    if (isClerkEnabled()) {
      hostUserId = (await verifySocketUser(authToken)) || socket.data.userId;
      if (!hostUserId) {
        if (cb) cb({ ok: false, authRequired: true, message: 'Please sign in to host a game.' });
        return;
      }
      socket.data.userId = hostUserId;
    }

    const pin = generatePin();
    const room = {
      pin,
      id: uuidv4(),
      hostId: socket.id,
      hostUserId,
      gameName: String(gameName || '').trim().slice(0, 40) || 'Finnival',
      players: [],
      questions: [],
      questionIndex: -1,
      state: 'lobby',
      locked: false,
      settings: defaultRoomSettings(),
      bannedNames: [],
      answers: new Map(),
      timer: null,
      phaseTimer: null
    };

    const hostSessionToken = uuidv4();
    room.hostSessionToken = hostSessionToken;
    room.kickedTokens = new Set();
    room.disconnectGraceTimers = new Map();
    room.chatMessages = [];
    room.lastChatAt = new Map();
    room.lastReactionAt = new Map();

    room.host = {
      id: socket.id,
      name: 'Host',
      avatar: '🎙️'
    };
    room.banned = new Set();

    rooms.set(pin, room);
    socket.data.pin = pin;
    socket.join(pin);

    if (cb) cb({ ok: true, pin, sessionToken: hostSessionToken, snapshot: roomSnapshot(room) });
    io.to(pin).emit('roomUpdate', roomSnapshot(room));
  });

  socket.on('joinRoom', ({ pin, playerName, avatar }, cb) => {
    const room = rooms.get(String(pin || '').trim());
    const fail = (message) => cb && cb({ ok: false, message });

    if (!room) return fail('No game found with that PIN.');
    if (room.locked) return fail('The host locked this lobby.');
    if (room.bannedNames && room.bannedNames.includes(String(playerName || '').trim().toLowerCase())) {
      return fail('You have been banned from this game.');
    }
    if (room.state !== 'lobby') return fail('That game has already started.');

    const name = String(playerName || '').trim().slice(0, 16) || 'Player';
    if (room.banned && room.banned.has(name.toLowerCase())) {
      return fail('You have been banned from this game.');
    }
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return fail('That nickname is already taken.');
    }

    const sessionToken = uuidv4();
    const player = {
      id: socket.id,
      sessionToken,
      name,
      avatar: avatar || '🐼',
      score: 0,
      streak: 0,
      isHost: false,
      power: null,
      powerCooldownUntil: 0,
      powerUsed: false,
      frozen: false,
      connected: true
    };

    room.players.push(player);
    socket.data.pin = room.pin;
    socket.join(room.pin);

    if (cb) cb({ ok: true, pin: room.pin, sessionToken, snapshot: roomSnapshot(room) });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).emit('toast', { text: `${player.avatar} ${player.name} joined`, tone: 'join' });
  });

  socket.on('rejoinRoom', async ({ pin, sessionToken, playerId, authToken }, cb) => {
    const room = rooms.get(String(pin || '').trim());
    if (!room) return cb && cb({ ok: false, message: 'Game no longer exists.' });

    if (sessionToken && room.kickedTokens && room.kickedTokens.has(sessionToken)) {
      return cb && cb({ ok: false, message: 'You have been kicked from this game.' });
    }

    const isHost = (sessionToken && room.hostSessionToken === sessionToken) || (playerId && room.hostId === playerId);
    let player = null;
    if (!isHost) {
      player = room.players.find((p) => (sessionToken && p.sessionToken === sessionToken) || (playerId && p.id === playerId));
    }

    if (!isHost && !player) {
      return cb && cb({ ok: false, message: 'You are no longer in this game.' });
    }

    if (isHost && isClerkEnabled() && room.hostUserId) {
      const verifiedUserId = (await verifySocketUser(authToken)) || socket.data.userId;
      if (verifiedUserId !== room.hostUserId) {
        return cb && cb({ ok: false, authRejected: true, message: 'Host signed out.' });
      }
      socket.data.userId = verifiedUserId;
    }

    const token = isHost ? room.hostSessionToken : player.sessionToken;
    if (token && room.disconnectGraceTimers && room.disconnectGraceTimers.has(token)) {
      clearTimeout(room.disconnectGraceTimers.get(token));
      room.disconnectGraceTimers.delete(token);
    }

    const graceMs = room.state === 'lobby' ? 120000 : 30000;

    if (isHost) {
      clearTimeout(room.hostGraceTimer);
      room.hostId = socket.id;
      if (room.host) room.host.id = socket.id;
      if (room.hostUserId) socket.data.userId = room.hostUserId;
    } else {
      const oldId = player.id;
      player.id = socket.id;
      player.connected = true;

      if (room.answers instanceof Map && room.answers.has(oldId)) {
        const answer = room.answers.get(oldId);
        room.answers.delete(oldId);
        room.answers.set(socket.id, answer);
      }
      room.players.forEach((p) => {
        if (p.heistTarget === oldId) p.heistTarget = socket.id;
      });
    }

    socket.data.pin = room.pin;
    socket.join(room.pin);

    const snapshot = roomSnapshot(room);
    let activeQuestion = null;
    let hasSubmitted = false;

    if (room.state === 'question' || room.state === 'reveal') {
      const q = room.questions[room.questionIndex];
      if (q) {
        activeQuestion = isHost ? q : sanitizeQuestion(q);
      }
      hasSubmitted = !isHost && room.answers ? room.answers.has(socket.id) : false;
    }

    const rejoinPayload = {
      ok: true,
      isHost,
      snapshot,
      sessionToken: token,
      activeQuestion,
      hasSubmitted,
      startedAt: room.startedAt,
      endsAt: room.endsAt,
      paused: !!room.paused,
      pausedAt: room.paused ? room.pausedAt : null,
      powerSelectEndsAt: room.powerSelectStartedAt ? room.powerSelectStartedAt + POWER_SELECT_DURATION_MS : null
    };

    if (cb) cb(rejoinPayload);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  });

  socket.on('kickPlayer', ({ playerId }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;

    const target = room.players.find((p) => p.id === playerId);
    if (!target || target.isHost) return;

    if (target.sessionToken) {
      if (!room.kickedTokens) room.kickedTokens = new Set();
      room.kickedTokens.add(target.sessionToken);
      if (room.disconnectGraceTimers && room.disconnectGraceTimers.has(target.sessionToken)) {
        clearTimeout(room.disconnectGraceTimers.get(target.sessionToken));
        room.disconnectGraceTimers.delete(target.sessionToken);
      }
    }

    room.players = room.players.filter((p) => p.id !== playerId);
    io.to(playerId).emit('kicked');
    io.sockets.sockets.get(playerId)?.leave(room.pin);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).emit('toast', { text: `${target.name} was removed`, tone: 'warn' });
  });

  socket.on('leaveRoom', () => {
    const room = rooms.get(socket.data.pin);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.isHost) return;

    if (player.sessionToken && room.disconnectGraceTimers && room.disconnectGraceTimers.has(player.sessionToken)) {
      clearTimeout(room.disconnectGraceTimers.get(player.sessionToken));
      room.disconnectGraceTimers.delete(player.sessionToken);
    }

    room.players = room.players.filter((p) => p.id !== socket.id);
    socket.leave(room.pin);
    socket.data.pin = null;
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).emit('toast', { text: `${player.name} left the lobby`, tone: 'warn' });
  });

  socket.on('abandonLobby', (payload = {}) => {
    let room = rooms.get(socket.data.pin);
    let authorized = room && room.hostId === socket.id;
    if (!authorized && payload?.pin && payload?.sessionToken) {
      const targetRoom = rooms.get(String(payload.pin).trim());
      if (targetRoom && targetRoom.hostSessionToken === payload.sessionToken) {
        room = targetRoom;
        authorized = true;
      }
    }
    if (!room || !authorized) return;

    clearRoomTimers(room);
    if (room.disconnectGraceTimers) {
      room.disconnectGraceTimers.forEach((t) => clearTimeout(t));
      room.disconnectGraceTimers.clear();
    }
    clearTimeout(room.hostGraceTimer);

    io.to(room.pin).emit('roomClosed', { message: 'Host closed the lobby.' });
    rooms.delete(room.pin);
  });

  socket.on('banPlayer', ({ playerId }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    const target = room.players.find((p) => p.id === playerId);
    if (!target || target.isHost) return;
    if (!room.bannedNames) room.bannedNames = [];
    room.bannedNames.push(target.name.toLowerCase());
    room.players = room.players.filter((p) => p.id !== playerId);
    io.to(playerId).emit('kicked');
    io.sockets.sockets.get(playerId)?.leave(room.pin);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).emit('toast', { text: `${target.name} was banned`, tone: 'warn' });
  });

  socket.on('setLocked', ({ locked }, cb) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return cb && cb({ ok: false });
    room.locked = !!locked;
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    if (cb) cb({ ok: true, locked: room.locked });
  });

  socket.on('updateSettings', (incoming, cb) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return cb && cb({ ok: false });
    if (room.state !== 'lobby') return cb && cb({ ok: false, message: 'Settings can only be changed in the lobby.' });

    const prev = room.settings || defaultRoomSettings();
    const powerMode = ['choose', 'random', 'off'].includes(incoming?.powerMode) ? incoming.powerMode : prev.powerMode;
    let powerCooldownSec = prev.powerCooldownSec;
    if (incoming?.powerCooldownSec !== undefined) {
      const val = Number(incoming.powerCooldownSec);
      if (val === -1) {
        powerCooldownSec = -1;
      } else if (Number.isFinite(val)) {
        powerCooldownSec = Math.max(5, Math.round(val));
      }
    }
    const shuffleQuestions = incoming?.shuffleQuestions !== undefined ? !!incoming.shuffleQuestions : prev.shuffleQuestions;

    room.settings = { powerMode, powerCooldownSec, shuffleQuestions };
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    if (cb) cb({ ok: true, settings: room.settings });
  });

  socket.on('sendLobbyChat', ({ text }, cb) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.state !== 'lobby') return cb && cb({ ok: false, message: 'Chat is only available in lobby.' });
    const trimmed = typeof text === 'string' ? text.trim().slice(0, 120) : '';
    if (!trimmed) return cb && cb({ ok: false, message: 'Message cannot be empty.' });

    const now = Date.now();
    const token = socket.data.sessionToken || socket.id;
    if (!room.lastChatAt) room.lastChatAt = new Map();
    const lastAt = room.lastChatAt.get(token) || 0;
    if (now - lastAt < 1000) {
      return cb && cb({ ok: false, error: 'Slow down! Max 1 message per second.' });
    }
    room.lastChatAt.set(token, now);

    const isHost = room.hostId === socket.id;
    const player = !isHost ? room.players.find((p) => p.id === socket.id) : null;
    const msg = {
      id: uuidv4(),
      senderName: isHost ? (room.host?.name || 'Host') : (player?.name || 'Player'),
      senderAvatar: isHost ? (room.host?.avatar || '👑') : (player?.avatar || '👤'),
      isHost,
      text: trimmed,
      timestamp: now
    };

    if (!room.chatMessages) room.chatMessages = [];
    room.chatMessages.push(msg);
    if (room.chatMessages.length > 50) room.chatMessages.shift();

    io.to(room.pin).emit('lobbyChat', msg);
    if (cb) cb({ ok: true, message: msg });
  });

  const ALLOWED_REACTIONS = ['🔥', '💀', '😭', '😂', '👑', '🪝'];
  socket.on('sendLobbyReaction', ({ emoji }, cb) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.state !== 'lobby') return cb && cb({ ok: false });
    if (!ALLOWED_REACTIONS.includes(emoji)) return cb && cb({ ok: false });

    const now = Date.now();
    const token = socket.data.sessionToken || socket.id;
    if (!room.lastReactionAt) room.lastReactionAt = new Map();
    const lastAt = room.lastReactionAt.get(token) || 0;
    if (now - lastAt < 5000) {
      return cb && cb({ ok: false, error: 'Cooldown active', remainingMs: 5000 - (now - lastAt) });
    }
    room.lastReactionAt.set(token, now);

    const isHost = room.hostId === socket.id;
    const player = !isHost ? room.players.find((p) => p.id === socket.id) : null;
    const reaction = {
      id: uuidv4(),
      emoji,
      senderName: isHost ? (room.host?.name || 'Host') : (player?.name || 'Player'),
      timestamp: now
    };

    io.to(room.pin).emit('lobbyReaction', reaction);
    if (cb) cb({ ok: true });
  });


  const normalizeQuestions = (list) => (list || []).map((q) => {
    const img = q.imageUrl || q.image || null;
    const minVal = Number(q.min);
    const maxVal = Number(q.max);
    const numVal = Number(q.correctNumber);
    return {
      type: q.type || 'classic',
      text: String(q.text || '').slice(0, 200),
      options: (q.options || []).map((o) => String(o).slice(0, 80)),
      correctAnswer: Number(q.correctAnswer) || 0,
      timeLimit: Math.max(5, Math.round(Number(q.timeLimit)) || 20),
      image: img,
      imageUrl: img,
      correctAnswerText: q.correctAnswerText || '',
      min: Number.isFinite(minVal) ? minVal : 0,
      max: Number.isFinite(maxVal) ? maxVal : 100,
      correctNumber: Number.isFinite(numVal) ? numVal : 50,
      pairs: Array.isArray(q.pairs) ? q.pairs.map((p) => ({ left: String(p.left || ''), right: String(p.right || '') })) : []
    };
  });

  socket.on('setQuestions', ({ questions }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;

    room.questions = normalizeQuestions(questions);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  });

  socket.on('loadQuestionSet', async ({ setId, authToken }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    try {
      const userId = isClerkEnabled()
        ? ((await verifySocketUser(authToken)) || room.hostUserId || socket.data.userId)
        : null;
      const set = await questionsStore.getSet(setId, { userId, authEnabled: isClerkEnabled() });
      if (!set) {
        return socket.emit('toast', { text: 'Question set not found.', tone: 'warn' });
      }
      if (set.forbidden) {
        return socket.emit('toast', { text: 'You do not have permission to load that quiz pack.', tone: 'warn' });
      }
      room.questions = normalizeQuestions(set.questions);
      io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
      socket.emit('questionsLoaded', { questions: room.questions });
      socket.emit('toast', { text: `Loaded "${set.name}" (${room.questions.length} questions)`, tone: 'join' });
    } catch (err) {
      socket.emit('toast', { text: 'Could not load that question set right now.', tone: 'warn' });
    }
  });

  socket.on('choosePower', ({ power }, cb) => {
    const ack = typeof cb === 'function' ? cb : () => {};
    const room = rooms.get(socket.data.pin);
    if (!room || room.state !== 'powerSelect') {
      ack({ ok: false, message: 'Power selection is no longer open.' });
      return;
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      ack({ ok: false, message: 'You are not in this room. Try rejoining.' });
      return;
    }
    if (player.isHost || !POWERS[power]) {
      ack({ ok: false, message: 'Invalid power selection.' });
      return;
    }
    player.power = power;
    player.powerCooldownUntil = 0;
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    ack({ ok: true });
    const nonHostPlayers = room.players.filter((p) => !p.isHost);
    const allChosen = nonHostPlayers.every((p) => p.power);
    if (allChosen && nonHostPlayers.length > 0) {
      clearTimeout(room.powerSelectTimer);
      io.to(room.pin).emit('toast', { text: 'All powers chosen! Starting...', tone: 'join' });
      clearTimeout(room.advanceTimer);
      room.advanceTimer = setTimeout(() => {
        const r = rooms.get(room.pin);
        if (!r || r.state !== 'powerSelect') return;
        nextQuestion(r);
      }, 2000);
    }
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    if (room.questions.length === 0) {
      return socket.emit('toast', { text: 'Add at least one question first.', tone: 'warn' });
    }

    const settings = room.settings || defaultRoomSettings();
    room.questionIndex = -1;
    room.players.forEach((p) => {
      p.score = 0;
      p.streak = 0;
      p.power = null;
      p.powerCooldownUntil = 0;
      p.powerUsed = false;
      p.frozen = false;
      p.heistTarget = null;
    });

    if (settings.shuffleQuestions && room.questions.length > 1) {
      room.lobbyQuestions = [...room.questions];
      const shuffled = [...room.questions];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      room.questions = shuffled;
    } else {
      room.lobbyQuestions = null;
    }

    if (settings.powerMode === 'off') {
      io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
      io.to(room.pin).emit('toast', { text: '⚡ Pure Trivia Mode — Powers are OFF!', tone: 'join' });
      nextQuestion(room);
      return;
    }

    if (settings.powerMode === 'random') {
      const powerKeys = Object.keys(POWERS);
      room.players.forEach((p) => {
        if (!p.isHost) {
          p.power = powerKeys[Math.floor(Math.random() * powerKeys.length)];
          const meta = POWERS[p.power];
          io.to(p.id).emit('toast', { text: `🎲 Random Power: ${meta.icon} ${meta.name}!`, tone: 'power' });
        }
      });
      io.to(room.hostId).emit('toast', { text: '🎲 Random powers assigned! Starting...', tone: 'join' });
      io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
      nextQuestion(room);
      return;
    }

    room.state = 'powerSelect';
    room.powerSelectStartedAt = Date.now();
    io.to(room.pin).emit('gameStarted');
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    clearTimeout(room.powerSelectTimer);
    room.powerSelectTimer = setTimeout(() => {
      const r = rooms.get(room.pin);
      if (!r || r.state !== 'powerSelect') return;
      const powerKeys = Object.keys(POWERS);
      r.players.forEach((p) => {
        if (!p.isHost && !p.power) {
          p.power = powerKeys[Math.floor(Math.random() * powerKeys.length)];
          p.powerCooldownUntil = 0;
        }
      });
      io.to(r.pin).emit('roomUpdate', roomSnapshot(r));
      io.to(r.pin).emit('toast', { text: "Time's up! Random powers assigned.", tone: 'warn' });
      clearTimeout(r.advanceTimer);
      r.advanceTimer = setTimeout(() => {
        const r2 = rooms.get(room.pin);
        if (!r2 || r2.state !== 'powerSelect') return;
        nextQuestion(r2);
      }, 2000);
    }, POWER_SELECT_DURATION_MS);
  });

  socket.on('endGameEarly', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    endGame(room);
  });

  socket.on('forceStartFromPowerSelect', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id || room.state !== 'powerSelect') return;
    clearTimeout(room.powerSelectTimer);
    const powerKeys = Object.keys(POWERS);
    room.players.forEach((p) => {
      if (!p.isHost && !p.power) {
        p.power = powerKeys[Math.floor(Math.random() * powerKeys.length)];
        p.powerCooldownUntil = 0;
      }
    });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).emit('toast', { text: 'Host started the game!', tone: 'join' });
    clearTimeout(room.advanceTimer);
    room.advanceTimer = setTimeout(() => {
      const r = rooms.get(room.pin);
      if (!r || r.state !== 'powerSelect') return;
      nextQuestion(r);
    }, 1500);
  });

  function nextQuestion(room) {
    clearRoomTimers(room);
    room.questionIndex += 1;
    if (room.questionIndex >= room.questions.length) return endGame(room);

    room.answers = new Map();
    room.players.forEach((p) => { p.frozen = false; p.heistTarget = null; });
    room.state = 'question';
    room.isDoublePoints = false;

    const q = room.questions[room.questionIndex];
    room.paused = false;
    room.pausedAt = null;
    room.pausedRemainingMs = 0;
    room.startedAt = Date.now();
    room.endsAt = Date.now() + q.timeLimit * 1000;
    const payloadPlayer = {
      question: sanitizeQuestion(q),
      index: room.questionIndex,
      total: room.questions.length,
      startedAt: room.startedAt,
      endsAt: room.endsAt
    };
    const payloadHost = { ...payloadPlayer, question: q };

    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).except(room.hostId).emit('questionStart', payloadPlayer);
    io.to(room.hostId).emit('questionStart', payloadHost);

    clearTimeout(room.timer);
    room.timer = setTimeout(() => revealAnswer(room), q.timeLimit * 1000 + 250);
  }

  function revealAnswer(room, isSkipped = false) {
    if (room.state !== 'question') return;
    clearRoomTimers(room);
    room.paused = false;
    room.pausedAt = null;
    room.pausedRemainingMs = 0;
    const q = room.questions[room.questionIndex];
    if (!q) return;
    room.state = 'reveal';
    room.isDoublePoints = false;
    room.players.forEach((p) => { p.heistTarget = null; });

    const distribution = (q.options || []).map((_, i) => {
      let count = 0;
      room.answers.forEach((a) => { if (a.answerIndex === i) count += 1; });
      return count;
    });

    const scorer = [...room.players].filter((p) => !p.isHost).sort((a, b) => b.score - a.score);
    io.to(room.pin).emit('answerReveal', {
      correctAnswer: q.correctAnswer,
      correctAnswerText: q.correctAnswerText,
      correctNumber: q.correctNumber,
      pairs: q.pairs,
      distribution,
      leaderboard: scorer.map((p, i) => ({ rank: i + 1, ...publicPlayer(p) })),
      lastRound: room.lastRound || null,
      skipped: isSkipped
    });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));

    room.phaseTimer = setTimeout(() => {
      const liveRoom = rooms.get(room.pin);
      if (liveRoom && liveRoom.state === 'reveal') {
        liveRoom.state = 'leaderboard';
        const sorted = [...liveRoom.players.filter((p) => !p.isHost)].sort((a, b) => b.score - a.score);
        sorted.forEach((p, i) => (p.rank = i + 1));
        io.to(liveRoom.pin).emit('leaderboardUpdate', {
          leaderboard: sorted.map((p) => ({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            score: p.score,
            rank: p.rank
          })),
          lastRound: liveRoom.lastRound
        });
        io.to(liveRoom.pin).emit('roomUpdate', roomSnapshot(liveRoom));
      }
    }, 3000);
  }

  socket.on('submitAnswer', ({ answerIndex, clientTime }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.state !== 'question' || room.paused) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.isHost) return;
    if (room.answers.has(socket.id)) return;

    if (player.frozen) {
      return socket.emit('answerAck', { correct: false, points: 0, total: player.score, frozen: true });
    }

    const q = room.questions[room.questionIndex];
    if (!q) return;

    let isCorrect = false;
    let accuracy = 0;

    const qType = q.type || 'classic';
    if (qType === 'classic') {
      isCorrect = Number.isInteger(answerIndex) && answerIndex === q.correctAnswer;
      accuracy = isCorrect ? 1 : 0;
    } else if (qType === 'short_answer') {
      const correctTxt = String(q.correctAnswerText || '').trim().toLowerCase();
      const ansTxt = String(answerIndex || '').trim().toLowerCase();
      if (ansTxt && correctTxt) {
          if (ansTxt === correctTxt) {
             isCorrect = true;
             accuracy = 1;
          } else {
             const words = correctTxt.split(/\s+/);
             if (words.includes(ansTxt) && ansTxt.length > 4) {
                 isCorrect = true;
                 accuracy = 1;
             }
          }
        }
    } else if (qType === 'slider') {
      const target = Number(q.correctNumber) || 0;
      const range = (Number(q.max) - Number(q.min)) || 100;
      const ansNum = Number(answerIndex) || 0;
      const diff = Math.abs(ansNum - target);
      if (diff === 0) {
        isCorrect = true;
        accuracy = 1;
      } else if (diff <= range * 0.15) { 
        // Partial points if within 15%
        isCorrect = true;
        accuracy = 1 - (diff / (range * 0.15));
      } else {
        accuracy = 0;
      }
    } else if (qType === 'match') {
      const answers = answerIndex || [];
      const totalPairs = q.pairs ? q.pairs.length : 0;
      let correctPairs = 0;
      if (Array.isArray(answers) && totalPairs > 0) {
        answers.forEach((ans) => {
          if (Number(ans.left) === Number(ans.right)) correctPairs++;
        });
        accuracy = correctPairs / totalPairs;
        if (correctPairs > 0) isCorrect = true;
      }
    }

    const elapsed = Date.now() - (clientTime || Date.now());
    const timeLeftMs = Math.max(0, q.timeLimit * 1000 - elapsed);

    if (isCorrect) player.streak += 1;
    else player.streak = 0;

    // Use accuracy to scale points!
    const base = 600 * accuracy;
    const speed = Math.floor((Math.max(0, timeLeftMs) / (q.timeLimit * 1000)) * 400) * accuracy;
    const streakBonus = Math.min(player.streak, 5) * 50 * (accuracy > 0.9 ? 1 : 0); // Need high accuracy for streak bonus
    const points = Math.floor(base + speed + streakBonus);

    let earnedPoints = points;
    if (points > 0) {
      const heisters = room.players.filter(p => p.heistTarget === player.id && p.id !== player.id && p.connected);
      if (heisters.length > 0) {
        const totalStolen = Math.floor(points * 0.5);
        earnedPoints -= totalStolen;
        const perHeister = Math.floor(totalStolen / heisters.length);
        heisters.forEach((h) => {
          h.score += perHeister;
          h.heistTarget = null;
        });
        const names = heisters.map(h => h.name).join(', ');
        io.to(room.pin).emit('toast', {
          text: `🪝 ${names} stole ${totalStolen} points from ${player.name}'s answer!`,
          tone: 'power'
        });
      }
    }
    player.score += earnedPoints;

    room.answers.set(socket.id, { answerIndex, correct: isCorrect, points: earnedPoints });
    room.lastRound = { name: player.name, correct: isCorrect, points: earnedPoints };

    socket.emit('answerAck', {
      correct: isCorrect,
      points,
      total: player.score,
      streak: player.streak
    });

    const activePlayers = room.players.filter((p) => !p.isHost);
    io.to(room.pin).emit('answerCount', { answered: room.answers.size, total: activePlayers.length, answeredPlayerIds: Array.from(room.answers.keys()) });

    const everyone = activePlayers.length > 0 && activePlayers.every((p) => room.answers.has(p.id));
    if (everyone) {
      clearTimeout(room.timer);
      setTimeout(() => revealAnswer(room), 600);
    }
  });

  socket.on('nextQuestion', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'reveal' && room.state !== 'leaderboard') return;
    nextQuestion(room);
  });

  function endGame(room) {
  room.isDoublePoints = false;
    room.state = 'results';
    room.paused = false;
    room.pausedAt = null;
    room.pausedRemainingMs = 0;
    clearRoomTimers(room);
    const ranked = [...room.players].filter((p) => !p.isHost).sort((a, b) => b.score - a.score);
    io.to(room.pin).emit('gameOver', {
      podium: ranked.slice(0, 3).map((p, i) => ({ rank: i + 1, ...publicPlayer(p) })),
      all: ranked.map((p, i) => ({ rank: i + 1, ...publicPlayer(p) }))
    });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  }

  socket.on('playAgain', () => {
    const rPlay = rooms.get(socket.data.pin);
    if (rPlay) rPlay.isDoublePoints = false;
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    clearRoomTimers(room);
    room.paused = false;
    room.pausedAt = null;
    room.pausedRemainingMs = 0;
    room.state = 'lobby';
    room.questionIndex = -1;
    room.answers = new Map();
    if (Array.isArray(room.lobbyQuestions)) {
      room.questions = room.lobbyQuestions;
      room.lobbyQuestions = null;
    }
    room.players.forEach((p) => {
      p.score = 0;
      p.streak = 0;
      p.power = null;
      p.powerCooldownUntil = 0;
      p.powerUsed = false;
      p.frozen = false;
      p.heistTarget = null;
    });
    io.to(room.pin).emit('backToLobby');
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  });

  
  socket.on('activateDoublePoints', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'question' || room.isDoublePoints) return;

    room.isDoublePoints = true;

    // Retroactively double current round earnings for players who already submitted
    room.answers.forEach((ans, playerId) => {
      const player = room.players.find((p) => p.id === playerId);
      if (player && ans.correct && ans.points > 0) {
        const extra = ans.points;
        ans.points *= 2;
        player.score += extra;

        if (Array.isArray(ans.heistSplit)) {
          ans.heistSplit.forEach((h) => {
            const heister = room.players.find((p) => p.id === h.heisterId);
            if (heister) {
              heister.score += h.stolen;
              h.stolen *= 2;
            }
          });
        }
      }
    });

    io.to(room.pin).emit('doublePointsActivated', {
      isDoublePoints: true,
      leaderboard: room.players.filter((p) => !p.isHost).map(publicPlayer)
    });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).emit('toast', { text: '🔥 2× POINTS ACTIVATED!', tone: 'power' });

    // Broadcast battle feed event to Host
    io.to(room.pin).emit('battleFeedEvent', {
      id: uuidv4(),
      text: 'Host activated 🔥 2× POINTS!',
      icon: '🔥',
      tone: 'double',
      timestamp: Date.now()
    });
  });

  socket.on('hostSkipQuestion', () => {
    const rCheck = rooms.get(socket.data.pin);
    if (rCheck) rCheck.isDoublePoints = false;
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'question') return;
    io.to(room.pin).emit('toast', { text: 'Host skipped the question', tone: 'warn' });
    revealAnswer(room, true);
  });

  socket.on('hostTogglePause', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'question') return;
    const q = room.questions[room.questionIndex];
    if (!q) return;

    if (room.paused) {
      const pauseDuration = Date.now() - (room.pausedAt || Date.now());
      room.paused = false;
      room.pausedAt = null;
      if (room.startedAt) room.startedAt += pauseDuration;
      room.players.forEach((p) => {
        if (p.powerCooldownUntil && p.powerCooldownUntil > Date.now()) {
          p.powerCooldownUntil += pauseDuration;
        }
      });
      const remaining = room.pausedRemainingMs || 0;
      room.endsAt = Date.now() + remaining;
      clearTimeout(room.timer);
      room.timer = setTimeout(() => revealAnswer(room), remaining + 250);
      io.to(room.pin).emit('timerResumed', { endsAt: room.endsAt, startedAt: room.startedAt });
      io.to(room.pin).emit('toast', { text: 'Timer resumed', tone: 'join' });
    } else {
      room.paused = true;
      room.pausedAt = Date.now();
      room.pausedRemainingMs = Math.max(0, (room.endsAt || Date.now()) - Date.now());
      clearTimeout(room.timer);
      io.to(room.pin).emit('timerPaused', { remainingMs: room.pausedRemainingMs });
      io.to(room.pin).emit('toast', { text: 'Timer paused by host', tone: 'warn' });
    }
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  });

  const consumePower = (fn) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.settings?.powerMode === 'off') return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.power || player.powerUsed || Date.now() < (player.powerCooldownUntil || 0)) return;
    const cooldownSec = room.settings?.powerCooldownSec ?? Math.round(POWER_COOLDOWN_MS / 1000);
    if (cooldownSec === -1) {
      player.powerUsed = true;
      player.powerCooldownUntil = 0;
    } else {
      player.powerCooldownUntil = Date.now() + Math.max(5, cooldownSec) * 1000;
    }
    fn(room, player);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  };

  socket.on('usePower', ({ targetId, currentPairs }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.paused || room.settings?.powerMode === 'off') return;
    const me = room.players.find((p) => p.id === socket.id);
    if (!me || !me.power || me.powerUsed || Date.now() < (me.powerCooldownUntil || 0)) return;

    const power = me.power;

    if (power === 'blind') {
      consumePower((rm, actor) => {
        rm.players.forEach((p) => {
          if (p.id === actor.id) return;
          io.to(p.id).emit('powerEffect', { type: 'blind', duration: 10000, from: actor.name });
        });
        io.to(rm.pin).emit('toast', { text: `🌑 ${actor.name} blacked out the room!`, tone: 'power' });
        io.to(rm.pin).emit('battleFeedEvent', { id: uuidv4(), text: `${actor.name} 🌑 blacked out the room!`, icon: '🌑', timestamp: Date.now() });
      });
      return;
    }

    if (power === 'steal') {
      consumePower((rm, actor) => {
        const target = rm.players.find((p) => p.id === targetId && p.id !== actor.id && p.connected && !p.isHost);
        if (!target) { actor.powerCooldownUntil = 0; actor.powerUsed = false; return; }
        actor.heistTarget = target.id;
        io.to(rm.pin).emit('toast', {
          text: `🪝 ${actor.name} targeted ${target.name} with Heist!`,
          tone: 'power'
        });
        io.to(actor.id).emit('powerEffect', { type: 'steal', from: actor.name, target: target.name });
      });
      return;
    }

    if (power === 'scramble') {
      consumePower((rm, actor) => {
        const q = rm.questions[rm.questionIndex];
        const qType = q ? (q.type || 'classic') : 'classic';
        const duration = 10000; // 10 seconds across all modes
        rm.players.forEach((p) => {
          if (p.id === actor.id) return;
          io.to(p.id).emit('powerEffect', { type: 'scramble', qType, duration, from: actor.name });
        });
        io.to(rm.pin).emit('toast', { text: `🌀 ${actor.name} scrambled the answers!`, tone: 'power' });
        io.to(rm.pin).emit('battleFeedEvent', { id: uuidv4(), text: `${actor.name} 🌀 scrambled the answers!`, icon: '🌀', timestamp: Date.now() });
      });
      return;
    }

    if (power === 'freeze') {
      consumePower((rm, actor) => {
        const target = rm.players.find((p) => p.id === targetId && p.id !== actor.id);
        if (!target) { actor.powerCooldownUntil = 0; actor.powerUsed = false; return; }
        target.frozen = true;
        io.to(target.id).emit('powerEffect', { type: 'frozen', from: actor.name, duration: FREEZE_DURATION_MS });
        io.to(rm.pin).emit('toast', { text: `❄️ ${actor.name} froze ${target.name}!`, tone: 'power' });
        io.to(rm.pin).emit('battleFeedEvent', { id: uuidv4(), text: `${actor.name} ❄️ froze ${target.name}!`, icon: '❄️', timestamp: Date.now() });
        setTimeout(() => {
          const liveRoom = rooms.get(rm.pin);
          if (!liveRoom) return;
          const liveTarget = liveRoom.players.find((p) => p.id === target.id);
          if (!liveTarget || !liveTarget.frozen) return;
          liveTarget.frozen = false;
          io.to(liveRoom.pin).emit('roomUpdate', roomSnapshot(liveRoom));
          // Give unfrozen player extra time if everyone else already answered
          if (liveRoom.state === 'question' && !liveRoom.answers.has(target.id)) {
            const activePlayers = liveRoom.players.filter((p) => !p.isHost);
            const othersAllDone = activePlayers.filter(p => p.id !== target.id).every(p => liveRoom.answers.has(p.id));
            if (othersAllDone) {
              clearTimeout(liveRoom.timer);
              liveRoom.endsAt = Date.now() + 10000;
              liveRoom.timer = setTimeout(() => revealAnswer(liveRoom), 10250);
              io.to(liveRoom.pin).emit('timerResumed', { endsAt: liveRoom.endsAt });
              io.to(target.id).emit('toast', { text: '❄️ Unfrozen! Quick, answer now!', tone: 'warn' });
            }
          }
        }, FREEZE_DURATION_MS);
      });
      return;
    }

    if (power === 'hint') {
      consumePower((rm, actor) => {
        const q = rm.questions[rm.questionIndex];
        if (!q) { actor.powerCooldownUntil = 0; actor.powerUsed = false; return; }
        const qType = q.type || 'classic';

        if (qType === 'classic') {
          const wrong = (q.options || [])
            .map((_, i) => i)
            .filter((i) => i !== q.correctAnswer);
          for (let i = wrong.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
          }
          const eliminate = wrong.slice(0, Math.min(2, wrong.length));
          io.to(actor.id).emit('powerEffect', { type: 'hint', qType: 'classic', eliminate });
        } else if (qType === 'short_answer') {
          const ans = String(q.correctAnswerText || '').trim();
          const maskedWords = ans.split(/\s+/).map(word => {
            if (word.length <= 2) return word.split('').map(() => '_').join(' ');
            const firstChar = word[0];
            const rest = Array(word.length - 1).fill('_').join(' ');
            return `${firstChar} ${rest}`;
          });
          const masked = maskedWords.join('   ');
          io.to(actor.id).emit('powerEffect', { type: 'hint', qType: 'short_answer', masked });
        } else if (qType === 'slider') {
          const min = Number(q.min) || 0;
          const max = Number(q.max) || 100;
          const target = Number(q.correctNumber) || 0;
          const mid = (min + max) / 2;
          let safeMin, safeMax;
          if (target <= mid) {
            safeMin = min;
            safeMax = Math.ceil(mid);
          } else {
            safeMin = Math.floor(mid);
            safeMax = max;
          }
          io.to(actor.id).emit('powerEffect', { type: 'hint', qType: 'slider', safeMin, safeMax });
        } else if (qType === 'match') {
          const totalPairs = q.pairs ? q.pairs.length : 0;
          const userMatches = currentPairs || {};
          const unassignedLefts = [];
          for (let i = 0; i < totalPairs; i++) {
            if (userMatches[i] === undefined || Number(userMatches[i]) !== i) {
              unassignedLefts.push(i);
            }
          }
          const chosenLeft = unassignedLefts.length > 0 
            ? unassignedLefts[Math.floor(Math.random() * unassignedLefts.length)]
            : 0;
          io.to(actor.id).emit('powerEffect', { 
            type: 'hint', 
            qType: 'match', 
            autoPair: { left: chosenLeft, right: chosenLeft } 
          });
        }
        io.to(rm.pin).emit('toast', { text: `🔮 ${actor.name} consulted the Oracle`, tone: 'power' });
        io.to(rm.pin).emit('battleFeedEvent', { id: uuidv4(), text: `${actor.name} 🔮 consulted the Oracle!`, icon: '🔮', timestamp: Date.now() });
      });
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.pin);
    if (!room) return;

    const isHost = room.hostId === socket.id;
    const player = !isHost ? room.players.find((p) => p.id === socket.id) : null;
    if (!isHost && !player) return;

    const graceMs = room.state === 'lobby' ? 120000 : 30000;

    if (isHost) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = setTimeout(() => {
        const current = rooms.get(room.pin);
        if (current && current.hostId === socket.id) {
          io.to(room.pin).emit('hostLeft');
          clearRoomTimers(current);
          if (current.disconnectGraceTimers) {
            current.disconnectGraceTimers.forEach((t) => clearTimeout(t));
          }
          rooms.delete(room.pin);
        }
      }, graceMs);
      return;
    }

    player.connected = false;
    player.heistTarget = null;
    room.players.forEach((p) => { if (p.heistTarget === player.id) p.heistTarget = null; });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));

    // 15-second grace window before purging disconnected player
    const token = player.sessionToken || player.id;
    if (!room.disconnectGraceTimers) room.disconnectGraceTimers = new Map();
    if (room.disconnectGraceTimers.has(token)) {
      clearTimeout(room.disconnectGraceTimers.get(token));
    }

    const graceTimer = setTimeout(() => {
      const liveRoom = rooms.get(room.pin);
      if (!liveRoom) return;
      const targetP = liveRoom.players.find((p) => (p.sessionToken && p.sessionToken === token) || p.id === player.id);
      if (targetP && !targetP.connected) {
        liveRoom.players = liveRoom.players.filter((p) => p !== targetP);
        liveRoom.disconnectGraceTimers.delete(token);
        io.to(liveRoom.pin).emit('roomUpdate', roomSnapshot(liveRoom));
        io.to(liveRoom.pin).emit('toast', { text: `${targetP.name} left`, tone: 'warn' });
      }
    }, graceMs);

    room.disconnectGraceTimers.set(token, graceTimer);
  });
});

app.get('/', (req, res) => res.send('🎮 Finnival Backend Server is running! Open the game in your browser at port 3002.'));


app.get('/api/network-info', (req, res) => {
  res.json({ lanIp: getLanIp(), port: PORT });
});

app.get('/api/config', (req, res) => {
  res.json({
    authEnabled: isClerkEnabled(),
    dbEnabled: questionsStore.isUsingDb()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    authEnabled: isClerkEnabled(),
    dbEnabled: questionsStore.isUsingDb()
  });
});
app.get('/api/powers', (req, res) => res.json(POWERS));
app.get('/api/shapes', (req, res) => res.json(SHAPES));

app.get('/api/ai-status', async (req, res) => {
  const status = await aiGenerator.getAiStatus();
  res.json(status);
});

app.post('/api/generate-quiz', async (req, res) => {
  const userId = getRequestUserId(req);
  if (isClerkEnabled() && !userId) {
    return res.status(401).json({ error: 'Please sign in to generate AI questions.' });
  }

  const { pin, sessionToken, topic, count, types, difficulty, timeLimit } = req.body || {};
  const room = rooms.get(String(pin || '').trim());
  if (!room || !sessionToken || room.hostSessionToken !== sessionToken) {
    return res.status(403).json({ error: 'Only an active lobby host can generate AI questions.' });
  }
  if (isClerkEnabled() && room.hostUserId && room.hostUserId !== userId) {
    return res.status(403).json({ error: 'Only the lobby owner can generate AI questions.' });
  }

  const now = Date.now();
  if (room.lastAiGenAt && now - room.lastAiGenAt < 8000) {
    const waitSec = Math.ceil((8000 - (now - room.lastAiGenAt)) / 1000);
    return res.status(429).json({ error: `Please wait ${waitSec}s before generating again.` });
  }

  const quota = consumeUserAiQuota(userId);
  if (!quota.allowed) {
    return res.status(429).json({
      error: `Hourly AI quiz limit reached (${USER_AI_MAX_PER_HOUR}/hr). Try again in ~${quota.waitMin}m, or add questions manually.`
    });
  }

  room.lastAiGenAt = now;
  try {
    const result = await aiGenerator.generateQuiz({
      topic,
      count,
      types,
      difficulty,
      timeLimit
    });
    console.log(`[AI Quiz Generator] Room ${room.pin}: generated ${result.questions.length} questions via ${result.providerUsed}`);
    res.json({ ok: true, packName: result.packName, questions: result.questions });
  } catch (err) {
    room.lastAiGenAt = 0;
    refundUserAiQuota(userId);
    res.status(400).json({ error: err.message || 'Could not generate questions right now.' });
  }
});

app.get('/api/question-sets', async (req, res) => {
  try {
    const authEnabled = isClerkEnabled();
    const userId = getRequestUserId(req);
    const sets = await questionsStore.listSets({ userId, authEnabled });
    res.json(sets);
  } catch (err) {
    console.error('[Question Sets List Error]:', err);
    res.status(500).json({ error: 'Could not load saved question sets.' });
  }
});

app.get('/api/question-sets/:id', async (req, res) => {
  try {
    const authEnabled = isClerkEnabled();
    const userId = getRequestUserId(req);
    const set = await questionsStore.getSet(req.params.id, { userId, authEnabled });
    if (!set) return res.status(404).json({ error: 'not found' });
    if (set.forbidden) return res.status(403).json({ error: 'You do not have access to this quiz pack.' });
    res.json(set);
  } catch (err) {
    console.error('[Question Set Get Error]:', err);
    res.status(500).json({ error: 'Could not fetch question set.' });
  }
});

app.post('/api/question-sets', async (req, res) => {
  try {
    const authEnabled = isClerkEnabled();
    const userId = getRequestUserId(req);
    if (authEnabled && !userId) {
      return res.status(401).json({ error: 'Please sign in to save quiz packs.' });
    }
    const { name, questions } = req.body || {};
    if (!name || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'name and non-empty questions array required' });
    }
    const entry = await questionsStore.saveSet(name, questions, { userId });
    res.json({
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      questionCount: entry.questionCount,
      isPublic: false,
      isOwner: true
    });
  } catch (err) {
    console.error('[Question Set Save Error]:', err);
    res.status(500).json({ error: 'Could not save question set.' });
  }
});

app.post('/api/purge-unused-images', async (req, res) => {
  if (isClerkEnabled() && !getRequestUserId(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const result = await purgeOrphanImages(rooms);
  res.json({ ok: true, ...result });
});

app.delete('/api/question-sets/:id', async (req, res) => {
  try {
    const authEnabled = isClerkEnabled();
    const userId = getRequestUserId(req);
    if (authEnabled && !userId) {
      return res.status(401).json({ error: 'Please sign in to delete quiz packs.' });
    }
    const result = await questionsStore.deleteSet(req.params.id, { userId, authEnabled });
    if (result.ok) await purgeOrphanImages(rooms);
    if (!result.ok) {
      if (result.reason === 'forbidden') {
        return res.status(403).json({ error: 'You can only delete your own private quiz packs.' });
      }
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Question Set Delete Error]:', err);
    res.status(500).json({ error: 'Could not delete question set.' });
  }
});

const clientBuildDir = path.join(__dirname, '..', 'client', 'build');
if (process.env.SERVE_CLIENT === 'true' && fs.existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/socket.io/')) {
      return next();
    }
    return res.sendFile(path.join(clientBuildDir, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
async function startServer() {
  try {
    const storageInfo = await questionsStore.initStorage();
    console.log(`[Storage] Initialized in ${storageInfo.mode.toUpperCase()} mode`);
  } catch (err) {
    console.error('[Storage Error] Could not initialize database:', err);
  }

  console.log(`[Auth] Clerk authentication: ${isClerkEnabled() ? 'ENABLED' : 'LOCAL OPEN MODE (set CLERK keys in .env to enable)'}`);

  server.listen(PORT, '0.0.0.0', async () => {
    const startupPurge = await purgeOrphanImages(rooms);
    if (startupPurge.deletedCount > 0) {
      console.log(`Startup orphan check: cleaned ${startupPurge.deletedCount} unused images (${startupPurge.mbFreed} MB freed)`);
    }

    // Automatically sweep and purge unreferenced uploaded images older than 15 minutes
    setInterval(async () => {
      const sweep = await purgeOrphanImages(rooms);
      if (sweep.deletedCount > 0) {
        console.log(`[Auto-Purge] Cleaned ${sweep.deletedCount} unused images (${sweep.mbFreed} MB freed)`);
      }
    }, 15 * 60 * 1000);

    const nets = require('os').networkInterfaces();
    let lanIP = 'localhost';
    for (const iface of Object.values(nets)) {
      for (const cfg of iface) {
        if (cfg.family === 'IPv4' && !cfg.internal) {
          lanIP = cfg.address;
          break;
        }
      }
    }
    console.log(`Finnival server running on http://localhost:${PORT}`);
    console.log(`For other devices on your network: http://${lanIP}:${PORT}`);
  });
}

startServer();

