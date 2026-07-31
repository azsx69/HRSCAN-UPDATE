@echo off
chcp 65001 >nul
REM ============================================================
REM   install.bat — ตัวติดตั้งไฟล์เดียว
REM
REM   พกไฟล์นี้ไปวางที่ไหนก็ได้ในเครื่องสาขา (Desktop, USB, C:\HR-SCAN) แล้วคลิก
REM   โปรแกรมจะติดตั้ง Git/Node.js ให้ถ้ายังไม่มี แล้วโหลดโปรแกรมจาก GitHub
REM   ลงที่ C:\Jaybon\HRSCAN-UPDATE ให้เอง ไม่ต้องคัดลอกไฟล์อื่นตามไปด้วย
REM
REM   ถ้าวาง .env หรือ config.ini ไว้ข้าง ๆ ไฟล์นี้ จะยกไปให้ด้วยเพื่อไม่ต้องพิมพ์ใหม่
REM   แต่จะไม่เขียนทับของที่ปลายทางมีอยู่แล้วเด็ดขาด
REM ============================================================
REM ถูก double-click จาก Explorer หน้าต่างจะปิดทันทีที่จบจนอ่านผลไม่ทัน — ค้างไว้ให้อ่าน
echo %cmdcmdline% | find /i "%~nx0" >nul && set "HOLD=1"
setlocal enabledelayedexpansion

set "TARGET=C:\Jaybon\HRSCAN-UPDATE"
set "REPO=https://github.com/azsx69/HRSCAN-UPDATE.git"

REM โฟลเดอร์ที่ไฟล์นี้วางอยู่ ใช้หาไฟล์ตั้งค่าที่คนติดตั้งพกมาด้วย
REM %~dp0 ลงท้ายด้วย \ เสมอ ต้องตัดทิ้งก่อน ไม่งั้น "!HERE!\x" จะกลายเป็น C:\dir\\x
REM และถ้าเป็นรากไดรฟ์ "C:\" ตัว \" จะถูกอ่านเป็น escaped quote แล้วคำสั่งเพี้ยนทั้งบรรทัด
set "HERE=%~dp0"
if "!HERE:~-1!"=="\" set "HERE=!HERE:~0,-1!"

echo ============================================
echo    HRSCAN-UPDATE : ติดตั้ง
echo ============================================
echo   ปลายทาง : !TARGET!
echo.

REM ---------- Git ----------
where git >nul 2>&1
if errorlevel 1 (
    echo  [*] ไม่พบ Git — กำลังติดตั้งผ่าน winget ...
    winget install Git.Git --silent --accept-source-agreements --accept-package-agreements
    REM winget เพิ่ง PATH ให้ process ใหม่ หน้าต่างนี้ยังไม่เห็น ต้องดึง PATH มาใหม่เอง
    call :refreshpath
    where git >nul 2>&1
    if errorlevel 1 (
        echo  [x] ติดตั้ง Git ไม่สำเร็จ — ติดตั้งเองจาก https://git-scm.com
        echo      แล้วเปิดหน้าต่างใหม่ คลิกไฟล์นี้อีกครั้ง
        goto :fail
    )
)
for /f "delims=" %%v in ('git --version') do echo  [OK] %%v

REM ---------- Node.js ----------
where node >nul 2>&1
if errorlevel 1 (
    echo  [*] ไม่พบ Node.js — กำลังติดตั้งผ่าน winget ...
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    call :refreshpath
    where node >nul 2>&1
    if errorlevel 1 (
        echo  [x] ติดตั้ง Node.js ไม่สำเร็จ — ติดตั้งเองจาก https://nodejs.org
        echo      แล้วเปิดหน้าต่างใหม่ คลิกไฟล์นี้อีกครั้ง
        goto :fail
    )
)
for /f "delims=" %%v in ('node --version') do echo  [OK] Node.js %%v

