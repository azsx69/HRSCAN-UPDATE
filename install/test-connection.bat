@echo off
chcp 65001 >nul
REM ============================================================
REM   test-connection.bat — ทดสอบเครื่องสแกนและ Supabase แยกกัน
REM ============================================================
REM ค้างหน้าต่างไว้เมื่อถูกคลิกเองจาก Explorer — ดูคำอธิบายใน install.bat
echo %cmdcmdline% | find /i "%~nx0" >nul && set "HOLD=1"
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo.
echo --- 1/2 แหล่งข้อมูลสแกน ---
node src\cli.mjs test-source
set "DEV_RC=%ERRORLEVEL%"

echo.
echo --- 2/2 Supabase ---
node src\cli.mjs test-supabase
set "SB_RC=%ERRORLEVEL%"

echo.
if "%DEV_RC%"=="0" if "%SB_RC%"=="0" (
    echo  [OK] เชื่อมต่อได้ทั้งสองฝั่ง — พร้อมใช้งาน
    if defined HOLD pause
    exit /b 0
)
echo  [x] ยังมีส่วนที่ต่อไม่ได้ — แก้การตั้งค่าแล้วทดสอบใหม่ (เมนูข้อ 6)
if defined HOLD pause
exit /b 1
