// อ่าน log การสแกนจากฐานข้อมูลของ ZKBioTime (PostgreSQL) ที่ติดตั้งอยู่ในเครื่องของสาขา
//
// ใช้กับสาขาที่มี ZKBioTime อยู่แล้ว เพราะโปรแกรมนั้นยึดการเชื่อมต่อกับเครื่องสแกนไว้ตลอด
// ทำให้ต่อ TCP 4370 ตรง ๆ ไม่ได้ ข้อมูลสแกนจึงต้องอ่านผ่านฐานของ ZKBioTime แทน
//
// เรียกผ่าน psql.exe ที่ติดมากับ ZKBioTime ไม่ใช่ไลบรารี pg เพราะ ZKBioTime ตั้ง pg_hba
// ให้ต่อจากในเครื่องได้โดยไม่ต้องใส่รหัสผ่าน (-w) จึงไม่ต้องเก็บรหัสผ่านเพิ่มไว้ที่สาขา
// และไม่ต้องเพิ่ม dependency ใน repo ที่เป็น public
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { parseThaiStamp, toThaiStamp } from "./thaiTime.mjs";

const execFileAsync = promisify(execFile);

// ตัวคั่นคอลัมน์ที่ส่งให้ psql (-F) — ชื่อพนักงานที่มีอักขระนี้ปนก็ยังแยกถูก เพราะ
// parseRows ตัดจากตัวคั่นตัวแรกและตัวสุดท้าย ไม่ได้ split ทั้งบรรทัด
const SEP = "|";

// backfill ครั้งแรกอาจได้เป็นแสนแถว — ค่า default 1 MB ของ execFile ไม่พอ
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const SELECT_CLAUSE = `SELECT t.emp_code,
       TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')),
       TO_CHAR(t.punch_time AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS')
  FROM iclock_transaction t
  LEFT JOIN personnel_employee e ON e.emp_code = t.emp_code`;

// รหัสพนักงานในระบบ HR เป็นเลข 3 หลัก — กฎเดียวกับที่ device.mjs ใช้กับเครื่องสแกน
function padEmployeeCode(id) {
  return /^\d+$/.test(id) ? id.padStart(3, "0") : id;
}

// punch_time เป็น timestamptz — AT TIME ZONE 'Asia/Bangkok' จึงคืนเวลาไทยตามที่เห็นบนหน้าเครื่อง
//
// since ต้องผ่าน parseThaiStamp แล้วประกอบกลับด้วย toThaiStamp เสมอ ค่าที่เข้า SQL จึงเป็น
// รูปแบบวันที่ล้วนที่โปรแกรมสร้างเอง ไม่ใช่ข้อความจาก state.json/config ที่แก้ด้วยมือได้
export function buildQuery(since) {
  const at = parseThaiStamp(since);
  const where = at ? `\n WHERE t.punch_time AT TIME ZONE 'Asia/Bangkok' >= TIMESTAMP '${toThaiStamp(at)}'` : "";
  return `${SELECT_CLAUSE}${where}\n ORDER BY t.punch_time`;
}

// ใช้กับคำสั่งทดสอบเท่านั้น — ดูแถวล่าสุดพอให้รู้ว่าเวลาตรงและชื่อไทยไม่เพี้ยน
const LATEST_QUERY = `${SELECT_CLAUSE}\n ORDER BY t.punch_time DESC\n LIMIT 5`;
const COUNT_QUERY = "SELECT COUNT(*) FROM iclock_transaction";

export function parseRows(stdout) {
  const records = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    const first = row.indexOf(SEP);
    const last = row.lastIndexOf(SEP);
    if (first === -1 || first === last) continue; // ต้องมีครบ 3 คอลัมน์
    const scannedAt = parseThaiStamp(row.slice(last + 1));
    if (!scannedAt) continue; // เวลาอ่านไม่ได้ → ทิ้งแถวนั้น ดีกว่าส่งเวลาผิดขึ้น Supabase
    records.push({
      employeeCode: padEmployeeCode(row.slice(0, first).trim()),
      employeeName: row.slice(first + 1, last).trim(),
      scannedAt,
    });
  }
  return records;
}

async function runPsql({ psqlPath, host, port, database, user, password, timeoutMs }, sql) {
  if (!existsSync(psqlPath)) {
    throw new Error(`ไม่พบ psql.exe ที่ ${psqlPath} — ตรวจว่าติดตั้ง ZKBioTime ไว้ที่ใด แล้วแก้ [biotime] psql_path`);
  }
  const env = { ...process.env, PGCLIENTENCODING: "UTF8" };
  if (password) env.PGPASSWORD = password;

  try {
    const { stdout } = await execFileAsync(
      psqlPath,
      ["-U", user, "-h", host, "-p", String(port), "-d", database, "-w", "-t", "-A", "-F", SEP, "-c", sql],
      { env, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, timeout: timeoutMs, windowsHide: true },
    );
    return stdout;
  } catch (e) {
    // psql เขียนสาเหตุจริงลง stderr ส่วน message ของ execFile บอกแค่ exit code ซึ่งไม่ช่วยคนหน้างาน
    const detail = String(e.stderr || e.message).trim().split(/\r?\n/)[0];
    throw new Error(detail || "เรียก psql ไม่สำเร็จ");
  }
}

export async function readAttendance(biotime, { since } = {}) {
  return parseRows(await runPsql(biotime, buildQuery(since)));
}

// ใช้กับเมนู "ทดสอบการเชื่อมต่อ" — คืนข้อมูลสรุปรูปแบบเดียวกับ testDevice ของฝั่งเครื่องสแกน
export async function testSource(biotime) {
  const total = Number(String(await runPsql(biotime, COUNT_QUERY)).trim()) || 0;
  const records = parseRows(await runPsql(biotime, LATEST_QUERY));
  return { total, latest: records[0]?.scannedAt ?? null, sampleName: records[0]?.employeeName ?? "" };
}
