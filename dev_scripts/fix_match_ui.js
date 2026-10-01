const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// 1. Fix native drag hijacking pointer events on buttons
content = content.replace(
    /onPointerDown=\{\(e\) => handlePointerDown\(e, i\)\}/g,
    "onPointerDown={(e) => handlePointerDown(e, i)}\n                            onDragStart={(e) => e.preventDefault()}\n                            draggable={false}"
);
content = content.replace(
    /onClick=\{\(\) => handleRightClick\(realIndex\)\}/g,
    "onClick={() => handleRightClick(realIndex)}\n                                onDragStart={(e) => e.preventDefault()}\n                                draggable={false}"
);

// 2. Change the dragging line color to white (instead of yellow #fbc531)
// We look for the dragLine block
const dragLineOld = `<line 
                                x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                                stroke="#fbc531" strokeWidth={8} strokeLinecap="round" strokeDasharray="16 16"
                            />`;
const dragLineNew = `<line 
                                x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                                stroke="#ffffff" strokeWidth={8} strokeLinecap="round" strokeDasharray="16 16"
                            />`;
content = content.replace(dragLineOld, dragLineNew);

// 3. Slow down the animation
// Old: transition={{ duration: 0.3, type: 'spring', bounce: 0.4 }}
// New: transition={{ duration: 0.5, type: 'spring', bounce: 0.5 }}
content = content.replace(/transition=\{\{ duration: 0\.3, type: 'spring', bounce: 0\.4 \}\}/g, "transition={{ duration: 0.5, type: 'spring', bounce: 0.5 }}");

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Applied UI fixes for MatchGame (drag hijack, drag line color, animation speed).");
