@echo off
title CareHub
cd /d "%~dp0"
echo Starting CareHub at http://localhost:3000 ...
echo Close this window to stop the app.
start "" cmd /c "timeout /t 20 /nobreak >nul && start http://localhost:3000"
echo Updating database...
call npx prisma migrate deploy
call npx prisma generate
call npm run dev
