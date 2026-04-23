@echo off
echo Starting POS Server...
cd /d "%~dp0"
start "POS Server" cmd /k "node server\index.js"
timeout /t 3 /nobreak
echo Server should be running at http://localhost:8080
pause