# ============================================================
#  get.ps1 — ติดตั้งครั้งแรกที่เครื่องสาขา
#
#  วางคำสั่งนี้ใน CMD หรือ PowerShell ของเครื่องสาขา:
#    powershell -c "irm https://raw.githubusercontent.com/azsx69/HRSCAN-UPDATE/main/install/get.ps1 | iex"
#
#  แก้ปัญหาไก่กับไข่: เครื่องยังไม่มี git จึง clone เองไม่ได้ สคริปต์นี้จึงติดตั้ง
#  เครื่องมือที่จำเป็นก่อน แล้วค่อย clone แล้วส่งต่อให้ setup.bat
# ============================================================

$ErrorActionPreference = "Stop"
$repo = "https://github.com/azsx69/HRSCAN-UPDATE.git"
# ต้องตรงกับ TARGET ใน install\install.bat — ไม่งั้นสองเส้นทางติดตั้งจะไปคนละโฟลเดอร์
$dest = "C:\Jaybon\HRSCAN-UPDATE"

function Have($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host "=== HRSCAN-UPDATE : ติดตั้งครั้งแรก ===" -ForegroundColor Cyan
Write-Host ""

# --- Git ---
if (-not (Have git)) {
    Write-Host " [*] ไม่พบ Git — กำลังติดตั้ง ..."
    winget install Git.Git --silent --accept-source-agreements --accept-package-agreements
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
}
if (-not (Have git)) {
    Write-Host " [!] ติดตั้ง Git ไม่สำเร็จ — ติดตั้งเองจาก https://git-scm.com แล้วรันคำสั่งนี้ใหม่" -ForegroundColor Red
    exit 1
}
Write-Host " [OK] $(git --version)"

# --- Node.js ---
if (-not (Have node)) {
    Write-Host " [*] ไม่พบ Node.js — กำลังติดตั้ง ..."
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
}
if (-not (Have node)) {
    Write-Host " [!] ติดตั้ง Node.js ไม่สำเร็จ — ติดตั้งเองจาก https://nodejs.org แล้วรันคำสั่งนี้ใหม่" -ForegroundColor Red
    exit 1
}
Write-Host " [OK] Node.js $(node --version)"

# --- โหลดโปรแกรม ---
if (Test-Path (Join-Path $dest ".git")) {
    Write-Host " [*] มีโปรแกรมอยู่แล้วที่ $dest — ดึงเวอร์ชันล่าสุดแทน"
    git -C $dest fetch --tags --prune --quiet
} else {
    if (Test-Path $dest) {
        Write-Host " [!] มีโฟลเดอร์ $dest อยู่แล้วแต่ไม่ใช่ repo — ย้ายหรือเปลี่ยนชื่อก่อน" -ForegroundColor Red
        exit 1
    }
    Write-Host " [*] กำลังดาวน์โหลดโปรแกรมไปที่ $dest ..."
    git clone --quiet $repo $dest
}

# ใช้เวอร์ชันที่ออก release แล้ว ไม่ใช่ปลาย main ที่อาจยังไม่ผ่านการทดสอบ
$tag = (git -C $dest tag -l "v*" --sort=-v:refname | Select-Object -First 1)
if ($tag) {
    git -C $dest checkout $tag --quiet
    Write-Host " [OK] ใช้เวอร์ชัน $tag"
} else {
    Write-Host " [!] ยังไม่มี tag เวอร์ชัน — ใช้โค้ดล่าสุดบน main ไปก่อน" -ForegroundColor Yellow
}

Write-Host ""
Write-Host " [*] เริ่มขั้นตอนตั้งค่า ..." -ForegroundColor Cyan
Write-Host ""
& cmd /c "`"$dest\install\setup.bat`""
