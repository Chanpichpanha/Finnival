const fs = require('fs');
const file = 'client/src/components/LeaderboardScreen.js';
let content = fs.readFileSync(file, 'utf8');

const target = `              {leaderboard.map((p, i) => (
                <motion.tr
                  key={p.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: i * 0.1 }}
                  style={{
                    background: p.id === playerId ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
                    fontWeight: p.id === playerId ? 'bold' : 'normal'
                  }}
                >
                  <td style={{ fontSize: '1.2rem' }}>#{p.rank}</td>
                  <td>
                    <span style={{ marginRight: 8 }}>{p.avatar}</span>
                    {p.name}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: '1.2rem' }}>
                    <AnimatedScore value={p.score} />
                  </td>
                </motion.tr>
              ))}`;

const replacement = `              {leaderboard.map((p, i) => {
                let rankDisplay = \`#\${p.rank}\`;
                let bgColor = 'transparent';
                let scoreColor = 'inherit';
                if (p.rank === 1) { rankDisplay = '🥇'; bgColor = 'rgba(255, 215, 0, 0.15)'; scoreColor = '#FFD700'; }
                else if (p.rank === 2) { rankDisplay = '🥈'; bgColor = 'rgba(192, 192, 192, 0.15)'; scoreColor = '#E0E0E0'; }
                else if (p.rank === 3) { rankDisplay = '🥉'; bgColor = 'rgba(205, 127, 50, 0.15)'; scoreColor = '#CD7F32'; }
                const isMe = p.id === playerId;
                if (isMe && p.rank > 3) bgColor = 'rgba(255, 255, 255, 0.2)';
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
                      border: isMe ? '2px solid rgba(255, 255, 255, 0.3)' : 'none'
                    }}
                  >
                    <td style={{ fontSize: '1.6rem', textAlign: 'center' }}>{rankDisplay}</td>
                    <td style={{ fontSize: isMe ? '1.2rem' : '1.1rem' }}>
                      <span style={{ marginRight: 8 }}>{p.avatar}</span>
                      {p.name} {isMe && <span style={{fontSize: '0.8rem', opacity: 0.7}}>(You)</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '1.2rem', color: scoreColor, fontWeight: p.rank <= 3 ? 'bold' : 'normal', textShadow: p.rank <= 3 ? '0px 0px 8px rgba(0,0,0,0.5)' : 'none' }}>
                      <AnimatedScore value={p.score} />
                    </td>
                  </motion.tr>
                );
              })}`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Successfully updated LeaderboardScreen.js!');
} else {
    console.error('Target not found in LeaderboardScreen.js!');
}
