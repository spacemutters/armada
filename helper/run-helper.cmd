@echo off
rem Runs the Armada AI helper and starts it again if it ever stops (a crash, the laptop waking from
rem sleep, a lost connection). stop-helper.cmd closes this window, which ends the loop too.
cd /d "%~dp0"
:loop
node armada-helper.mjs
echo %date% %time% helper stopped; starting it again in 15 seconds>> helper.log
timeout /t 15 /nobreak >nul
goto loop
