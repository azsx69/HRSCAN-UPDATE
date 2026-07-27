// เขียน log รายวันลง logs\sync-YYYY-MM-DD.log และพิมพ์ออกจอไปด้วย
// (NSSM เก็บ stdout ของ service ไว้ที่ logs\service.out.log อีกชั้นหนึ่ง)
import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { toThaiParts, toThaiStamp } from "./thaiTime.mjs";

function cleanOldLogs(dir, keepDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffName = `sync-${toThaiParts(cutoff).scanDate}.log`;

  for (const name of readdirSync(dir)) {
    // ชื่อไฟล์เป็น sync-YYYY-MM-DD.log ซึ่งเรียงตามตัวอักษรได้ตรงกับเรียงตามวันอยู่แล้ว
    if (/^sync-\d{4}-\d{2}-\d{2}\.log$/.test(name) && name < cutoffName) {
      try {
        unlinkSync(path.join(dir, name));
      } catch {
        // ลบไม่ได้ (ไฟล์ถูกเปิดค้าง) ไม่ใช่เรื่องคอขาดบาดตาย — รอบหน้าค่อยลบ
      }
    }
  }
}

export function createLogger({ dir, keepDays = 30 } = {}) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cleanOldLogs(dir, keepDays);

  const write = (level, message) => {
    const now = new Date();
    const line = `${toThaiStamp(now)} [${level}] ${message}`;
    console.log(line);
    try {
      appendFileSync(path.join(dir, `sync-${toThaiParts(now).scanDate}.log`), `${line}\n`, "utf8");
    } catch {
      // เขียนไฟล์ไม่ได้ก็ยังต้องทำงานต่อ — ข้อความออกทาง stdout ให้ NSSM เก็บแล้ว
    }
  };

  return {
    info: (m) => write("INFO", m),
    ok: (m) => write("OK  ", m),
    err: (m) => write("ERR ", m),
  };
}
