// ส่งแถวสแกนขึ้น Supabase — ตารางปลายทาง public.fingerprint_attendance
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { toThaiParts } from "./thaiTime.mjs";

const TABLE = "fingerprint_attendance";
const CONFLICT_KEY = "branch,employee_code,scan_date,scan_time";
const DEFAULT_DELAYS = [1000, 4000, 9000];

export function createClient({ url, serviceKey }) {
  if (!url || !serviceKey) {
    throw new Error("ยังไม่ได้ตั้งค่า Supabase — ใส่ SUPABASE_URL และ SUPABASE_SERVICE_KEY ใน .env ก่อน");
  }
  return createSupabaseClient(url, serviceKey, { auth: { persistSession: false } });
}

export function toPayload(records, { code, machineCode }) {
  return records.map((r) => {
    const { scanDate, scanTime } = toThaiParts(r.scannedAt);
    return {
      branch: code,
      employee_code: r.employeeCode,
      employee_name: r.employeeName || null,
      scan_date: scanDate,
      scan_time: scanTime,
      source: "k50id",
      source_machine: machineCode || null,
    };
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// upsert แบบไม่ขอข้อมูลกลับ: ignoreDuplicates ทำให้เป็น ON CONFLICT DO NOTHING ซึ่งตรงกับ
// ธรรมชาติ insert-only ของข้อมูลสแกน และห้าม chain .select() เพราะจะทำให้ Supabase
// ส่งทุกแถวกลับมาแล้วเสีย egress ฟรี ๆ
export async function pushRows(client, rows, { delays = DEFAULT_DELAYS } = {}) {
  if (rows.length === 0) return { pushed: 0 };

  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    const { error } = await client
      .from(TABLE)
      .upsert(rows, { onConflict: CONFLICT_KEY, ignoreDuplicates: true });
    if (!error) return { pushed: rows.length };
    lastError = error;
  }
  // ล้มครบทุกครั้งแล้วต้อง throw เพื่อให้ runSync ไม่ขยับ cursor
  throw new Error(lastError?.message ?? "ส่งข้อมูลขึ้น Supabase ไม่สำเร็จ");
}
