@echo off
chcp 65001 >nul
REM ============================================================
REM   uninstall-service.bat — ถอน service (ไม่ลบข้อมูลหรือการตั้งค่า)
REM ============================================================
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "NSSM_EXE=%ROOT%\nssm\nssm.exe"
if not exist "%NSSM_EXE%" set "NSSM_EXE=nssm"
set "SERVICE_NAME=HrScanUpdateSvc"

net session >nul 2>&1
if errorlevel 1 (
    echo  [!] ต้องรันด้วยสิทธิ์ Administrator
    pause & exit /b 1
)

"%NSSM_EXE%" status "%SERVICE_NAME%" >nul 2>&1
if errorlevel 1 (
    echo  ไม่พบ service %SERVICE_NAME% — ไม่ต้องถอน
    exit /b 0
)

echo  จะถอน service %SERVICE_NAME%
echo  (config.ini, .env, state.json และ log จะยังอยู่ครบ)
set "OK=N"
set /p "OK=ยืนยันหรือไม่? (y/N): "
if /i not "%OK%"=="Y" ( echo  ยกเลิก & exit /b 0 )

"%NSSM_EXE%" stop "%SERVICE_NAME%" >nul 2>&1
"%NSSM_EXE%" remove "%SERVICE_NAME%" confirm >nul
echo  [OK] ถอน service แล้ว
exit /b 0
