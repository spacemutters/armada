@echo off
rem Starts the Armada AI helper in its own small window. Close that window to stop it.
start "Armada AI helper" /min cmd /c "cd /d "%~dp0" && node armada-helper.mjs"
