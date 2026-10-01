const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

content = content.replace(
    /onPointerMove=\{handlePointerMove\}\s*onPointerUp=\{handlePointerUp\}\s*onPointerCancel=\{handlePointerUp\}/g,
    ""
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Cleaned up div handlers.");
