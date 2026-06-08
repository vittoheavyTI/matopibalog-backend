@echo off
start "Backend MatopibaLog" cmd /c "cd /d "%~dp0backend" && node server.js"
start "Frontend MatopibaLog" cmd /c "cd /d "%~dp0painel_web" && node node_modules\vite\bin\vite.js"
echo Servidores iniciados em segundo plano.
pause
