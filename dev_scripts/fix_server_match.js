const fs = require("fs");
let content = fs.readFileSync("server/index.js", "utf8");

content = content.replace(
    /const pair = q\.pairs\.find\(p => p\.left === ans\.left\);\s*if \(pair && pair\.right === ans\.right\) correctPairs\+\+;/g,
    "if (ans.left === ans.right) correctPairs++;"
);

fs.writeFileSync("server/index.js", content);
console.log("Fixed Match scoring logic.");
