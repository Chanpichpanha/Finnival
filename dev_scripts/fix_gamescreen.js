const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

// 1. Fix the stray parenthesis `)}}` for MatchGame
content = content.replace(
    /isReveal=\{gameState\?\.isReveal\} \r?\n\s*gameState=\{gameState\} \r?\n\s*submitAnswer=\{submitAnswer\} \r?\n\s*\/>\r?\n\s*\)\}\}/g,
    "isReveal={gameState?.isReveal} \n              gameState={gameState} \n              submitAnswer={submitAnswer} \n            />\n          )}"
);

// We should also handle the case where it might be slightly differently spaced
content = content.replace(/\/>\s*\)\}\}/g, "/>\n          )}");

// 2. Replace short_answer block
const startMarker = "{question.type === 'short_answer' && (";
const endMarker = "{question.type === 'slider' && (";
const startIdx = content.indexOf(startMarker, content.indexOf("className=\"options-grid\"") > -1 ? content.indexOf("className=\"options-grid\"") : 0);
const endIdx = content.indexOf(endMarker);

if (startIdx > -1 && endIdx > -1) {
    const replacement = `{question.type === 'short_answer' && (() => {
            const isReveal = gameState?.isReveal;
            let inputBg = 'white';
            let inputColor = 'var(--dark)';
            let isCorrect = false;
            
            if (isReveal) {
                const correctTxt = String(gameState.correctAnswerText || question.correctAnswerText || '').trim().toLowerCase();
                const ansTxt = String(shortAnswerText || '').trim().toLowerCase();
                isCorrect = ansTxt && correctTxt && (ansTxt.includes(correctTxt) || correctTxt.includes(ansTxt));
                inputBg = isCorrect ? 'var(--green)' : 'var(--red)';
                inputColor = 'white';
            }

            return (
            <div style={{ padding: 24, textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
              <h3 style={{ color: 'white', marginBottom: 24 }}>Type your answer:</h3>
              <input 
                type="text" 
                className="input" 
                placeholder="Your answer..."
                value={shortAnswerText}
                onChange={(e) => setShortAnswerText(e.target.value)}
                disabled={answered || isFrozen || isReveal}
                style={{ 
                    width: '100%', 
                    maxWidth: 400, 
                    fontSize: '1.5rem', 
                    marginBottom: 24, 
                    textAlign: 'center',
                    backgroundColor: inputBg,
                    color: inputColor,
                    border: isReveal ? (isCorrect ? '4px solid #2ecc71' : '4px solid #e74c3c') : '4px solid var(--dark)',
                    transition: 'all 0.3s ease',
                    fontWeight: isReveal ? 'bold' : 'normal'
                }}
              />
              <br/>
              {!isReveal && (
              <button 
                className="btn btn-primary" 
                disabled={answered || isFrozen || !shortAnswerText.trim()}
                onClick={() => submitAnswer(shortAnswerText.trim())}
                style={{ width: '100%', maxWidth: 400, fontSize: '1.2rem', padding: '16px' }}
              >
                Submit Answer
              </button>
              )}
              {isReveal && (
                <div 
                    style={{ 
                        marginTop: 16, 
                        padding: '16px',
                        background: 'rgba(255,255,255,0.95)', 
                        borderRadius: 12,
                        color: 'var(--dark)', 
                        fontSize: '1.4rem', 
                        fontWeight: 'bold',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        border: '3px solid var(--dark)',
                        display: 'inline-block',
                        minWidth: '250px'
                    }}
                >
                  <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#666', marginBottom: 4 }}>Correct Answer</div>
                  <div style={{ color: 'var(--green)' }}>{gameState.correctAnswerText || question.correctAnswerText}</div>
                </div>
              )}
            </div>
          );
        })()}

        `;
    
    // We only want to replace the SECOND occurrence of shortAnswerStart (the one in the player input area),
    // because the first occurrence is in the HOST view!
    // Let's find all occurrences:
    let occurrences = [];
    let currentIdx = content.indexOf(startMarker);
    while(currentIdx !== -1) {
        occurrences.push(currentIdx);
        currentIdx = content.indexOf(startMarker, currentIdx + 1);
    }
    
    if (occurrences.length >= 2) {
        const targetStart = occurrences[1];
        content = content.substring(0, targetStart) + replacement + content.substring(endIdx);
        fs.writeFileSync("client/src/components/GameScreen.js", content);
        console.log("Updated GameScreen.js successfully.");
    } else {
        console.log("Could not find the second occurrence of short_answer block.");
    }
} else {
    console.log("Could not find start/end markers.");
}
