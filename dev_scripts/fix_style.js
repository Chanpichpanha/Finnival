const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

const oldSvg = `<svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                    {lines.map((l, i) => (
                        <motion.line 
                            key={\`line-\${l.leftIdx}-\${l.rightIdx}\`}
                            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                            stroke={isReveal ? (l.leftIdx === l.rightIdx ? '#4cd137' : '#e84118') : 'rgba(255,255,255,0.8)'}
                            strokeWidth={6}
                            strokeLinecap="round"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.3 }}
                        />
                    ))}
                    {dragLine && (
                        <line 
                            x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                            stroke="rgba(255,255,255,0.5)" strokeWidth={6} strokeDasharray="8 8" strokeLinecap="round"
                        />
                    )}
                </svg>`;

const newSvg = `<svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                    <defs>
                        <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                            <feMerge>
                                <feMergeNode in="coloredBlur"/>
                                <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                        </filter>
                        <linearGradient id="energy-beam" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#00a8ff" />
                            <stop offset="50%" stopColor="#9c88ff" />
                            <stop offset="100%" stopColor="#fbc531" />
                        </linearGradient>
                    </defs>
                    {lines.map((l, i) => {
                        const isCorrect = l.leftIdx === l.rightIdx;
                        const lineColor = isReveal ? (isCorrect ? '#4cd137' : '#e84118') : 'url(#energy-beam)';
                        const glowColor = isReveal ? (isCorrect ? '#4cd137' : '#e84118') : '#9c88ff';
                        return (
                        <motion.line 
                            key={\`line-\${l.leftIdx}-\${l.rightIdx}\`}
                            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                            stroke={lineColor}
                            strokeWidth={8}
                            strokeLinecap="round"
                            filter="url(#neon-glow)"
                            style={{ filter: \`drop-shadow(0 0 8px \${glowColor})\` }}
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.4, type: 'spring', bounce: 0.2 }}
                        />
                        );
                    })}
                    {dragLine && (
                        <line 
                            x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                            stroke="#00a8ff" strokeWidth={6} strokeDasharray="12 12" strokeLinecap="round"
                            style={{ filter: 'drop-shadow(0 0 6px #00a8ff)' }}
                        />
                    )}
                </svg>`;

if (content.includes("<svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>")) {
    content = content.replace(oldSvg, newSvg);
    fs.writeFileSync("client/src/components/MatchGame.js", content);
    console.log("Updated SVG styling in MatchGame.");
} else {
    console.log("Could not find the SVG block to replace.");
}
