const fs = require("fs");
let content = fs.readFileSync("client/src/App.js", "utf8");

content = content.replace(
`              setRoom(res.snapshot);
              const stateToScreen = { lobby: 'lobby', powerSelect: 'powerSelect', leaderboard: 'leaderboard', results: 'results' };
              setScreen(stateToScreen[res.snapshot.state] || 'game');
            } else {`,
`              setRoom(res.snapshot);
              const stateToScreen = { lobby: 'lobby', powerSelect: 'powerSelect', leaderboard: 'leaderboard', results: 'results' };
              setScreen(stateToScreen[res.snapshot.state] || 'game');
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
              }
            } else {`
);

fs.writeFileSync("client/src/App.js", content);
console.log("Updated client/src/App.js successfully.");
