const fs = require("fs");
let content = fs.readFileSync("server/index.js", "utf8");

content = content.replace(
`        if (Array.isArray(answers) && totalPairs > 0) {
          answers.forEach((ans) => {
            const pair = q.pairs.find(p => p.left === ans.left);
            if (pair && pair.right === ans.right) correctPairs++;
          });`,
`        if (Array.isArray(answers) && totalPairs > 0) {
          answers.forEach((ans) => {
            // Both left and right are submitted as indexes of the pairs array.
            // Since the pairs are defined linearly in LobbyScreen, index 0 left matches index 0 right.
            if (ans.left === ans.right) correctPairs++;
          });`
);

fs.writeFileSync("server/index.js", content);
console.log("Fixed match grading in server/index.js.");
