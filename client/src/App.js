import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { AnimatePresence, motion } from 'framer-motion';
import LobbyScreen from './components/LobbyScreen';
import PowerSelectScreen from './components/PowerSelectScreen';
import GameScreen from './components/GameScreen';
import LeaderboardScreen from './components/LeaderboardScreen';
import ResultsScreen from './components/ResultsScreen';
import Toast from './components/Toast';
import './App.css';

const SERVER_PORT = 3001;
const serverUrl = process.env.REACT_APP_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:${SERVER_PORT}`;
const socket = io(serverUrl);

const screenVariants = {
  initial: { opacity: 0, scale: 0.96, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: -12 }
};

const screenTransition = { type: 'spring', stiffness: 260, damping: 26, mass: 0.9 };

function App() {
  const [screen, setScreen] = useState('home');
  const [pin, setPin] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [room, setRoom] = useState(null);
  const [toast, setToast] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [answerCount, setAnswerCount] = useState(null);
  const [connectionLost, setConnectionLost] = useState(false);

  useEffect(() => {
    socket.on('connect', () => {
      setConnectionLost(false);
      const savedPin = sessionStorage.getItem('finnival-pin');
      const savedPlayerId = sessionStorage.getItem('finnival-playerId');

      if (savedPin && savedPlayerId) {
        socket.emit('rejoinRoom', { pin: savedPin, playerId: savedPlayerId }, (res) => {
          if (res.ok) {
            setPin(savedPin);
            setPlayerId(socket.id);
            setRoom(res.snapshot);
            const stateToScreen = { lobby: 'lobby', powerSelect: 'powerSelect', leaderboard: 'leaderboard', results: 'results' };
            setScreen(stateToScreen[res.snapshot.state] || 'game');
              if (res.snapshot.state === 'question' || res.snapshot.state === 'reveal') {
                const qIndex = res.snapshot.questionIndex;
                setGameState({
                  index: qIndex,
                  question: res.snapshot.questions[qIndex],
                  total: res.snapshot.totalQuestions,
                  startedAt: res.snapshot.startedAt || Date.now(),
                  endsAt: res.snapshot.endsAt,
                  isReveal: res.snapshot.state === 'reveal',
                  correctAnswer: res.snapshot.state === 'reveal' ? res.snapshot.questions[qIndex]?.correctAnswer : undefined
                });
              }
          } else {
            sessionStorage.removeItem('finnival-pin');
            sessionStorage.removeItem('finnival-playerId');
            setPlayerId(socket.id);
          }
        });
      } else {
        setPlayerId(socket.id);
      }
    });

    socket.on('roomUpdate', (snapshot) => {
      setRoom(snapshot);
    });

    socket.on('toast', (msg) => {
      setToast(msg);
      setTimeout(() => setToast(null), 3000);
    });

    socket.on('gameStarted', () => {
      setScreen('powerSelect');
    });

    socket.on('questionStart', (data) => {
      setGameState(data);
      setAnswerCount(null);
      setScreen('game');
    });

    socket.on('answerCount', (data) => {
      setAnswerCount(data);
    });

    socket.on('timerPaused', () => {
      setGameState((prev) => (prev ? { ...prev, pausedAt: Date.now() } : prev));
    });

    socket.on('timerResumed', (data) => {
      setGameState((prev) => (prev ? { ...prev, endsAt: data.endsAt, pausedAt: null } : prev));
    });

    socket.on('answerReveal', (data) => {
      setGameState((prev) => ({ ...prev, ...data, isReveal: true }));
    });

    socket.on('leaderboardUpdate', (data) => {
      setGameState((prev) => ({ ...prev, ...data, isReveal: false }));
      setScreen('leaderboard');
    });

    socket.on('gameOver', (data) => {
      setGameState(data);
      setScreen('results');
    });

    socket.on('backToLobby', () => {
      setScreen('lobby');
      setGameState(null);
    });

    socket.on('hostLeft', () => {
      sessionStorage.removeItem('finnival-pin');
      sessionStorage.removeItem('finnival-playerId');
      alert('The host has left. The game is ending.');
      setScreen('home');
    });

    socket.on('kicked', () => {
      sessionStorage.removeItem('finnival-pin');
      sessionStorage.removeItem('finnival-playerId');
      alert('You have been removed from the game.');
      setScreen('home');
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') setConnectionLost(true);
    });

    socket.on('connect_error', () => {
      setConnectionLost(true);
    });

    return () => {
      socket.off('connect');
      socket.off('roomUpdate');
      socket.off('toast');
      socket.off('gameStarted');
      socket.off('questionStart');
      socket.off('answerCount');
      socket.off('timerPaused');
      socket.off('timerResumed');
      socket.off('answerReveal');
      socket.off('leaderboardUpdate');
      socket.off('gameOver');
      socket.off('backToLobby');
      socket.off('hostLeft');
      socket.off('kicked');
      socket.off('disconnect');
      socket.off('connect_error');
    };
  }, []);

  const renderScreen = () => {
    switch (screen) {
      case 'home':
        return <HomeScreen socket={socket} setScreen={setScreen} setPin={setPin} setPlayerId={setPlayerId} />;
      case 'lobby':
        return <LobbyScreen socket={socket} room={room} pin={pin} playerId={playerId} setScreen={setScreen} />;
      case 'powerSelect':
        return <PowerSelectScreen socket={socket} room={room} pin={pin} playerId={playerId} />;
      case 'game':
        return <GameScreen socket={socket} gameState={gameState} room={room} pin={pin} playerId={playerId} answerCount={answerCount} />;
      case 'leaderboard':
        return <LeaderboardScreen socket={socket} gameState={gameState} room={room} pin={pin} playerId={playerId} />;
      case 'results':
        return <ResultsScreen socket={socket} gameState={gameState} pin={pin} setScreen={setScreen} />;
      default:
        return <HomeScreen socket={socket} setScreen={setScreen} setPin={setPin} setPlayerId={setPlayerId} />;
    }
  };

  return (
    <div className="App">
      <AnimatePresence>
        {connectionLost && (
          <motion.div
            key="connection-lost"
            className="connection-banner"
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
          >
            ⚠️ Connection lost — trying to reconnect...
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && <Toast key="toast" message={toast.text} tone={toast.tone} />}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          initial="initial"
          animate="animate"
          exit="exit"
          variants={screenVariants}
          transition={screenTransition}
        >
          {renderScreen()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function HomeScreen({ socket, setScreen, setPin, setPlayerId }) {
  const [mode, setMode] = useState(null);
  const [name, setName] = useState('');
  const [gameName, setGameName] = useState('');
  const [joinPin, setJoinPin] = useState('');
  const avatars = ['🦊', '🐼', '🦁', '🐯', '🐨', '🐸', '🦄', '🐙'];
  const [avatar, setAvatar] = useState(avatars[0]);

  const handleCreate = () => {
    if (!gameName.trim()) return;
    socket.emit('createRoom', { gameName }, (res) => {
      if (res.ok) {
        sessionStorage.setItem('finnival-pin', res.pin);
        sessionStorage.setItem('finnival-playerId', socket.id);
        setPlayerId(socket.id);
        setPin(res.pin);
        setScreen('lobby');
      }
    });
  };

  const handleJoin = () => {
    if (!name.trim() || !joinPin.trim()) return;
    socket.emit('joinRoom', { pin: joinPin, playerName: name, avatar }, (res) => {
      if (res.ok) {
        sessionStorage.setItem('finnival-pin', res.pin);
        sessionStorage.setItem('finnival-playerId', socket.id);
        setPlayerId(socket.id);
        setPin(res.pin);
        setScreen('lobby');
      } else {
        alert(res.message);
      }
    });
  };

  if (!mode) {
    return (
      <div className="screen-center">
        <div className="card" style={{ textAlign: 'center', maxWidth: 500 }}>
          <h1
            style={{
              fontSize: '3.4rem',
              marginBottom: 8,
              letterSpacing: 2,
              color: 'var(--amber)',
              textShadow: '-2px -2px 0 var(--indigo-deep), 2px -2px 0 var(--indigo-deep), -2px 2px 0 var(--indigo-deep), 2px 2px 0 var(--indigo-deep), 0 -2px 0 var(--indigo-deep), 0 2px 0 var(--indigo-deep), -2px 0 0 var(--indigo-deep), 2px 0 0 var(--indigo-deep), 0 4px 0 var(--indigo-deep)'
            }}
          >
            FINNIVAL
          </h1>
          <p style={{ fontSize: '1.2rem', marginBottom: 32, color: 'var(--plum)', fontWeight: 700, textShadow: '-1px -1px 0 var(--indigo-deep), 1px -1px 0 var(--indigo-deep), -1px 1px 0 var(--indigo-deep), 1px 1px 0 var(--indigo-deep), 0 -1px 0 var(--indigo-deep), 0 1px 0 var(--indigo-deep), -1px 0 0 var(--indigo-deep), 1px 0 0 var(--indigo-deep)' }}>The ultimate quiz battle with powers!</p>
          <button className="btn btn-primary" onClick={() => setMode('host')} style={{ width: '100%', marginBottom: 16, fontSize: '1.2rem' }}>
            🎮 Host a Game
          </button>
          <button className="btn btn-secondary" onClick={() => setMode('join')} style={{ width: '100%', fontSize: '1.2rem' }}>
            👥 Join a Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-center">
      <div className="card" style={{ textAlign: 'center', maxWidth: 400 }}>
        <h2 style={{ marginBottom: 24 }}>{mode === 'host' ? '🎮 Host a Game' : '👥 Join a Game'}</h2>

        {mode === 'host' ? (
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Game name:</label>
            <input
              className="input"
              type="text"
              placeholder="Enter a name for your game"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              maxLength={40}
              style={{ width: '100%' }}
            />
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Choose your avatar:</label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                {avatars.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAvatar(a)}
                    style={{
                      fontSize: '2rem',
                      padding: '8px 12px',
                      border: avatar === a ? '3px solid var(--orange)' : '3px solid var(--plum-tint)',
                      borderRadius: 'var(--radius-sm)',
                      background: avatar === a ? 'var(--amber-tint)' : 'white',
                      boxShadow: avatar === a ? '0 4px 0 var(--orange-dark)' : 'none',
                      transform: avatar === a ? 'translateY(-2px)' : 'none',
                      transition: 'all 0.15s',
                      cursor: 'pointer'
                    }}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Your name:</label>
              <input
                className="input"
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={16}
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}

        {mode === 'join' && (
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>Game PIN:</label>
            <input
              className="input"
              type="text"
              placeholder="6-digit code"
              value={joinPin}
              onChange={(e) => setJoinPin(e.target.value)}
              maxLength={6}
              style={{ width: '100%', textAlign: 'center', fontSize: '1.5rem', letterSpacing: 8, fontFamily: "'Fredoka One', cursive", color: 'var(--indigo)', background: 'var(--amber-tint)' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={() => setMode(null)} style={{ flex: 1 }}>
            Back
          </button>
          <button
            className={mode === 'host' ? 'btn btn-primary' : 'btn btn-success'}
            onClick={mode === 'host' ? handleCreate : handleJoin}
            style={{ flex: 1 }}
            disabled={mode === 'host' ? !gameName.trim() : !name.trim()}
          >
            {mode === 'host' ? 'Create Room' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
