const fs = require("fs");
let content = fs.readFileSync("server/index.js", "utf8");
content = content.replace(
    'console.log("CALCULATED POINTS:", points, "ACCURACY:", accuracy, "CORRECT_PAIRS:", correctPairs);',
    'console.log("CALCULATED POINTS:", points, "ACCURACY:", accuracy);'
);
fs.writeFileSync("server/index.js", content);
console.log("Fixed debug log scoping.");
