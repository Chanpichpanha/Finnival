const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

content = content.replace(
    /<div\s+ref=\{containerRef\}\s+style=\{\{ display: 'flex', gap: 60, justifyContent: 'center', position: 'relative', touchAction: 'none' \}\}\s*>/,
    `<div ref={containerRef} style={{ display: 'flex', gap: 60, justifyContent: 'center', position: 'relative', touchAction: 'none' }} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>`
);
content = content.replace(
    /<div\s+style=\{\{ display: 'flex', gap: 60, justifyContent: 'center', position: 'relative', touchAction: 'none' \}\}\s+ref=\{containerRef\}\s*>/,
    `<div style={{ display: 'flex', gap: 60, justifyContent: 'center', position: 'relative', touchAction: 'none' }} ref={containerRef} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>`
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Added local pointer handlers back to div.");
