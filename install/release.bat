@echo off
chcp 65001 >nul
REM ============================================================
REM   release.bat vX.Y.Z "หมายเหตุ" — ใช้ฝั่ง dev เท่านั้น
REM   อัปเดตไฟล์ VERSION, สร้าง tag แล้ว push ให้สาขาดึงไปใช้
REM ============================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"

set "TAG=%~1"
set "NOTE=%~2"

REM ตรวจรูปแบบ tag ด้วย Node ไม่ใช่ findstr — "echo %TAG% | findstr" ส่ง space ติดท้ายไปด้วย
REM ทำให้ $ ไม่ match แล้ว tag ที่ถูกต้องถูกปฏิเสธ เป็นกับดักที่มองด้วยตาไม่เห็น
node -e "process.exit(/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(process.argv[1]||'')?0:1)" "%TAG%"
if errorlevel 1 (
    echo  [x] วิธีใช้: release.bat vX.Y.Z "หมายเหตุ"   เช่น release.bat v0.2.0 "แก้เวลาเพี้ยน"
    exit /b 1
)
if "%NOTE%"=="" set "NOTE=release %TAG%"

REM -- working tree ต้องสะอาด ไม่งั้น tag จะไม่ตรงกับสิ่งที่สาขาได้รับ --
for /f "delims=" %%s in ('git status --porcelain') do (
    echo  [x] ยังมีไฟล์ที่ยังไม่ commit — commit หรือ stash ก่อน release
    exit /b 1
)

git rev-parse "%TAG%" >nul 2>&1
if not errorlevel 1 ( echo  [x] tag %TAG% มีอยู่แล้ว & exit /b 1 )

REM -- VERSION ต้องตรงกับ tag เพราะเมนูและ update.bat อ่านค่าจากไฟล์นี้ --
echo %TAG%> VERSION
git add VERSION
git commit -q -m "chore: bump VERSION to %TAG%"

git push origin HEAD
if errorlevel 1 ( echo  [x] push ไม่สำเร็จ & exit /b 1 )

git tag -a "%TAG%" -m "%NOTE%"
git push origin "%TAG%"
if errorlevel 1 ( echo  [x] push tag ไม่สำเร็จ & exit /b 1 )

echo.
echo  [OK] ออกเวอร์ชัน %TAG% แล้ว
echo       ที่สาขา: เปิด install\menu.bat แล้วเลือกข้อ 8 เพื่ออัปเดต
exit /b 0
