import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { playPodium } from '../utils/sound';

const CONFETTI_COLORS = ['#FFAF50', '#ED743F', '#824C97', '#3DBE8B', '#5B8FD9', '#FFF6EC'];

function ConfettiBurst() {
  const pieces = useMemo(() => (
    Array.from({ length: 28 }, (_, i) => ({
      id: i,
      left: `${3 + ((i * 3.4) % 94)}%`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: (i % 7) * 0.14,
      duration: 2.6 + (i % 5) * 0.45,
      rotate: (i % 2 === 0 ? 1 : -1) * (240 + (i % 4) * 90),
      drift: (i % 2 === 0 ? 1 : -1) * (18 + (i % 5) * 14)
    }))
  ), []);

  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 9990 }}>
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          className="confetti-piece"
          style={{ left: p.left, background: p.color, border: '1.5px solid var(--indigo-deep)' }}
          initial={{ y: -24, x: 0, opacity: 1, rotate: 0, scale: 0.9 }}
          animate={{ y: '105vh', x: p.drift, opacity: [1, 1, 0], rotate: p.rotate, scale: 1 }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

function AnimatedScore({ value }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const duration = 1000;
    const startTime = performance.now();
    let raf;
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span>{display}</span>;
}

function ResultsScreen({ socket, gameState, pin, setScreen }) {
  useEffect(() => {
    playPodium();
  }, []);

  if (!gameState) return null;
  const { podium, all } = gameState;

  const playAgain = () => {
    socket.emit('playAgain');
    setScreen('lobby');
  };

  return (
    <div className="screen-center">
      <ConfettiBurst />
      <motion.div
        className="card"
        style={{ maxWidth: 600, width: '100%', textAlign: 'center' }}
        initial={{ opacity: 0, scale: 0.9, y: 28 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 290, damping: 22 }}
      >
        <motion.h1
          style={{ fontSize: '2.5rem', marginBottom: 8 }}
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.2, 1] }}
          transition={{ duration: 0.5 }}
        >
          🏆 Game Over!
        </motion.h1>

        <div style={{ marginBottom: 32 }}>
          {podium?.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 40, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: i * 0.2, type: 'spring', stiffness: 260, damping: 18 }}
              style={{
                padding: '20px',
                margin: '12px 0',
                background: i === 0 ? 'linear-gradient(135deg, var(--amber), var(--orange))' : i === 1 ? 'linear-gradient(135deg, var(--plum-tint), #CFC4DC)' : 'linear-gradient(135deg, var(--orange), var(--orange-dark))',
                borderRadius: 12,
                border: '4px solid var(--indigo-deep)',
                boxShadow: '0 6px 0 var(--indigo-deep)',
                color: i < 3 ? 'white' : 'inherit',
                fontSize: i === 0 ? '1.5rem' : '1.2rem'
              }}
            >
              <motion.div
                style={{ fontSize: '3rem' }}
                initial={{ rotate: -30 }}
                animate={{ rotate: [-30, 15, 0] }}
                transition={{ delay: i * 0.2 + 0.15, duration: 0.4 }}
              >
                {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
              </motion.div>
              <div style={{ fontWeight: 800, color: 'white', letterSpacing: '1px', WebkitTextStroke: '2px var(--indigo-deep)', paintOrder: 'stroke fill' }}>{p.avatar} {p.name}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'white', letterSpacing: '1px', WebkitTextStroke: '2px var(--indigo-deep)', paintOrder: 'stroke fill' }}><AnimatedScore value={p.score} /> pts</div>
            </motion.div>
          ))}
        </div>

        <h3 style={{ marginBottom: 16 }}>Final Standings</h3>
        <table className="leaderboard-table" style={{ marginBottom: 24 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {all?.map((p, i) => (
              <motion.tr
                key={p.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.05 }}
              >
                <td>{p.rank}</td>
                <td>{p.avatar} {p.name}</td>
                <td style={{ fontWeight: 700 }}>{p.score}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>

        <motion.button
          className="btn btn-success"
          onClick={playAgain}
          style={{ width: '100%', fontSize: '1.2rem' }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          🔄 Play Again
        </motion.button>
      </motion.div>
    </div>
  );
}

export default ResultsScreen;
