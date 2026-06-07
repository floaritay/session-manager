@echo off
chcp 65001 >nul 2>&1
title Session Manager

echo.
echo  ================================
echo    Session Manager
echo  ================================
echo.

:: Check if port 8765 is in use
netstat -ano | findstr ":8765" >nul 2>&1
if %errorlevel% equ 0 (
    echo [!] Port 8765 is already in use.
    echo.
    pause
    exit /b 1
)

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Python not found. Please install Python 3.10+
    pause
    exit /b 1
)

:: Check dependencies
python -c "import fastapi" >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Installing dependencies...
    pip install -r requirements.txt
    echo.
)

:: Start server (main.py auto-opens browser)
echo [*] Starting server on http://127.0.0.1:8765
echo [*] Close this window to stop
echo.

python main.py
