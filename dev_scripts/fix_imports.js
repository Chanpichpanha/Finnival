const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");
content = content.replace(
    /import React, \{ useState, useRef \} from 'react';/,
    "import React, { useState, useRef, useEffect } from 'react';"
);
fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Imported useEffect.");
