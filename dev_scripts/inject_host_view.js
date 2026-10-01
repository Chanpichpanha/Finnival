const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

content = content.replace(
`          <div className="card" style={{ marginBottom: 16 }}>
            <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: 4 }}>Current question (read-only)</p>
            {(!question.type || question.type === 'classic') && (
              <p>Correct answer: Option {['A', 'B', 'C', 'D'][gameState?.question?.correctAnswer]}</p>
            )}`,
`          <div className="card" style={{ marginBottom: 16 }}>
            <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: 4 }}>Current question (read-only)</p>
            {(!question.type || question.type === 'classic') && (
              <p>Correct answer: Option {String.fromCharCode(65 + (gameState?.question?.correctAnswer || 0))}</p>
            )}`
);

// If the previous replace failed because of exact string matching, let's use a regex replace.
content = content.replace(/\{?\['A',\s*'B',\s*'C',\s*'D'\]\[.*?\]\}?/, '{String.fromCharCode(65 + (gameState?.question?.correctAnswer || 0))}');

fs.writeFileSync("client/src/components/GameScreen.js", content);
console.log("Updated GameScreen.js host view successfully.");
