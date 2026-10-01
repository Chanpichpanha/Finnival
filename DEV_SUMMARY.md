/# Finnival - Development & Debugging Summary

This document serves as a comprehensive log of the debugging and architectural fixes implemented in the Finnival project. It is intended to provide full context on recent changes, root causes of bugs, and exactly how they were resolved.

## 1. The "Connection Lost" / Server Crash Bug

### 🔴 The Issue
When launching the game via `start.bat`, the React client (port 3002) would load but instantly display a "Connection lost -- try again" banner. The client was unable to connect to the backend server.

### 🔍 Root Cause Analysis
- The Node.js backend (intended to run on port 3001) was silently crashing in the background immediately upon startup.
- The crash was caused by a corrupted `node_modules` directory in the `server` folder, specifically throwing an error related to a missing or corrupted `engine.io-parser` dependency required by `socket.io`.
- The `start.bat` script included a check (`if not exist node_modules`) that prevented it from running `npm install` because the folder technically existed, even though its contents were broken.

### ✅ Solution Implemented
- Manually executed `npm install` inside the `server/` directory to completely rebuild the dependency tree and restore `engine.io-parser`.
- The server successfully bound to port 3001, allowing the client's WebSocket connection to establish normally.

---

## 2. The "Missing Host Controls" Bug

### 🔴 The Issue
After creating a room, the Host was routed to the Lobby screen but lacked all host privileges. The UI treated the Host as a standard player, displaying "Waiting for the host to start the game..." instead of rendering the "Start Game" button, room lock toggle, and the Question Set dashboard.

### 🔍 Root Cause Analysis
This bug was multi-layered and required fixes across both the React frontend and the Node.js backend.

#### A. Flawed Host Identification Logic (Client)
- The components (`LobbyScreen.js`, `GameScreen.js`, `PowerSelectScreen.js`) were determining host status using:
  ```javascript
  const me = room?.players.find((p) => p.id === playerId);
  const isHost = me?.isHost;
  ```
- **The flaw:** The server intentionally separates the host from the contestants. The host object is stored at `room.host` and the host is *never* pushed into the `room.players` array. Consequently, `me` was evaluating to `undefined`, causing `isHost` to be `false`.

#### B. React State Race Condition (Client)
- In `App.js`, the active user's ID (`playerId`) is managed in React state.
- When `handleCreate` (in `HomeScreen.js`) successfully created a room, it saved the socket ID to `sessionStorage` but **failed to update the active `playerId` state**. 
- Because the initial socket connection fired before the React component fully mounted, the `playerId` state was stuck as an empty string `""`, making it impossible for the client to accurately identify itself against the room data.

#### C. Host Refresh Rejection (Server)
- If the host attempted to refresh the browser to fix the UI, the server would kick them entirely.
- In `server/index.js`, the `rejoinRoom` socket event was hardcoded to validate returning users strictly by searching the `room.players` array:
  ```javascript
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return cb({ ok: false, message: 'You are no longer in this game.' });
  ```
- Since the host isn't in `room.players`, the server rejected the host's reconnection attempt.

### ✅ Solutions Implemented

**1. Updated Client UI Logic (`LobbyScreen.js`, `GameScreen.js`, `PowerSelectScreen.js`)**
Replaced the flawed array-search logic with a direct check against the room's host object:
```javascript
const me = room?.players.find((p) => p.id === playerId); // Used for player-specific rendering
const isHost = room?.host?.id === playerId;              // Correct host validation
```

**2. Fixed State Management (`App.js`)**
- Passed `setPlayerId` down through `renderScreen` as a prop to the `HomeScreen` component.
- Updated `handleCreate` and `handleJoin` in `HomeScreen` to explicitly call `setPlayerId(socket.id)` upon a successful server response. This ensures the UI instantly recognizes the user's socket ID without requiring a refresh.

**3. Patched Backend Reconnection Logic (`server/index.js`)**
- Rewrote the `rejoinRoom` event listener to account for the host. 
- The server now explicitly checks `const isHost = room.hostId === playerId;`.
- If a reconnecting user is the host, it updates `room.hostId` and `room.host.id` to the new `socket.id` and allows them to successfully rejoin the lobby.

---

## 🚀 Current Architecture State
- **Backend (`server/index.js`)**: Express + Socket.io server running on port 3001. Handles room state (separating `host` from `players`), handles reconnections reliably for all user types, and manages game phase progression.
- **Frontend (`App.js` -> `Screens`)**: React application running on port 3002. Accurately tracks `playerId` state and dynamically renders Host controls vs. Contestant UI based on `room.host.id`. 
- **Dependencies**: Fully intact. `start.bat` successfully launches both environments.

