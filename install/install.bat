@echo off
chcp 65001 >nul
REM ============================================================
REM   install.bat — ตรวจ Node/Git แล้วติดตั้ง dependency
REM ============================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo === HRSCAN-UPDATE : ติดตั้งส่วนประกอบ ===
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo  [*] ไม่พบ Node.js — กำลังติดตั้งผ่าน winget ...
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    where node >nul 2>&1
    if errorlevel 1 (
        echo  [x] ติดตั้ง Node.js ไม่สำเร็จ — ติดตั้งเองจาก https://nodejs.org แล้วรันไฟล์นี้ใหม่
        pause & exit /b 1
    )
)
for /f "delims=" %%v in ('node --version') do echo  [OK] Node.js %%v

where git >nul 2>&1
if errorlevel 1 (
    echo  [*] ไม่พบ Git — กำลังติดตั้งผ่าน winget ...
    winget install Git.Git --silent --accept-source-agreements --accept-package-agreements
    where git >nul 2>&1
    if errorlevel 1 (
        echo  [x] ติดตั้ง Git ไม่สำเร็จ — ติดตั้งเองจาก https://git-scm.com แล้วรันไฟล์นี้ใหม่
        echo      ไม่มี Git จะอัปเดตเวอร์ชันผ่านเมนูไม่ได้
        pause & exit /b 1
    )
)
for /f "delims=" %%v in ('git --version') do echo  [OK] %%v

echo.
echo  [*] ติดตั้ง dependency ...
if exist "package-lock.json" ( call npm ci ) else ( call npm install )
if errorlevel 1 (
    echo  [x] ติดตั้ง dependency ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต
    pause & exit /b 1
)

echo.
echo  [OK] ติดตั้งส่วนประกอบเรียบร้อย
exit /b 0
