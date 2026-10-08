@echo off
rem Starts the local PostgreSQL cluster if it is not already listening. Safe to run on a machine without
rem PostgreSQL (does nothing). Data directory: %PGDATA% when set, else %USERPROFILE%\pgdata17.
set "PGBIN=C:\Program Files\PostgreSQL\17\bin"
if not exist "%PGBIN%\pg_ctl.exe" exit /b 0
if "%PGDATA%"=="" set "PGDATA=%USERPROFILE%\pgdata17"
if not exist "%PGDATA%\PG_VERSION" exit /b 0
"%PGBIN%\pg_isready.exe" -q -h localhost -p 5432 && exit /b 0
echo [postgres] cluster not running, starting it from %PGDATA% ...
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -l "%PGDATA%\server.log" -w -t 30 start >nul
"%PGBIN%\pg_isready.exe" -q -h localhost -p 5432 && echo [postgres] ready || echo [postgres] could not start; see %PGDATA%\server.log
exit /b 0
