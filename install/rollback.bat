@echo off
chcp 65001 >nul
REM ============================================================
REM   rollback.bat — ย้อนกลับไปเวอร์ชันก่อนหน้า
REM ============================================================
REM ค้างหน้าต่างไว้เมื่อถูกคลิกเองจาก Explorer — ดูคำอธิบายใน install.bat
echo %cmdcmdline% | find /i "%~nx0" >nul && set "HOLD=1"
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "NSSM_EXE=%ROOT%\nssm\nssm.exe"
if not exist "%NSSM_EXE%" set "NSSM_EXE=nssm"
set "SERVICE_NAME=HrScanUpdateSvc"

echo === HRSCAN-UPDATE : ย้อนเวอร์ชัน ===
echo.

set "CURRENT=(ไม่ทราบ)"
if exist "VERSION" for /f "delims=" %%v in (VERSION) do set "CURRENT=%%v"
echo  เวอร์ชันปัจจุบัน : !CURRENT!
echo.
echo  เวอร์ชันที่มี:
git tag -l "v*" --sort=-v:refname

REM -- หา tag ตัวถัดจากปัจจุบัน (เรียงใหม่ไปเก่า) --
set "PREV="
set "SEEN="
for /f "delims=" %%t in ('git tag -l "v*" --sort^=-v:refname') do (
    if defined SEEN if not defined PREV set "PREV=%%t"
    if "%%t"=="!CURRENT!" set "SEEN=1"
)
if not defined PREV (
    echo.
    echo  [x] ไม่มีเวอร์ชันเก่ากว่านี้ให้ย้อนกลับ
    pause & exit /b 1
)

echo.
set "TARGET=!PREV!"
set /p "TARGET=ย้อนไปเวอร์ชัน [!PREV!]: "

echo.
set "OK=N"
set /p "OK=ยืนยันย้อนจาก !CURRENT! ไป !TARGET! หรือไม่? (y/N): "
if /i not "!OK!"=="Y" (
    echo  ยกเลิก
    if defined HOLD pause
    exit /b 0
)

set "WASRUNNING="
"%NSSM_EXE%" status %SERVICE_NAME% 2>nul | findstr /C:"SERVICE_RUNNING" >nul
if not errorlevel 1 (
    set "WASRUNNING=1"
    "%NSSM_EXE%" stop %SERVICE_NAME% >nul 2>&1
)

git checkout !TARGET! --quiet
if errorlevel 1 (
    echo  [x] เปลี่ยนเวอร์ชันไม่สำเร็จ
    if defined WASRUNNING "%NSSM_EXE%" start %SERVICE_NAME% >nul 2>&1
    pause & exit /b 1
)
call npm ci
if defined WASRUNNING "%NSSM_EXE%" start %SERVICE_NAME% >nul 2>&1

echo.
echo  [OK] ย้อนกลับเป็น !TARGET! แล้ว
if defined HOLD pause
exit /b 0
