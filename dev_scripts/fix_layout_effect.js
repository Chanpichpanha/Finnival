const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// We need to add state for dragLineCoords and linesCoords
// Let's find the state declarations
content = content.replace(
    /const \[pointerPos, setPointerPos\] = useState\(null\);/,
    `const [pointerPos, setPointerPos] = useState(null);
    const [dragLineCoords, setDragLineCoords] = useState(null);
    const [linesCoords, setLinesCoords] = useState([]);`
);

// Now let's remove the inline calculations and replace with useLayoutEffect
const inlineCalcRegex = /\s*\/\/ Calculate active drag line[\s\S]*?let dragLine = null;[\s\S]*?y2: pointerPos\.y - containerRect\.top\s*\}\;\s*\}\s*\}/;

const layoutEffectHook = `
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        
        // Calculate colored lines
        const newLines = [];
        Object.entries(matches).forEach(([leftIdxStr, rightIdx]) => {
            const leftIdx = parseInt(leftIdxStr, 10);
            const leftEl = leftRefs.current[leftIdx];
            const rightEl = rightRefs.current[rightIdx];
            if (leftEl && rightEl) {
                const lRect = leftEl.getBoundingClientRect();
                const rRect = rightEl.getBoundingClientRect();
                newLines.push({
                    leftIdx,
                    rightIdx,
                    x1: lRect.right - containerRect.left - 15,
                    y1: lRect.top + lRect.height / 2 - containerRect.top,
                    x2: rRect.left - containerRect.left + 15,
                    y2: rRect.top + rRect.height / 2 - containerRect.top
                });
            }
        });
        setLinesCoords(newLines);

        // Calculate drag line
        if (activeDragTarget !== null && pointerPos) {
            const leftEl = leftRefs.current[activeDragTarget];
            if (leftEl) {
                const lRect = leftEl.getBoundingClientRect();
                setDragLineCoords({
                    x1: lRect.right - containerRect.left - 15,
                    y1: lRect.top + lRect.height / 2 - containerRect.top,
                    x2: pointerPos.x - containerRect.left,
                    y2: pointerPos.y - containerRect.top
                });
            } else {
                setDragLineCoords(null);
            }
        } else {
            setDragLineCoords(null);
        }
    }, [matches, activeDragTarget, pointerPos]);
`;

content = content.replace(inlineCalcRegex, layoutEffectHook);

// Also remove the old `const lines = []; ...` calculation
const oldLinesRegex = /\s*const lines = \[\];[\s\S]*?\}\s*\);\s*\}\s*\);\s*\}/;
content = content.replace(oldLinesRegex, "");

// In the JSX, replace `lines.map` with `linesCoords.map`
content = content.replace(/\{lines\.map\(\(l, i\) => \{/g, "{linesCoords.map((l, i) => {");

// In the JSX, replace `dragLine` with `dragLineCoords`
content = content.replace(/\{dragLine && \(/g, "{dragLineCoords && (");
content = content.replace(/dragLine\.x1/g, "dragLineCoords.x1");
content = content.replace(/dragLine\.y1/g, "dragLineCoords.y1");
content = content.replace(/dragLine\.x2/g, "dragLineCoords.x2");
content = content.replace(/dragLine\.y2/g, "dragLineCoords.y2");

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Refactored to useLayoutEffect.");
