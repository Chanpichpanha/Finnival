const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// Remove opacity logic from the left buttons
content = content.replace(
    /opacity: isReveal && matches\[i\] !== i \? 0\.6 : 1,/g,
    ""
);

// Remove opacity logic from the right buttons
content = content.replace(
    /opacity: isReveal && !Object\.entries\(matches\)\.some\(\(\[l, r\]\) => parseInt\(l, 10\) === r && r === realIndex\) \? 0\.6 : 1/g,
    ""
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Removed opacity dimming for incorrect boxes.");
