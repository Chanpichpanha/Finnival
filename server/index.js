const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const questionsStore = require('./questions-store');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = new Map();

const POWERS = {
  blind: { id: 'blind', name: 'Blackout', icon: '🌑', desc: 'Blind every other player for 10 seconds.' },
  steal: { id: 'steal', name: 'Heist', icon: '🪝', desc: 'Steal 50% of a rival\'s round points at the end of the round.' },
  hint: { id: 'hint', name: 'Oracle', icon: '🔮', desc: 'Eliminate two wrong answers this round.' },
  freeze: { id: 'freeze', name: 'Deep Freeze', icon: '❄️', desc: 'Lock one rival out for 10 seconds.' },
  scramble: { id: 'scramble', name: 'Scramble', icon: '🌀', desc: 'Shuffle answer colors for everyone else.' }
};

const SHAPES = ['triangle', 'diamond', 'circle', 'square'];

const POWER_SELECT_DURATION_MS = 3600000;
const FREEZE_DURATION_MS = 10000;
const POWER_COOLDOWN_MS = 120000;

function generatePin() {
  let pin;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(pin));
  return pin;
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
    locked: !!room.locked,
    powerSelectStartedAt: room.powerSelectStartedAt || null,
    powerSelectDurationMs: POWER_SELECT_DURATION_MS
  };
}

