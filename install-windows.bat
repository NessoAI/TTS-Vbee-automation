@echo off
cd /d "%~dp0"
npm install
npm run install:browser
echo.
echo Cai dat hoan tat. Chay run-windows.bat de mo ung dung.
pause
