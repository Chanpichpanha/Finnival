const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

const oldSvgRegex = /<svg[\s\S]*?<\/svg>/;

const newSvg = `<svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                    {lines.map((l, i) => {
                        const isCorrect = l.leftIdx === l.rightIdx;
                        const lineColor = isReveal ? (isCorrect ? '#4cd137' : '#e84118') : '#fbc531';
                        return (
                        <g key={\`line-\${l.leftIdx}-\${l.rightIdx}\`}>
                            {/* Thick black cartoon outline */}
                            <motion.line 
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke="#1e272e"
                                strokeWidth={16}
                                strokeLinecap="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.3, type: 'spring', bounce: 0.4 }}
                            />
                            {/* Bright inner cartoon color */}
                            <motion.line 
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke={lineColor}
                                strokeWidth={10}
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
                                stroke="#1e272e" strokeWidth={16} strokeLinecap="round" strokeDasharray="16 16"
                            />
                            <line 
                                x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                                stroke="#fbc531" strokeWidth={10} strokeLinecap="round" strokeDasharray="16 16"
                            />
                        </g>
                    )}
                </svg>`;

content = content.replace(oldSvgRegex, newSvg);
fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Updated SVG to 2D Cartoony style.");
