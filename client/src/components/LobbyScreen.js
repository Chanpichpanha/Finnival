import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function LobbyScreen({ socket, room, pin, playerId, setScreen }) {
 const [questions, setQuestions] = useState([]);
 const [newQuestion, setNewQuestion] = useState({ type: 'classic', text: '', options: ['', '', '', ''], correctAnswer: 0, correctAnswerText: '', min: 0, max: 100, correctNumber: 50, pairs: [{left: '', right: ''}, {left: '', right: ''}], timeLimit: 20 });
 const [editingIndex, setEditingIndex] = useState(null);
 const [savedSets, setSavedSets] = useState([]);
 const me = room?.players.find((p) => p.id === playerId);
 const isHost = room?.host?.id === playerId;

 const serverUrl = process.env.REACT_APP_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:3001`;

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

 if (editingIndex !== null) {
 const updated = questions.map((q, i) => (i === editingIndex ? { ...newQuestion } : q));
 syncQuestions(updated);
 setEditingIndex(null);
 } else {
 syncQuestions([...questions, { ...newQuestion }]);
 }
 setNewQuestion({ type: 'classic', text: '', options: ['', '', '', ''], correctAnswer: 0, correctAnswerText: '', min: 0, max: 100, correctNumber: 50, pairs: [{left: '', right: ''}, {left: '', right: ''}], timeLimit: 20 });
 };

 const editQuestion = (i) => {
 setNewQuestion({ ...questions[i] });
 setEditingIndex(i);
 };

 const removeQuestion = (i) => {
 const updated = questions.filter((_, idx) => idx !== i);
 syncQuestions(updated);
 if (editingIndex === i) {
 setEditingIndex(null);
 setNewQuestion({ type: 'classic', text: '', options: ['', '', '', ''], correctAnswer: 0, correctAnswerText: '', min: 0, max: 100, correctNumber: 50, pairs: [{left: '', right: ''}, {left: '', right: ''}], timeLimit: 20 });
 }
 };

 const cancelEdit = () => {
 setEditingIndex(null);
 setNewQuestion({ type: 'classic', text: '', options: ['', '', '', ''], correctAnswer: 0, correctAnswerText: '', min: 0, max: 100, correctNumber: 50, pairs: [{left: '', right: ''}, {left: '', right: ''}], timeLimit: 20 });
 };

 const startGame = () => {
 socket.emit('startGame');
 };

 const kickPlayer = (targetId) => {
 socket.emit('kickPlayer', { playerId: targetId });
 };

 const banPlayer = (targetId) => {
 socket.emit('banPlayer', { playerId: targetId });
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

 return (
 <div>
 <div className="lobby-header">
 <h1 style={{ fontSize: '2.5rem', color: 'var(--purple)' }}>{room?.gameName || 'FINNIVAL'}</h1>
 <p style={{ fontSize: '1.2rem', marginBottom: 8 }}>Share this code with your friends:</p>
 <div className="pin-display">{pin}</div>
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

 {isHost && (
 <button
 className={room?.locked ? 'btn btn-danger' : 'btn btn-secondary'}
 onClick={toggleLock}
 style={{ marginTop: 12, fontSize: '0.9rem', padding: '8px 16px' }}
 >
 {room?.locked ? 'Click to Unlock' : '🔓 Lock Lobby'}
 </button>
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
 <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
 <button
 className="btn btn-secondary"
 onClick={() => kickPlayer(p.id)}
 style={{ padding: '4px 10px', fontSize: '0.75rem' }}
 >
 Kick
 </button>
 <button
 className="btn btn-danger"
 onClick={() => banPlayer(p.id)}
 style={{ padding: '4px 10px', fontSize: '0.75rem' }}
 >
 Ban
 </button>
 </div>
 )}
 </motion.div>
 ))}
 </AnimatePresence>
 </div>

 {isHost && (
 <div style={{ marginTop: 40 }}>
 <h2 style={{ color: 'white', marginBottom: 16 }}>Saved Question Sets</h2>
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

  <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Time limit:</label>
 <select
 className="input"
 value={newQuestion.timeLimit}
 onChange={(e) => setNewQuestion({ ...newQuestion, timeLimit: Number(e.target.value) })}
 style={{ width: '100%', marginBottom: 12 }}
 >
 {[10, 20, 30, 60].map((t) => (
 <option key={t} value={t}>{t} seconds</option>
 ))}
 </select>
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

