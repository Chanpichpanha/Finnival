import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const POWERS = [
  { id: 'blind', name: 'Blackout', icon: '🌑', desc: 'Blind every other player for 10 seconds.' },
  { id: 'steal', name: 'Heist', icon: '🪝', desc: 'Steal 50% of one rival\'s points this round if they guess right.' },
  { id: 'hint', name: 'Oracle', icon: '🔮', desc: 'Eliminate two wrong answers this round.' },
  { id: 'freeze', name: 'Deep Freeze', icon: '❄️', desc: 'Lock one rival out for 10 seconds.' },
  { id: 'scramble', name: 'Scramble', icon: '🌀', desc: 'Shuffle answer colors for everyone else.' }
];

const POWER_SELECT_DURATION_MS = 120000;

function formatMmSs(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function PowerSelectScreen({ socket, room, pin, playerId }) {
  const [selected, setSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(Math.floor(POWER_SELECT_DURATION_MS / 1000));
  const me = room?.players.find((p) => p.id === playerId);
  const isHost = room?.host?.id === playerId;
  const nonHostPlayers = room?.players.filter((p) => !p.isHost) || [];
  const chosenCount = nonHostPlayers.filter((p) => p.powerChosen).length;

  useEffect(() => {
    if (me?.powerChosen && !confirmed) setConfirmed(true);
  }, [me?.powerChosen, confirmed]);

  useEffect(() => {
    const durationMs = room?.powerSelectDurationMs || POWER_SELECT_DURATION_MS;
    const interval = setInterval(() => {
      const elapsed = (Date.now() - (room?.powerSelectStartedAt || Date.now())) / 1000;
      const remaining = Math.max(0, durationMs / 1000 - elapsed);
      setTimeLeft(Math.ceil(remaining));
    }, 250);
    return () => clearInterval(interval);
  }, [room?.powerSelectStartedAt, room?.powerSelectDurationMs]);

  const [confirmError, setConfirmError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const confirmPower = () => {
    if (!selected || confirmed || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    socket.emit('choosePower', { power: selected }, (res) => {
      setConfirming(false);
      if (!res?.ok) {
        setConfirmError(res?.message || 'Could not lock in your power. Please try again.');
      }
    });
  };

  const forceStart = () => {
    socket.emit('forceStartFromPowerSelect');
  };

  if (isHost) {
    return (
      <div className="screen-center">
        <div className="card" style={{ textAlign: 'center', maxWidth: 600 }}>
          <h2 style={{ marginBottom: 8 }}>⏳ Waiting for Players to Choose Powers</h2>
          <p style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--purple)', marginBottom: 16 }}>
            {chosenCount}/{nonHostPlayers.length} players ready
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginBottom: 24 }}>
            {nonHostPlayers.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{
                  padding: '10px 16px',
                  borderRadius: 12,
                  border: '3px solid var(--dark)',
                  background: p.powerChosen ? 'var(--green)' : 'white',
                  color: p.powerChosen ? 'var(--dark)' : 'var(--muted)',
                  fontWeight: 700,
                  minWidth: 120
                }}
              >
                <div style={{ fontSize: '1.5rem' }}>{p.avatar}</div>
                <div>{p.name}</div>
                <div style={{ fontSize: '0.8rem' }}>{p.powerChosen ? '✅ Ready' : '⏳ Picking...'}</div>
              </motion.div>
            ))}
          </div>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Auto-start in {formatMmSs(timeLeft)}. Force Start assigns random powers to anyone still picking.</p>
          <motion.button
            className="btn btn-primary"
            onClick={forceStart}
            style={{ width: '100%', fontSize: '1.1rem' }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            🚀 Force Start
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-center">
      <div className="card" style={{ textAlign: 'center', maxWidth: 700 }}>
        <h2 style={{ marginBottom: 8 }}>Choose Your Power</h2>
        <p style={{ marginBottom: 8, color: 'var(--muted)' }}>Pick wisely — it recharges every 2 minutes, so you can use it again and again!</p>
        <p style={{ marginBottom: 24, fontWeight: 700, color: timeLeft <= 30 ? 'var(--red)' : 'var(--purple)' }}>
          ⏱ {formatMmSs(timeLeft)} remaining
        </p>

        {!confirmed ? (
          <>
            <div className="power-grid">
              {POWERS.map((p, i) => (
                <motion.div
                  key={p.id}
                  className={`power-card ${selected === p.id ? 'selected' : ''}`}
                  onClick={() => setSelected(p.id)}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: selected === p.id ? 1.05 : 1,
                    rotate: selected === p.id ? -1.5 : 0
                  }}
                  transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 20 }}
                  whileHover={{ scale: 1.06, rotate: 1.5, y: -6 }}
                  whileTap={{ scale: 0.95, rotate: -1 }}
                >
                  <div className="power-icon">{p.icon}</div>
                  <h3>{p.name}</h3>
                  <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>{p.desc}</p>
                </motion.div>
              ))}
            </div>

            {confirmError && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                style={{ color: 'var(--red)', fontWeight: 700, marginTop: 16 }}
              >
                ⚠️ {confirmError}
              </motion.p>
            )}

            <motion.button
              className="btn btn-primary"
              onClick={confirmPower}
              disabled={!selected || confirming}
              style={{ marginTop: 16, width: '100%', fontSize: '1.2rem' }}
              whileHover={!selected || confirming ? {} : { scale: 1.03 }}
              whileTap={!selected || confirming ? {} : { scale: 0.97 }}
            >
              {confirming ? 'Locking in...' : 'Confirm Power'}
            </motion.button>
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ padding: 32 }}
          >
            <div style={{ fontSize: '4rem', marginBottom: 16 }}>✅</div>
            <h3 style={{ marginBottom: 8 }}>Power Locked In!</h3>
            <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Waiting for other players...</p>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--purple)' }}>
              {chosenCount}/{nonHostPlayers.length} players ready
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default PowerSelectScreen;


