const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

// Add import if not exists
if (!content.includes("import MatchGame")) {
    content = content.replace("import { motion } from 'framer-motion';", "import { motion } from 'framer-motion';\nimport MatchGame from './MatchGame';");
}

// Replace the old Match block
// We need to find the block starting with `{question.type === 'match' && (` inside the non-host view.
// Let's use regex with a robust match.
const oldMatchBlockRegex = /\{question\.type === 'match' && \([\s\S]*?(?=\s*\{question\.type === 'slider')/g;
// Wait, slider is ABOVE match in the code! Let's check GameScreen.js structure.
