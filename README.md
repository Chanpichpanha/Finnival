# Finnival

A real-time multiplayer quiz game — Kahoot-style, but infinitely more chaotic with **sabotage powers**.

## What's inside

**Core quiz loop (Kahoot parity)**
- 6-digit game PIN, no accounts needed.
- Host-controlled question flow with a live player roster.
- **Dynamic Scoring:** Speed-based scoring (600 base + up to 400 speed bonus) + streak bonuses.
- **Reveal Phase:** A smooth, 3-second animated "Answer Reveal" phase that highlights the correct answer before transitioning to the leaderboard.
- **Leaderboard:** Sleek, high-contrast Pill Badge UI with 🥇 Gold, 🥈 Silver, and 🥉 Bronze medals for the top 3 players.
- Podium + full final standings, rematch via "Play Again".
- **Host Tools:** Kick players, lock lobby, custom question editor, pause timer, skip questions, and an emergency **End Game Early** button. The host also sees the correct answer highlighted during the countdown.
- **Robust Reconnects:** Full state restoration if a player drops mid-game.

**The 4 Powers** — each player picks one before the game and can fire it once:

| Power | Icon | Effect |
|---|---|---|
| Blackout | 🌑 | Blind every other player for 5 seconds (Victims can still blindly guess through the darkness). |
| Heist | 🪝 | Steal **50%** of a rival's points this round—but *only* if they guess the answer correctly! High risk, high reward. |
| Oracle | 🔮 | Eliminate one wrong answer for yourself this round. |
| Deep Freeze | ❄️ | Lock one rival out of answering for 5 seconds. |

## Stack

- **server/** — Node.js + Express + Socket.io. All game state is authoritative on the server.
- **client/** — React 18 (Create React App) + socket.io-client + ramer-motion for smooth animations.

## Running it

**Windows Users (Easy Start):**
Just double-click the start.bat file in the root directory! It will automatically install dependencies and launch both the client and server.

**Manual Start (Two Terminals):**

`ash
cd server
npm install
npm start          # http://localhost:3001
`

`ash
cd client
npm install
npm start          # http://localhost:3000
`

Open http://localhost:3000 in one tab to host, and more tabs (or other devices on your LAN) to join with the PIN.

To point the client at a deployed server, set REACT_APP_SERVER_URL.

## Design

Fonts: **Fredoka One** for display, **Nunito** for body — rounded and cartoon-coded, loaded from Google Fonts in client/public/index.html. 
The UI features a vibrant purple/pink/teal gradient background, animated particles, dynamic leaderboards, and responsive hover/tap physics via Framer Motion.

## API

- GET /api/health — room count
- GET /api/powers — power definitions
- GET /api/shapes — answer shape order

## 💡 Concept Sandbox / Upcoming Features

**1. The "Scramble" Power 🌀**
When activated, this visually shuffles the colors and shapes of the answer buttons on *everyone else's* screens for that round. If the correct answer is usually the "Red Triangle", the victims might see the Red Triangle randomly positioned where the Green Square normally sits. Designed to cause absolute panic and muscle-memory misclicks!

## 💡 Legendary Feature Roadmap (v2.0)

**1. Dynamic Question Types:**
*   **Classic:** Standard 4-option multiple choice. already have
*   **True/False:** 2 massive 50/50 buttons.
*   **Short Answer (Fuzzy Match):** Players type the answer. The grading engine is highly forgiving—if the correct answer is "John", typing "Pork John" is correct, and if the answer is "Pork John", typing "John" is correct. It uses strict sequential matching, so scrambled letters like "ojhn" will be rejected.
*   **Proximity Slider 🌡️:** For number-based questions. Players drag a slider to guess, and earn partial points based on exactly how close they are to the true number!
*   **Drag & Drop Match 🔗:** Two columns of blocky options (e.g., 1, 2, 3 on the left, A, B, C on the right). Players click and hold to drag connection lines between matching pairs.

**2. Architecture Changes Required:**
*   **Lobby Editor:** Add a "Question Type" dropdown to switch between building Classic, True/False, Short Answer, Slider, or Match questions.
*   **Game Screen UI:** Build custom React components for the Slider, the Text Input, and the interactive SVG line-drawing grid for the Drag-and-Drop mechanic.
*   **Server Scoring Engine:** Upgrade the backend submitAnswer to handle fuzzy substring validation for text, proximity math for the slider, and mapping validation for the drag-and-drop matches.