function sanitizeQuestion(q) {
  return {
    type: q.type,
    text: q.text,
    options: q.options,
    timeLimit: q.timeLimit,
    image: q.image || null,
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
      timer: null
    };

    room.host = {
      id: socket.id,
      name: 'Host',
      avatar: '🎙️'
    };
    room.banned = new Set();

    rooms.set(pin, room);
    socket.data.pin = pin;
    socket.join(pin);

    if (cb) cb({ ok: true, pin, snapshot: roomSnapshot(room) });
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

    const player = {
      id: socket.id,
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

    if (cb) cb({ ok: true, pin: room.pin, snapshot: roomSnapshot(room) });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).emit('toast', { text: `${player.avatar} ${player.name} joined`, tone: 'join' });
  });

  socket.on('rejoinRoom', ({ pin, playerId }, cb) => {
    const room = rooms.get(String(pin || '').trim());
    if (!room) return cb && cb({ ok: false, message: 'Game no longer exists.' });

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return cb && cb({ ok: false, message: 'You are no longer in this game.' });

    const oldId = player.id;
    player.id = socket.id;
    player.connected = true;
    if (room.hostId === oldId) {
      room.hostId = socket.id;
      if (room.host) room.host.id = socket.id;
      clearTimeout(room.hostGraceTimer);
    }
    if (room.answers instanceof Map && room.answers.has(oldId)) {
      const answer = room.answers.get(oldId);
      room.answers.delete(oldId);
      room.answers.set(socket.id, answer);
    }

    socket.data.pin = room.pin;
    socket.join(room.pin);

    if (cb) cb({ ok: true, snapshot: roomSnapshot(room) });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  
    setTimeout(() => {
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
  });

  socket.on('kickPlayer', ({ playerId }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;

    const target = room.players.find((p) => p.id === playerId);
    if (!target || target.isHost) return;

    room.players = room.players.filter((p) => p.id !== playerId);
    io.to(playerId).emit('kicked');
    io.sockets.sockets.get(playerId)?.leave(room.pin);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).emit('toast', { text: `${target.name} was removed`, tone: 'warn' });
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

  socket.on('setQuestions', ({ questions }) => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;

    room.questions = (questions || []).map((q) => ({
        type: q.type || 'classic',
        text: String(q.text || '').slice(0, 200),
        options: (q.options || []).map((o) => String(o).slice(0, 80)),
        correctAnswer: Number(q.correctAnswer) || 0,
        timeLimit: Number(q.timeLimit) || 20,
        image: q.image || null,
        correctAnswerText: q.correctAnswerText || '',
        min: Number(q.min) || 0,
        max: Number(q.max) || 100,
        correctNumber: Number(q.correctNumber) || 50,
        pairs: Array.isArray(q.pairs) ? q.pairs.map(p => ({ left: String(p.left||''), right: String(p.right||'') })) : []
      }));
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  
    setTimeout(() => {
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
        timeLimit: Number(q.timeLimit) || 20,
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
    room.questionIndex += 1;
    if (room.questionIndex >= room.questions.length) return endGame(room);

    room.answers = new Map();
    room.players.forEach((p) => { p.frozen = false; });
    room.state = 'question';

    const q = room.questions[room.questionIndex];
    room.paused = false;
    room.pausedRemainingMs = 0;
    room.endsAt = Date.now() + q.timeLimit * 1000;
    const payloadPlayer = {
      question: sanitizeQuestion(q),
      index: room.questionIndex,
      total: room.questions.length,
      startedAt: Date.now(),
      endsAt: room.endsAt
    };
    const payloadHost = { ...payloadPlayer, question: q };
    room.players.forEach(p => p.heistTarget = null);

    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
    io.to(room.pin).except(room.hostId).emit('questionStart', payloadPlayer);
    io.to(room.hostId).emit('questionStart', payloadHost);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));

    clearTimeout(room.timer);
    room.timer = setTimeout(() => revealAnswer(room), q.timeLimit * 1000 + 250);
  }

  function revealAnswer(room) {
    if (room.state !== 'question') return;
    const q = room.questions[room.questionIndex];
    room.state = 'reveal';

    const distribution = q.options.map((_, i) => {
      let count = 0;
      room.answers.forEach((a) => { if (a.answerIndex === i) count += 1; });
      return count;
    });

    // === HEIST SETTLEMENT: steal 50% of rival's round points ===
    const activePlayers = room.players.filter((p) => !p.isHost);
    activePlayers.forEach(heister => {
      if (!heister.heistTarget) return;
      const target = room.players.find(p => p.id === heister.heistTarget);
      heister.heistTarget = null; // clear regardless
      if (!target) return;
      const targetAnswer = room.answers.get(target.id);
      // Only steal if target answered correctly and earned points
      if (targetAnswer && targetAnswer.points > 0) {
        const stolen = Math.floor(targetAnswer.points * 0.5);
        target.score -= stolen;
        heister.score += stolen;
        targetAnswer.points -= stolen; // update the recorded points
        io.to(room.pin).emit('toast', { text: `🪝 ${heister.name} stole ${stolen} points from ${target.name}!`, tone: 'power' });
      } else {
        io.to(heister.id).emit('toast', { text: `🪝 ${target.name} got nothing right — nothing to steal!`, tone: 'warn' });
      }
    });

    const scorer = [...room.players].filter((p) => !p.isHost).sort((a, b) => b.score - a.score);
    io.to(room.pin).emit('answerReveal', {
        correctAnswer: q.correctAnswer,
        correctAnswerText: q.correctAnswerText,
        correctNumber: q.correctNumber,
        pairs: q.pairs,
        distribution,
        leaderboard: scorer.map((p, i) => ({ rank: i + 1, ...publicPlayer(p) })),
        lastRound: room.lastRound || null
      });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  
    setTimeout(() => {
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
    if (!room || room.state !== 'question') return;

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
        if (accuracy > 0.5) isCorrect = true;
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
    io.to(room.pin).emit('answerCount', { answered: room.answers.size, total: activePlayers.length });

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

  socket.on('endGameEarly', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    endGame(room);
  });

  function endGame(room) {
    room.state = 'results';
    clearTimeout(room.timer);
    const ranked = [...room.players].filter((p) => !p.isHost).sort((a, b) => b.score - a.score);
    io.to(room.pin).emit('gameOver', {
      podium: ranked.slice(0, 3).map((p, i) => ({ rank: i + 1, ...publicPlayer(p) })),
      all: ranked.map((p, i) => ({ rank: i + 1, ...publicPlayer(p) }))
    });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  
    setTimeout(() => {
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

  socket.on('playAgain', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    room.state = 'lobby';
    room.questionIndex = -1;
    room.answers = new Map();
    room.players.forEach((p) => {
      p.score = 0;
      p.streak = 0;
      p.powerCooldownUntil = 0;
      p.frozen = false;
    });
    io.to(room.pin).emit('backToLobby');
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  
    setTimeout(() => {
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
  });

  socket.on('hostSkipQuestion', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'question' && room.state !== 'reveal') return;
    clearTimeout(room.timer);
    room.state = 'reveal';
    const q = room.questions[room.questionIndex];
    if (!q) return;
    const distribution = q.options.map((_, i) => {
      let count = 0;
      room.answers.forEach((a) => { if (a.answerIndex === i) count += 1; });
      return count;
    });
    const scorer = [...room.players].filter((p) => !p.isHost).sort((a, b) => b.score - a.score);
    io.to(room.pin).emit('toast', { text: 'Host skipped the question', tone: 'warn' });
    io.to(room.pin).emit('answerReveal', {
        correctAnswer: q.correctAnswer,
        correctAnswerText: q.correctAnswerText,
        correctNumber: q.correctNumber,
        pairs: q.pairs,
        distribution,
        leaderboard: scorer.map((p, i) => ({ rank: i + 1, ...publicPlayer(p) })),
        lastRound: room.lastRound || null,
        skipped: true
      });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  
    setTimeout(() => {
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
  });

  socket.on('hostTogglePause', () => {
    const room = rooms.get(socket.data.pin);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'question') return;
    const q = room.questions[room.questionIndex];
    if (!q) return;

    if (room.paused) {
      const remaining = room.pausedRemainingMs || 0;
      room.paused = false;
      room.endsAt = Date.now() + remaining;
      clearTimeout(room.timer);
      room.timer = setTimeout(() => revealAnswer(room), remaining + 250);
      io.to(room.pin).emit('timerResumed', { endsAt: room.endsAt });
      io.to(room.pin).emit('toast', { text: 'Timer resumed', tone: 'join' });
    } else {
      room.paused = true;
      room.pausedRemainingMs = Math.max(0, (room.endsAt || Date.now()) - Date.now());
      clearTimeout(room.timer);
      io.to(room.pin).emit('timerPaused', { remainingMs: room.pausedRemainingMs });
      io.to(room.pin).emit('toast', { text: 'Timer paused by host', tone: 'warn' });
    }
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  
    setTimeout(() => {
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
  });

  const consumePower = (fn) => {
    const room = rooms.get(socket.data.pin);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.power || Date.now() < (player.powerCooldownUntil || 0)) return;
    player.powerCooldownUntil = Date.now() + POWER_COOLDOWN_MS;
    fn(room, player);
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
  
    setTimeout(() => {
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
  };

  socket.on('usePower', ({ targetId }) => {
    const room = rooms.get(socket.data.pin);
    if (!room) return;
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
      });
      return;
    }

    if (power === 'steal') {
      consumePower((rm, actor) => {
        const target = rm.players.find((p) => p.id === targetId && p.id !== actor.id);
        if (!target) { actor.powerCooldownUntil = 0; return; }
        // Mark the heist target — steal happens at round end in revealAnswer
        actor.heistTarget = target.id;
        io.to(rm.pin).emit('toast', {
          text: `🪝 ${actor.name} set a heist on ${target.name}!`,
          tone: 'power'
        });
        io.to(actor.id).emit('powerEffect', { type: 'steal', from: actor.name, target: target.name, amount: 0 });
      });
      return;
    }

    if (power === 'scramble') {
      consumePower((rm, actor) => {
        rm.players.forEach((p) => {
          if (p.id === actor.id) return;
          io.to(p.id).emit('powerEffect', { type: 'scramble', duration: 15000, from: actor.name });
        });
        io.to(rm.pin).emit('toast', { text: `🌀 ${actor.name} scrambled the answers!`, tone: 'power' });
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
        const wrong = q.options
          .map((_, i) => i)
          .filter((i) => i !== q.correctAnswer);
        for (let i = wrong.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
        }
        const eliminate = wrong.slice(0, Math.min(2, wrong.length));
        io.to(actor.id).emit('powerEffect', { type: 'hint', eliminate });
        io.to(rm.pin).emit('toast', { text: `🔮 ${actor.name} consulted the Oracle`, tone: 'power' });
      });
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.pin);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    if (room.state === 'lobby') {
      room.players = room.players.filter((p) => p.id !== socket.id);
      if (player.isHost) {
        io.to(room.pin).emit('hostLeft');
        rooms.delete(room.pin);
        return;
      }
      io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
      io.to(room.pin).emit('toast', { text: `${player.name} left`, tone: 'warn' });
    } else {
      player.connected = false;
      io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
      io.to(room.pin).emit('toast', { text: `${player.name} disconnected`, tone: 'warn' });

      if (player.isHost) {
        clearTimeout(room.hostGraceTimer);
        room.hostGraceTimer = setTimeout(() => {
          const current = rooms.get(room.pin);
          if (current && !current.players.find((p) => p.isHost)?.connected) {
            io.to(room.pin).emit('hostLeft');
            clearTimeout(current.timer);
            rooms.delete(room.pin);
          }
        }, 30000);
      }
    }
  });
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

app.delete('/api/question-sets/:id', (req, res) => {
  const ok = questionsStore.deleteSet(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
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

