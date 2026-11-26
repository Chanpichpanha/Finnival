import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MatchGame from './MatchGame';
import { resolveImageUrl } from '../utils/imageUrl';
import { playTick, playSubmit, playFreeze, playHeist, playScramble, playOracle, playDoublePoints } from '../utils/sound';


const OPTION_COLORS = ['option-red', 'option-blue', 'option-yellow', 'option-green'];

const POWER_META = {
  blind: { name: 'Blackout', icon: '🌑', needsTarget: false },
  steal: { name: 'Heist', icon: '🪝', needsTarget: true },
  hint: { name: 'Oracle', icon: '🔮', needsTarget: false },
  freeze: { name: 'Deep Freeze', icon: '❄️', needsTarget: true },
  scramble: { name: 'Scramble', icon: '🌀', needsTarget: false }
};

const BURST_META = {
  blind: { icon: '🌑', text: 'Blackout!', color: '#2A2142' },
  steal: { icon: '🪝', text: 'Heist!', color: '#824C97' },
  hint: { icon: '🔮', text: 'Oracle activated', color: '#FFAF50' },
  frozen: { icon: '❄️', text: 'Frozen!', color: '#2BA89A' },
  scramble: { icon: '🌀', text: 'Scrambled!', color: '#ED743F' }
};

function Particles({ color }) {
  const particles = React.useMemo(() => (
    Array.from({ length: 18 }, (_, i) => ({
      id: i,
      angle: (i / 18) * Math.PI * 2,
      distance: 120 + Math.random() * 160,
      size: 6 + Math.random() * 10,
      delay: Math.random() * 0.15
    }))
  ), []);

  return (
    <>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="particle"
          style={{
            background: color,
            width: p.size,
            height: p.size,
            top: '50%',
            left: '50%'
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{
            x: Math.cos(p.angle) * p.distance,
            y: Math.sin(p.angle) * p.distance,
            opacity: 0,
            scale: 0.3
          }}
          transition={{ duration: 0.7, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </>
  );
}

function PowerBurst({ effect, onDone }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const t = setTimeout(() => onDoneRef.current(), 900);
    return () => clearTimeout(t);
  }, [effect]);

  if (!effect) return null;
  const meta = BURST_META[effect.type] || { icon: '✨', text: 'Power!', color: '#824C97' };

  return (
    <motion.div
      className="power-burst"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <Particles color={meta.color} />
      <motion.div
        className="power-burst-emoji"
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: [0, 1.4, 1], rotate: [0, 8, 0] }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {meta.icon}
      </motion.div>
      <motion.div
        className="power-burst-text"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        {effect.from ? `${effect.from} used ${meta.text}` : meta.text}
      </motion.div>
    </motion.div>
  );
}

