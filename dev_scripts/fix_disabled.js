const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// Remove disabled from left and right buttons. 
// Note: We leave it on the "Submit Matches" button because that one uses !isComplete
content = content.replace(
    /disabled=\{answered \|\| isFrozen \|\| isReveal\}/g,
    ""
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Removed disabled attribute from Match boxes.");
