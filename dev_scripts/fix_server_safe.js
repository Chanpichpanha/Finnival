const fs = require("fs");
let content = fs.readFileSync("server/index.js", "utf8");

content = content.replace(
    /if \(ans\.left === ans\.right\) correctPairs\+\+;/g,
    "if (Number(ans.left) === Number(ans.right)) correctPairs++;"
);

fs.writeFileSync("server/index.js", content);
console.log("Made server grading type-safe.");
