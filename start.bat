@echo off
rem LinkIQ Field Assistant - local start on Windows.
rem   start.bat       = the real Kamstrup API
rem   start.bat sim   = simulator, no meter needed
rem The server listens on this computer only (127.0.0.1), so no pairing is asked.
setlocal
cd /d "%~dp0backend"

set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto :nopython

rem The Python environment and the database live outside OneDrive, so they are not synchronised.
set "HOME_DIR=%LOCALAPPDATA%\LinkIQ"
set "VENV=%HOME_DIR%\venv"
if not exist "%HOME_DIR%" mkdir "%HOME_DIR%"
if exist "%VENV%\Scripts\python.exe" goto :run

echo Preparing the Python environment. This happens once and takes about a minute...
%PY% -m venv "%VENV%"
if errorlevel 1 goto :fail
"%VENV%\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :fail

:run
set "KAMSTRUP_MODE=live"
if /i "%~1"=="sim" set "KAMSTRUP_MODE=sim"
set "AUTH_MODE=none"
set "LINKIQ_DB_PATH=%HOME_DIR%\linkiq-%KAMSTRUP_MODE%.sqlite3"

rem The sample registry is loaded for the simulator only. In real mode no measurement
rem can start until the Kredsloeb registry is imported (fail closed).
if "%KAMSTRUP_MODE%"=="sim" if not exist "%LINKIQ_DB_PATH%" "%VENV%\Scripts\python.exe" scripts\import_registry.py --db "%LINKIQ_DB_PATH%" --sites data\sites.sample.csv --concentrators data\concentrators.sample.csv

echo.
echo LinkIQ starts in mode: %KAMSTRUP_MODE%
echo Address: http://localhost:8000    Stop: Ctrl+C or close the window.
echo.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:8000'"
"%VENV%\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
goto :eof

:nopython
echo Python is not installed on this computer.
echo Install "Python 3.12" from Microsoft Store or Company Portal, then run start.bat again.
pause
exit /b 1

:fail
echo.
echo The installation failed. Most often the network blocks the download of Python packages.
echo Send the text above for diagnosis.
if exist "%VENV%" rmdir /s /q "%VENV%"
pause
exit /b 1
