const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

content = content.replace(
    /\s*border:\s*answered\s*&&\s*selectedOption\s*===\s*i\s*\?\s*'4px\s*solid\s*white'\s*:\s*'3px\s*solid\s*var\(--dark\)',/g,
    ""
);

fs.writeFileSync("client/src/components/GameScreen.js", content);
console.log("Removed problematic border inline style successfully.");
