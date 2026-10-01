## Goal Description
We are upgrading the core Finnival game engine to support highly dynamic Question Types. Based on your brilliant pivot, we are scrapping the dedicated True/False type. Instead, we are upgrading the **Classic (Multiple Choice)** question so the Host can define *exactly* how many options it has. (If they want True/False, they just set it to 2 options!). We are also applying this dynamic scaling to the **Drag & Drop Match** pairs.

**The 4 Question Types will be:**
1. **Classic (Dynamic Options)**: Multiple choice, but the host can add or remove options (from 2 up to infinity).
2. **Short Answer (Fuzzy Match)**: A text box where players type the answer. The grading engine checks sequential substrings.The grading engine is highly forgiving—if the correct answer is "John", typing "Pork John" is correct, and if the answer is "Pork John", typing "John" is correct. It uses strict sequential matching, so scrambled letters like "ojhn" will be rejected.
3. **Proximity Slider 🌡️**: A slider scale where players earn partial points based on how close their guess is to the true number.
4. **Drag & Drop Match 🔗**: The host defines N matching pairs. Players drag lines connecting the left and right columns.

---

## Proposed Changes

### 1. client/src/components/LobbyScreen.js
We will overhaul the Question Editor to support dynamic arrays.
- Add a <select> for Question Type (classic, short_answer, slider, match).
- **If Classic**: Add + Add Option and - Remove Option buttons. The correctAnswer dropdown will scale to match the length of the options array.
- **If Match**: Add + Add Pair buttons to push { left: '', right: '' } objects into the state.

### 2. client/src/components/GameScreen.js
We will build out the 4 different interactive UI views.
- Update the .options-grid CSS to use grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); so dynamic buttons wrap beautifully.
- Build the **Slider Component**: An HTML <input type="range" /> bounded by q.min and q.max.
- Build the **Text Component**: A sleek <input type="text" /> with a submit button.
- Build the **Match Component**: Render two vertical columns. We will implement simple click-to-connect logic (click a left item, click a right item to draw a visual SVG line).

### 3. server/index.js
The scoring engine must be branched based on q.type.
- classic: isCorrect = answerIndex === q.correctAnswer;
- short_answer: Check sequential fuzzy match.
- slider: Calculate percentage error and award scaled points.
- match: Calculate partial points based on how many pairs they matched correctly out of the total!

**2. Architecture Changes Required:**
*   **Lobby Editor:** Add a "Question Type" dropdown to switch between building Classic, Short Answer, Slider, or Match questions.
*   **Game Screen UI:** Build custom React components for the Slider, the Text Input, and the interactive SVG line-drawing grid for the Drag-and-Drop mechanic.
*   **Server Scoring Engine:** Upgrade the backend submitAnswer to handle fuzzy substring validation for text, proximity math for the slider, and mapping validation for the drag-and-drop matches.