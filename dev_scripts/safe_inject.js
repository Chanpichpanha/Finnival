const fs = require("fs");
let content = fs.readFileSync("client/src/components/GameScreen.js", "utf8");

// 1. Fix the stray `)}}`
content = content.replace(
    "isReveal={gameState?.isReveal} \n              gameState={gameState} \n              submitAnswer={submitAnswer} \n            />\n          )}}",
    "isReveal={gameState?.isReveal} \n              gameState={gameState} \n              submitAnswer={submitAnswer} \n            />\n          )}"
);
// In case the spacing is different:
content = content.replace("/>\n          )}}", "/>\n          )}");
content = content.replace("/>\r\n          )}}", "/>\r\n          )}");

// 2. Replace the player's short_answer block.
// The host's block is `if (isHost) { ... }`
// We want the short_answer block that is inside the player's view.
// It starts with `{question.type === 'short_answer' && (`.
const blocks = content.split("{question.type === 'short_answer' && (");
if (blocks.length === 3) {
    // The player's block is in blocks[2].
    // It ends right before `{question.type === 'slider' && (`
    const subBlocks = blocks[2].split("{question.type === 'slider' && (");
    
    // We replace subBlocks[0] with our new UI block.
    const newUI = `() => {
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

    blocks[2] = newUI + "{question.type === 'slider' && (" + subBlocks.slice(1).join("{question.type === 'slider' && (");
    content = blocks.join("{question.type === 'short_answer' && (");
    
    fs.writeFileSync("client/src/components/GameScreen.js", content);
    console.log("Safely applied both fixes!");
} else {
    console.log("Could not find exactly two occurrences of short_answer block:", blocks.length);
}
