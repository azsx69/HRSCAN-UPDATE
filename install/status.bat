@echo off
chcp 65001 >nul
REM ============================================================
REM   status.bat — สถานะ service + ค่าปัจจุบัน + log ล่าสุด
REM ============================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "NSSM_EXE=%ROOT%\nssm\nssm.exe"
if not exist "%NSSM_EXE%" set "NSSM_EXE=nssm"
set "SERVICE_NAME=HrScanUpdateSvc"

echo.
echo ===== สถานะ HRSCAN-UPDATE =====
for /f "delims=" %%s in ('"%NSSM_EXE%" status %SERVICE_NAME% 2^>nul') do set "SVC=%%s"
if not defined SVC set "SVC=ยังไม่ได้ติดตั้ง service"
echo service       : !SVC!
node src\cli.mjs status

echo.
echo ===== log ล่าสุด 20 บรรทัด =====
set "TODAY="
for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
set "LOGFILE=%ROOT%\logs\sync-!TODAY!.log"
if exist "!LOGFILE!" (
    powershell -NoProfile -Command "Get-Content -Path '!LOGFILE!' -Tail 20"
) else (
    echo   ยังไม่มี log ของวันนี้ที่ !LOGFILE!
)
exit /b 0
