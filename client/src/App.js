import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { AnimatePresence, motion } from 'framer-motion';
import LobbyScreen from './components/LobbyScreen';
import PowerSelectScreen from './components/PowerSelectScreen';
import GameScreen from './components/GameScreen';
import LeaderboardScreen from './components/LeaderboardScreen';
import ResultsScreen from './components/ResultsScreen';
import Toast from './components/Toast';
import { preloadImages } from './utils/imageUrl';
import { isMuted, toggleMute } from './utils/sound';
import { useAppAuth, AppUserButton } from './auth/AuthContext';
import './App.css';

const SERVER_PORT = 3001;
const serverUrl = process.env.REACT_APP_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:${SERVER_PORT}`;
const socket = io(serverUrl);

function clearStoredRoomSession() {
  sessionStorage.removeItem('finnival-pin');
  sessionStorage.removeItem('finnival-sessionToken');
  sessionStorage.removeItem('finnival-playerId');
  sessionStorage.removeItem('finnival-role');
}

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
  const [socketConnected, setSocketConnected] = useState(() => socket.connected);
  const [signingOut, setSigningOut] = useState(false);
  const [muted, setLocalMuted] = useState(isMuted());
  const { authEnabled, isLoaded, isSignedIn, hasAuthCookie, userId, userLabel, getToken, openSignIn, openSignUp, signOut } = useAppAuth();

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const roomRef = useRef(room);
  roomRef.current = room;
  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;
  const prevUserIdRef = useRef(null);
  const toastTimerRef = useRef(null);
  const authStateRef = useRef({ authEnabled, isLoaded, isSignedIn, userId, getToken });
  authStateRef.current = { authEnabled, isLoaded, isSignedIn, userId, getToken };

  const showLocalToast = useCallback((text, tone = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const applyRejoinResult = useCallback((res, savedPin) => {
    if (res?.ok) {
      setPin(savedPin);
      setPlayerId(socket.id);
      if (res.sessionToken) {
        sessionStorage.setItem('finnival-sessionToken', res.sessionToken);
      }
      sessionStorage.setItem('finnival-role', res.isHost ? 'host' : 'player');
      setRoom(res.snapshot);
      const stateToScreen = { lobby: 'lobby', powerSelect: 'powerSelect', leaderboard: 'leaderboard', results: 'results' };
      setScreen(stateToScreen[res.snapshot.state] || 'game');

      if (res.snapshot.state === 'question' || res.snapshot.state === 'reveal') {
        const qIndex = res.snapshot.questionIndex;
        const activeQ = res.activeQuestion || res.snapshot.questions[qIndex];
        setGameState({
          index: qIndex,
          question: activeQ,
          total: res.snapshot.totalQuestions,
          startedAt: res.startedAt || Date.now(),
          endsAt: res.endsAt || (Date.now() + (activeQ?.timeLimit || 20) * 1000),
          pausedAt: res.pausedAt || null,
          isReveal: res.snapshot.state === 'reveal',
          hasSubmitted: res.hasSubmitted,
          correctAnswer: res.snapshot.state === 'reveal' ? res.snapshot.questions[qIndex]?.correctAnswer : undefined
        });
      }
    } else {
      clearStoredRoomSession();
      setPlayerId(socket.id);
      setScreen('home');
    }
  }, []);

  useEffect(() => {
    const onMuteChange = (e) => setLocalMuted(e.detail.muted);
    window.addEventListener('finnival_mute_change', onMuteChange);
    return () => window.removeEventListener('finnival_mute_change', onMuteChange);
  }, []);

  useEffect(() => {
    let active = true;
    const syncSocketToken = async () => {
      if (!authEnabled) return;
      const token = isSignedIn ? await getToken() : null;
      if (!active) return;
      socket.auth = token ? { token } : {};
      if (socketConnected) {
        socket.emit('syncAuth', { authToken: token });
      }
    };
    syncSocketToken();

    if (isLoaded) {
      const prevUser = prevUserIdRef.current;
      prevUserIdRef.current = userId || null;
      if (prevUser && prevUser !== userId) {
        const isHostingNow = screenRef.current !== 'home' && roomRef.current?.host?.id === playerIdRef.current;
        if (isHostingNow) {
          socket.emit('abandonLobby');
          clearStoredRoomSession();
          setRoom(null);
          setGameState(null);
          setPin('');
          setScreen('home');
          showLocalToast(userId ? 'Switched account — previous lobby closed' : 'Signed out — active lobby closed', 'info');
        }
      }
    }

    return () => {
      active = false;
    };
  }, [authEnabled, isLoaded, isSignedIn, userId, socketConnected, getToken, showLocalToast]);

  useEffect(() => {
    if (!socketConnected || !authEnabled || !isLoaded) return;
    const savedPin = sessionStorage.getItem('finnival-pin');
    const savedToken = sessionStorage.getItem('finnival-sessionToken') || sessionStorage.getItem('finnival-playerId');
    const savedRole = sessionStorage.getItem('finnival-role');

    if (!savedPin || !savedToken || savedRole === 'player') return;

    const alreadyInRoomOnThisSocket = Boolean(
      roomRef.current &&
      (roomRef.current.host?.id === socket.id || roomRef.current.players?.some((p) => p.id === socket.id))
    );
    if (alreadyInRoomOnThisSocket) return;

    if (savedRole === 'host' && !isSignedIn) {
      socket.emit('abandonLobby', { pin: savedPin, sessionToken: savedToken });
      clearStoredRoomSession();
      return;
    }

    let cancelled = false;
    (async () => {
      const authToken = isSignedIn ? await getToken() : null;
      if (cancelled) return;
      socket.emit('rejoinRoom', { pin: savedPin, sessionToken: savedToken, playerId: savedToken, authToken }, (res) => {
        if (!cancelled) applyRejoinResult(res, savedPin);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [socketConnected, authEnabled, isLoaded, isSignedIn, getToken, applyRejoinResult]);

  useEffect(() => {
    socket.on('connect', () => {
      setConnectionLost(false);
      setSocketConnected(true);
      setPlayerId(socket.id);

      const savedPin = sessionStorage.getItem('finnival-pin');
      const savedToken = sessionStorage.getItem('finnival-sessionToken') || sessionStorage.getItem('finnival-playerId');
      const savedRole = sessionStorage.getItem('finnival-role');

      if (savedPin && savedToken && (!authStateRef.current.authEnabled || savedRole === 'player')) {
        socket.emit('rejoinRoom', { pin: savedPin, sessionToken: savedToken, playerId: savedToken }, (res) => {
          applyRejoinResult(res, savedPin);
        });
      }
    });

    socket.on('roomUpdate', (snapshot) => {
      setRoom(snapshot);
      if (snapshot?.questions) {
        preloadImages(snapshot.questions);
      }
    });

    socket.on('toast', (msg) => {
      showLocalToast(msg?.text, msg?.tone);
    });

    socket.on('gameStarted', () => {
      setScreen('powerSelect');
    });

    socket.on('questionStart', (data) => {
      setGameState(data);
      setAnswerCount(null);
      setScreen('game');
      if (data?.question) {
        preloadImages([data.question]);
      }
    });

    socket.on('answerCount', (data) => {
      setAnswerCount(data);
    });

    socket.on('timerPaused', (data) => {
      setGameState((prev) => (prev ? { ...prev, pausedAt: Date.now(), remainingMs: data?.remainingMs } : prev));
    });

    socket.on('timerResumed', (data) => {
      setGameState((prev) => (prev ? { ...prev, endsAt: data.endsAt, startedAt: data.startedAt || prev.startedAt, pausedAt: null } : prev));
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
      clearStoredRoomSession();
      alert('The host has left. The game is ending.');
      setRoom(null);
      setGameState(null);
      setScreen('home');
    });

    socket.on('roomClosed', (data) => {
      clearStoredRoomSession();
      alert(data?.message || 'The host has closed the lobby.');
      setRoom(null);
      setGameState(null);
      setScreen('home');
    });

    socket.on('kicked', () => {
      clearStoredRoomSession();
      alert('You have been removed from the game.');
      setRoom(null);
      setGameState(null);
      setScreen('home');
    });

    socket.on('disconnect', (reason) => {
      setSocketConnected(false);
      if (reason !== 'io client disconnect') setConnectionLost(true);
    });

    socket.on('connect_error', () => {
      setSocketConnected(false);
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
      socket.off('roomClosed');
      socket.off('kicked');
      socket.off('disconnect');
      socket.off('connect_error');
    };
  }, [applyRejoinResult, showLocalToast]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const isHostingNow = screenRef.current !== 'home' && roomRef.current?.host?.id === playerIdRef.current;
    if (isHostingNow) {
      socket.emit('abandonLobby');
      clearStoredRoomSession();
      setRoom(null);
      setGameState(null);
      setPin('');
      setScreen('home');
    }
    prevUserIdRef.current = null;
    try {
      await signOut();
      showLocalToast(isHostingNow ? 'Signed out — active lobby closed' : 'Signed out', 'info');
    } finally {
      setSigningOut(false);
    }
  };

  const renderScreen = () => {
    switch (screen) {
      case 'home':
        return <HomeScreen socket={socket} setScreen={setScreen} setPin={setPin} setPlayerId={setPlayerId} setRoom={setRoom} />;
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
        return <HomeScreen socket={socket} setScreen={setScreen} setPin={setPin} setPlayerId={setPlayerId} setRoom={setRoom} />;
    }
  };

  return (
    <div className="App">
      {authEnabled && (screen === 'home' || screen === 'lobby') && (
        <div
          style={{
            position: 'fixed',
            top: 14,
            left: 14,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(30, 24, 53, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '999px',
            padding: (isSignedIn || (!isLoaded && hasAuthCookie)) ? '4px 12px 4px 6px' : '4px 6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            minHeight: 38
          }}
        >
          {!isLoaded && hasAuthCookie ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px' }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.25)',
                  animation: 'pulse 1.2s ease-in-out infinite'
                }}
              />
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem', fontWeight: 600 }}>Loading...</span>
            </div>
          ) : isSignedIn ? (
            <>
              <AppUserButton />
              {userLabel && (
                <span style={{ color: 'white', fontWeight: 700, fontSize: '0.84rem', maxWidth: 'clamp(64px, 18vw, 130px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {userLabel}
                </span>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSignOut}
                disabled={signingOut}
                style={{ padding: '4px 10px', fontSize: '0.78rem', borderRadius: '999px', whiteSpace: 'nowrap' }}
                title="Sign out of your account"
              >
                {signingOut ? 'Signing out...' : 'Sign Out'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={openSignIn}
                style={{ padding: '5px 12px', fontSize: '0.82rem', borderRadius: '999px' }}
              >
                Sign In
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openSignUp}
                style={{ padding: '5px 12px', fontSize: '0.82rem', borderRadius: '999px' }}
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setLocalMuted(toggleMute())}
        className="btn btn-secondary"
        style={{
          position: 'fixed',
          top: 14,
          right: 14,
          zIndex: 9999,
          padding: '6px 12px',
          borderRadius: '999px',
          fontSize: '0.9rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(30, 24, 53, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          cursor: 'pointer'
        }}
        title={muted ? 'Unmute Sound' : 'Mute Sound'}
      >
        <span>{muted ? '🔇 Muted' : '🔊 Sound'}</span>
      </button>
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

function HomeScreen({ socket, setScreen, setPin, setPlayerId, setRoom }) {
  const [mode, setMode] = useState(null);
  const [name, setName] = useState('');
  const [gameName, setGameName] = useState('');
  const [joinPin, setJoinPin] = useState('');
  const [hostError, setHostError] = useState(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const avatars = ['🦊', '🐼', '🦁', '🐯', '🐨', '🐸', '🦄', '🐙'];
  const [avatar, setAvatar] = useState(avatars[0]);
  const { authEnabled, isLoaded, isSignedIn, hasAuthCookie, userId, getToken, openSignIn, openSignUp } = useAppAuth();

  useEffect(() => {
    setHostError(null);
    setCreatingRoom(false);
  }, [isSignedIn, userId]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pinParam = params.get('pin');
      if (pinParam && /^\d{6}$/.test(pinParam.trim())) {
        setJoinPin(pinParam.trim());
        setMode('join');
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch (e) {}
  }, []);

  const handleCreate = async () => {
    if (!gameName.trim() || creatingRoom) return;
    setHostError(null);
    setCreatingRoom(true);
    try {
      const authToken = authEnabled ? await getToken() : null;
      socket.emit('createRoom', { gameName, authToken }, (res) => {
        setCreatingRoom(false);
        if (res?.ok) {
          sessionStorage.setItem('finnival-pin', res.pin);
          if (res.sessionToken) sessionStorage.setItem('finnival-sessionToken', res.sessionToken);
          sessionStorage.setItem('finnival-playerId', socket.id);
          sessionStorage.setItem('finnival-role', 'host');
          setPlayerId(socket.id);
          setPin(res.pin);
          if (typeof setRoom === 'function' && res.snapshot) setRoom(res.snapshot);
          setScreen('lobby');
        } else {
          if (res?.authRequired && !authEnabled) {
            setHostError('Server requires Clerk login. Configure REACT_APP_CLERK_PUBLISHABLE_KEY in client/.env.');
          } else {
            setHostError(res?.message || 'Could not create room right now.');
          }
        }
      });
    } catch (e) {
      setCreatingRoom(false);
      setHostError('Could not create room right now.');
    }
  };

  const handleJoin = () => {
    if (!name.trim() || !joinPin.trim()) return;
    socket.emit('joinRoom', { pin: joinPin, playerName: name, avatar }, (res) => {
      if (res.ok) {
        sessionStorage.setItem('finnival-pin', res.pin);
        if (res.sessionToken) sessionStorage.setItem('finnival-sessionToken', res.sessionToken);
        sessionStorage.setItem('finnival-playerId', socket.id);
        sessionStorage.setItem('finnival-role', 'player');
        setPlayerId(socket.id);
        setPin(res.pin);
        if (typeof setRoom === 'function' && res.snapshot) setRoom(res.snapshot);
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

  const userLikelySignedIn = isSignedIn || (!isLoaded && hasAuthCookie);
  const needsHostLogin = mode === 'host' && authEnabled && !userLikelySignedIn;

  return (
    <div className="screen-center">
      <div className="card" style={{ textAlign: 'center', maxWidth: 400 }}>
        <h2 style={{ marginBottom: 24 }}>{mode === 'host' ? '🎮 Host a Game' : '👥 Join a Game'}</h2>

        {mode === 'host' ? (
          needsHostLogin ? (
            <div style={{ marginBottom: 24 }}>
              <p style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 18, lineHeight: 1.5 }}>
                Sign in or create a free account to host games and save quizzes to your library.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button type="button" className="btn btn-primary" onClick={openSignIn} style={{ flex: 1 }}>
                  Sign In
                </button>
                <button type="button" className="btn btn-success" onClick={openSignUp} style={{ flex: 1 }}>
                  Sign Up
                </button>
              </div>
            </div>
          ) : (
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
              {hostError && (
                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(232,69,69,0.12)', color: 'var(--coral)', fontWeight: 700, fontSize: '0.85rem' }}>
                  {hostError}
                </div>
              )}
            </div>
          )
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
          <button className="btn btn-secondary" onClick={() => { setHostError(null); setMode(null); }} style={{ flex: 1 }}>
            Back
          </button>
          {!needsHostLogin && (
            <button
              className={mode === 'host' ? 'btn btn-primary' : 'btn btn-success'}
              onClick={mode === 'host' ? handleCreate : handleJoin}
              style={{ flex: 1 }}
              disabled={mode === 'host' ? (!gameName.trim() || creatingRoom) : !name.trim()}
            >
              {mode === 'host' ? (creatingRoom ? 'Creating...' : 'Create Room') : 'Join'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
