const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

content = content.replace(
`  const submitAnswer = (index) => {
    if (answered || isFrozen) return;
    setAnswered(true);
    setSelectedOption(index);
    const finalAnswer = isScrambled ? scrambleMap[index] : index;
    socket.emit('submitAnswer', { answerIndex: finalAnswer, clientTime: gameState.startedAt });
  };`,
`  const submitAnswer = (index) => {
    if (answered || isFrozen) return;
    setAnswered(true);
    setSelectedOption(index);
    const finalAnswer = (isScrambled && typeof index === 'number') ? scrambleMap[index] : index;
    socket.emit('submitAnswer', { answerIndex: finalAnswer, clientTime: gameState.startedAt });
  };`
);

fs.writeFileSync("client/src/components/GameScreen.js", content);
console.log("Fixed submitAnswer in GameScreen.js");
