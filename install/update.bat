@echo off
chcp 65001 >nul
REM ============================================================
REM   update.bat — ดึง tag ล่าสุดมาใช้ แล้ว restart service
REM   ถ้า service ไม่ขึ้นหลังอัปเดต จะย้อนกลับ tag เดิมอัตโนมัติ
REM ============================================================
REM ค้างหน้าต่างไว้เมื่อถูกคลิกเองจาก Explorer — ดูคำอธิบายใน install.bat
echo %cmdcmdline% | find /i "%~nx0" >nul && set "HOLD=1"
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "NSSM_EXE=%ROOT%\nssm\nssm.exe"
if not exist "%NSSM_EXE%" set "NSSM_EXE=nssm"
set "SERVICE_NAME=HrScanUpdateSvc"

echo === HRSCAN-UPDATE : อัปเดต ===
echo.

git --version >nul 2>&1
if errorlevel 1 ( echo  [x] ไม่พบ Git & pause & exit /b 1 )

set "CURRENT=(ไม่ทราบ)"
if exist "VERSION" for /f "delims=" %%v in (VERSION) do set "CURRENT=%%v"
echo  เวอร์ชันปัจจุบัน : !CURRENT!

echo  [*] ตรวจหาเวอร์ชันใหม่ ...
git fetch --tags --prune --quiet
if errorlevel 1 ( echo  [x] ดึงข้อมูลจาก GitHub ไม่สำเร็จ — ตรวจอินเทอร์เน็ต & pause & exit /b 1 )

set "LATEST="
for /f "delims=" %%t in ('git tag -l "v*" --sort^=-v:refname') do ( set "LATEST=%%t" & goto :got )
:got
if not defined LATEST ( echo  [x] ไม่พบ tag เวอร์ชันบน GitHub & pause & exit /b 1 )
echo  เวอร์ชันล่าสุด   : !LATEST!

if "!LATEST!"=="!CURRENT!" (
    echo.
    echo  [OK] ใช้เวอร์ชันล่าสุดอยู่แล้ว ไม่ต้องอัปเดต
    if defined HOLD pause
    exit /b 0
)

echo.
set "OK=Y"
set /p "OK=อัปเดตจาก !CURRENT! เป็น !LATEST! หรือไม่? (Y/n): "
if /i "!OK!"=="N" (
    echo  ยกเลิก
    if defined HOLD pause
    exit /b 0
)

REM -- จำ tag เดิมไว้เผื่อต้องย้อนกลับ --
set "PREV="
for /f "delims=" %%c in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "PREV=%%c"
if "!PREV!"=="HEAD" for /f "delims=" %%c in ('git describe --tags --exact-match 2^>nul') do set "PREV=%%c"
if not defined PREV set "PREV=!CURRENT!"

set "WASRUNNING="
"%NSSM_EXE%" status %SERVICE_NAME% 2>nul | findstr /C:"SERVICE_RUNNING" >nul
if not errorlevel 1 (
    set "WASRUNNING=1"
    echo  [*] หยุด service ...
    "%NSSM_EXE%" stop %SERVICE_NAME% >nul 2>&1
)

echo  [*] เปลี่ยนไปเวอร์ชัน !LATEST! ...
git checkout !LATEST! --quiet
if errorlevel 1 (
    echo  [x] เปลี่ยนเวอร์ชันไม่สำเร็จ — อาจมีไฟล์ถูกแก้ไว้ในเครื่อง
    if defined WASRUNNING "%NSSM_EXE%" start %SERVICE_NAME% >nul 2>&1
    pause & exit /b 1
)

echo  [*] ติดตั้ง dependency ...
call npm ci
if errorlevel 1 (
    echo  [x] npm ci ไม่สำเร็จ — ย้อนกลับ !PREV!
    git checkout !PREV! --quiet
    call npm ci
    if defined WASRUNNING "%NSSM_EXE%" start %SERVICE_NAME% >nul 2>&1
    pause & exit /b 1
)

if defined WASRUNNING (
    echo  [*] เปิด service ...
    "%NSSM_EXE%" start %SERVICE_NAME% >nul 2>&1
    timeout /t 5 /nobreak >nul
    "%NSSM_EXE%" status %SERVICE_NAME% 2>nul | findstr /C:"SERVICE_RUNNING" >nul
    if errorlevel 1 (
        echo  [x] service ไม่ขึ้นหลังอัปเดต — ย้อนกลับ !PREV! อัตโนมัติ
        git checkout !PREV! --quiet
        call npm ci
        "%NSSM_EXE%" start %SERVICE_NAME% >nul 2>&1
        echo      ดูสาเหตุได้ที่ logs\service.err.log
        pause & exit /b 1
    )
)

echo.
echo  [OK] อัปเดตเป็น !LATEST! แล้ว
echo       การตั้งค่าและ cursor ไม่ถูกแตะ (config.ini/.env/state.json ไม่ได้อยู่ใน git)
if defined HOLD pause
exit /b 0
