const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

// The original file is from 0 to 15721, and then from 28288 to the end!
let original = content.substring(0, 15721) + content.substring(28288);
fs.writeFileSync("client/src/components/GameScreen.js.restored", original);
console.log("Restored length:", original.length);

// Let's check if the restored file has duplicates of "if (isHost)" or "return ( <div className="question-container">"
const isHostCount = original.split("if (isHost)").length - 1;
const playerReturnCount = original.split("return (\r\n    <div className=\"question-container\">\r\n      <AnimatePresence>\r\n        {isBlind").length - 1;

console.log("isHostCount:", isHostCount);
console.log("playerReturnCount:", playerReturnCount);

