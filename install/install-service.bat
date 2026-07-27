@echo off
chcp 65001 >nul
REM ============================================================
REM   install-service.bat — ลงทะเบียน NSSM service (ต้องรันด้วยสิทธิ์ Administrator)
REM ============================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"

set "SERVICE_NAME=HrScanUpdateSvc"
set "NSSM_DIR=%ROOT%\nssm"
set "NSSM_EXE=%NSSM_DIR%\nssm.exe"
set "WINGET_NSSM=%LOCALAPPDATA%\Microsoft\WinGet\Links\nssm.exe"

echo === HRSCAN-UPDATE : ติดตั้ง Windows Service ===
echo.

net session >nul 2>&1
if errorlevel 1 (
    echo  [!] ต้องรันด้วยสิทธิ์ Administrator — คลิกขวาที่ไฟล์นี้แล้วเลือก "Run as administrator"
    pause & exit /b 1
)

if not exist "config.ini" (
    echo  [!] ยังไม่ได้ตั้งค่า — รัน install\bootstrap.bat ก่อน
    pause & exit /b 1
)

REM -- หา NSSM: winget cache -> zip จาก nssm.cc -> winget --
if not exist "%NSSM_EXE%" if exist "%WINGET_NSSM%" (
    mkdir "%NSSM_DIR%" >nul 2>&1
    copy "%WINGET_NSSM%" "%NSSM_EXE%" >nul
)
if not exist "%NSSM_EXE%" (
    echo  [*] กำลังดาวน์โหลด NSSM ...
    mkdir "%NSSM_DIR%" >nul 2>&1
    curl -L --connect-timeout 15 -o "%TEMP%\nssm.zip" "https://nssm.cc/release/nssm-2.24.zip" >nul 2>&1
    if not errorlevel 1 (
        powershell -Command "Expand-Archive -Path '%TEMP%\nssm.zip' -DestinationPath '%TEMP%\nssm-extract' -Force"
        copy "%TEMP%\nssm-extract\nssm-2.24\win64\nssm.exe" "%NSSM_EXE%" >nul
        rmdir /S /Q "%TEMP%\nssm-extract" >nul 2>&1
        del "%TEMP%\nssm.zip" >nul 2>&1
    )
)
if not exist "%NSSM_EXE%" (
    winget install NSSM.NSSM --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
    if exist "%WINGET_NSSM%" ( mkdir "%NSSM_DIR%" >nul 2>&1 & copy "%WINGET_NSSM%" "%NSSM_EXE%" >nul )
)
if not exist "%NSSM_EXE%" (
    echo  [!] ไม่พบ NSSM — ติดตั้งเอง: winget install NSSM.NSSM แล้วคัดลอกไปที่ %NSSM_EXE%
    pause & exit /b 1
)

REM -- หา node.exe (service รันด้วยบัญชี LocalSystem ซึ่ง PATH ไม่เหมือนของผู้ใช้) --
set "NODE_EXE="
for %%N in (node.exe) do if not defined NODE_EXE set "NODE_EXE=%%~$PATH:N"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE (
    echo  [!] ไม่พบ node.exe — รัน install\install.bat ก่อน
    pause & exit /b 1
)

REM -- service ต้องเรียก git ได้เองตอนอัปเดต จึงต้องใส่ path ของ git ไว้ให้ --
set "GIT_CMD_DIR="
for %%G in ("%ProgramFiles%\Git\cmd" "%ProgramFiles(x86)%\Git\cmd" "%LOCALAPPDATA%\Programs\Git\cmd") do (
    if exist "%%~G\git.exe" if not defined GIT_CMD_DIR set "GIT_CMD_DIR=%%~G"
)

if not exist "logs" mkdir "logs"

"%NSSM_EXE%" status "%SERVICE_NAME%" >nul 2>&1
if not errorlevel 1 (
    echo  [*] มี service อยู่แล้ว — ตั้งค่าใหม่ทับ
    "%NSSM_EXE%" stop "%SERVICE_NAME%" >nul 2>&1
    "%NSSM_EXE%" remove "%SERVICE_NAME%" confirm >nul
)

"%NSSM_EXE%" install "%SERVICE_NAME%" "%NODE_EXE%" src\index.mjs
"%NSSM_EXE%" set "%SERVICE_NAME%" AppDirectory "%ROOT%"
"%NSSM_EXE%" set "%SERVICE_NAME%" DisplayName "HRSCAN Update (ส่งข้อมูลสแกนนิ้วขึ้น Supabase)"
"%NSSM_EXE%" set "%SERVICE_NAME%" Description "อ่าน log จากเครื่องสแกนลายนิ้วมือ ZKTeco แล้วส่งขึ้น Supabase"
"%NSSM_EXE%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START
"%NSSM_EXE%" set "%SERVICE_NAME%" AppStdout "%ROOT%\logs\service.out.log"
"%NSSM_EXE%" set "%SERVICE_NAME%" AppStderr "%ROOT%\logs\service.err.log"
"%NSSM_EXE%" set "%SERVICE_NAME%" AppRotateFiles 1
"%NSSM_EXE%" set "%SERVICE_NAME%" AppRotateBytes 10485760
"%NSSM_EXE%" set "%SERVICE_NAME%" AppExit Default Restart
"%NSSM_EXE%" set "%SERVICE_NAME%" AppRestartDelay 10000
"%NSSM_EXE%" set "%SERVICE_NAME%" AppStopMethodConsole 15000

set "EXTRA_PATH=%ProgramFiles%\nodejs"
if defined GIT_CMD_DIR set "EXTRA_PATH=!EXTRA_PATH!;!GIT_CMD_DIR!"
"%NSSM_EXE%" set "%SERVICE_NAME%" AppEnvironmentExtra "PATH=!EXTRA_PATH!;%PATH%"

"%NSSM_EXE%" start "%SERVICE_NAME%"
if errorlevel 1 (
    echo  [!] เริ่ม service ไม่สำเร็จ — ดู logs\service.err.log
    pause & exit /b 1
)

echo.
echo  [OK] %SERVICE_NAME% ทำงานแล้ว
echo       ดูสถานะได้จาก install\menu.bat
exit /b 0