function AnimatedScore({ value }) {
  const [display, setDisplay] = useState(value);
  const startRef = useRef(value);

  useEffect(() => {
    const start = startRef.current;
    const end = value;
    if (start === end) return;
    const duration = 500;
    const startTime = performance.now();

    let raf;
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(start + (end - start) * eased);
      setDisplay(next);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        startRef.current = end;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className="score-pop">{display}</span>;
}




function GameScreen({ socket, gameState, room, playerId, answerCount }) {
  const [timeLeft, setTimeLeft] = useState(gameState?.question?.timeLimit || 20);
  const prevDoublePointsRef = useRef(room?.isDoublePoints);
  useEffect(() => {
    if (room?.isDoublePoints && !prevDoublePointsRef.current) {
      playDoublePoints();
    }
    prevDoublePointsRef.current = room?.isDoublePoints;
  }, [room?.isDoublePoints]);

  const lastTickSecRef = useRef(null);
  useEffect(() => {
    lastTickSecRef.current = null;
  }, [gameState?.questionIndex]);

  const [answered, setAnswered] = useState(false);
  const [eliminated, setEliminated] = useState(null);
  const [blindedUntil, setBlindedUntil] = useState(0);
  const [pickingTarget, setPickingTarget] = useState(false);
  const [frozenUntil, setFrozenUntil] = useState(0);
  const [burst, setBurst] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [shortAnswerText, setShortAnswerText] = useState('');
  const [sliderValue, setSliderValue] = useState(50);
  const [maskedHint, setMaskedHint] = useState(null);
  const [sliderSafeRange, setSliderSafeRange] = useState(null);
  const [oracleMatchPair, setOracleMatchPair] = useState(null);
  const [matchScrambleTrigger, setMatchScrambleTrigger] = useState(0);
  const matchPairsRef = useRef({});

  const [scrambledUntil, setScrambledUntil] = useState(0);
  const [scrambleMap, setScrambleMap] = useState([0, 1, 2, 3]); // Initialized to default 4

  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [battleFeed, setBattleFeed] = useState([]);

  useEffect(() => {
    setBattleFeed([]);
  }, [gameState?.index]);

  useEffect(() => {
    const handleBattleFeed = (item) => {
      setBattleFeed((prev) => [item, ...prev].slice(0, 4));
    };
    socket.on('battleFeedEvent', handleBattleFeed);
    return () => socket.off('battleFeedEvent', handleBattleFeed);
  }, [socket]);

  const me = room?.players.find((p) => p.id === playerId);
  const isHost = room?.host?.id === playerId;
  const isPaused = Boolean(room?.paused || gameState?.pausedAt);
  const powerMeta = me?.power ? POWER_META[me.power] : null;
  const onCooldown = cooldownLeft > 0;
  const canUsePower = me?.power && !onCooldown && !answered && !isPaused;

  const question = gameState?.question;
  const index = gameState?.index;
  const total = gameState?.total;

  const isBlind = blindedUntil > Date.now();
  const isFrozen = frozenUntil > Date.now();
  const effectiveNow = isPaused && (room?.pausedAt || gameState?.pausedAt)
    ? (room?.pausedAt || gameState?.pausedAt)
    : Date.now();
  const isScrambled = scrambledUntil > effectiveNow && !gameState?.isReveal;

  useEffect(() => {
    setAnswered(false);
    setEliminated(null);
    setPickingTarget(false);
    setSelectedOption(null);
    setFrozenUntil(me?.frozen ? Date.now() + 5000 : 0);
    setBlindedUntil(0);
    setScrambledUntil(0);
    setMaskedHint(null);
    setSliderSafeRange(null);
    setOracleMatchPair(null);
    matchPairsRef.current = {};
    const len = gameState?.question?.options?.length || 4;
    setScrambleMap(Array.from({ length: len }, (_, i) => i));

    setBurst(null);
  }, [gameState?.index]);

  useEffect(() => {
    if (!gameState || isPaused) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, (gameState.endsAt - Date.now()) / 1000);
      setTimeLeft(remaining);
      // Auto-submit partial match pairs before timer hits zero
      if (remaining <= 0.8 && !answered && question?.type === 'match') {
        const current = matchPairsRef.current || {};
        const payload = Object.entries(current).map(([left, right]) => ({
          left: parseInt(left, 10),
          right: parseInt(right, 10)
        }));
        if (payload.length > 0) {
          submitAnswer(payload);
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [gameState, isPaused, answered, question?.type]);

  const pausedAtRef = useRef(null);
  useEffect(() => {
    if (isPaused) {
      document.activeElement?.blur();
      setPickingTarget(false);
      pausedAtRef.current = Date.now();
    } else if (pausedAtRef.current) {
      const dur = Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
      if (scrambledUntil > 0) setScrambledUntil((prev) => prev + dur);
      if (blindedUntil > 0) setBlindedUntil((prev) => prev + dur);
      if (frozenUntil > 0) setFrozenUntil((prev) => prev + dur);
    }
  }, [isPaused]);

  useEffect(() => {
    const handlePowerEffect = (effect) => {
      if (effect.type === 'hint') {
        if (!effect.qType || effect.qType === 'classic') setEliminated(effect.eliminate);
        if (effect.qType === 'short_answer') setMaskedHint(effect.masked);
        if (effect.qType === 'slider') setSliderSafeRange({ safeMin: effect.safeMin, safeMax: effect.safeMax });
        if (effect.qType === 'match') setOracleMatchPair({ questionIndex: gameState?.index, autoPair: effect.autoPair });
      }
      if (effect.type === 'blind') setBlindedUntil(Date.now() + effect.duration);
      if (effect.type === 'frozen') setFrozenUntil(Date.now() + (effect.duration || 5000));
      if (effect.type === 'scramble') {
        setScrambledUntil(Date.now() + (effect.duration || 10000));
        setMatchScrambleTrigger(Date.now());
        if (!effect.qType || effect.qType === 'classic') {
          let valid = false;
          const numOpts = gameState?.question?.options?.length || 4;
          let arr = Array.from({ length: numOpts }, (_, i) => i);
          while (!valid && numOpts > 1) {
            arr = Array.from({ length: numOpts }, (_, i) => i);
            for (let i = numOpts - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              const temp = arr[i];
              arr[i] = arr[j];
              arr[j] = temp;
            }
            valid = arr.every((val, i) => val !== i);
          }
          setScrambleMap(arr);
        }
      }
      setBurst(effect);
    };
    socket.on('powerEffect', handlePowerEffect);
    return () => socket.off('powerEffect', handlePowerEffect);
  }, [socket, gameState?.index]);

  useEffect(() => {
    if (!blindedUntil) return;
    const t = setTimeout(() => setBlindedUntil(0), Math.max(0, blindedUntil - Date.now()));
    return () => clearTimeout(t);
  }, [blindedUntil]);

  useEffect(() => {
    if (!frozenUntil) return;
    const t = setTimeout(() => setFrozenUntil(0), Math.max(0, frozenUntil - Date.now()));
    return () => clearTimeout(t);
  }, [frozenUntil]);

  useEffect(() => {
    if (!scrambledUntil || isPaused) return;
    const t = setTimeout(() => setScrambledUntil(0), Math.max(0, scrambledUntil - Date.now()));
    return () => clearTimeout(t);
  }, [scrambledUntil, isPaused]);

  useEffect(() => {
    const update = () => {
      const effectiveNow = isPaused && (room?.pausedAt || gameState?.pausedAt)
        ? (room?.pausedAt || gameState?.pausedAt)
        : Date.now();
      const remaining = Math.max(0, (me?.powerCooldownUntil || 0) - effectiveNow);
      setCooldownLeft(remaining);
    };
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [me?.powerCooldownUntil, isPaused, room?.pausedAt, gameState?.pausedAt]);

  const submitAnswer = (index) => {
    if (answered || isFrozen || isPaused) return;
    playSubmit();
    setAnswered(true);
    setSelectedOption(index);
    const finalAnswer = (isScrambled && typeof index === 'number') ? scrambleMap[index] : index;
    socket.emit('submitAnswer', { answerIndex: finalAnswer, clientTime: gameState?.startedAt });
  };

  const activatePower = () => {
    if (!me?.power || isPaused) return;
    if (powerMeta?.needsTarget) {
      setPickingTarget(true);
      return;
    }
    if (me?.power === 'hint' && question?.type === 'match') {
      socket.emit('usePower', { currentPairs: matchPairsRef.current });
      return;
    }
    socket.emit('usePower', {});
  };

  const activateOnTarget = (targetId) => {
    if (isPaused) return;
    socket.emit('usePower', { targetId });
    setPickingTarget(false);
  };

  const skipQuestion = () => socket.emit('hostSkipQuestion');
  const togglePause = () => socket.emit('hostTogglePause');
  const banPlayer = (targetId) => socket.emit('banPlayer', { playerId: targetId });
  const kickPlayer = (targetId) => socket.emit('kickPlayer', { playerId: targetId });

  if (!gameState || !question) return null;

  const rivals = room?.players.filter((p) => p.id !== playerId) || [];
  const isUrgent = timeLeft <= 3 && timeLeft > 0;
  const contestants = room?.players.filter((p) => !p.isHost) || [];

  if (isHost) {
    return (
      <div className="question-container">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <span style={{ color: 'white', fontSize: '1.2rem', fontWeight: 700 }}>
            Question {index + 1} of {total}
          </span>
        </div>

        {/* Phase 1 SFX hook connected: playDoublePoints() fires via room.isDoublePoints */}
        {room?.isDoublePoints && (
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{
              margin: '0 auto 12px auto',
              padding: '8px 18px',
              background: 'linear-gradient(135deg, #FF6B35 0%, #FFAF50 100%)',
              borderRadius: 12,
              color: 'white',
              fontWeight: 900,
              fontSize: '1.15rem',
              textAlign: 'center',
              boxShadow: '0 0 20px rgba(255, 107, 53, 0.6), 0 3px 0 #D4541B',
              letterSpacing: '1px',
              maxWidth: 420
            }}
          >
            🔥 2× POINTS ACTIVATED!
          </motion.div>
        )}
        <div className={`timer-bar ${isPaused ? '' : isUrgent ? 'urgent' : ''}`}>
          <motion.div
            className={`timer-fill ${isUrgent ? 'urgent' : ''}`}
            animate={{ width: `${Math.min(100, Math.max(0, (timeLeft / (question.timeLimit || 20)) * 100))}%` }}
            transition={{ duration: isPaused ? 0 : 0.1, ease: 'linear' }}
          />
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 4 }}>Current question (read-only)</p>
            <div className="question-text" style={{ fontSize: '1.1rem' }}>{question.text}</div>
            {(question.imageUrl || question.image) && (
              <div style={{ textAlign: 'center', marginTop: 12, marginBottom: 8 }}>
                <img
                  src={resolveImageUrl(question.imageUrl || question.image)}
                  alt=""
                  style={{
                    maxHeight: '170px',
                    maxWidth: '100%',
                    width: 'auto',
                    borderRadius: 10,
                    objectFit: 'contain',
                    border: '2px solid var(--indigo-deep)',
                    boxShadow: '0 3px 0 var(--indigo-deep)'
                  }}
                />
              </div>
            )}
            
            {(!question.type || question.type === 'classic') && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {question.options?.map((opt, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      border: '2px solid var(--dark)',
                      background: i === question.correctAnswer ? 'var(--green)' : 'white',
                      fontWeight: 700,
                      fontSize: '0.9rem'
                    }}
                  >
                    {String.fromCharCode(65 + i)}. {opt}{i === question.correctAnswer ? ' ✓' : ''}
                  </div>
                ))}
              </div>
            )}

            {question.type === 'short_answer' && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--amber-tint)', borderRadius: 8, fontWeight: 'bold' }}>
                Type: Short Answer | Correct: {question.correctAnswerText}
              </div>
            )}

            {question.type === 'slider' && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--amber-tint)', borderRadius: 8, fontWeight: 'bold' }}>
                Type: Slider | Min: {question.min} | Max: {question.max} | Target: {question.correctNumber}
              </div>
            )}

            {question.type === 'match' && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--amber-tint)', borderRadius: 8, fontWeight: 'bold' }}>
                Type: Drag & Drop Match
                <div style={{ marginTop: 8 }}>
                  {question.pairs?.map((p, i) => (
                     <div key={i}>- {p.left} ➔ {p.right}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <motion.button
            className={`btn ${room?.isDoublePoints ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => socket.emit('activateDoublePoints')}
            disabled={Boolean(room?.isDoublePoints || isPaused)}
            whileHover={{ scale: room?.isDoublePoints || isPaused ? 1 : 1.03 }}
            whileTap={{ scale: room?.isDoublePoints || isPaused ? 1 : 0.97 }}
            style={{
              flex: 1,
              minWidth: 160,
              background: room?.isDoublePoints
                ? 'linear-gradient(135deg, #FF6B35 0%, #FFAF50 100%)'
                : undefined,
              boxShadow: room?.isDoublePoints
                ? '0 0 16px rgba(255, 107, 53, 0.7), 0 4px 0 #D4541B'
                : undefined,
              color: 'white',
              fontWeight: 800,
              cursor: room?.isDoublePoints || isPaused ? 'not-allowed' : 'pointer'
            }}
          >
            {room?.isDoublePoints ? '🔥 2× ACTIVE' : '🔥 2× Points'}
          </motion.button>
          <motion.button
            className="btn btn-secondary"
            onClick={togglePause}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{ flex: 1, minWidth: 160 }}
          >
            {room?.paused ? '▶️ Resume Timer' : '⏸ Pause Timer'}
          </motion.button>
          <motion.button
            className="btn btn-danger"
            onClick={skipQuestion}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{ flex: 1, minWidth: 160 }}
          >
            ⏭ Skip Question
          </motion.button>
          <motion.button
            className="btn btn-danger"
            onClick={() => socket.emit('endGameEarly')}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{ flex: 1, minWidth: 160 }}
          >
            ⏹ End Game
          </motion.button>
        </div>

        <div className="card">
          <p style={{ fontWeight: 700, marginBottom: 12 }}>
            Players — {answerCount ? `${answerCount.answered}/${answerCount.total} answered` : `${contestants.length} in game`}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contestants.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '2px solid var(--dark)',
                  background: p.frozen ? '#E0F4F1' : 'white'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                  <span style={{ fontSize: '1.3rem' }}>{p.avatar}</span>
                  {p.name}
                  {p.frozen && <span title="Frozen">❄️</span>}
                  {!p.connected && <span title="Disconnected" style={{ color: 'var(--red)' }}>⚠️</span>}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ color: 'var(--muted)' }}><AnimatedScore value={p.score} /> pts</span>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => kickPlayer(p.id)}>Kick</button>
                  <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => banPlayer(p.id)}>Ban</button>
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="question-container">
      <AnimatePresence>
        {isBlind && (
          <motion.div
            className="blind-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {Array.from({length:30}).map((_,i) => {
              const left = [5,92,18,73,45,60,30,85,12,55,38,78,22,67,50,8,95,42,70,15,63,33,88,25,58,48,82,10,75,40][i];
              const size = [80,120,60,140,100,90,110,70,130,85,95,75,115,65,105,125,88,72,135,68,98,82,108,78,118,92,128,62,102,86][i];
              const delay = [0,0,0.05,0.05,0.1,0.1,0.15,0.15,0.2,0.2,0.25,0.25,0.3,0.3,0.35,0.35,0.4,0.4,0.45,0.45,0.5,0.5,0.55,0.55,0.6,0.6,0.65,0.65,0.7,0.7][i];
              const dur = [0.4,0.5,0.3,0.6,0.45,0.35,0.55,0.4,0.5,0.3,0.45,0.55,0.35,0.6,0.4,0.3,0.5,0.35,0.45,0.4,0.55,0.3,0.4,0.5,0.35,0.45,0.4,0.3,0.5,0.35][i];
              return <div key={i} className="smoke-bubble" style={{left:left+'%',width: 'var(--bubble-size)', height: 'var(--bubble-size)', '--bubble-size': size + 'px',animationDelay:delay+'s',animationDuration:dur+'s'}} />;
            })}
            <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,background:'#000',animation:'blackoutFill 1s linear forwards',opacity:0,zIndex:2}} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {burst && <PowerBurst key={burst.type + (burst.from || '')} effect={burst} onDone={() => setBurst(null)} />}
      </AnimatePresence>

      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <span style={{ color: 'white', fontSize: '1.2rem', fontWeight: 700 }}>
          Question {index + 1} of {total}
        </span>
      </div>

      {powerMeta && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <motion.button
            className="power-action-btn"
            onClick={activatePower}
            disabled={!canUsePower || isPaused}
            animate={canUsePower ? { boxShadow: ['0 0 4px rgba(130,76,151,0.4)', '0 0 16px rgba(130,76,151,0.9)', '0 0 4px rgba(130,76,151,0.4)'] } : {}}
            transition={canUsePower ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : {}}
          >
            <span style={{ fontSize: '1.4rem', marginRight: 8 }}>{powerMeta.icon}</span>
            <span>
              {onCooldown
                ? `Ready in ${Math.floor(cooldownLeft / 60000)}:${String(Math.ceil((cooldownLeft % 60000) / 1000)).padStart(2, '0')}`
                : `Use ${powerMeta.name}`}
            </span>
          </motion.button>
        </div>
      )}

      <AnimatePresence>
        {pickingTarget && (
          <motion.div
            className="card"
            style={{ marginBottom: 16 }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <p style={{ fontWeight: 700, marginBottom: 12 }}>Choose a target:</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {rivals.map((p) => (
                <button key={p.id} className="btn btn-primary" onClick={() => activateOnTarget(p.id)}>
                  {p.avatar} {p.name}
                </button>
              ))}
              <button className="btn btn-danger" onClick={() => setPickingTarget(false)}>Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`timer-bar ${isPaused ? '' : isUrgent ? 'urgent' : ''}`}>
        <motion.div
          className={`timer-fill ${isUrgent ? 'urgent' : ''}`}
          animate={{ width: `${Math.min(100, Math.max(0, (timeLeft / (question.timeLimit || 20)) * 100))}%` }}
          transition={{ duration: isPaused ? 0 : 0.1, ease: 'linear' }}
        />
      </div>

      <div className="question-card" style={{ position: 'relative', overflow: 'hidden' }}>
        {isPaused && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              backgroundColor: 'rgba(26, 16, 60, 0.82)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-lg)',
              zIndex: 30,
              padding: 24,
              textAlign: 'center',
              border: '2px solid rgba(255, 255, 255, 0.2)'
            }}
          >
            <div style={{ fontSize: '3.5rem', marginBottom: 12 }}>⏸️</div>
            <h2 style={{ color: 'white', margin: 0, fontSize: '1.9rem', fontWeight: 800 }}>Game Paused by Host</h2>
          </div>
        )}
        {(question.imageUrl || question.image) && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img
              src={resolveImageUrl(question.imageUrl || question.image)}
              alt=""
              style={{
                maxHeight: '180px',
                maxWidth: '100%',
                width: 'auto',
                borderRadius: 12,
                objectFit: 'contain',
                border: '2px solid var(--indigo-deep)',
                boxShadow: '0 4px 0 var(--indigo-deep)'
              }}
            />
          </div>
        )}
        <div className="question-text">{question.text}</div>

        
        {(!question.type || question.type === 'classic') && (
          <div className="options-grid" style={{ pointerEvents: (answered || isFrozen) ? 'none' : 'auto' }}>
            {question.options?.map((opt, i) => {
               const mapIndex = isScrambled ? scrambleMap[i] : i;
               const cssClass = mapIndex < OPTION_COLORS.length ? OPTION_COLORS[mapIndex] : '';
               const customStyle = mapIndex >= OPTION_COLORS.length ? { backgroundColor: `hsl(${mapIndex * 50}, 80%, 50%)`, color: 'white' } : {};
               return (
                <motion.button
                  key={i}
                  className={`option-btn ${cssClass}`}
                  onClick={() => submitAnswer(i)}
                  disabled={answered || eliminated?.includes(i) || isFrozen || isPaused}
                  style={{ 
                      ...customStyle, 
                      opacity: gameState?.isReveal 
                        ? (gameState.correctAnswer === i ? 1 : 0.3) 
                        : (eliminated?.includes(i) ? 0.3 : (answered && selectedOption !== i ? 0.4 : 1)),
                      transform: answered && selectedOption === i ? 'scale(1.04)' : 'none'
                    }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{
                    opacity: gameState?.isReveal ? (gameState.correctAnswer === i ? 1 : 0.3) : (eliminated?.includes(i) ? 0.3 : 1),
                    y: 0,
                    scale: gameState?.isReveal && gameState.correctAnswer === i ? 1.02 : (selectedOption === i ? [1, 1.12, 1.04] : 1)
                  }}
                  transition={gameState?.isReveal && gameState.correctAnswer === i ? { duration: 1.2, ease: [0.34, 1.56, 0.64, 1] } : { delay: i * 0.05, type: 'spring', stiffness: 300, damping: 22 }}
                  whileHover={!answered && !eliminated?.includes(i) && !isFrozen && !isPaused ? { scale: 1.04, rotate: i % 2 === 0 ? -1.5 : 1.5, y: -4 } : {}}
                  whileTap={!answered && !eliminated?.includes(i) && !isFrozen && !isPaused ? { scale: 0.96, rotate: 0 } : {}}
                >
                  {String.fromCharCode(65 + i)}. {opt}
                </motion.button>
               )
            })}
          </div>
        )}

        {question.type === 'short_answer' && (() => {
            const isReveal = gameState?.isReveal;
            let inputBg = 'white';
            let inputColor = 'var(--dark)';
            let isCorrect = false;
            
            if (isReveal) {
                const correctTxt = String(gameState.correctAnswerText || question.correctAnswerText || '').trim().toLowerCase();
                const ansTxt = String(shortAnswerText || '').trim().toLowerCase();
                if (ansTxt === correctTxt) {
                    isCorrect = true;
                } else {
                    const words = correctTxt.split(/\s+/);
                    isCorrect = words.includes(ansTxt) && ansTxt.length > 4;
                }
                inputBg = isCorrect ? 'var(--green)' : 'var(--red)';
                inputColor = 'white';
            }

            return (
            <div style={{ padding: 24, textAlign: 'center', background: 'rgba(42,33,66,0.45)', borderRadius: 12 }}>
              <h3 style={{ color: 'white', marginBottom: 16 }}>Type your answer:</h3>
              {maskedHint && !isReveal && (
                <div style={{ 
                  marginBottom: 16, 
                  padding: '10px 18px', 
                  background: 'rgba(130, 76, 151, 0.35)', 
                  border: '2px solid #FFAF50', 
                  borderRadius: 10, 
                  color: 'white', 
                  fontSize: '1.25rem', 
                  letterSpacing: 3, 
                  fontWeight: 'bold' 
                }}>
                  🔮 Oracle Hint: <span style={{ color: '#FFAF50' }}>{maskedHint}</span>
                </div>
              )}
              {isScrambled && !isReveal && (
                <div style={{ 
                  marginBottom: 16, 
                  padding: '8px 16px', 
                  background: 'rgba(237, 116, 63, 0.3)', 
                  border: '2px solid var(--orange)', 
                  borderRadius: 10, 
                  color: '#FFC173', 
                  fontSize: '1.1rem', 
                  fontWeight: 'bold' 
                }}>
                  🌀 Scrambled! Blind Typing Active!
                </div>
              )}
              <input 
                type={isScrambled && !isReveal ? 'password' : 'text'} 
                className="input" 
                placeholder={isScrambled && !isReveal ? 'Typing blind...' : 'Your answer...'}
                value={shortAnswerText}
                onChange={(e) => setShortAnswerText(e.target.value)}
                disabled={answered || isFrozen || isReveal || isPaused}
                style={{ 
                    width: '100%', 
                    maxWidth: 400, 
                    fontSize: '1.5rem', 
                    marginBottom: 24, 
                    textAlign: 'center',
                    backgroundColor: inputBg,
                    color: inputColor,
                    border: isScrambled && !isReveal ? '4px solid var(--orange)' : '4px solid var(--indigo-deep)',
                    boxShadow: '0 4px 0 var(--indigo-deep)',
                    transition: 'all 0.3s ease',
                    fontWeight: 'bold', fontFamily: "'Fredoka One', cursive"
                }}
              />
              <br/>
              {!isReveal && (
              <button 
                className="btn btn-primary" 
                disabled={answered || isFrozen || !shortAnswerText.trim() || isPaused}
                onClick={() => submitAnswer(shortAnswerText.trim())}
                style={{ width: '100%', maxWidth: 400, fontSize: '1.2rem', padding: '16px' }}
              >
                Submit Answer
              </button>
              )}
              {isReveal && (
                <div 
                    style={{ 
                        marginTop: 16, 
                        padding: '16px',
                        background: 'var(--cream)', 
                        borderRadius: 12,
                        color: 'var(--dark)', 
                        fontSize: '1.4rem', 
                        fontWeight: 'bold',
                        boxShadow: '0 4px 12px rgba(42,33,66,0.25)',
                        border: '3px solid var(--dark)',
                        display: 'inline-block',
                        minWidth: '250px'
                    }}
                >
                  <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>Correct Answer</div>
                  <div style={{ color: 'var(--green)' }}>{gameState.correctAnswerText || question.correctAnswerText}</div>
                </div>
              )}
            </div>
          );
        })()}

        {question.type === 'slider' && (
          <div style={{ padding: 24, textAlign: 'center', background: 'rgba(42,33,66,0.45)', borderRadius: 12 }}>
            <h3 style={{ color: 'white', marginBottom: 16 }}>Drag to select:</h3>
            {sliderSafeRange && !gameState?.isReveal && (
              <div style={{ 
                marginBottom: 16, 
                padding: '10px 18px', 
                background: 'rgba(130, 76, 151, 0.35)', 
                border: '2px solid #FFAF50', 
                borderRadius: 10, 
                color: 'white', 
                fontSize: '1.1rem', 
                fontWeight: 'bold' 
              }}>
                🔮 Oracle Hint: Target is within <span style={{ color: '#FFAF50' }}>{sliderSafeRange.safeMin} – {sliderSafeRange.safeMax}</span>
              </div>
            )}
            {isScrambled && !gameState?.isReveal && (
              <div style={{ 
                marginBottom: 16, 
                padding: '8px 16px', 
                background: 'rgba(237, 116, 63, 0.3)', 
                border: '2px solid var(--orange)', 
                borderRadius: 10, 
                color: '#FFC173', 
                fontSize: '1.1rem', 
                fontWeight: 'bold' 
              }}>
                🌀 Foggy Gauge! Values Hidden!
              </div>
            )}
            <div style={{ fontSize: '3rem', marginBottom: 24, color: 'white', fontWeight: 'bold' }}>
              {isScrambled && !gameState?.isReveal ? '???' : sliderValue}
            </div>
            <input 
                type="range" 
                min={question.min} 
                max={question.max} 
                value={sliderValue}
                onChange={(e) => setSliderValue(Number(e.target.value))}
                disabled={answered || isFrozen || gameState?.isReveal || isPaused}
                className="custom-slider"
                style={{ width: '100%', maxWidth: 600, marginBottom: 12 }}
              />
            <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 600, margin: '0 auto 32px auto', color: 'var(--amber-tint)', fontWeight: 'bold', fontSize: '1.2rem' }}>
               <span>{isScrambled && !gameState?.isReveal ? '?' : question.min}</span>
               <span>{isScrambled && !gameState?.isReveal ? '?' : question.max}</span>
            </div>
            <button 
              className="btn btn-primary" 
              disabled={answered || isFrozen || gameState?.isReveal || isPaused}
              onClick={() => submitAnswer(sliderValue)}
              style={{ width: '100%', maxWidth: 400, fontSize: '1.2rem', padding: '16px' }}
            >
              Submit Answer
            </button>
            {gameState?.isReveal && (
                <div style={{ marginTop: 24, textAlign: 'center' }}>
                  <div style={{ 
                    display: 'inline-block',
                    background: 'linear-gradient(135deg, var(--amber-tint), var(--amber))', 
                    border: '4px solid var(--indigo-deep)',
                    borderRadius: 12,
                    padding: '16px 32px',
                    boxShadow: '0 4px 0 var(--indigo-deep)'
                  }}>
                    <div style={{ color: 'var(--indigo)', fontWeight: 700, fontSize: '0.9rem', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>CORRECT ANSWER</div>
                    <div style={{ color: 'var(--indigo-deep)', fontSize: '2.5rem', fontWeight: 900, fontFamily: "'Fredoka One', cursive" }}>
                      {gameState.correctNumber !== undefined ? gameState.correctNumber : question.correctNumber}
                    </div>
                  </div>
                </div>
              )}
          </div>
        )}

        {question.type === 'match' && (
          <MatchGame 
             key={gameState?.index}
             question={question} 
             answered={answered} 
             isFrozen={isFrozen} 
             isReveal={gameState?.isReveal} 
             isPaused={isPaused}
             isScrambled={isScrambled}
             oraclePair={oracleMatchPair && oracleMatchPair.questionIndex === gameState?.index ? oracleMatchPair.autoPair : null}
             scrambleTrigger={matchScrambleTrigger}
             onMatchesChange={(m) => { matchPairsRef.current = m; }}
             submitAnswer={submitAnswer} 
            />
          )}
      </div>


      {isScrambled && (
        <motion.div
          className="frozen-notice"
          style={{ background: 'linear-gradient(135deg, var(--plum), var(--orange))', color: 'white', border: 'none' }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          🌀 Scrambled! Click the ORIGINAL COLOR of your answer!
        </motion.div>
      )}
      {isFrozen && (
        <motion.div
          style={{
             position: 'fixed',
             top: 0, left: 0, right: 0, bottom: 0,
             background: 'rgba(150, 210, 255, 0.35)', // low opacity light blue
             pointerEvents: 'all', // blocks clicks
             zIndex: 9999,
             display: 'flex',
             flexDirection: 'column',
             justifyContent: 'center',
             alignItems: 'center',
             backdropFilter: 'blur(3px)'
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="snowflakes" aria-hidden="true">
            <div className="snowflake">❅</div>
            <div className="snowflake">❆</div>
            <div className="snowflake">❅</div>
            <div className="snowflake">❆</div>
            <div className="snowflake">❅</div>
            <div className="snowflake">❆</div>
            <div className="snowflake">❅</div>
            <div className="snowflake">❆</div>
          </div>
          <div style={{
              background: 'rgba(255, 255, 255, 0.95)', 
              padding: '30px 50px', 
              borderRadius: '24px', 
              color: '#0066cc', 
              fontSize: '2.5rem', 
              fontWeight: '900',
              fontFamily: "'Fredoka One', cursive",
              boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
              textAlign: 'center',
              border: '6px solid #b3d9ff', transform: 'scale(0.8)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', whiteSpace: 'nowrap', marginBottom: '8px' }}>
              <span>❄️</span>
              <span>DEEP FREEZE</span>
              <span>❄️</span>
            </div>
            <span style={{fontSize: '1.2rem', color: '#66a3ff', fontFamily: 'Inter, sans-serif'}}>You have been frozen</span>
          </div>
        </motion.div>
      )}
      {answered && !isFrozen && (
        <motion.div
          style={{ textAlign: 'center', color: 'white', fontSize: '1.2rem', marginTop: 24 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          ⏳ Waiting for others...
          {answerCount && ` (${answerCount.answered}/${answerCount.total} answered)`}
        </motion.div>
      )}
      {!answered && !isFrozen && answerCount && (
        <div style={{ textAlign: 'center', color: 'white', fontSize: '1rem', marginTop: 24, opacity: 0.85 }}>
          <AnimatedScore value={answerCount.answered} />/{answerCount.total} answered
        </div>
      )}
    </div>
  );
}

export default GameScreen;







