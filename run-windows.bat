@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 4173,4174 -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo.
  echo Cong 4173 hoac 4174 dang duoc su dung.
  echo Hay dong cua so TTS POE cu, sau do chay lai file nay.
  echo.
  pause
  exit /b 1
)
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://127.0.0.1:4173'"
npm run dev
echo.
echo TTS POE Automation da dung.
pause
