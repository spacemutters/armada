@echo off
rem Stops the Armada AI helper.
taskkill /fi "WINDOWTITLE eq Armada AI helper*" /t /f >nul 2>&1
if exist "%~dp0helper.lock" del "%~dp0helper.lock"
