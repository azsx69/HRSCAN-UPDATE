// คำสั่งที่สคริปต์ .bat ในเมนูเรียกใช้
//   node src\cli.mjs status         แสดงสถานะจาก state.json
//   node src\cli.mjs test-source    ทดสอบต่อแหล่งข้อมูลสแกน (เครื่อง ZKTeco หรือฐาน ZKBioTime)
//   node src\cli.mjs test-supabase  ทดสอบต่อ Supabase
//   node src\cli.mjs sync-now       สั่ง sync 1 รอบแบบเห็นผลบนจอ
//   node src\cli.mjs sync-range <ตั้งแต่> <ถึง>   ดึงย้อนหลังตามช่วงวันที่ โดยไม่แตะตัวจำของ service
// ทุกคำสั่งคืน exit code 0 = สำเร็จ, 1 = ไม่สำเร็จ ให้ .bat เช็คได้
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createLogger } from "./logger.mjs";
import { createReader, createTester, describeSource, isBiotime } from "./source.mjs";
import { createClient, pushRows } from "./supabase.mjs";
import { runRange, runSync } from "./sync.mjs";
import { readState } from "./state.mjs";
import { parseThaiStamp, toThaiStamp } from "./thaiTime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, "state.json");

function version() {
  const file = path.join(root, "VERSION");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "(ไม่ทราบ)";
}

function isConfigured() {
  return existsSync(path.join(root, "config.ini"));
}

function showStatus(config) {
  const s = readState(statePath);
  console.log(`เวอร์ชัน       : ${version()}`);
  console.log(`สาขา          : ${config.branch.code}${isConfigured() ? "" : "  (ยังไม่ได้ตั้งค่า)"}`);
  console.log(`แหล่งข้อมูล     : ${describeSource(config)}`);
  console.log(`ความถี่        : ทุก ${config.sync.intervalMinutes} นาที`);
  console.log(`เริ่มดึงตั้งแต่   : ${config.sync.startDate || "(ไม่กำหนด)"}`);
  console.log(`สแกนถึง        : ${s.last_scan_at ?? "ยังไม่เคยส่ง"}`);
  console.log(`รันล่าสุด       : ${s.last_run_at ?? "-"}  (${s.last_result ?? "-"})`);
  console.log(`ส่งสะสม        : ${s.pushed_total.toLocaleString()} แถว`);
  if (s.last_error) console.log(`ข้อผิดพลาดล่าสุด : ${s.last_error}`);
  return 0;
}

async function checkSource(config) {
  console.log(`กำลังเชื่อมต่อ ${describeSource(config)} ...`);
  try {
    const r = await createTester(config)();
    console.log(`[OK] อ่าน log ได้ ${r.total.toLocaleString()} แถว`);
    if (r.latest) console.log(`     สแกนล่าสุดที่บันทึกไว้: ${toThaiStamp(r.latest)}`);
    // ให้คนหน้างานยืนยันด้วยตาว่าชื่อไทยไม่เพี้ยน — เป็นอาการที่ test อัตโนมัติจับไม่ได้
    if (r.sampleName) console.log(`     ตัวอย่างชื่อพนักงาน: ${r.sampleName}  <- ถ้าอ่านไม่ออกแปลว่า encoding เพี้ยน`);
    return 0;
  } catch (e) {
    console.log(`[ไม่สำเร็จ] ${e.message}`);
    console.log(
      isBiotime(config)
        ? "     ตรวจว่า ZKBioTime เปิดอยู่ และค่า [biotime] psql_path/port/database ถูกต้อง"
        : "     ตรวจ IP/พอร์ต ในการตั้งค่า และตรวจว่าเครื่องสแกนเปิดอยู่และอยู่วง LAN เดียวกัน",
    );
    return 1;
  }
}

async function checkSupabase(config) {
  console.log(`กำลังต่อ Supabase ${config.supabase.url || "(ยังไม่ได้ตั้งค่า)"} ...`);
  try {
    const client = createClient(config.supabase);
    // ขอแถวเดียวพอให้รู้ว่าคีย์ใช้ได้และตารางมีจริง — เลี่ยงการดึงข้อมูลโดยไม่จำเป็น
    const { error } = await client.from("fingerprint_attendance").select("id").limit(1);
    if (error) throw new Error(error.message);
    console.log("[OK] เชื่อมต่อได้ และเห็นตาราง fingerprint_attendance");
    return 0;
  } catch (e) {
    console.log(`[ไม่สำเร็จ] ${e.message}`);
    console.log("     ตรวจ SUPABASE_URL และ SUPABASE_SERVICE_KEY ในการตั้งค่า");
    return 1;
  }
}

