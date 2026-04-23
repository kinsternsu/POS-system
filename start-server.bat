@echo off
cd /d "%~dp0"
echo Starting POS Server...
node server\index.js
pause