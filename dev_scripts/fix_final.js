const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// 1. Restore the global hook
const globalEventsHook = `
    useEffect(() => {
        const onGlobalPointerMove = (e) => {
            if (activeDragTarget !== null) {
                setPointerPos({ x: e.clientX, y: e.clientY });
            }
        };
        const onGlobalPointerUp = (e) => {
            if (activeDragTarget !== null) {
                const rightBtn = document.elementFromPoint(e.clientX, e.clientY)?.closest('.match-right-btn');
                if (rightBtn) {
                    const rightIdx = parseInt(rightBtn.getAttribute('data-index'), 10);
                    const newMatches = { ...matches };
                    Object.keys(newMatches).forEach(key => {
                        if (newMatches[key] === rightIdx) delete newMatches[key];
                    });
                    newMatches[activeDragTarget] = rightIdx;
                    setMatches(newMatches);
                }
                setActiveDragTarget(null);
                setPointerPos(null);
            }
        };

        if (activeDragTarget !== null) {
            window.addEventListener('pointermove', onGlobalPointerMove);
            window.addEventListener('pointerup', onGlobalPointerUp);
        }

        return () => {
            window.removeEventListener('pointermove', onGlobalPointerMove);
            window.removeEventListener('pointerup', onGlobalPointerUp);
        };
    }, [activeDragTarget, matches]);
`;

// Remove local handlers (handlePointerMove, handlePointerUp) from body
content = content.replace(
    /const handlePointerMove = \(e\) => \{[\s\S]*?const handlePointerUp = \(e\) => \{[\s\S]*?setPointerPos\(null\);\n    \};\n/g,
    ""
);

// Inject global hook
content = content.replace(
    /const handleSubmit = \(\) => \{/,
    `${globalEventsHook}\n    const handleSubmit = () => {`
);

// Remove onPointerMove/Up from the div
content = content.replace(
    /onPointerMove=\{handlePointerMove\} onPointerUp=\{handlePointerUp\} onPointerCancel=\{handlePointerUp\}/g,
    ""
);

// 2. Put zIndex on the header text and the submit container so lines go behind them
content = content.replace(
    /<h3 style=\{\{ color: 'white', textAlign: 'center', marginBottom: 24 \}\}>/,
    `<h3 style={{ color: 'white', textAlign: 'center', marginBottom: 24, position: 'relative', zIndex: 2 }}>`
);

content = content.replace(
    /<div style=\{\{ marginTop: 32, textAlign: 'center' \}\}>/,
    `<div style={{ marginTop: 32, textAlign: 'center', position: 'relative', zIndex: 2 }}>`
);

// 3. Slow down the animation by another 15% (0.6 -> 0.7)
content = content.replace(/duration: 0\.6/g, "duration: 0.7");

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Restored global tracking perfectly, added zIndex to text, slowed animation.");
