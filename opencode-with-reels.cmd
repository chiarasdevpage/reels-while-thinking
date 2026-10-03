@echo off
setlocal
rem Keep the caller's working directory for OpenCode.
for /f "delims=" %%P in ('node "%~dp0src\port.js"') do set "REELS_PORT=%%P"
if not defined REELS_PORT exit /b 1
start "Reels task watcher" /d "%~dp0" cmd /c start.cmd
call opencode.cmd --hostname 127.0.0.1 --port %REELS_PORT% %*
