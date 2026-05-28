@echo off
start "Backend ChoferLog" cmd /c "cd /d "%~dp0backend" && node server.js"
start "Frontend ChoferLog" cmd /c "cd /d "%~dp0painel_web" && node node_modules\vite\bin\vite.js"
echo Servidores iniciados em segundo plano.
pause
