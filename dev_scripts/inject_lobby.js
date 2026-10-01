const fs = require("fs");
let content = fs.readFileSync("client/src/components/LobbyScreen.js", "utf8");

// We want to replace the match setup UI.
const matchStrStart = "{newQuestion.type === 'match' && (";
const startIdx = content.indexOf(matchStrStart);
if (startIdx > -1) {
    // Find matching closing bracket
    let braceCount = 0;
    let endIdx = -1;
    for (let i = startIdx + matchStrStart.length - 1; i < content.length; i++) {
        if (content[i] === '(') braceCount++;
        if (content[i] === ')') braceCount--;
        if (braceCount === 0) {
            endIdx = i;
            break;
        }
    }
    
    if (endIdx > -1) {
        const replacement = `{newQuestion.type === 'match' && (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <label style={{ fontWeight: 700 }}>Matching Pairs (Players will draw lines between them):</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => setNewQuestion({...newQuestion, pairs: [...(newQuestion.pairs || []), {left: '', right: ''}]})}>+ Add Pair</button>
            <button className="btn btn-danger" style={{ padding: '4px 10px' }} disabled={(newQuestion.pairs?.length || 0) <= 2} onClick={() => setNewQuestion({...newQuestion, pairs: newQuestion.pairs.slice(0, -1)})}>- Remove</button>
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {(newQuestion.pairs || []).map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.4)', padding: 12, borderRadius: 8, border: '2px dashed var(--dark)' }}>
                <span style={{ fontWeight: 'bold', width: 30 }}>#{i+1}</span>
                <input className="input" placeholder="Left Side Item" value={p.left} onChange={(e) => { const np = [...newQuestion.pairs]; np[i].left = e.target.value; setNewQuestion({...newQuestion, pairs: np}); }} style={{ flex: 1, margin: 0 }} />
                <span style={{ fontSize: '1.5rem' }}>➔</span>
                <input className="input" placeholder="Right Side Match" value={p.right} onChange={(e) => { const np = [...newQuestion.pairs]; np[i].right = e.target.value; setNewQuestion({...newQuestion, pairs: np}); }} style={{ flex: 1, margin: 0 }} />
            </div>
            ))}
        </div>
        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: 12 }}>
           *The left side items will be locked in place. The right side items will be randomly shuffled for the players.
        </p>
      </>
    )}`;
        content = content.substring(0, startIdx) + replacement + content.substring(endIdx + 1);
        fs.writeFileSync("client/src/components/LobbyScreen.js", content);
        console.log("Updated LobbyScreen.js Match UI successfully.");
    } else {
        console.log("Could not find end of match block in LobbyScreen.");
    }
} else {
    console.log("Could not find start of match block in LobbyScreen.");
}
