@echo off
chcp 65001 >nul
REM ============================================================
REM   menu.bat — เมนูหลัก (คนที่สาขาใช้ไฟล์นี้ไฟล์เดียว)
REM   ข้อที่ต้องใช้สิทธิ์ Administrator จะบอกไว้ในเมนู
REM ============================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "NSSM_EXE=%ROOT%\nssm\nssm.exe"
if not exist "%NSSM_EXE%" set "NSSM_EXE=nssm"
set "SERVICE_NAME=HrScanUpdateSvc"

:menu
cls
set "SVC="
for /f "delims=" %%s in ('"%NSSM_EXE%" status %SERVICE_NAME% 2^>nul') do set "SVC=%%s"
if not defined SVC set "SVC=ยังไม่ได้ติดตั้ง"
if "!SVC!"=="SERVICE_RUNNING" set "SVC=กำลังทำงาน"
if "!SVC!"=="SERVICE_STOPPED" set "SVC=หยุดอยู่"

set "VER=(ไม่ทราบ)"
if exist "VERSION" for /f "delims=" %%v in (VERSION) do set "VER=%%v"

echo ========= HRSCAN-UPDATE =========
echo   service : !SVC!        เวอร์ชัน : !VER!
echo.
node src\cli.mjs status
echo.
echo   --- ใช้งานประจำ ---
echo    1. ดูสถานะ + log ล่าสุด
echo    2. ดู log วันนี้ทั้งไฟล์
echo    3. เปิดโฟลเดอร์ log
echo    4. ทดสอบการเชื่อมต่อ (เครื่องสแกน / Supabase)
echo    5. สั่ง sync เดี๋ยวนี้
echo.
echo   --- ตั้งค่า ---
echo    6. แก้ไขการตั้งค่า
echo    7. Start / Stop / Restart service      (ต้องเป็น Administrator)
echo.
echo   --- ติดตั้งและอัปเดต ---
echo    8. อัปเดตเป็นเวอร์ชันล่าสุด             (ต้องเป็น Administrator)
echo    9. ย้อนกลับเวอร์ชันก่อนหน้า             (ต้องเป็น Administrator)
echo   10. ติดตั้ง service ใหม่                (ต้องเป็น Administrator)
echo   11. ถอน service                        (ต้องเป็น Administrator)
echo.
echo    0. ออก
echo.
set "CH="
set /p "CH=เลือก: "

if "%CH%"=="1" ( call "%~dp0status.bat" & pause & goto menu )
if "%CH%"=="2" ( call :viewlog & pause & goto menu )
if "%CH%"=="3" ( if not exist "logs" mkdir "logs" & start "" "%ROOT%\logs" & goto menu )
if "%CH%"=="4" ( call "%~dp0test-connection.bat" & pause & goto menu )
if "%CH%"=="5" ( call :syncnow & pause & goto menu )
if "%CH%"=="6" ( call "%~dp0bootstrap.bat" & pause & goto menu )
if "%CH%"=="7" ( call :svcmenu & goto menu )
if "%CH%"=="8" ( call "%~dp0update.bat" & pause & goto menu )
if "%CH%"=="9" ( call "%~dp0rollback.bat" & pause & goto menu )
if "%CH%"=="10" ( call "%~dp0install-service.bat" & pause & goto menu )
if "%CH%"=="11" ( call "%~dp0uninstall-service.bat" & pause & goto menu )
if "%CH%"=="0" ( exit /b 0 )
goto menu

:viewlog
set "TODAY="
for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
if exist "logs\sync-!TODAY!.log" (
    type "logs\sync-!TODAY!.log"
) else (
    echo   ยังไม่มี log ของวันนี้
)
exit /b 0

REM -- sync ทันที: ต้องหยุด service ก่อน เพราะเครื่อง ZKTeco รับได้ทีละ 1 การเชื่อมต่อ
REM    ถ้าปล่อยให้ชนกัน จะต่อไม่ติดทั้งคู่และ state.json อาจถูกเขียนทับกัน
:syncnow
set "WASRUNNING="
"%NSSM_EXE%" status %SERVICE_NAME% 2>nul | findstr /C:"SERVICE_RUNNING" >nul
if not errorlevel 1 (
    set "WASRUNNING=1"
    echo  [*] หยุด service ชั่วคราว ...
    "%NSSM_EXE%" stop %SERVICE_NAME% >nul 2>&1
)
echo.
node src\cli.mjs sync-now
set "SYNC_RC=!ERRORLEVEL!"
echo.
REM เปิด service กลับเสมอ แม้ sync จะล้ม ไม่งั้นสาขาจะหยุดส่งข้อมูลโดยไม่มีใครรู้
if defined WASRUNNING (
    echo  [*] เปิด service กลับ ...
    "%NSSM_EXE%" start %SERVICE_NAME% >nul 2>&1
)
if not "!SYNC_RC!"=="0" echo  [x] รอบนี้ไม่สำเร็จ — ดูข้อความด้านบน
exit /b 0

:svcmenu
echo.
echo    1. Start   2. Stop   3. Restart   0. กลับ
set "S="
set /p "S=เลือก: "
if "%S%"=="1" "%NSSM_EXE%" start %SERVICE_NAME%
if "%S%"=="2" "%NSSM_EXE%" stop %SERVICE_NAME%
if "%S%"=="3" "%NSSM_EXE%" restart %SERVICE_NAME%
if not "%S%"=="0" pause
exit /b 0
