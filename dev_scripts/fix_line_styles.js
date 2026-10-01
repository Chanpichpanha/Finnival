const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

content = content.replace(
    /stroke="#1e272e" strokeWidth=\{13\} strokeLinecap="round" strokeDasharray="16 16"/,
    'stroke="#1e272e" strokeWidth={13} strokeLinecap="round" strokeDasharray="16 16" style={{ transition: "none" }}'
);
content = content.replace(
    /stroke="#ffffff" strokeWidth=\{8\} strokeLinecap="round" strokeDasharray="16 16"/,
    'stroke="#ffffff" strokeWidth={8} strokeLinecap="round" strokeDasharray="16 16" style={{ transition: "none" }}'
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Added style={{ transition: 'none' }} to drag lines.");
