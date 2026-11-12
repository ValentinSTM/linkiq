@echo off
rem LinkIQ Field Assistant - pornire locala pe Windows.
rem   start.bat       = API-ul real Kamstrup
rem   start.bat sim   = simulator, fara contor
rem Serverul asculta doar pe acest calculator (127.0.0.1), deci nu cere cuplare.
setlocal
cd /d "%~dp0backend"

set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto :nopython

rem Mediul Python si baza de date stau in afara OneDrive, ca sa nu fie sincronizate.
set "HOME_DIR=%LOCALAPPDATA%\LinkIQ"
set "VENV=%HOME_DIR%\venv"
if not exist "%HOME_DIR%" mkdir "%HOME_DIR%"
if exist "%VENV%\Scripts\python.exe" goto :run

echo Pregatesc mediul Python. Se face o singura data si dureaza un minut...
%PY% -m venv "%VENV%"
if errorlevel 1 goto :fail
"%VENV%\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :fail

:run
set "KAMSTRUP_MODE=live"
if /i "%~1"=="sim" set "KAMSTRUP_MODE=sim"
set "AUTH_MODE=none"
set "LINKIQ_DB_PATH=%HOME_DIR%\linkiq-%KAMSTRUP_MODE%.sqlite3"

rem Registrul de exemplu se incarca doar pentru simulator. In modul real, cat timp
rem registrul este gol, toate receptoarele auzite sunt tratate ca proprii.
if "%KAMSTRUP_MODE%"=="sim" if not exist "%LINKIQ_DB_PATH%" "%VENV%\Scripts\python.exe" scripts\import_registry.py --db "%LINKIQ_DB_PATH%" --sites data\sites.sample.csv --concentrators data\concentrators.sample.csv

echo.
echo LinkIQ porneste in modul: %KAMSTRUP_MODE%
echo Adresa: http://localhost:8000    Oprire: Ctrl+C sau inchide fereastra.
echo.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:8000'"
"%VENV%\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
goto :eof

:nopython
echo Python nu este instalat pe acest calculator.
echo Instaleaza "Python 3.12" din Microsoft Store sau din Company Portal, apoi ruleaza din nou start.bat.
pause
exit /b 1

:fail
echo.
echo Instalarea a esuat. Cel mai des, reteaua blocheaza descarcarea pachetelor Python.
echo Trimite textul de mai sus pentru diagnostic.
if exist "%VENV%" rmdir /s /q "%VENV%"
pause
exit /b 1
