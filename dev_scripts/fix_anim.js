const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

content = content.replace(
    /transition=\{\{ duration: 0\.5, type: 'spring', bounce: 0\.5 \}\}/g,
    "transition={{ duration: 0.6, type: 'spring', bounce: 0.5 }}"
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Slowed down animation.");
