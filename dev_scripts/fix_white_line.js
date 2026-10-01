const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

content = content.replace(
    /stroke="#fbc531" strokeWidth=\{8\} strokeLinecap="round" strokeDasharray="16 16"/,
    'stroke="#ffffff" strokeWidth={8} strokeLinecap="round" strokeDasharray="16 16"'
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Restored the white drag line!");
