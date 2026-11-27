# 🎮 FINNIVAL — Complete Project Master Architecture, History & Bug Audit

> **Document Purpose**: This file serves as the single source of truth for the **Finnival** codebase. It contains the complete architectural breakdown, development history, game mechanics, and a technical audit of all active bugs, discrepancies, and immediate action items.

---

## 1. Project Overview & Tech Stack

**Finnival** is an interactive, real-time multiplayer party/trivia battle game inspired by Kahoot and Jackbox, enhanced with RPG-style player powers (Blackout, Heist, Oracle, Deep Freeze, Scramble), host moderation tools, and 4 dynamic question engines.

* **Frontend (`/client`)**:
  * **Framework**: React 18 (Create React App) running on **Port 3002** (`http://localhost:3002` or `http://<LAN_IP>:3002`).
  * **Animation & UI**: `framer-motion` for physics-based spring transitions, zoom effects, and layout animations.
  * **Networking**: `socket.io-client` for real-time WebSocket communication.
  * **Theme / Styling**: Custom CSS design system with bubbly cartoon aesthetics (deep indigo, plum, amber, orange accents, drop-shadows, and customized SVGs).
* **Backend (`/server`)**:
  * **Runtime**: Node.js + Express running on **Port 3001** (`http://localhost:3001`).
  * **WebSockets**: `socket.io` with CORS enabled (`origin: '*'`).
  * **State Architecture**: In-memory room manager using a JavaScript `Map` keyed by 6-digit PIN strings.
  * **Persistence**: Flat-file JSON database (`server/data/question-sets.json`) managed via `server/questions-store.js`.
* **Execution Scripts**:
  * `start.bat`: Double-click launcher that installs missing dependencies and launches server and client in independent `cmd.exe` windows.
  * `stop.bat`: Shutdown utility to terminate running Node and React processes.

---

## 2. File Tree & Codebase Map

```text
Finnival/
├── FINNIVAL_MASTER_CONTEXT.md   # This master context and briefing file
├── start.bat                    # Windows launcher (runs backend on 3001 & client on 3002)
├── stop.bat                     # Process cleanup script
├── README.md                    # Project README
├── client/
│   ├── package.json             # React 18, framer-motion, socket.io-client
│   ├── public/
│   │   └── index.html           # HTML template importing Fredoka One & Nunito Google Fonts
│   └── src/
│       ├── App.js               # Root state machine, socket lifecycle & screen routing
│       ├── App.css              # Custom styles, cartoon UI classes, animations, overlays
│       ├── index.css            # Base resets and CSS root design tokens
│       ├── index.js             # React DOM entry point
│       └── components/
│           ├── HomeScreen.js    # (Inside App.js) Avatar selection, Name entry, Host / Join
│           ├── LobbyScreen.js   # Lobby roster, Host question editor, Question set loader
│           ├── PowerSelectScreen.js # Pre-game 5-power drafting phase
│           ├── GameScreen.js    # Core gameplay container for Host and Contestants
│           ├── MatchGame.js     # Interactive SVG drag-and-drop / click-to-connect line matching
│           ├── LeaderboardScreen.js # Real-time ranking table with animated counter & auto-advance
│           ├── ResultsScreen.js # Final podium (1st, 2nd, 3rd) and game summary
│           └── Toast.js         # Animated sliding notification banner
└── server/
    ├── package.json             # Express, socket.io, cors, uuid
    ├── index.js                 # Primary game engine, socket listeners, scoring, room state
    ├── questions-store.js       # CRUD helper functions for persistent question sets
    └── data/
        └── question-sets.json   # JSON storage file for custom trivia packs
```

---

## 3. Core Game Loop & State Transitions

The game transitions through well-defined phases managed by the server and synchronized to all clients via `roomUpdate` socket broadcasts:

