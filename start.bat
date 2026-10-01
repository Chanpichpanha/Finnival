@echo off
title Finnival - Starting...
color 0A
cd /d "%~dp0"

echo ========================================
echo          FINNIVAL GAME SERVER
echo ========================================
echo.

:: Check if node_modules exist, install if needed
if not exist "server\node_modules" (
    echo [1/4] Installing server dependencies...
    cd server
    call npm install
    cd ..
) else (
    echo [1/4] Server dependencies found.
)

if not exist "client\node_modules" (
    echo [2/4] Installing client dependencies...
    cd client
    call npm install
    cd ..
) else (
    echo [2/4] Client dependencies found.
)

echo [3/4] Starting server on port 3001...
start "Finnival Server" cmd /k "cd /d ""%~dp0server"" && npm start"

:: Wait for server to be ready
timeout /t 3 /nobreak >nul

echo [4/4] Starting client...
start "Finnival Client" cmd /k "cd /d ""%~dp0client"" && set PORT=3002 && npm start"

echo.
echo ========================================
echo   Finnival is starting up!
echo   Server: http://localhost:3001
echo   Client: http://localhost:3002
echo ========================================
echo.
echo Press any key to close this launcher window...
pause >nul