async function syncNow(config) {
  const logger = createLogger({ dir: path.join(root, "logs"), keepDays: config.log.keepDays });
  try {
    const client = createClient(config.supabase);
    const readAttendance = createReader(config);
    const res = await runSync({ config, logger, statePath, readAttendance, pushRows, client });
    return res.ok ? 0 : 1;
  } catch (e) {
    logger.err(`ไม่สำเร็จ: ${e.message}`);
    return 1;
  }
}

// ค่ามาจากคนพิมพ์สด ๆ จึงต้องเข้มกว่าที่ parseThaiStamp ให้: Date จะ normalize วันที่เกินช่วง
// ให้เงียบ ๆ (2026-13-45 กลายเป็น 2027-02-14) ถ้าปล่อยผ่าน คนพิมพ์ผิดจะได้ข้อมูลคนละช่วงโดยไม่รู้ตัว
//
// endOfDay: ขอบบนที่เป็นวันที่ล้วนหมายถึง "ทั้งวันนั้น" ไม่ใช่เที่ยงคืนตรงซึ่งจะได้แค่วินาทีเดียว
function parseRangeArg(text, { endOfDay = false } = {}) {
  const at = parseThaiStamp(text);
  if (!at) return null;
  const raw = String(text).trim().replace("T", " ");
  if (toThaiStamp(at).slice(0, raw.length) !== raw) return null;
  if (endOfDay && raw.length === 10) at.setHours(23, 59, 59);
  return at;
}

async function syncRange(config, fromText, toText) {
  const from = parseRangeArg(fromText);
  const until = parseRangeArg(toText, { endOfDay: true });

  if (!from || !until) {
    console.log("ใช้: node src\\cli.mjs sync-range <ตั้งแต่> <ถึง>");
    console.log("     เช่น node src\\cli.mjs sync-range 2026-07-01 2026-07-31   (รวมข้อมูลทั้งวันที่ 31)");
    return 1;
  }
  if (from > until) {
    console.log("วันที่เริ่มต้องไม่อยู่หลังวันที่สิ้นสุด");
    return 1;
  }
  if (!isBiotime(config)) {
    console.log("หมายเหตุ: แหล่งเป็นเครื่องสแกน ต้องหยุด service ก่อน ไม่งั้นต่อเครื่องไม่ติด (เมนูข้อ 5 หยุดให้เอง)");
  }

  const logger = createLogger({ dir: path.join(root, "logs"), keepDays: config.log.keepDays });
  try {
    const client = createClient(config.supabase);
    const readAttendance = createReader(config);
    const res = await runRange({
      config,
      logger,
      client,
      pushRows,
      readAttendance,
      from: toThaiStamp(from),
      until: toThaiStamp(until),
    });
    return res.ok ? 0 : 1;
  } catch (e) {
    logger.err(`ไม่สำเร็จ: ${e.message}`);
    return 1;
  }
}

async function main() {
  const command = process.argv[2] ?? "status";
  const config = loadConfig(root);

  if (command === "status") return showStatus(config);

  if (!isConfigured()) {
    console.log("ยังไม่ได้ตั้งค่า — รัน install\\bootstrap.bat ก่อน");
    return 1;
  }

  // test-source เป็นชื่อที่ตรงกว่าเมื่อสาขาอ่านจากฐาน ZKBioTime — คง test-device ไว้ให้สคริปต์เดิมเรียกได้
  if (command === "test-device" || command === "test-source") return checkSource(config);
  if (command === "test-supabase") return checkSupabase(config);
  if (command === "sync-now") return syncNow(config);
  if (command === "sync-range") return syncRange(config, process.argv[3], process.argv[4]);

  console.log(
    `ไม่รู้จักคำสั่ง "${command}" — ใช้ได้: status | test-source | test-supabase | sync-now | sync-range`,
  );
  return 1;
}

const code = await main();

// ตั้ง exitCode แทนการเรียก process.exit() ทันที
// supabase-js/undici ยังถือ handle ค้างอยู่หลัง await เสร็จ การสั่ง exit กลางคันทำให้ libuv
// ยิง assertion (UV_HANDLE_CLOSING) แล้ว exit code กลายเป็นค่าติดลบ ซึ่ง .bat จะอ่านว่าล้มเหลว
// ทั้งที่คำสั่งสำเร็จ — ปล่อยให้ Node จบเองหลัง event loop ว่างจึงถูกต้องกว่า
process.exitCode = code;

// กันกรณี handle บางตัวไม่ยอมปล่อย: บังคับจบหลัง 3 วินาที โดยคง exit code เดิมไว้
const guard = setTimeout(() => process.exit(code), 3000);
guard.unref();