```
[Home] ──(Create / Join)──> [Lobby] ──(Host Starts)──> [Power Select] 
                                                               │
                                                               ▼
[Results / Podium] <──(All Questions Done)── [Question Phase]
        │                                             │ (Timer ends)
        │                                             ▼
        └──────────────(Next Question) <─────── [Reveal Phase] (3s)
                                                      │
                                                      ▼
                                              [Leaderboard] (5s)
```

1. **`home`**: Player enters their nickname, selects an avatar emoji, and either hosts a room (generating a 6-digit PIN) or joins an existing PIN.
2. **`lobby`**:
   * **Host**: Can toggle room lock, load pre-saved question sets, or author custom questions on the fly using the built-in question editor.
   * **Players**: Live-updating participant grid showing avatars and nicknames.
3. **`powerSelect`**: Contestants choose 1 power out of 5. If players don't choose in time, random powers are assigned. Host can click "Force Start" if needed.
4. **`question`**:
   * Host receives full question payload including correct answers.
   * Players receive sanitized questions without answers.
   * Dynamic widgets render based on question type.
   * Players can trigger their power on rivals (with cooldowns).
5. **`reveal`**: 3-second transition immediately after question time expires. The correct answer zooms in with a spring animation.
6. **`leaderboard`**: Table displaying ranked scores. Auto-advances after 5 seconds to the next question.
7. **`results`**: Once all questions conclude, a 3D-styled animated podium highlights 1st, 2nd, and 3rd place, with a button to return to lobby for a rematch.

---

## 4. The 4 Dynamic Question Engines

Rather than being limited to standard 4-option MCQs, the engine supports 4 distinct question types:

| Type ID | Display Name | Mechanics | Server Scoring Algorithm |
| :--- | :--- | :--- | :--- |
| `classic` | **Classic Multiple Choice** | Dynamic number of options (2 to 10+). Can act as True/False (2 options) or standard MCQ. | Exact match: `answerIndex === q.correctAnswer`. Speed bonus + streak bonus applied. |
| `short_answer` | **Short Answer** | Text input field with instant validation styling. | Case-insensitive fuzzy sequential substring match & word containment. |
| `slider` | **Proximity Slider 🌡️** | Range slider bounded between `q.min` and `q.max`. | Exact match gets 100%. Guesses within 15% range earn scaled partial points: `accuracy = 1 - (diff / (range * 0.15))`. |
| `match` | **Drag & Drop Match 🔗** | Dual columns of items. Players drag or click to connect SVG cartoon lines between pairs. | Pairwise matching: `Number(ans.left) === Number(ans.right)`. Accuracy is `correctPairs / totalPairs`. |

---

## 5. Player Powers Specification

| Power ID | Name | Icon | Target | Intended Effect |
| :--- | :--- | :---: | :---: | :--- |
| `blind` | **Blackout** | 🌑 | All rivals | Triggers rising black smoke bubbles over rivals' screens for 10 seconds. Pointer events pass through so rivals can still blindly guess. |
| `steal` | **Heist** | 🪝 | 1 Rival | Targets a rival. If the target answers correctly, 50% of the target's round earnings are diverted to the heister. |
| `hint` | **Oracle** | 🔮 | Self | Instantly eliminates two wrong answers from the player's view for the active question. |
| `freeze` | **Deep Freeze** | ❄️ | 1 Rival | Encases target rival in an ice overlay with falling snowflakes, locking them out from answering for 10 seconds. |
| `scramble` | **Scramble** | 🌀 | All rivals | Shuffles the color classes of answer buttons for all other players for 15 seconds. |

---

## 6. Complete Development & Debugging History

### Milestone 1: Server Startup Crash & Dependency Corruption
* **Symptoms**: React client loaded on port 3002 but permanently showed `⚠️ Connection lost — trying to reconnect...`.
* **Root Cause**: Corrupted `server/node_modules` directory where `engine.io-parser` was missing, causing Node.js to crash immediately upon launch.
* **Resolution**: Clean dependency rebuild via `npm install` inside `/server`.

