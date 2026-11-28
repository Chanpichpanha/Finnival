@echo off
title Finnival - Starting...
color 0A
cd /d "%~dp0"

echo ========================================
echo          FINNIVAL GAME SERVER
echo ========================================
echo.

:: Get local IP address for display
for /f "delims=[] tokens=2" %%a in ('ping -4 -n 1 %COMPUTERNAME% ^| findstr "["') do set LOCAL_IP=%%a

:: Check if server dependencies exist and are complete
if not exist "server\node_modules\@clerk\express" (
    echo [1/4] Installing / updating server dependencies...
    cd server
    call npm install
    cd ..
) else (
    echo [1/4] Server dependencies found.
)

:: Check if client dependencies exist and are complete
if not exist "client\node_modules\@clerk\react" (
    echo [2/4] Installing / updating client dependencies...
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
start "Finnival Client" cmd /k "cd /d ""%~dp0client"" && set ""HOST=0.0.0.0"" && set ""PORT=3002"" && npm start"

echo.
echo ========================================
echo   Finnival is starting up!
echo.
echo   [On this computer]
echo   Server: http://localhost:3001
echo   Client: http://localhost:3002
echo.
if defined LOCAL_IP (
    echo   [On phones/other devices on your WiFi]
    echo   Client: http://%LOCAL_IP%:3002
)
echo ========================================
echo.
echo Press any key to close this launcher window...
pause >nul
