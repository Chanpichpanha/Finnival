const fs = require("fs");
let content = fs.readFileSync("server/index.js", "utf8");

content = content.replace(
`      room.pausedRemainingMs = 0;
      room.endsAt = Date.now() + q.timeLimit * 1000;`,
`      room.pausedRemainingMs = 0;
      room.startedAt = Date.now();
      room.endsAt = Date.now() + q.timeLimit * 1000;`
);

content = content.replace(
`      questionIndex: room.questionIndex,
      totalQuestions: room.questions.length,
      paused: !!room.paused,`,
`      questionIndex: room.questionIndex,
      totalQuestions: room.questions.length,
      startedAt: room.startedAt,
      endsAt: room.endsAt,
      paused: !!room.paused,`
);

fs.writeFileSync("server/index.js", content);
console.log("Updated server/index.js successfully.");