### Milestone 2: Missing Host Privileges & Reconnection Kicks
* **Symptoms**: Host was treated as a standard spectator with no "Start Game" or question editor buttons. Refreshing kicked the host entirely.
* **Root Cause**:
  1. Server stored host in `room.host` and kept `room.players` strictly for contestants.
  2. Client checked `room.players.find(p => p.id === playerId)`, which returned `undefined` for the host.
  3. Client `playerId` state in `App.js` was initialized as empty string because `setPlayerId(socket.id)` was omitted from `handleCreate`.
  4. Backend `rejoinRoom` rejected any ID not in `room.players`.
* **Resolution**:
  * Updated client host detection: `const isHost = room?.host?.id === playerId`.
  * Passed `setPlayerId` down to `HomeScreen` and bound it upon room creation.
  * Updated server `rejoinRoom` to check `room.hostId === playerId` and re-assign the socket.

### Milestone 3: Gameplay & Moderation Features
* **Emergency End Game**: Implemented `socket.emit('endGameEarly')` accessible via Host controls.
* **Host Live Correct Answer**: Split `questionStart` emission so host receives the unredacted question object while players receive sanitized options.
* **Leaderboard Polish**: Removed clutter banners under leaderboard rankings.
* **Blackout Usability**: Added `pointer-events: none` to the smoke overlay CSS so players can still tap through the smoke.
* **Leaderboard State Lockout**: Fixed `nextQuestion` rejecting advance requests while in `leaderboard` state.

### Milestone 4: Local Wi-Fi / Multi-Device Cross-Hosting
* **Symptoms**: Game functioned on the host computer at `localhost:3002`, but mobile phones and other PCs on the same Wi-Fi could not load the page.
* **Root Cause**: React dev server defaults to binding on loopback (`127.0.0.1`) unless `HOST=0.0.0.0` is specified. In addition, `start.bat` only printed `localhost` without displaying the machine's actual LAN IP address.

---

## 7. ⚠️ Technical Audit: Current Bugs & Immediate Action Items

### 🔴 Bug 1: Heist Power Logic Disconnect (High Priority)
* **Location**: `server/index.js` lines 828–842 vs lines 575–583.
* **The Issue**:
  * In `usePower` (`power === 'steal'`), the server currently executes:
    ```javascript
    const amount = Math.floor(target.score * 0.3);
    target.score -= amount;
    actor.score += amount;
    ```
    This immediately deducts 30% of the target's total points and **never sets `actor.heistTarget = target.id`**.
  * Meanwhile, in `submitAnswer`, there is round-based code:
    ```javascript
    const heister = room.players.find(p => p.heistTarget === player.id);
    if (heister) {
      const stolen = Math.floor(points * 0.5);
      earnedPoints -= stolen;
      heister.score += stolen;
      heister.heistTarget = null;
    }
    ```
  * **Result**: Because `heistTarget` is never assigned, the 50% round steal code is dead code. The power currently behaves as a 30% instant bank robbery, contradicting the UI description in `PowerSelectScreen.js`.
* **Fix**: Decide on one mechanic. To match the UI description ("Steal 50% of round earnings"):
  Inside `usePower`:
  ```javascript
  actor.heistTarget = target.id;
  io.to(rm.pin).emit('toast', { text: `🪝 ${actor.name} targeted ${target.name} with Heist!`, tone: 'power' });
  ```

---

### 🔴 Bug 2: Codebase Pollution — 8 Duplicate Timeout Blocks in `server/index.js`
* **Location**: `server/index.js` lines 198, 274, 475, 630, 666, 713, 758, 789.
* **The Issue**: A 20-line `setTimeout` block that forces a transition from `reveal` to `leaderboard` after 3000ms was accidentally injected into 8 different event handlers:
  1. `rejoinRoom`
  2. `setQuestions`
  3. `revealAnswer` *(The ONLY handler where this belongs)*
  4. `endGame`
  5. `playAgain`
  6. `hostSkipQuestion`
  7. `hostTogglePause`
  8. `consumePower`
