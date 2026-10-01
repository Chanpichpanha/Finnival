const fs = require("fs");
let content = fs.readFileSync("server/index.js", "utf8");

content = content.replace(
`      if (qType === 'classic') {`,
`      console.log("GRADING QUESTION TYPE:", qType);
      console.log("RECEIVED ANSWER:", answerIndex);
      if (qType === 'classic') {`
);

content = content.replace(
`      const points = Math.floor(base + speed + streakBonus);`,
`      const points = Math.floor(base + speed + streakBonus);
      console.log("CALCULATED POINTS:", points, "ACCURACY:", accuracy, "CORRECT_PAIRS:", correctPairs);`
);

fs.writeFileSync("server/index.js", content);
console.log("Injected debug logging into server/index.js");
