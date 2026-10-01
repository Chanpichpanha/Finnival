@echo off
title Finnival - Stopping...
color 0C
echo ========================================
echo STOPPING FINNIVAL
echo ========================================
echo.

echo [1/2] Stopping server...
taskkill /FI "WINDOWTITLE eq Finnival Server*" /T /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [2/2] Stopping client...
taskkill /FI "WINDOWTITLE eq Finnival Client*" /T /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3002 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3003 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo ========================================
echo Finnival has been stopped.
echo ========================================
echo.
pause
