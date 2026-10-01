const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

content = content.replace(
    /x2: pointerPos\.x,\s*y2: pointerPos\.y/,
    `x2: pointerPos.x - containerRect.left,
                y2: pointerPos.y - containerRect.top`
);

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Fixed dragLine coordinates.");
