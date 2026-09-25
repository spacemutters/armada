@echo off
rem Starts the Armada AI helper in its own small window, restarting it on its own if it stops.
rem Close that window (or run stop-helper.cmd) to stop it.
start "Armada AI helper" /min cmd /c ""%~dp0run-helper.cmd""