* **Fix**: Delete the duplicate timeout blocks from all handlers except `revealAnswer` and `hostSkipQuestion`.

---

### 🟡 Bug 3: `start.bat` Reversion & LAN Networking
* **Location**: `start.bat`
* **The Issue**: `start.bat` is currently missing `set HOST=0.0.0.0` and LAN IP display.
* **Fix**: Update line 37 in `start.bat` to include `set HOST=0.0.0.0` and print the local IP address found via `ping -4 -n 1 %COMPUTERNAME%`.

---

### 🟡 Bug 4: Power Duration & String Mismatches
* **Deep Freeze**:
  * `PowerSelectScreen.js`: Says *"Lock one rival out for 5 seconds."*
  * `server/index.js`: `FREEZE_DURATION_MS = 10000` (10 seconds).
  * `server/index.js` line 23: Typo `desc: 'Freeze one riva out for 10 seconds.'` ("riva" instead of "rival").
* **Blackout**:
  * `PowerSelectScreen.js`: Says *"Blind every other player for 5 seconds."*
  * `server/index.js`: Sets duration to 10 seconds (`10000ms`).
* **Fix**: Synchronize durations between `PowerSelectScreen.js` and `server/index.js` to 10 seconds, and correct the typo.

---

### 🟡 Bug 5: Redundant Props in `MatchGame.js`
* **Location**: `client/src/components/GameScreen.js` line 673 & `client/src/components/MatchGame.js` line 4.
* **The Issue**: `GameScreen.js` computes a shuffled `matchOrder` array and passes it as a prop `<MatchGame matchOrder={matchOrder} ... />`, but `MatchGame.js` does not destructure `matchOrder` from props, instead creating its own internal `useState` shuffle.
* **Fix**: Either accept `matchOrder` in `MatchGame`'s props or remove the unused calculation and prop pass from `GameScreen.js`.

---

## 8. Summary Checklist (RESOLVED & VERIFIED ✅)
- [x] **Align Heist mechanic in `server/index.js`**: `usePower` assigns `actor.heistTarget = target.id` with full guardrails (cannot target self or disconnected players). In `submitAnswer`, victim's deduction is capped at 50% and divided evenly across all active heisters. Unused heists reset each round.
- [x] **Remove duplicate `setTimeout` reveal blocks**: 7 duplicate timeout blocks purged from `rejoinRoom`, `setQuestions`, `endGame`, `playAgain`, `hostSkipQuestion`, `hostTogglePause`, and `consumePower`. Single managed `room.phaseTimer` and `clearRoomTimers(room)` helper implemented.
- [x] **Add `set HOST=0.0.0.0` to `start.bat`**: Client now binds to all network interfaces and dynamically prints the local IPv4 address for mobile/LAN players.
- [x] **Align Power durations & fix typos**: Blackout and Deep Freeze synced to 10 seconds across backend and frontend, and the `riva` typo in `POWERS.freeze` is fixed.
- [x] **Clean up `MatchGame.js` / `GameScreen.js`**: Added `key={gameState?.index}` so MatchGame remounts cleanly for every match question, and eliminated dead state and redundant prop pass.

### Milestone 5: Custom Timer, Pause Lockout & Power Selection Polish (Completed)
* **Custom Question Timer**:
  * Added "Custom..." option to `LobbyScreen.js` alongside the 4 presets (10s, 20s, 30s, 60s).
  * Allowed arbitrary second input (minimum 5s, no artificial upper bound so host can set 120s, 3600s, etc.).
  * Shows dynamic minutes helper badge (e.g. `(~1.5m)`) when custom value >= 60s.
  * Clamps gracefully on `onBlur` to allow fluid multi-digit typing.
  * Server sanitizes `timeLimit: Math.max(5, Math.round(Number(q.timeLimit)) || 20)` dynamically in speed bonus math.
