# Finnival Project Architecture & Preservation Rules

This workspace is **Finnival**, an interactive real-time multiplayer party/trivia battle game built with React 18 and Node.js + Express + Socket.io.

## Core Directives for Any AI Working in This Project:
1. **Single Source of Truth**: Always read `FINNIVAL_MASTER_CONTEXT.md` in the root directory before designing, refactoring, or editing features. It documents the entire codebase, state machine, and history.
2. **Never Break or Rewrite Existing Core Mechanics**:
   - **Sound Engine (`client/src/utils/sound.js`)**: Pure Web Audio API arcade synthesizer. Do not replace with external audio assets or libraries.
   - **QR Code Join Flow (`LobbyScreen.js` / `App.js`)**: Encodes `http://<LAN_IP>:3002/?pin=XXXXXX`. Auto-fills PIN on phone scan. Keep error shielding in `index.html` and `index.js`.
   - **Host Features**: Keep "🔥 2× Points" retroactive doubling, Live Battle Feed, pause time shifting, and answer pulse chips.
   - **Powers (5 types)**: Blackout, Heist (50% round-end steal), Oracle (hints across all 4 question types), Deep Freeze (10s lock), Scramble (shuffle/blind across all 4 types).
   - **Automated Image Purge**: The server runs an automatic 15-minute background sweep (`purgeOrphanImages`) for unreferenced images. Do not re-add manual clean buttons to the user-facing UI.
3. **Ports & Execution**:
   - Backend Express/Socket.io: Port `3001`
   - Frontend React: Port `3002` (bound to `HOST=0.0.0.0` for mobile LAN access)
   - Launcher: `start.bat` handles dependency checks and dual-process startup.
4. **Git Discipline**:
   - The primary Git repository is `https://github.com/Chanpichpanha/Finnival.git`.
   - Never commit `node_modules/` or build artifacts. Always respect `.gitignore`.
