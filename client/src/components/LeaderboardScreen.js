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
      <div className="card" style={{ maxWidth: 600 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 24 }}>Leaderboard</h2>

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
                  bgColor = 'rgba(255, 215, 0, 0.1)'; 
                  pillBg = '#FFD700'; 
                  pillColor = '#000';
                } else if (p.rank === 2) { 
                  rankDisplay = '🥈'; 
                  bgColor = 'rgba(192, 192, 192, 0.1)'; 
                  pillBg = '#E0E0E0'; 
                  pillColor = '#000';
                } else if (p.rank === 3) { 
                  rankDisplay = '🥉'; 
                  bgColor = 'rgba(205, 127, 50, 0.1)'; 
                  pillBg = '#CD7F32'; 
                  pillColor = '#FFF';
                }
                
                const isMe = p.id === playerId;
                if (isMe && p.rank > 3) bgColor = 'rgba(255, 255, 255, 0.4)';
                
                return (
                  <motion.tr
                    key={p.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: i * 0.1 }}
                    style={{
                      background: bgColor,
                      fontWeight: isMe ? 'bold' : 'normal',
                      border: isMe ? '2px solid rgba(0, 0, 0, 0.1)' : 'none'
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
                        boxShadow: p.rank <= 3 ? '0 3px 6px rgba(0,0,0,0.15)' : 'none'
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
      </div>
    </div>
  );
}

export default LeaderboardScreen;
