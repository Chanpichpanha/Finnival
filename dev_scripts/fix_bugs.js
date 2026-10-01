const fs = require("fs");

// 1. Fix GameScreen.js import
let gsContent = fs.readFileSync("client/src/components/GameScreen.js", "utf8");
if (!gsContent.includes("import MatchGame from './MatchGame';")) {
    gsContent = gsContent.replace("import { motion, AnimatePresence } from 'framer-motion';", "import { motion, AnimatePresence } from 'framer-motion';\nimport MatchGame from './MatchGame';");
    fs.writeFileSync("client/src/components/GameScreen.js", gsContent);
    console.log("Fixed GameScreen.js import.");
}

// 2. Fix LobbyScreen.js responsiveness
let lsContent = fs.readFileSync("client/src/components/LobbyScreen.js", "utf8");
lsContent = lsContent.replace(/display: 'flex', gap: 12, alignItems: 'center', background: 'rgba\(255,255,255,0\.4\)',/g, "display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.4)',");
lsContent = lsContent.replace(/style=\{\{ flex: 1, margin: 0 \}\}/g, "style={{ flex: '1 1 120px', minWidth: '120px', margin: 0 }}");
fs.writeFileSync("client/src/components/LobbyScreen.js", lsContent);
console.log("Fixed LobbyScreen.js flex wrap.");
