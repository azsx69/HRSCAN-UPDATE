// เก็บ cursor และสถิติการทำงานไว้ใน state.json (ไม่เข้า git — git checkout ตอนอัปเดตจึงไม่แตะ)
//
// ไฟล์นี้พังหรือหายต้องไม่ทำให้ service ตาย: คืนค่าเริ่มต้นแล้วเริ่มนับจาก start_date ใหม่
// ข้อมูลจะไม่ซ้ำอยู่ดีเพราะ unique constraint ฝั่ง Supabase กันไว้
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_STATE = {
  last_scan_at: null,   // เวลาสแกน (ไทย) ของแถวล่าสุดที่ push สำเร็จ = cursor
  last_run_at: null,    // เวลาที่รันรอบล่าสุด สำเร็จหรือไม่ก็ตาม
  last_result: null,    // "ok" | "error" | "empty"
  last_error: null,
  pushed_total: 0,
};

export function readState(file) {
  if (!existsSync(file)) return { ...DEFAULT_STATE };
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeState(file, patch) {
  const next = { ...readState(file), ...patch };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
