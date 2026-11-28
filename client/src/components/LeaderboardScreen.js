import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function AnimatedScore({ value }) {
  const [display, setDisplay] = useState(value);
  const startRef = useRef(value);

  useEffect(() => {
    const start = startRef.current;
    const end = value;
    if (start === end) return;
    const duration = 800;
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

  return <span>{display}</span>;
}

const AUTO_ADVANCE_SECONDS = 5;

function LeaderboardScreen({ socket, gameState, room, pin, playerId }) {
  const isHost = room?.host?.id === playerId;
  const [countdown, setCountdown] = useState(AUTO_ADVANCE_SECONDS);

  useEffect(() => {
    if (!isHost) return;
    setCountdown(AUTO_ADVANCE_SECONDS);

    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    const timeout = setTimeout(() => {
      socket.emit('nextQuestion', { pin });
    }, AUTO_ADVANCE_SECONDS * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isHost, gameState?.index, socket, pin]);

  if (!gameState) return null;
  const { leaderboard, lastRound } = gameState;

  return (
    <div className="screen-center">
      <motion.div
        className="card"
        style={{ maxWidth: 600, width: '100%' }}
        initial={{ opacity: 0, scale: 0.9, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      >
        <motion.h2
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 20 }}
          style={{ textAlign: 'center', marginBottom: 24 }}
        >
          🏅 Leaderboard
        </motion.h2>

        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {leaderboard.map((p, i) => {
                let rankDisplay = `#${p.rank}`;
                let bgColor = 'transparent';
                let pillBg = 'var(--light)';
                let pillColor = 'var(--dark)';
                
                if (p.rank === 1) { 
                  rankDisplay = '🥇'; 
                  bgColor = 'rgba(255, 175, 80, 0.15)'; 
                  pillBg = 'var(--amber)'; 
                  pillColor = 'var(--indigo-deep)';
                } else if (p.rank === 2) { 
                  rankDisplay = '🥈'; 
                  bgColor = 'rgba(130, 76, 151, 0.12)'; 
                  pillBg = 'var(--plum-tint)'; 
                  pillColor = 'var(--indigo)';
                } else if (p.rank === 3) { 
                  rankDisplay = '🥉'; 
                  bgColor = 'rgba(237, 116, 63, 0.12)'; 
                  pillBg = 'var(--orange)'; 
                  pillColor = '#FFF';
                }
                
                const isMe = p.id === playerId;
                if (isMe && p.rank > 3) bgColor = 'var(--amber-tint)';
                
                return (
                  <motion.tr
                    key={p.id}
                    initial={{ opacity: 0, x: -24, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: i * 0.08, type: 'spring', stiffness: 320, damping: 22 }}
                    style={{
                      background: bgColor,
                      fontWeight: isMe ? 'bold' : 'normal',
                      border: isMe ? '2px solid var(--orange)' : 'none'
                    }}
                  >
                    <td style={{ fontSize: '1.6rem', textAlign: 'center' }}>{rankDisplay}</td>
                    <td style={{ fontSize: isMe ? '1.2rem' : '1.1rem' }}>
                      <span style={{ marginRight: 8 }}>{p.avatar}</span>
                      {p.name} {isMe && <span style={{fontSize: '0.8rem', opacity: 0.5}}>(You)</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{
                        background: pillBg,
                        color: pillColor,
                        padding: '4px 12px',
                        borderRadius: '20px',
                        display: 'inline-block',
                        fontWeight: '900',
                        fontSize: '1.1rem',
                        boxShadow: p.rank <= 3 ? '0 3px 6px rgba(42,33,66,0.25)' : 'none'
                      }}>
                        <AnimatedScore value={p.score} />
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>

        {isHost && (
          <motion.button
            className="btn btn-primary"
            onClick={() => socket.emit('nextQuestion', { pin })}
            style={{ marginTop: 24, width: '100%' }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Next Question ({countdown}s)
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}

export default LeaderboardScreen;