* **Host Timer Bar Freeze on Pause**:
  * Removed `room?.paused ? undefined : ...` in `GameScreen.js`, replaced with clamped percentage `0-100%`.
  * Set Framer Motion transition duration to 0 on pause to freeze bar at the exact paused percentage with no expansion or overshoot.
* **Comprehensive Pause Lockout, Timers & UX Blur**:
  * **Server Timestamp & Cooldown Shifting**:
    * `hostTogglePause` records `room.pausedAt = Date.now()`.
    * On unpause: calculates `pauseDuration = Date.now() - room.pausedAt`, shifts `room.startedAt += pauseDuration` so players do not lose speed bonus points, shifts active `player.powerCooldownUntil += pauseDuration` so cooldowns pause accurately, and emits `timerResumed` with updated `endsAt` and `startedAt`.
    * `roomSnapshot` broadcasts `pausedAt`.
    * Cleaned pause state in `revealAnswer`, `hostSkipQuestion`, `endGame`, and `playAgain`.
    * Server blocks `submitAnswer` and `usePower` while `room.paused` is true.
  * **Contestant Frosted Glass Overlay**:
    * Renders a frosted glass overlay with `backdrop-filter: blur(14px)` and `WebkitBackdropFilter: blur(14px)` displaying: "⏸️ Game Paused by Host".
    * Disables all interactive question buttons, text inputs, sliders, and power buttons during pause.
    * Calls `document.activeElement?.blur()` immediately on pause.
  * **MatchGame Mid-Drag Cancellation**:
    * Accepts `isPaused` prop.
    * Cancels active drag line (`activeDragTarget = null`, `pointerPos = null`) when paused while preserving existing connected matches.
* **Power Selection Timeout**:
  * Reduced `POWER_SELECT_DURATION_MS` from 1 hour (`3600000ms`) to 2 minutes (`120000ms`) in both server and client.

### Milestone 6: Session Persistence (Anti-Drop), Cross-Type Powers & Lobby Polish (Completed)
* **Session Persistence & Anti-Drop System**:
  * Generated persistent `sessionToken` (UUID) on the server in `createRoom` and `joinRoom`, stored safely in `sessionStorage`.
  * Fixed LAN Wi-Fi non-HTTPS compatibility (avoided `crypto.randomUUID()` on browser).
  * In `rejoinRoom`: mapped reconnecting sockets by `sessionToken`, cleared disconnect grace timers, migrated `room.answers` and active `heistTarget` references to the new socket ID.
  * Re-synchronized full active phase states on rejoin: `question` (unredacted for host, sanitized for players, active timer, submitted status), `powerSelect`, `reveal`, `leaderboard`, `results`.
  * Added 15-second lobby reconnect grace timers for both players and host before purging.
* **Lobby Moderation & Navigation**:
  * Removed redundant "Ban" button; centered single clean red "Kick" button on each player card.
  * Kicked players have their `sessionToken` stored in `room.kickedTokens` so refreshing cannot bypass the kick.
  * Added "Leave Lobby" button for contestants (cleans session storage and returns to Home immediately without 15s ghost card).
  * Added "Abandon Lobby" button for Host with 2-step misclick protection (switches to `⚠️ Confirm Abandon?` for 3.5s before emitting `abandonLobby`, clearing room, notifying players, and returning to Home).
* **Power Adaptations Across All 4 Question Types**:
  * **Short Answer**:
    * 🔮 *Oracle*: Generates masked Hangman hint (e.g. `C _ _ _ _ _ _ _`) displayed in a golden banner.
    * 🌀 *Scramble*: **Blind Typing**: Switches text input to `type="password"` with an orange accent border and `🌀 Scrambled! Blind Typing Active!` badge for 10s.
  * **Slider**:
    * 🔮 *Oracle*: Cuts track in half, calculating safe region on server and displaying target window banner (e.g. `50 – 100`).
    * 🌀 *Scramble*: **Foggy Gauge**: Hides numeric value (shows `???`) and hides min/max labels with `🌀 Foggy Gauge! Values Hidden!` badge for 10s.
  * **Match Pairs**:
    * 🔮 *Oracle*: Client passes current matched pairs; server auto-solves 1 unassigned or wrong pair with a golden locked line (`#FFAF50`).
    * 🌀 *Scramble*: Performs in-place shuffle of *unmatched* right-side items, immediately clearing active mid-drag line while preserving existing valid connections.
