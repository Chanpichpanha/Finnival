const fs = require("fs");
let content = fs.readFileSync("client/src/App.js", "utf8");

const target = `              setScreen(stateToScreen[res.snapshot.state] || 'game');`;
if (content.includes(target)) {
    const replacement = `              setScreen(stateToScreen[res.snapshot.state] || 'game');
              if (res.snapshot.state === 'question' || res.snapshot.state === 'reveal') {
                const qIndex = res.snapshot.questionIndex;
                setGameState({
                  index: qIndex,
                  question: res.snapshot.questions[qIndex],
                  total: res.snapshot.totalQuestions,
                  startedAt: res.snapshot.startedAt || Date.now(),
                  endsAt: res.snapshot.endsAt,
                  isReveal: res.snapshot.state === 'reveal',
                  correctAnswer: res.snapshot.state === 'reveal' ? res.snapshot.questions[qIndex]?.correctAnswer : undefined
                });
              }`;
    content = content.replace(target, replacement);
    fs.writeFileSync("client/src/App.js", content);
    console.log("Injected setGameState successfully.");
} else {
    console.log("Target not found!");
}
