const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// Remove the wrongly placed isComplete
content = content.replace(
    /const isComplete = Object\.keys\(matches\)\.length === \(question\.pairs\?\.length \|\| 0\);/,
    ""
);

// Add it correctly after all the hooks
content = content.replace(
    /const rightRefs = useRef\(\[\]\);/,
    `const rightRefs = useRef([]);
    
    const isComplete = Object.keys(matches).length === (question.pairs?.length || 0);`
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Moved isComplete down after matches is initialized.");
