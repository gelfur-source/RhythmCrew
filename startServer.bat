@echo off
title Farias' Song Server

REM Check if the server file exists in the current folder.
if exist "server.py" (
    echo Starting the Farias' Song Interface server...
    echo You can close this window to stop the server.
    
    REM Execute the python server. Use "py" or "python3" if "python" doesn't work.
    python server.py
) else (
    echo.
    echo ERROR: server.py not found!
    echo.
    echo Please make sure start_server.bat is in the same folder as server.py.
    echo.
    pause
)