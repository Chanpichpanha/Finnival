const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

content = content.replace(
    /border:\s*answered\s*&&\s*selectedOption\s*===\s*i\s*\?\s*'4px\s*solid\s*white'\s*:\s*'none'/g,
    "border: answered && selectedOption === i ? '4px solid white' : '3px solid var(--dark)'"
);

fs.writeFileSync("client/src/components/GameScreen.js", content);
console.log("Updated GameScreen.js border inline style successfully.");
