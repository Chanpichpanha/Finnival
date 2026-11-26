const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const questionsStore = require('./questions-store');

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



function purgeOrphanImages(roomsMap) {
  try {
    if (!fs.existsSync(uploadsDir)) return { deletedCount: 0, bytesFreed: 0, mbFreed: '0.00' };
    const allFiles = fs.readdirSync(uploadsDir);
    if (allFiles.length === 0) return { deletedCount: 0, bytesFreed: 0, mbFreed: '0.00' };

    const referencedFiles = new Set();

    // 1. Check all saved packs
    const savedSets = questionsStore.readSets ? questionsStore.readSets() : [];
    savedSets.forEach((s) => {
      (s.questions || []).forEach((q) => {
        const img = q.imageUrl || q.image;
        if (typeof img === 'string' && img.startsWith('/uploads/')) {
          referencedFiles.add(path.basename(img));
        }
      });
    });

    // 2. Check all active game rooms
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

app.use(cors());
app.use(express.json());

app.use('/uploads', express.static(uploadsDir));

app.post('/api/upload-image', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    res.json({ imageUrl: `/uploads/${req.file.filename}` });
  });
});


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
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
    frozen: p.frozen,
    connected: p.connected,
    powerChosen: !!p.power
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

  socket.on('createRoom', ({ gameName }, cb) => {
    const pin = generatePin();
    const room = {
      pin,
      id: uuidv4(),
      hostId: socket.id,
      gameName: String(gameName || '').trim().slice(0, 40) || 'Finnival',
      players: [],
      questions: [],
      questionIndex: -1,
      state: 'lobby',
      locked: false,
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

  socket.on('rejoinRoom', ({ pin, sessionToken, playerId }, cb) => {
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

  socket.on('abandonLobby', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;

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


  socket.on('setQuestions', ({ questions }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;

    room.questions = (questions || []).map((q) => ({
        type: q.type || 'classic',
        text: String(q.text || '').slice(0, 200),
        options: (q.options || []).map((o) => String(o).slice(0, 80)),
        correctAnswer: Number(q.correctAnswer) || 0,
        timeLimit: Math.max(5, Math.round(Number(q.timeLimit)) || 20),
        image: q.image || null,
        correctAnswerText: q.correctAnswerText || '',
        min: Number(q.min) || 0,
        max: Number(q.max) || 100,
        correctNumber: Number(q.correctNumber) || 50,
        pairs: Array.isArray(q.pairs) ? q.pairs.map(p => ({ left: String(p.left||''), right: String(p.right||'') })) : []
      }));
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  });

  socket.on('loadQuestionSet', ({ setId }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    const set = questionsStore.getSet(setId);
    if (!set) {
      return socket.emit('toast', { text: 'Question set not found.', tone: 'warn' });
    }
    room.questions = set.questions.map((q) => ({
        type: q.type || 'classic',
        text: String(q.text || '').slice(0, 200),
        options: (q.options || []).map((o) => String(o).slice(0, 80)),
        correctAnswer: Number(q.correctAnswer) || 0,
        timeLimit: Math.max(5, Math.round(Number(q.timeLimit)) || 20),
        image: q.image || null,
        correctAnswerText: q.correctAnswerText || '',
        min: Number(q.min) || 0,
        max: Number(q.max) || 100,
        correctNumber: Number(q.correctNumber) || 50,
        pairs: Array.isArray(q.pairs) ? q.pairs.map(p => ({ left: String(p.left||''), right: String(p.right||'') })) : []
      }));
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    socket.emit('questionsLoaded', { questions: room.questions });
    socket.emit('toast', { text: `Loaded "${set.name}" (${room.questions.length} questions)`, tone: 'join' });
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
    room.state = 'powerSelect';
    room.questionIndex = -1;
    room.players.forEach((p) => {
      p.score = 0;
      p.streak = 0;
      p.power = null;
      p.powerCooldownUntil = 0;
      p.frozen = false;
    });
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
    room.players.forEach((p) => {
      p.score = 0;
      p.streak = 0;
      p.powerCooldownUntil = 0;
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
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.power || Date.now() < (player.powerCooldownUntil || 0)) return;
    player.powerCooldownUntil = Date.now() + POWER_COOLDOWN_MS;
    fn(room, player);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  };

  socket.on('usePower', ({ targetId, currentPairs }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.paused) return;
    const me = room.players.find((p) => p.id === socket.id);
    if (!me || !me.power || Date.now() < (me.powerCooldownUntil || 0)) return;

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
        if (!target) { actor.powerCooldownUntil = 0; return; }
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
        if (!target) { actor.powerCooldownUntil = 0; return; }
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
        if (!q) { actor.powerCooldownUntil = 0; return; }
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

app.get('/api/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/powers', (req, res) => res.json(POWERS));
app.get('/api/shapes', (req, res) => res.json(SHAPES));

app.get('/api/question-sets', (req, res) => {
  res.json(questionsStore.listSets());
});

app.post('/api/question-sets', (req, res) => {
  const { name, questions } = req.body || {};
  if (!name || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'name and non-empty questions array required' });
  }
  const entry = questionsStore.saveSet(name, questions);
  res.json({ id: entry.id, name: entry.name, createdAt: entry.createdAt, questionCount: entry.questionCount });
});


app.post('/api/purge-unused-images', (req, res) => {
  const result = purgeOrphanImages(rooms);
  res.json({ ok: true, ...result });
});

app.delete('/api/question-sets/:id', (req, res) => {
  const ok = questionsStore.deleteSet(req.params.id);
  if (ok) purgeOrphanImages(rooms);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  const startupPurge = purgeOrphanImages(rooms);
  if (startupPurge.deletedCount > 0) {
    console.log(`Startup orphan check: cleaned ${startupPurge.deletedCount} unused images (${startupPurge.mbFreed} MB freed)`);
  }
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

