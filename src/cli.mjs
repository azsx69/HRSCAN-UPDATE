// คำสั่งที่สคริปต์ .bat ในเมนูเรียกใช้
//   node src\cli.mjs status         แสดงสถานะจาก state.json
//   node src\cli.mjs test-device    ทดสอบต่อเครื่องสแกน
//   node src\cli.mjs test-supabase  ทดสอบต่อ Supabase
//   node src\cli.mjs sync-now       สั่ง sync 1 รอบแบบเห็นผลบนจอ
// ทุกคำสั่งคืน exit code 0 = สำเร็จ, 1 = ไม่สำเร็จ ให้ .bat เช็คได้
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createLogger } from "./logger.mjs";
import { readAttendance, testDevice } from "./device.mjs";
import { createClient, pushRows } from "./supabase.mjs";
import { runSync } from "./sync.mjs";
import { readState } from "./state.mjs";
import { toThaiStamp } from "./thaiTime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, "state.json");
const command = process.argv[2] ?? "status";

function version() {
  const file = path.join(root, "VERSION");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "(ไม่ทราบ)";
}

function requireConfigured(config) {
  if (!existsSync(path.join(root, "config.ini"))) {
    console.log("ยังไม่ได้ตั้งค่า — รัน install\\bootstrap.bat ก่อน");
    process.exit(1);
  }
  return config;
}

const config = loadConfig(root);

if (command === "status") {
  const s = readState(statePath);
  const configured = existsSync(path.join(root, "config.ini"));
  console.log(`เวอร์ชัน       : ${version()}`);
  console.log(`สาขา          : ${config.branch.code}${configured ? "" : "  (ยังไม่ได้ตั้งค่า)"}`);
  console.log(`เครื่องสแกน     : ${config.device.ip}:${config.device.port}`);
  console.log(`ความถี่        : ทุก ${config.sync.intervalMinutes} นาที`);
  console.log(`เริ่มดึงตั้งแต่   : ${config.sync.startDate || "(ไม่กำหนด)"}`);
  console.log(`สแกนถึง        : ${s.last_scan_at ?? "ยังไม่เคยส่ง"}`);
  console.log(`รันล่าสุด       : ${s.last_run_at ?? "-"}  (${s.last_result ?? "-"})`);
  console.log(`ส่งสะสม        : ${s.pushed_total.toLocaleString()} แถว`);
  if (s.last_error) console.log(`ข้อผิดพลาดล่าสุด : ${s.last_error}`);
  process.exit(0);
}

if (command === "test-device") {
  requireConfigured(config);
  console.log(`กำลังต่อเครื่องสแกน ${config.device.ip}:${config.device.port} ...`);
  try {
    const r = await testDevice(config.device);
    console.log(`[OK] อ่าน log ได้ ${r.total.toLocaleString()} แถว`);
    if (r.latest) console.log(`     สแกนล่าสุดในเครื่อง: ${toThaiStamp(r.latest)}`);
    // ให้คนหน้างานยืนยันด้วยตาว่าชื่อไทยไม่เพี้ยน — เป็นอาการที่ test อัตโนมัติจับไม่ได้
    if (r.sampleName) console.log(`     ตัวอย่างชื่อพนักงาน: ${r.sampleName}  <- ถ้าอ่านไม่ออกแปลว่า encoding เพี้ยน`);
    process.exit(0);
  } catch (e) {
    console.log(`[ไม่สำเร็จ] ${e.message}`);
    console.log("     ตรวจ IP/พอร์ต ในการตั้งค่า และตรวจว่าเครื่องสแกนเปิดอยู่และอยู่วง LAN เดียวกัน");
    process.exit(1);
  }
}

if (command === "test-supabase") {
  requireConfigured(config);
  console.log(`กำลังต่อ Supabase ${config.supabase.url || "(ยังไม่ได้ตั้งค่า)"} ...`);
  try {
    const client = createClient(config.supabase);
    // ขอแถวเดียวพอให้รู้ว่าคีย์ใช้ได้และตารางมีจริง — เลี่ยงการดึงข้อมูลโดยไม่จำเป็น
    const { error } = await client.from("fingerprint_attendance").select("id").limit(1);
    if (error) throw new Error(error.message);
    console.log("[OK] เชื่อมต่อได้ และเห็นตาราง fingerprint_attendance");
    process.exit(0);
  } catch (e) {
    console.log(`[ไม่สำเร็จ] ${e.message}`);
    console.log("     ตรวจ SUPABASE_URL และ SUPABASE_SERVICE_KEY ในการตั้งค่า");
    process.exit(1);
  }
}

if (command === "sync-now") {
  requireConfigured(config);
  const logger = createLogger({ dir: path.join(root, "logs"), keepDays: config.log.keepDays });
  try {
    const client = createClient(config.supabase);
    const res = await runSync({ config, logger, statePath, readAttendance, pushRows, client });
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    logger.err(`ไม่สำเร็จ: ${e.message}`);
    process.exit(1);
  }
}

console.log(`ไม่รู้จักคำสั่ง "${command}" — ใช้ได้: status | test-device | test-supabase | sync-now`);
process.exit(1);
