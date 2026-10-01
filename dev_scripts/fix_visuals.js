const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// 1. Fix the coordinates so they are tucked under the box
content = content.replace(/x1: lRect\.right - containerRect\.left,/g, "x1: lRect.right - containerRect.left - 15,");
content = content.replace(/x2: rRect\.left - containerRect\.left,/g, "x2: rRect.left - containerRect.left + 15,");
content = content.replace(/x1: lRect\.right - containerRect\.left,/g, "x1: lRect.right - containerRect.left - 15,"); // in case there's another
// dragLine coordinate fix
content = content.replace(
    /x1: lRect\.right - containerRect\.left,/g,
    "x1: lRect.right - containerRect.left - 15,"
);

// 2. Fix the zIndex issue by making the button columns position: relative
content = content.replace(
    /<div style=\{\{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, zIndex: 2 \}\}>/g,
    "<div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, zIndex: 2, position: 'relative' }}>"
);

// 3. Make lines 20% smaller and colorful
const oldSvgRegex = /<svg[\s\S]*?<\/svg>/;

const newSvg = `<svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                    {lines.map((l, i) => {
                        const isCorrect = l.leftIdx === l.rightIdx;
                        const colors = ['#fbc531', '#00a8ff', '#9c88ff', '#e84118'];
                        let lineColor = colors[l.leftIdx % colors.length];
                        if (isReveal) lineColor = isCorrect ? '#4cd137' : '#e84118';
                        
                        return (
                        <g key={\`line-\${l.leftIdx}-\${l.rightIdx}\`}>
                            {/* Thick black cartoon outline */}
                            <motion.line 
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke="#1e272e"
                                strokeWidth={13}
                                strokeLinecap="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.3, type: 'spring', bounce: 0.4 }}
                            />
                            {/* Bright inner cartoon color */}
                            <motion.line 
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke={lineColor}
                                strokeWidth={8}
                                strokeLinecap="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.3, type: 'spring', bounce: 0.4 }}
                            />
                        </g>
                        );
                    })}
                    {dragLine && (
                        <g>
                            <line 
                                x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                                stroke="#1e272e" strokeWidth={13} strokeLinecap="round" strokeDasharray="16 16"
                            />
                            <line 
                                x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                                stroke="#fbc531" strokeWidth={8} strokeLinecap="round" strokeDasharray="16 16"
                            />
                        </g>
                    )}
                </svg>`;

content = content.replace(oldSvgRegex, newSvg);
fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Fixed sizes, zIndex, and colors.");
