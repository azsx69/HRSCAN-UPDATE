@echo off
chcp 65001 >nul
REM ============================================================
REM   setup.bat — ติดตั้งครบขั้นตอนในครั้งเดียว
REM   ติดตั้งส่วนประกอบ -> ตั้งค่าสาขา -> ลง service -> เปิดเมนู
REM ============================================================
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo ============================================
echo    HRSCAN-UPDATE : ติดตั้ง
echo ============================================
echo.

call "%~dp0install.bat"
if errorlevel 1 exit /b 1

echo.
call "%~dp0bootstrap.bat"
if errorlevel 1 exit /b 1

echo.
echo --- ติดตั้ง Windows Service ---
echo  ขั้นนี้ต้องใช้สิทธิ์ Administrator
set "DO_SVC=Y"
set /p "DO_SVC=ติดตั้ง service ตอนนี้เลยไหม? (Y/n): "
if /i "%DO_SVC%"=="N" (
    echo  ข้ามไปก่อน — ภายหลังให้คลิกขวาที่ install\install-service.bat แล้วเลือก Run as administrator
    goto :done
)

net session >nul 2>&1
if errorlevel 1 (
    echo  [*] ขอสิทธิ์ Administrator ...
    powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~dp0install-service.bat'"
) else (
    call "%~dp0install-service.bat"
)

:done
echo.
echo  เปิดเมนูใช้งาน ...
timeout /t 2 /nobreak >nul
call "%~dp0menu.bat"
exit /b 0
