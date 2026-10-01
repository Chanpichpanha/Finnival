const fs = require("fs");

// 1. Fix server/index.js
let serverContent = fs.readFileSync("server/index.js", "utf8");
const serverRegex = /if \(ansTxt && correctTxt && ansTxt\.includes\(correctTxt\) \|\| correctTxt\.includes\(ansTxt\)\) \{\s*isCorrect = true;\s*accuracy = 1;\s*\}/;

const serverReplacement = `if (ansTxt && correctTxt) {
          if (ansTxt === correctTxt) {
             isCorrect = true;
             accuracy = 1;
          } else {
             const words = correctTxt.split(/\\s+/);
             if (words.includes(ansTxt) && ansTxt.length > 4) {
                 isCorrect = true;
                 accuracy = 1;
             }
          }
        }`;
serverContent = serverContent.replace(serverRegex, serverReplacement);
fs.writeFileSync("server/index.js", serverContent);
console.log("Updated server/index.js");

// 2. Fix GameScreen.js
let clientContent = fs.readFileSync("client/src/components/GameScreen.js", "utf8");
const clientRegex = /isCorrect = ansTxt && correctTxt && \(ansTxt\.includes\(correctTxt\) \|\| correctTxt\.includes\(ansTxt\)\);/;
const clientReplacement = `if (ansTxt === correctTxt) {
                    isCorrect = true;
                } else {
                    const words = correctTxt.split(/\\s+/);
                    isCorrect = words.includes(ansTxt) && ansTxt.length > 4;
                }`;
clientContent = clientContent.replace(clientRegex, clientReplacement);
fs.writeFileSync("client/src/components/GameScreen.js", clientContent);
console.log("Updated GameScreen.js");

