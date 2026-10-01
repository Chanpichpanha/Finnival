const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// 1. Remove the useEffect global event hook
content = content.replace(/useEffect\(\(\) => \{[\s\S]*?const onGlobalPointerMove[\s\S]*?\}, \[activeDragTarget, matches\]\);\s*/, "");

// 2. Add back handlePointerMove and handlePointerUp right before handleSubmit
const localHandlers = `
    const handlePointerMove = (e) => {
        if (activeDragTarget === null) return;
        setPointerPos({ x: e.clientX, y: e.clientY });
    };

    const handlePointerUp = (e) => {
        if (activeDragTarget === null) return;
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
    };
`;

content = content.replace(/const handleSubmit = \(\) => \{/, `${localHandlers}\n    const handleSubmit = () => {`);

// 3. Add back the div pointer events
content = content.replace(
    /<div style=\{\{ display: 'flex', gap: 60, justifyContent: 'center', position: 'relative', touchAction: 'none' \}\}>/,
    `<div style={{ display: 'flex', gap: 60, justifyContent: 'center', position: 'relative', touchAction: 'none' }} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>`
);

// 4. Revert white line to yellow line
content = content.replace(/stroke="#ffffff"/g, 'stroke="#fbc531"');

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Reverted the white drag line and global tracking.");
