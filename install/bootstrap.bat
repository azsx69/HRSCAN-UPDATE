@echo off
chcp 65001 >nul
REM ============================================================
REM   bootstrap.bat — ตั้งค่าประจำสาขา (config.ini + .env)
REM ============================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo === HRSCAN-UPDATE : ตั้งค่าสาขา ===
echo.

REM -- สำรองของเดิมก่อนทุกครั้ง --
if not exist "backups" mkdir "backups"
for /f "tokens=2 delims==" %%t in ('wmic os get localdatetime /value 2^>nul') do set "TS=%%t"
set "TS=!TS:~0,8!-!TS:~8,6!"
if exist "config.ini" copy /Y "config.ini" "backups\config.ini.!TS!" >nul
if exist ".env" copy /Y ".env" "backups\.env.!TS!" >nul

if not exist "config.ini" if exist "config.example.ini" copy /Y "config.example.ini" "config.ini" >nul
if not exist ".env" if exist ".env.example" copy /Y ".env.example" ".env" >nul

REM -- อ่านค่าปัจจุบันมาเป็นค่าตั้งต้นของ prompt --
set "CUR_BRANCH=Store 1"
set "CUR_MACHINE=FP-01"
set "CUR_IP=192.168.88.175"
set "CUR_PORT=4370"
set "CUR_INTERVAL=5"
set "CUR_START=2026-01-01"
set "CUR_SOURCE=device"
set "CUR_PSQL=C:\ZKBioTime\pgsql\bin\psql.exe"
set "CUR_DB=biotime"
REM ตัวอ่านนี้ไม่แยกหมวด จึงใช้ค่าแรกที่เจอสำหรับคีย์ที่ซ้ำกันข้ามหมวด (port มีทั้ง [device] และ [biotime])
for /f "usebackq tokens=1,* delims==" %%A in ("config.ini") do (
    set "K=%%A"
    set "K=!K: =!"
    set "V=%%B"
    for /f "tokens=* delims= " %%x in ("!V!") do set "V=%%x"
    if /i "!K!"=="code" if not defined GOT_BRANCH ( set "CUR_BRANCH=!V!" & set "GOT_BRANCH=1" )
    if /i "!K!"=="machine_code" set "CUR_MACHINE=!V!"
    if /i "!K!"=="type" set "CUR_SOURCE=!V!"
    if /i "!K!"=="ip" set "CUR_IP=!V!"
    if /i "!K!"=="port" if not defined GOT_PORT ( set "CUR_PORT=!V!" & set "GOT_PORT=1" )
    if /i "!K!"=="psql_path" set "CUR_PSQL=!V!"
    if /i "!K!"=="database" set "CUR_DB=!V!"
    if /i "!K!"=="interval_minutes" set "CUR_INTERVAL=!V!"
    if /i "!K!"=="start_date" set "CUR_START=!V!"
)

echo --- สาขา ---
set "BRANCH=!CUR_BRANCH!"
set /p "BRANCH=Branch code (ต้องตรงกับที่ระบบ HR ใช้) [!CUR_BRANCH!]: "
set "MACHINE=!CUR_MACHINE!"
set /p "MACHINE=Machine code [!CUR_MACHINE!]: "

echo.
echo --- แหล่งข้อมูลสแกน ---
set "CUR_CHOICE=1"
if /i "!CUR_SOURCE!"=="biotime" set "CUR_CHOICE=2"
echo    1. ต่อเครื่องสแกน ZKTeco ตรง ๆ
echo    2. อ่านจากฐานข้อมูล ZKBioTime ในเครื่องนี้  (สำหรับสาขาที่ลง ZKBioTime ไว้)
set "SRC_CHOICE=!CUR_CHOICE!"
set /p "SRC_CHOICE=เลือก [!CUR_CHOICE!]: "

if "!SRC_CHOICE!"=="2" (
    set "SRC_TYPE=biotime"
    echo.
    set "BIO_PSQL=!CUR_PSQL!"
    set /p "BIO_PSQL=พาธ psql.exe ของ ZKBioTime [!CUR_PSQL!]: "
    set "BIO_DB=!CUR_DB!"
    set /p "BIO_DB=ชื่อฐานข้อมูล [!CUR_DB!]: "
) else (
    set "SRC_TYPE=device"
    echo.
    set "DEV_IP=!CUR_IP!"
    set /p "DEV_IP=IP เครื่องสแกน [!CUR_IP!]: "
    set "DEV_PORT=!CUR_PORT!"
    set /p "DEV_PORT=Port [!CUR_PORT!]: "
)

echo.
echo --- Supabase ---
echo   (service key มีสิทธิ์สูงสุด อย่าแชร์ให้ใคร และห้ามใส่ในไฟล์อื่น)
set "SB_URL="
set /p "SB_URL=Supabase URL (เว้นว่าง = ไม่เปลี่ยน): "
set "SB_KEY="
set /p "SB_KEY=Supabase service key (เว้นว่าง = ไม่เปลี่ยน): "

echo.
echo --- การทำงาน ---
set "INTERVAL=!CUR_INTERVAL!"
set /p "INTERVAL=ความถี่ sync เป็นนาที [!CUR_INTERVAL!]: "
set "START_DATE=!CUR_START!"
set /p "START_DATE=เริ่มดึงข้อมูลตั้งแต่วันที่ YYYY-MM-DD [!CUR_START!]: "

node install\patch-config.mjs config.ini ^
    "branch.code=!BRANCH!" "branch.machine_code=!MACHINE!" ^
    "source.type=!SRC_TYPE!" ^
    "sync.interval_minutes=!INTERVAL!" "sync.start_date=!START_DATE!"
if errorlevel 1 ( echo  [x] เขียน config.ini ไม่สำเร็จ & pause & exit /b 1 )

REM เขียนเฉพาะค่าของแหล่งที่เลือก — ค่าของอีกแหล่งคงไว้เผื่อสลับกลับ
if "!SRC_TYPE!"=="biotime" (
    node install\patch-config.mjs config.ini "biotime.psql_path=!BIO_PSQL!" "biotime.database=!BIO_DB!"
) else (
    node install\patch-config.mjs config.ini "device.ip=!DEV_IP!" "device.port=!DEV_PORT!"
)
if errorlevel 1 ( echo  [x] เขียน config.ini ไม่สำเร็จ & pause & exit /b 1 )

if not "!SB_URL!"=="" node install\patch-config.mjs --env .env "SUPABASE_URL=!SB_URL!"
if not "!SB_KEY!"=="" node install\patch-config.mjs --env .env "SUPABASE_SERVICE_KEY=!SB_KEY!"

echo.
echo  [OK] บันทึกการตั้งค่าแล้ว (สำรองของเดิมไว้ที่ backups\)
echo.

REM -- ทดสอบทันทีตอนที่คนติดตั้งยังอยู่หน้าเครื่อง ดีกว่าไปพบว่าพิมพ์ IP ผิดในอีกสามวัน --
set "DO_TEST=Y"
set /p "DO_TEST=ทดสอบการเชื่อมต่อเลยไหม? (Y/n): "
if /i "!DO_TEST!"=="N" exit /b 0
call "%~dp0test-connection.bat"
exit /b 0
