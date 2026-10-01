const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

// 1. Add import
if (!content.includes("import MatchGame from './MatchGame';")) {
    content = content.replace("import { motion } from 'framer-motion';", "import { motion } from 'framer-motion';\nimport MatchGame from './MatchGame';");
}

// 2. Replace match block
const startStr = "{question.type === 'match' && (";
const endStr = "</div>\n              )}"; // the end of the reveal block inside match
const nextBlockStr = "</div>\n      </motion.div>"; // Just to be safe, find a reliable anchor. Wait, no.

const matchStartIdx = content.lastIndexOf(startStr); // Since it's the player block at the bottom
if (matchStartIdx > -1) {
    // Find the end of this block by finding the start of the next div or just using a well-known suffix.
    // Let's just find the closing bracket of the match block.
    let braceCount = 0;
    let endIdx = -1;
    for (let i = matchStartIdx + startStr.length - 1; i < content.length; i++) {
        if (content[i] === '(') braceCount++;
        if (content[i] === ')') braceCount--;
        if (braceCount === 0) {
            endIdx = i;
            break;
        }
    }
    
    if (endIdx > -1) {
        const replacement = `{question.type === 'match' && (
          <MatchGame 
             question={question} 
             matchOrder={matchOrder} 
             answered={answered} 
             isFrozen={isFrozen} 
             isReveal={gameState?.isReveal} 
             gameState={gameState} 
             submitAnswer={submitAnswer} 
          />
        )}`;
        
        content = content.substring(0, matchStartIdx) + replacement + content.substring(endIdx + 1);
        fs.writeFileSync("client/src/components/GameScreen.js", content);
        console.log("Injected MatchGame successfully.");
    } else {
        console.log("Could not find end of match block.");
    }
} else {
    console.log("Could not find start of match block.");
}