* **Minimalist Pause Screen**:
  * Removed explanatory text under the pause overlay on contestant screens, retaining only the large `⏸️` icon and bold `Game Paused by Host` title over the frosted blur.

### Milestone 7: Audio Engine, QR Code Join, Lobby Chat & Shielding (Completed)
* **Web Audio API Engine (`client/src/utils/sound.js`)**:
  * Zero-external-asset arcade synthesizer using Web Audio API.
  * SFX for question countdown ticks (`playTick(isUrgent)`), answer submission (`playSubmit`), powers (`playFreeze`, `playHeist`, `playScramble`, `playOracle`), `playDoublePoints()`, and final podium fanfare (`playPodium()`).
  * Persistent volume/mute toggle (`🔊` / `🔇`) stored in `localStorage`.
* **Automatic LAN IP & QR Code Join (`LobbyScreen.js`)**:
  * Server dynamically detects true Wi-Fi/Ethernet IPv4 via `getLanIp()`, filtering virtual adapters.
  * Host lobby displays real-time auto-generated QR code (`qrcode.react`) encoding `http://<LAN_IP>:3002/?pin=XXXXXX`.
  * Mobile devices scanning the QR automatically land on the join screen with the 6-digit PIN pre-filled.
* **Lobby Chatbox & Floating Reaction Dock**:
  * Real-time lobby chatbox with 50-message cap, 120-character limit, and autoscroll.
  * Floating animated emoji reactions (`🔥`, `💀`, `😭`, `😂`, `👑`, `🪝`) with 5s cooldown, audio pop triggers, and floating Framer Motion animations across contestant screens.
* **Third-Party Script Error Shielding**:
  * Defensive capture-phase exception handlers in `public/index.html` and `src/index.js` preventing third-party browser wallet/reader/shield injections (e.g. Brave iOS Web3/Shields `Script error.` or Firefox user-scripts) from displaying red React dev error overlays.

### Milestone 8: In-Game 2× Points, Battle Feed & Image Uploads (Completed)
* **Mid-Question `🔥 2× Points` Host Power**:
  * Host can click "🔥 2× Points" mid-question.
  * Retroactively doubles speed points for any player who already answered, and applies 2× to future answers in that round.
  * Shows flashing amber warning banner on contestant screens: *"🔥 DOUBLE POINTS ACTIVE! Correct answers score 2×!"*.
* **Host Live Battle Feed & Contestant Pulse Chips**:
  * Real-time live activity feed on host screen displaying player answers and power activations as they occur.
  * Animated pulse chips showing who has submitted in real time.
* **Dynamic Question Images with Compression & Automated Purge**:
  * Questions support optional image URLs or local file uploads (`/api/upload-image`).
  * Canvas-based client downscaling to max 1200×1200px at 85% JPEG before upload.
  * Preloading engine (`preloadImages`) caching images before reveal.
  * Automated background garbage collector running every 15 minutes (`purgeOrphanImages`) removing unreferenced images older than 15 minutes with zero user effort needed.

