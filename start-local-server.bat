@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do if not defined IP set "IP=%%a"
set "IP=%IP: =%"
if not defined IP set "IP=127.0.0.1"

echo WordSprite local server starting...
echo PC / local:  http://127.0.0.1:8765/index.html
echo Tablet / LAN: http://%IP%:8765/index.html

where python >nul 2>nul
if %errorlevel%==0 (
    start "WordSprite Audio Server" cmd /k python -m http.server 8765 --bind 0.0.0.0
) else (
    start "WordSprite Audio Server" cmd /k py -3 -m http.server 8765 --bind 0.0.0.0
)

timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8765/index.html
