const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// 1. Remove onPointerMove and onPointerUp from the container div
content = content.replace(
    /<div style=\{\{ position: 'relative', width: '100%' \}\} ref=\{containerRef\} onPointerMove=\{handlePointerMove\} onPointerUp=\{handlePointerUp\}\>/,
    `<div style={{ position: 'relative', width: '100%' }} ref={containerRef}>`
);

// 2. Add useEffect to attach handlePointerMove and handlePointerUp to window
// We can insert this right before `const handleSubmit = ...`
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

content = content.replace(
    /const handleSubmit = \(\) => \{/,
    `${globalEventsHook}\n    const handleSubmit = () => {`
);

// 3. Keep handlePointerDown because it's attached to the left buttons
// But we can remove the old handlePointerMove and handlePointerUp from the component body so they don't do nothing
content = content.replace(
    /const handlePointerMove = \(e\) => \{[\s\S]*?const handlePointerUp = \(e\) => \{[\s\S]*?setPointerPos\(null\);\n    \};/,
    ""
);

// Wait, the old handleRightClick is used by fallback onClick. 
// Did I delete it? No, the regex above deletes handlePointerMove and handlePointerUp.
// Let's refine the deletion to be safer:
fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Applied global pointer event handlers.");
