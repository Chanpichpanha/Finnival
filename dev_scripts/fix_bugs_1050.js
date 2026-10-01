const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// 1. Fix isComplete by computing it locally and removing from props
content = content.replace(
    /export default function MatchGame\(\{ question, submitAnswer, isComplete, answered, isFrozen, isReveal \}\) \{/,
    `export default function MatchGame({ question, submitAnswer, answered, isFrozen, isReveal }) {
    const isComplete = Object.keys(matches).length === (question.pairs?.length || 0);`
);

// 2. Fix stuck line and out-of-bounds tracking by adding a global useEffect
const useEffectInjection = `
    useEffect(() => {
        const handleGlobalPointerMove = (e) => {
            if (activeDragTarget !== null) {
                setPointerPos({ x: e.clientX, y: e.clientY });
            }
        };
        const handleGlobalPointerUp = (e) => {
            if (activeDragTarget === null) return;
            
            const rightBtn = document.elementFromPoint(e.clientX, e.clientY)?.closest('.match-right-btn');
            if (rightBtn) {
                const rightIdx = parseInt(rightBtn.getAttribute('data-index'), 10);
                setMatches(prev => {
                    const newMatches = { ...prev };
                    Object.keys(newMatches).forEach(key => {
                        if (newMatches[key] === rightIdx) delete newMatches[key];
                    });
                    newMatches[activeDragTarget] = rightIdx;
                    return newMatches;
                });
            }
            
            setActiveDragTarget(null);
            setPointerPos(null);
        };

        if (activeDragTarget !== null) {
            window.addEventListener('pointermove', handleGlobalPointerMove);
            window.addEventListener('pointerup', handleGlobalPointerUp);
        }
        return () => {
            window.removeEventListener('pointermove', handleGlobalPointerMove);
            window.removeEventListener('pointerup', handleGlobalPointerUp);
        };
    }, [activeDragTarget]);
`;

// Insert the useEffect right before `const handlePointerDown = ...`
content = content.replace(
    /const handlePointerDown = \(e, leftIdx\) => \{/,
    useEffectInjection + "\n    const handlePointerDown = (e, leftIdx) => {"
);

// We no longer need the local handlePointerMove and handlePointerUp since they are handled globally
content = content.replace(
    /const handlePointerMove = \([\s\S]*?setPointerPos\(null\);\s*\};/g,
    ""
);

// Remove the local handlers from the container div
content = content.replace(
    /onPointerMove=\{handlePointerMove\} onPointerUp=\{handlePointerUp\} onPointerCancel=\{handlePointerUp\}/,
    ""
);

// 3. Fix the CSS transition bug on the drag line by adding transition: 'none'
content = content.replace(
    /stroke="#1e272e" strokeWidth=\{13\} strokeLinecap="round" strokeDasharray="16 16"/g,
    'stroke="#1e272e" strokeWidth={13} strokeLinecap="round" strokeDasharray="16 16" style={{ transition: "none" }}'
);
content = content.replace(
    /stroke="#ffffff" strokeWidth=\{8\} strokeLinecap="round" strokeDasharray="16 16"/g,
    'stroke="#ffffff" strokeWidth={8} strokeLinecap="round" strokeDasharray="16 16" style={{ transition: "none" }}'
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Fixed isComplete, added global listeners, and patched CSS transition!");