REM ---------- โหลดโปรแกรม ----------
echo.
if exist "!TARGET!\.git" (
    echo  [*] มีโปรแกรมอยู่แล้ว — ดึงเวอร์ชันล่าสุดจาก GitHub ...
    git -C "!TARGET!" fetch --tags --prune --quiet
    if errorlevel 1 (
        echo  [x] ดึงข้อมูลจาก GitHub ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต
        goto :fail
    )
) else (
    REM โฟลเดอร์มีอยู่แต่ไม่ใช่ repo — ถ้ามีไฟล์ปนอยู่ clone จะไม่ยอมทำงาน
    REM หยุดไว้ให้คนตัดสินใจเอง ดีกว่าไปยุ่งกับไฟล์ที่ไม่รู้ว่าของใคร
    if exist "!TARGET!" (
        dir /b /a "!TARGET!" 2>nul | findstr "^" >nul && (
            echo  [x] มีโฟลเดอร์ !TARGET! อยู่แล้วและมีไฟล์อยู่ข้างใน แต่ไม่ใช่โปรแกรมนี้
            echo      ย้ายหรือเปลี่ยนชื่อโฟลเดอร์นั้นก่อน แล้วคลิกไฟล์นี้อีกครั้ง
            goto :fail
        )
    )
    echo  [*] กำลังโหลดโปรแกรมจาก GitHub ไปที่ !TARGET! ...
    git clone --quiet "!REPO!" "!TARGET!"
    if errorlevel 1 (
        echo  [x] โหลดโปรแกรมไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต
        goto :fail
    )
)

REM ใช้เวอร์ชันที่ออก release แล้ว ไม่ใช่ปลาย main ที่อาจยังไม่ผ่านการทดสอบ
set "TAG="
for /f "delims=" %%t in ('git -C "!TARGET!" tag -l "v*" --sort^=-v:refname 2^>nul') do (
    set "TAG=%%t"
    goto :gottag
)
:gottag
if defined TAG (
    git -C "!TARGET!" checkout !TAG! --quiet
    if errorlevel 1 (
        echo  [x] เปลี่ยนไปเวอร์ชัน !TAG! ไม่สำเร็จ
        echo      มักเกิดจากมีไฟล์ที่ถูกแก้ค้างไว้ที่ !TARGET!
        echo      git จึงไม่ยอมทับให้ ตรวจด้วยคำสั่ง: git -C "!TARGET!" status
        goto :fail
    )
    echo  [OK] ใช้เวอร์ชัน !TAG!
) else (
    echo  [!] ยังไม่มี tag เวอร์ชัน — ใช้โค้ดล่าสุดบน main ไปก่อน
)

REM ---------- ยกไฟล์ตั้งค่าที่พกมาไปให้ ----------
REM เช็ค "มีที่ปลายทางไหม" เป็นเงื่อนไขนอกสุด เพราะ else ของ cmd ผูกกับ if ตัวในสุดเสมอ
for %%f in (config.ini .env) do (
    if exist "!TARGET!\%%f" (
        echo  [--] คง %%f เดิมที่ปลายทางไว้ ไม่เขียนทับ
    ) else (
        if exist "!HERE!\%%f" (
            copy /y "!HERE!\%%f" "!TARGET!\%%f" >nul
            echo  [OK] คัดลอก %%f ที่พกมาไปให้ด้วย
        )
    )
)

REM ---------- dependency ----------
echo.
echo  [*] ติดตั้ง dependency ...
pushd "!TARGET!"
if exist "package-lock.json" ( call npm ci ) else ( call npm install )
set "NPMRC=!ERRORLEVEL!"
popd
if not "!NPMRC!"=="0" (
    echo  [x] ติดตั้ง dependency ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต
    goto :fail
)

echo.
echo  [OK] ติดตั้งเรียบร้อยที่ !TARGET!
echo.
echo  ขั้นต่อไป: ตั้งค่าประจำสาขาแล้วลง service
echo    เปิด !TARGET!\install\setup.bat
if defined HOLD pause
exit /b 0

:fail
if defined HOLD pause
exit /b 1

REM ============================================================
REM   :refreshpath — ดึง PATH ล่าสุดจาก registry เข้ามาในหน้าต่างนี้
REM   winget ตั้ง PATH ให้ตอนติดตั้ง แต่หน้าต่างที่เปิดค้างอยู่ไม่เห็นค่าใหม่
REM   ถ้าไม่ทำ จะต้องปิดเปิดหน้าต่างใหม่ทุกครั้งที่เพิ่งลง Git หรือ Node
REM ============================================================
:refreshpath
for /f "skip=2 tokens=2,*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "MPATH=%%b"
for /f "skip=2 tokens=2,*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "UPATH=%%b"
set "PATH=!MPATH!;!UPATH!"
exit /b 0