### Milestone 9: Host Game Rules, Question Pack Import/Export & Lobby Music (Completed)
* **Host Game Settings Panel (`LobbyScreen.js` & `server/index.js`)**:
  * Added `room.settings` (`powerMode`, `powerCooldownSec`, `shuffleQuestions`) synchronized via `updateSettings` socket event and `roomSnapshot`.
  * **Power Mode**: Supports `choose` (Players Choose), `random` (Random Powers auto-assigned on start, skipping `powerSelect`), and `off` (Pure Trivia mode, powers disabled and `powerSelect` skipped).
  * **Power Cooldown**: Presets (`60s`, `120s`, `180s`, `Once per game` via `-1` / `player.powerUsed`) plus **Custom seconds input** (minimum 5s). Dynamic cooldown description updates in `PowerSelectScreen.js` and `Used (Once per game)` state in `GameScreen.js`.
  * **Shuffle Question Order**: Shuffles a match copy of `room.questions` on `startGame` while preserving `room.lobbyQuestions` so `playAgain` restores the host's original order.
  * Contestants see a read-only rules summary badge in the lobby.
* **Question Pack Import / Export (`.json`)**:
  * Added `GET /api/question-sets/:id` endpoint on server for single-pack retrieval.
  * Added `client/src/utils/questionPack.js` with `parseImportedPack`, `downloadJsonPack`, and `AI_QUIZ_PROMPT`.
  * Smart AI-friendly JSON importer strips markdown fences/chatter and supports both native Finnival fields and generic AI aliases (`title`, `question`/`prompt`, string/letter `correct_answer`, auto-detected question types).
  * Located neatly inside the **Saved Packs** tab (`📥 Import (.json)`, `📋 Paste JSON`, `📤 Export`, inline `💾 Save Current Quiz` name input, and Replace/Append guard).
* **Built-In Multi-Provider AI Quiz Generator (`server/ai-quiz-generator.js`, `LobbyScreen.js`)**:
  * Zero-dependency backend module loading optional `server/.env` (`server/.env.example` template included) and supporting silent automatic fallback across **Gemini** (`GEMINI_API_KEY`, trying `gemini-2.5-flash` / `gemini-2.5-flash-lite` / `gemini-2.0-flash`), **Groq** (`GROQ_API_KEY` / `llama-3.3-70b-versatile`), and **Local Ollama** (`OLLAMA_URL` / auto-detected model via `/api/tags`).
  * Added host-authenticated, 8s rate-limited `POST /api/generate-quiz` endpoint generating and validating all 4 question types (`classic`, `short_answer`, `slider`, `match`). Backend logs provider diagnostics server-side while returning clean, non-technical status/errors to the client without exposing model names or key setup hints.
* **Streamlined 3-Tab Host Workspace (`LobbyScreen.js`, `App.css`)**:
  * Consolidated lobby header (PIN, QR code, inline `Copy Join Link` feedback, Lock/Unlock, Music toggle, Close/Leave) and collapsed **Game Rules** into a compact one-line summary bar (`Customize ▾`).
  * Unified quiz creation into a clean 3-tab **`🎯 Build Your Quiz`** card: **✨ AI Quiz** (topic, type chips, count, difficulty, shared 10s–60s + Custom sec/min time picker — zero API key inputs, zero provider/model selectors), **✏️ Add Manually** (with optional image upload/URL positioned directly beneath the question input to match gameplay order, shared 10s–60s + Custom sec/min time picker, auto-opened on edit), and **📚 Saved** (responsive pack cards, `.json` import/paste).
  * Placed **`💾 Save Current Quiz`** (inline pack name prompt) and **`📤 Export (.json)`** conditionally directly beneath `Your Quiz` when 1 or more questions exist, plus mobile-responsive grid tabs and wrapping safeguards in `App.css`.
* **Synthesized Arcade Lobby Music (`client/src/utils/sound.js`)**:
  * Added gentle procedural 16-step triangle/sine arcade loop (`startLobbyMusic` / `stopLobbyMusic`) active during `LobbyScreen`.
  * Added persistent `finnival_music_muted` preference (`isMusicMuted`, `toggleMusicMute`) synced with the global `🔊/🔇` mute button plus a dedicated `🎵 Music: On/Off` toggle button in `LobbyScreen.js`.
