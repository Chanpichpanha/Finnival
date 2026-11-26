import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { playChatPop, playEmojiSound } from '../utils/sound';
import { motion, AnimatePresence } from 'framer-motion';
import { resolveImageUrl, compressImage, preloadImages } from '../utils/imageUrl';

const serverUrl = process.env.REACT_APP_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:3001`;

function LobbyScreen({ socket, room, pin, playerId, setScreen }) {
 const [questions, setQuestions] = useState([]);
 const [newQuestion, setNewQuestion] = useState({ type: 'classic', text: '', options: ['', '', '', ''], correctAnswer: 0, correctAnswerText: '', min: 0, max: 100, correctNumber: 50, pairs: [{left: '', right: ''}, {left: '', right: ''}], timeLimit: 20, imageUrl: '' });
 const [editingIndex, setEditingIndex] = useState(null);
 const [isCustomTime, setIsCustomTime] = useState(false);
 const [customTimeInput, setCustomTimeInput] = useState('20');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [chatMessages, setChatMessages] = useState(room?.chatMessages || []);
  const [chatInput, setChatInput] = useState('');
  const [emojiCooldown, setEmojiCooldown] = useState(0);
  const [floatingEmojis, setFloatingEmojis] = useState([]);
  const chatBottomRef = useRef(null);
  const [serverLanIp, setServerLanIp] = useState(room?.lanIp || null);

  useEffect(() => {
    if (room?.lanIp) setServerLanIp(room.lanIp);
  }, [room?.lanIp]);

  useEffect(() => {
    fetch(`${serverUrl}/api/network-info`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.lanIp && d.lanIp !== 'localhost') {
          setServerLanIp(d.lanIp);
        }
      })
      .catch(() => {});
  }, [serverUrl]);


 const [savedSets, setSavedSets] = useState([]);
 const me = room?.players.find((p) => p.id === playerId);
 const isHost = room?.host?.id === playerId;



 
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      alert('Image file is too large! Maximum allowed size is 15MB.');
      return;
    }
    try {
      setUploadingImage(true);
      const processedFile = await compressImage(file);
      const formData = new FormData();
      formData.append('image', processedFile);
      const res = await fetch(`${serverUrl}/api/upload-image`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.imageUrl) {
        setNewQuestion(prev => ({ ...prev, imageUrl: data.imageUrl }));
        setImageError(false);
        preloadImages([{ imageUrl: data.imageUrl }]);
      } else if (data.error) {
        alert(`Upload error: ${data.error}`);
      }
    } catch (err) {
      console.error('Failed to upload image:', err);
      alert('Could not connect to image upload server.');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };


  useEffect(() => {
    if (room?.chatMessages && room.chatMessages.length > chatMessages.length) {
      setChatMessages(room.chatMessages);
    }
  }, [room?.chatMessages]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    const onLobbyChat = (msg) => {
      setChatMessages((prev) => [...prev.slice(-49), msg]);
      playChatPop();
    };

    const onLobbyReaction = (reaction) => {
      playEmojiSound(reaction.emoji);
      const randomX = 15 + Math.random() * 70;
      setFloatingEmojis((prev) => [
        ...prev.slice(-19),
        { id: reaction.id || `${Date.now()}-${Math.random()}`, emoji: reaction.emoji, x: randomX }
      ]);
    };

    socket.on('lobbyChat', onLobbyChat);
    socket.on('lobbyReaction', onLobbyReaction);

  

  return () => {
      socket.off('lobbyChat', onLobbyChat);
      socket.off('lobbyReaction', onLobbyReaction);
    };
  }, [socket]);

  useEffect(() => {
    if (emojiCooldown <= 0) return;
    const timer = setInterval(() => {
      setEmojiCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [emojiCooldown]);

  const handleSendChat = (e) => {
    e?.preventDefault();
    const trimmed = chatInput.trim().slice(0, 120);
    if (!trimmed) return;
    socket.emit('sendLobbyChat', { text: trimmed });
    setChatInput('');
  };

  const handleSendReaction = (emoji) => {
    if (emojiCooldown > 0) return;
    setEmojiCooldown(5);
    socket.emit('sendLobbyReaction', { emoji });
  };

  const refreshSets = () => {
 fetch(`${serverUrl}/api/question-sets`)
 .then((r) => r.json())
 .then(setSavedSets)
 .catch(() => {});
 };

 useEffect(() => {
 if (isHost) refreshSets();
 }, [isHost]);

 const syncQuestions = (list) => {
 setQuestions(list);
 socket.emit('setQuestions', { questions: list });
 };

 const addQuestion = () => {
 if (!newQuestion.text.trim()) return;
  if ((!newQuestion.type || newQuestion.type === 'classic') && newQuestion.options.some((o) => !o.trim())) return;
  if (newQuestion.type === 'match' && newQuestion.pairs.some((p) => !p.left.trim() || !p.right.trim())) return;

 const finalTimeLimit = isCustomTime 
   ? Math.max(5, Math.round(Number(customTimeInput)) || 20)
   : (Number(newQuestion.timeLimit) || 20);

 const qToSave = { ...newQuestion, timeLimit: finalTimeLimit, image: newQuestion.imageUrl || null, imageUrl: newQuestion.imageUrl || null };

 if (editingIndex !== null) {
 const updated = questions.map((q, i) => (i === editingIndex ? qToSave : q));
 syncQuestions(updated);
 setEditingIndex(null);
 } else {
 syncQuestions([...questions, qToSave]);
 }
 setNewQuestion({ type: 'classic', text: '', options: ['', '', '', ''], correctAnswer: 0, correctAnswerText: '', min: 0, max: 100, correctNumber: 50, pairs: [{left: '', right: ''}, {left: '', right: ''}], timeLimit: 20, imageUrl: '' });
 setIsCustomTime(false);
 setCustomTimeInput('20');
 };

 const editQuestion = (i) => {
 const q = questions[i];
 setNewQuestion({ ...q, imageUrl: q.imageUrl || q.image || '' });
  setImageError(false);
 setEditingIndex(i);
 const limit = Number(q.timeLimit) || 20;
 if ([10, 20, 30, 60].includes(limit)) {
   setIsCustomTime(false);
   setCustomTimeInput(String(limit));
 } else {
   setIsCustomTime(true);
   setCustomTimeInput(String(limit));
 }
 };

 const removeQuestion = (i) => {
 const updated = questions.filter((_, idx) => idx !== i);
 syncQuestions(updated);
 if (editingIndex === i) {
 setEditingIndex(null);
 setNewQuestion({ type: 'classic', text: '', options: ['', '', '', ''], correctAnswer: 0, correctAnswerText: '', min: 0, max: 100, correctNumber: 50, pairs: [{left: '', right: ''}, {left: '', right: ''}], timeLimit: 20, imageUrl: '' });
 setIsCustomTime(false);
 setCustomTimeInput('20');
 }
 };

 const cancelEdit = () => {
 setEditingIndex(null);
 setNewQuestion({ type: 'classic', text: '', options: ['', '', '', ''], correctAnswer: 0, correctAnswerText: '', min: 0, max: 100, correctNumber: 50, pairs: [{left: '', right: ''}, {left: '', right: ''}], timeLimit: 20, imageUrl: '' });
 setIsCustomTime(false);
 setCustomTimeInput('20');
 };

 const startGame = () => {
 socket.emit('startGame');
 };

 const [confirmAbandon, setConfirmAbandon] = useState(false);

 const kickPlayer = (targetId) => {
 socket.emit('kickPlayer', { playerId: targetId });
 };

 const handleAbandon = () => {
 if (!confirmAbandon) {
   setConfirmAbandon(true);
   setTimeout(() => setConfirmAbandon(false), 3500);
   return;
 }
 socket.emit('abandonLobby');
 sessionStorage.removeItem('finnival-pin');
 sessionStorage.removeItem('finnival-sessionToken');
 sessionStorage.removeItem('finnival-playerId');
 setScreen('home');
 };

 const handleLeave = () => {
 socket.emit('leaveRoom');
 sessionStorage.removeItem('finnival-pin');
 sessionStorage.removeItem('finnival-sessionToken');
 sessionStorage.removeItem('finnival-playerId');
 setScreen('home');
 };

 const [lockPending, setLockPending] = useState(false);
 const toggleLock = () => {
 if (lockPending) return;
 setLockPending(true);
 const newLocked = !room?.locked;
 socket.emit('setLocked', { locked: newLocked }, () => {
 setLockPending(false);
 });
 setTimeout(() => setLockPending(false), 1000);
 };

 const saveCurrentSet = () => {
 if (questions.length === 0) return;
 const name = window.prompt('Name this question set:');
 if (!name || !name.trim()) return;
 fetch(`${serverUrl}/api/question-sets`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ name: name.trim(), questions })
 })
 .then((r) => r.json())
 .then(() => refreshSets())
 .catch(() => {});
 };

 const loadSet = (setId) => {
 socket.emit('loadQuestionSet', { setId });
 };

 const deleteSet = (setId) => {
 if (!window.confirm('Delete this saved question set?')) return;
 fetch(`${serverUrl}/api/question-sets/${setId}`, { method: 'DELETE' })
 .then(() => refreshSets())
 .catch(() => {});
 };

 useEffect(() => {
 const handleQuestionsLoaded = ({ questions: loaded }) => {
 setQuestions(loaded);
 };
 socket.on('questionsLoaded', handleQuestionsLoaded);
 return () => socket.off('questionsLoaded', handleQuestionsLoaded);
 }, [socket]);

  const activeLanIp = serverLanIp || room?.lanIp;
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const joinHost = (isLocal && activeLanIp && activeLanIp !== 'localhost') ? activeLanIp : (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
  const joinPort = (typeof window !== 'undefined' && window.location.port) ? `:${window.location.port}` : '';
  const joinUrl = (typeof window !== 'undefined') ? `${window.location.protocol}//${joinHost}${joinPort}/?pin=${pin}` : `/?pin=${pin}`;

 return (
 <div>
      {/* Floating Emojis Animation Overlay */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998, overflow: "hidden" }}>
        <AnimatePresence>
          {floatingEmojis.map((f) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 1, y: "85vh", x: `${f.x}vw`, scale: 0.6 }}
              animate={{ opacity: [1, 1, 0], y: "15vh", scale: [0.6, 1.4, 1.1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.4, ease: "easeOut" }}
              onAnimationComplete={() => {
                setFloatingEmojis((prev) => prev.filter((item) => item.id !== f.id));
              }}
              style={{ position: "absolute", fontSize: "3rem", textShadow: "0 4px 12px rgba(0,0,0,0.35)" }}
            >
              {f.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
 <div className="lobby-header">
 <h1 style={{ fontSize: '2.5rem', color: 'var(--purple)' }}>{room?.gameName || 'FINNIVAL'}</h1>
 <p style={{ fontSize: '1.2rem', marginBottom: 8 }}>Share this code with your friends:</p>
 <div className="pin-display">{pin}</div>

        {isHost && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '14px auto', maxWidth: 320 }}>
            <div style={{ background: 'white', padding: 10, borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', display: 'inline-block' }}>
              <QRCodeSVG value={joinUrl} size={135} level="M" marginSize={2} bgColor="#ffffff" fgColor="#1e1835" />
            </div>
            <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>
              📷 Scan to auto-join directly
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 6 }}>
                {joinUrl}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: 6 }}
                onClick={() => {
                  navigator.clipboard?.writeText(joinUrl);
                  alert('Join link copied!');
                }}
              >
                📋 Copy
              </button>
            </div>
          </div>
        )}

 <p style={{ marginTop: 8 }}>{room?.players.length} player{room?.players.length !== 1 ? 's' : ''} in lobby</p>

 <AnimatePresence mode="wait">
 <motion.div
 key={room?.locked ? 'locked' : 'unlocked'}
 className={`lobby-status-banner ${room?.locked ? 'locked' : 'unlocked'}`}
 initial={{ opacity: 0, y: -8, scale: 0.96 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, y: -8, scale: 0.96 }}
 transition={{ duration: 0.25 }}
 >
 {room?.locked ? '🔒 Lobby Locked — No new players can join' : '🟢 Lobby Open — Anyone with the PIN can join'}
 </motion.div>
 </AnimatePresence>

 {isHost ? (
 <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
 <button
 className={room?.locked ? 'btn btn-danger' : 'btn btn-secondary'}
 onClick={toggleLock}
 style={{ fontSize: '0.9rem', padding: '8px 16px' }}
 >
 {room?.locked ? 'Click to Unlock' : '🔓 Lock Lobby'}
 </button>
 <button
 className={confirmAbandon ? 'btn btn-danger' : 'btn btn-secondary'}
 onClick={handleAbandon}
 style={{ fontSize: '0.9rem', padding: '8px 16px', background: confirmAbandon ? '#E5484D' : undefined }}
 >
 {confirmAbandon ? '⚠️ Confirm Abandon?' : '🚪 Abandon Lobby'}
 </button>
 </div>
 ) : (
 <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
 <button
 className="btn btn-secondary"
 onClick={handleLeave}
 style={{ fontSize: '0.9rem', padding: '8px 16px' }}
 >
 🚪 Leave Lobby
 </button>
 </div>
 )}
 </div>

 <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 20px' }}>
 <h2 style={{ color: 'white', marginBottom: 16 }}>Players</h2>
 <div className="player-list">
 <AnimatePresence>
 {room?.players.map((p, i) => (
 <motion.div
 key={p.id}
 className="player-card"
 layout
 initial={{ opacity: 0, y: 16, scale: 0.9 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, scale: 0.9 }}
 transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 22 }}
 >
 <div className="player-avatar">{p.avatar}</div>
 <div style={{ fontWeight: 700 }}>{p.name}</div>
 {p.isHost && <div style={{ fontSize: '0.8rem', color: 'var(--purple)' }}>👑 Host</div>}
 {!p.connected && <div style={{ fontSize: '0.8rem', color: 'var(--red)' }}>Disconnected</div>}
 {isHost && !p.isHost && (
 <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
 <button
 className="btn btn-danger"
 onClick={() => kickPlayer(p.id)}
 style={{ padding: '4px 14px', fontSize: '0.75rem', borderRadius: 8 }}
 >
 Kick
 </button>
 </div>
 )}
 </motion.div>
 ))}
 </AnimatePresence>
 </div>

      {/* Floating Reaction Bar (Visible to Host and Contestants) */}
      <div style={{ margin: "24px auto 14px", textAlign: "center" }}>
        <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.85)", marginBottom: 10, fontWeight: 700 }}>
          ⚡ Floating Reactions {emojiCooldown > 0 && <span style={{ color: "var(--amber)", marginLeft: 6 }}>({emojiCooldown}s cooldown)</span>}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {["🔥", "💀", "😭", "😂", "👑", "🪝"].map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleSendReaction(emoji)}
              disabled={emojiCooldown > 0}
              className="btn"
              style={{
                fontSize: "1.6rem",
                padding: "8px 16px",
                borderRadius: 14,
                background: emojiCooldown > 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.18)",
                border: "1px solid rgba(255,255,255,0.25)",
                cursor: emojiCooldown > 0 ? "not-allowed" : "pointer",
                opacity: emojiCooldown > 0 ? 0.45 : 1,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Lobby Chatbox (Visible to Host and Contestants) */}
      <div style={{ margin: "16px auto 24px" }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: "1.15rem", display: "flex", alignItems: "center", gap: 8 }}>
              💬 Lobby Chat <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 400 }}>({chatMessages.length} messages)</span>
            </h3>
          </div>
          <div
            style={{
              maxHeight: 180,
              minHeight: 90,
              overflowY: "auto",
              background: "rgba(0, 0, 0, 0.25)",
              borderRadius: 10,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 12
            }}
          >
            {chatMessages.length === 0 ? (
              <div style={{ color: "var(--muted)", fontStyle: "italic", textAlign: "center", margin: "auto" }}>
                Say hello to everyone in the lobby!
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div key={msg.id} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "0.9rem" }}>
                  <span style={{ fontSize: "1.1rem" }}>{msg.senderAvatar}</span>
                  <strong style={{ color: msg.isHost ? "var(--amber)" : "#fff" }}>
                    {msg.senderName}{msg.isHost ? " (Host)" : ""}:
                  </strong>
                  <span style={{ wordBreak: "break-word", color: "rgba(255,255,255,0.95)" }}>{msg.text}</span>
                </div>
              ))
            )}
            <div ref={chatBottomRef} />
          </div>
          <form onSubmit={handleSendChat} style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              className="input"
              placeholder="Type a message (max 120 chars)..."
              maxLength={120}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              style={{ flex: 1, margin: 0, padding: "8px 12px" }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: "8px 18px", fontSize: "0.9rem" }}>
              Send
            </button>
          </form>
        </div>
      </div>


 {isHost && (
 <div style={{ marginTop: 40 }}>
 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
    <h2 style={{ color: 'white', margin: 0 }}>Saved Question Sets</h2>
 </div>
 <div className="card" style={{ marginBottom: 24 }}>
 {savedSets.length === 0 ? (
 <p style={{ color: 'var(--muted)' }}>No saved sets yet. Add questions below, then save them for next time.</p>
 ) : (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
 {savedSets.map((s) => (
 <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '2px solid var(--dark)', borderRadius: 10 }}>
 <div>
 <div style={{ fontWeight: 700 }}>{s.name}</div>
 <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{s.questionCount} question{s.questionCount !== 1 ? 's' : ''}</div>
 </div>
 <div style={{ display: 'flex', gap: 8 }}>
 <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={() => loadSet(s.id)}>Load</button>
 <button className="btn btn-danger" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={() => deleteSet(s.id)}>Delete</button>
 </div>
 </div>
 ))}
 </div>
 )}
 <button
 className="btn btn-success"
 onClick={saveCurrentSet}
 disabled={questions.length === 0}
 style={{ width: '100%', marginTop: 16 }}
 >
 💾 Save Current Questions as Set
 </button>
 </div>

 
  <h2 style={{ color: 'white', marginBottom: 16 }}>Add Questions</h2>
  <div className="card" style={{ marginBottom: 24 }}>
  <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Question Type:</label>
  <select
    className="input"
    value={newQuestion.type || 'classic'}
    onChange={(e) => setNewQuestion({ ...newQuestion, type: e.target.value })}
    style={{ width: '100%', marginBottom: 12 }}
  >
    <option value="classic">Classic (Dynamic Options)</option>
    <option value="short_answer">Short Answer (Fuzzy Text)</option>
    <option value="slider">Proximity Slider (Number)</option>
    <option value="match">Drag & Drop Match (Pairs)</option>
  </select>

  <input
    className="input"
    placeholder="Question text"
    value={newQuestion.text}
    onChange={(e) => setNewQuestion({ ...newQuestion, text: e.target.value })}
    style={{ width: '100%', marginBottom: 12 }}
  />

  {(!newQuestion.type || newQuestion.type === 'classic') && (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label style={{ fontWeight: 700 }}>Options:</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => setNewQuestion({...newQuestion, options: [...newQuestion.options, '']})}>+ Add</button>
          <button className="btn btn-danger" style={{ padding: '4px 10px' }} disabled={newQuestion.options.length <= 2} onClick={() => setNewQuestion({...newQuestion, options: newQuestion.options.slice(0, -1)})}>- Remove</button>
        </div>
      </div>
      {newQuestion.options.map((opt, i) => (
        <input
          key={i}
          className="input"
          placeholder={`Option ${String.fromCharCode(65 + i)}`}
          value={opt}
          onChange={(e) => {
            const opts = [...newQuestion.options];
            opts[i] = e.target.value;
            setNewQuestion({ ...newQuestion, options: opts });
          }}
          style={{ width: '100%', marginBottom: 8 }}
        />
      ))}
      <label style={{ display: 'block', marginTop: 12, marginBottom: 8, fontWeight: 700 }}>Correct answer:</label>
      <select
        className="input"
        value={newQuestion.correctAnswer}
        onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswer: Number(e.target.value) })}
        style={{ width: '100%', marginBottom: 12 }}
      >
        {newQuestion.options.map((_, i) => (
          <option key={i} value={i}>Option {String.fromCharCode(65 + i)}</option>
        ))}
      </select>
    </>
  )}

  {newQuestion.type === 'short_answer' && (
    <>
      <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Correct Answer (Text):</label>
      <input
        className="input"
        placeholder="e.g. Paris"
        value={newQuestion.correctAnswerText || ''}
        onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswerText: e.target.value })}
        style={{ width: '100%', marginBottom: 12 }}
      />
    </>
  )}

  {newQuestion.type === 'slider' && (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Min Value:</label>
          <input type="number" className="input" value={newQuestion.min ?? 0} onChange={(e) => setNewQuestion({...newQuestion, min: Number(e.target.value)})} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Max Value:</label>
          <input type="number" className="input" value={newQuestion.max ?? 100} onChange={(e) => setNewQuestion({...newQuestion, max: Number(e.target.value)})} style={{ width: '100%' }} />
        </div>
      </div>
      <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Exact Target Number:</label>
      <input type="number" className="input" value={newQuestion.correctNumber ?? 50} onChange={(e) => setNewQuestion({...newQuestion, correctNumber: Number(e.target.value)})} style={{ width: '100%', marginBottom: 12 }} />
    </>
  )}

  {newQuestion.type === 'match' && (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <label style={{ fontWeight: 700 }}>Matching Pairs (Players will draw lines between them):</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => setNewQuestion({...newQuestion, pairs: [...(newQuestion.pairs || []), {left: '', right: ''}]})}>+ Add Pair</button>
            <button className="btn btn-danger" style={{ padding: '4px 10px' }} disabled={(newQuestion.pairs?.length || 0) <= 2} onClick={() => setNewQuestion({...newQuestion, pairs: newQuestion.pairs.slice(0, -1)})}>- Remove</button>
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {(newQuestion.pairs || []).map((p, i) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', background: 'var(--cream)', padding: 12, borderRadius: 8, border: '2px dashed var(--plum)' }}>
                <span style={{ fontWeight: 'bold', width: 30 }}>#{i+1}</span>
                <input className="input" placeholder="Left Side Item" value={p.left} onChange={(e) => { const np = [...newQuestion.pairs]; np[i].left = e.target.value; setNewQuestion({...newQuestion, pairs: np}); }} style={{ flex: '1 1 120px', minWidth: '120px', margin: 0 }} />
                <span style={{ fontSize: '1.5rem' }}>➔</span>
                <input className="input" placeholder="Right Side Match" value={p.right} onChange={(e) => { const np = [...newQuestion.pairs]; np[i].right = e.target.value; setNewQuestion({...newQuestion, pairs: np}); }} style={{ flex: '1 1 120px', minWidth: '120px', margin: 0 }} />
            </div>
            ))}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 12 }}>
           *The left side items will be locked in place. The right side items will be randomly shuffled for the players.
        </p>
      </>
    )}}

  {/* Optional Question Image */}
  <div style={{ marginTop: 14, marginBottom: 14, padding: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 10, border: '1px dashed var(--indigo-light)' }}>
    <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.95rem' }}>
      📷 Question Image (Optional):
    </label>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        className="input"
        placeholder="Paste image URL (https://...)"
        value={newQuestion.imageUrl || ''}
        onChange={(e) => {
          setNewQuestion({ ...newQuestion, imageUrl: e.target.value });
          setImageError(false);
        }}
        style={{ flex: '1 1 200px', margin: 0 }}
      />
      <label className="btn btn-secondary" style={{ cursor: uploadingImage ? 'wait' : 'pointer', margin: 0, padding: '8px 14px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
        {uploadingImage ? '⏳ Uploading...' : '📁 Upload Image'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: 'none' }}
          disabled={uploadingImage}
          onChange={handleImageUpload}
        />
      </label>
      {newQuestion.imageUrl && (
        <button
          type="button"
          className="btn btn-danger"
          style={{ padding: '8px 12px', margin: 0, fontSize: '0.85rem' }}
          onClick={() => {
            setNewQuestion({ ...newQuestion, imageUrl: '' });
            setImageError(false);
          }}
          title="Remove Image"
        >
          ✕ Clear
        </button>
      )}
    </div>

    {/* Live Thumbnail Preview */}
    {newQuestion.imageUrl && (
      <div style={{ marginTop: 10, position: 'relative', display: 'inline-block' }}>
        <img
          src={resolveImageUrl(newQuestion.imageUrl)}
          alt="Preview"
          onError={() => setImageError(true)}
          onLoad={() => setImageError(false)}
          style={{ maxHeight: 110, maxWidth: '100%', borderRadius: 8, border: '2px solid var(--indigo-deep)', objectFit: 'contain', display: imageError ? 'none' : 'block' }}
        />
        {imageError && (
          <div style={{ color: 'var(--red)', fontSize: '0.85rem', marginTop: 4 }}>
            ⚠️ Failed to load image from URL
          </div>
        )}
      </div>
    )}
  </div>

  <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Time limit:</label>
 <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
 <select
 className="input"
 value={isCustomTime ? 'custom' : newQuestion.timeLimit}
 onChange={(e) => {
   if (e.target.value === 'custom') {
     setIsCustomTime(true);
     setCustomTimeInput(String(newQuestion.timeLimit || 20));
   } else {
     setIsCustomTime(false);
     setNewQuestion({ ...newQuestion, timeLimit: Number(e.target.value) });
   }
 }}
 style={{ flex: 1 }}
 >
 {[10, 20, 30, 60].map((t) => (
 <option key={t} value={t}>{t} seconds</option>
 ))}
 <option value="custom">Custom...</option>
 </select>
 {isCustomTime && (
   <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
     <input
       type="number"
       min="5"
       className="input"
       placeholder="Seconds (min 5)"
       value={customTimeInput}
       onChange={(e) => setCustomTimeInput(e.target.value)}
       onBlur={() => {
         const clamped = Math.max(5, Math.round(Number(customTimeInput)) || 20);
         setCustomTimeInput(String(clamped));
         setNewQuestion({ ...newQuestion, timeLimit: clamped });
       }}
       style={{ width: '100%' }}
     />
     <span style={{ fontSize: '0.85rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
       sec {Number(customTimeInput) >= 60 ? `(~${(Number(customTimeInput) / 60).toFixed(1)}m)` : ''}
     </span>
   </div>
 )}
 </div>
 <div style={{ display: 'flex', gap: 12 }}>
 <button className="btn btn-primary" onClick={addQuestion} style={{ flex: 1 }}>
 {editingIndex !== null ? 'Save Changes' : 'Add Question'}
 </button>
 {editingIndex !== null && (
 <button className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>
 )}
 </div>
 </div>

 <div style={{ marginBottom: 24 }}>
 <h3 style={{ color: 'white', marginBottom: 12 }}>{questions.length} question{questions.length !== 1 ? 's' : ''} added</h3>
 <AnimatePresence>
 {questions.map((q, i) => (
 <motion.div
 key={i}
 className="card"
 layout
 initial={{ opacity: 0, x: -16 }}
 animate={{ opacity: 1, x: 0 }}
 exit={{ opacity: 0, x: -16 }}
 transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 24 }}
 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: 16 }}
 >
 <div style={{ overflow: 'hidden' }}>
 <div style={{ fontWeight: 700 }}>{i + 1}. {q.text}</div>
 <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
 Type: {q.type || 'classic'} · {q.timeLimit}s
 </div>
 </div>
 <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 12 }}>
 <button className="btn btn-secondary" onClick={() => editQuestion(i)}>✏️</button>
 <button className="btn btn-danger" onClick={() => removeQuestion(i)}>🗑️</button>
 </div>
 </motion.div>
 ))}
 </AnimatePresence>
 </div>

 <button
 className="btn btn-success"
 onClick={startGame}
 disabled={questions.length === 0}
 style={{ width: '100%', fontSize: '1.3rem', padding: '16px' }}
 >
 🚀 Start Game
 </button>
 </div>
 )}

 {!isHost && (
 <div style={{ marginTop: 40, textAlign: 'center' }}>
 <p style={{ color: 'white', fontSize: '1.2rem' }}>Waiting for the host to start the game...</p>
 </div>
 )}
 </div>
 </div>
 );
}

export default LobbyScreen;

