with open('server/index.js', 'r') as f:
    content = f.read()

# 1. Fix answerCount total to exclude host
old_count = """    io.to(room.pin).emit('answerCount', { answered: room.answers.size, total: room.players.length });

    const everyone = room.players.every((p) => room.answers.has(p.id) || p.frozen);"""
new_count = """    const activePlayers = room.players.filter((p) => !p.isHost);
    io.to(room.pin).emit('answerCount', { answered: room.answers.size, total: activePlayers.length });

    const everyone = activePlayers.length > 0 && activePlayers.every((p) => room.answers.has(p.id) || p.frozen);"""
content = content.replace(old_count, new_count)

# 2. Add host control handlers (skip question, pause/resume) before the usePower handler
old_power_anchor = """  const consumePower = (fn) => {"""
new_power_anchor = """  socket.on('hostSkipQuestion', () => {
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
      distribution,
      leaderboard: scorer.map((p, i) => ({ rank: i + 1, ...publicPlayer(p) })),
      lastRound: room.lastRound || null,
      skipped: true
    });
    io.to(room.pin).emit('roomUpdate', roomSnapshot(room));
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
  });

  const consumePower = (fn) => {"""
content = content.replace(old_power_anchor, new_power_anchor)

# 3. Emit endsAt/paused in questionStart payload so client can sync
old_payload = """    const payload = {
      question: sanitizeQuestion(q),
      index: room.questionIndex,
      total: room.questions.length,
      startedAt: Date.now(),
      endsAt: Date.now() + q.timeLimit * 1000
    };"""
new_payload = """    room.paused = false;
    room.pausedRemainingMs = 0;
    room.endsAt = Date.now() + q.timeLimit * 1000;
    const payload = {
      question: sanitizeQuestion(q),
      index: room.questionIndex,
      total: room.questions.length,
      startedAt: Date.now(),
      endsAt: room.endsAt
    };"""
content = content.replace(old_payload, new_payload)

# 4. Include paused state in roomSnapshot
old_snapshot = """    questionIndex: room.questionIndex,
    totalQuestions: room.questions.length
  };"""
new_snapshot = """    questionIndex: room.questionIndex,
    totalQuestions: room.questions.length,
    paused: !!room.paused,
    locked: !!room.locked
  };"""
content = content.replace(old_snapshot, new_snapshot)

with open('server/index.js', 'w') as f:
    f.write(content)
print("OK: host controls + host-exclusion fixes applied")