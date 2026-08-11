import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/202608110001_create_device_employee_import_queue.sql", import.meta.url);

async function sql() {
  return readFile(migrationUrl, "utf8");
}

test("migration ใช้ advisory lease และ claim token ทีละหนึ่งงาน", async () => {
  const text = await sql();
  assert.match(text, /pg_advisory_xact_lock/i);
  assert.match(text, /claim_token\s*=\s*gen_random_uuid\(\)/i);
  assert.match(text, /lease_expires_at\s*=\s*now\(\)\s*\+\s*interval '30 minutes'/i);
  assert.match(text, /renew_device_employee_import_lease[\s\S]*?claim_token\s*=\s*p_claim_token/i);
  assert.match(text, /for update skip locked[\s\S]*?limit 1/i);
});

test("stale final attempt เปลี่ยนเป็น failed และ stale reclaim เพิ่ม attempts", async () => {
  const text = await sql();
  assert.match(text, /lease expired after final attempt/i);
  assert.match(text, /attempts\s*=\s*q\.attempts\s*\+\s*1/i);
  assert.match(text, /q\.attempts\s*<\s*q\.max_attempts/i);
});

test("complete/fail RPC fence ด้วย id และ claim token", async () => {
  const text = await sql();
  assert.match(text, /complete_device_employee_import_job[\s\S]*?claim_token\s*=\s*p_claim_token/i);
  assert.match(text, /fail_device_employee_import_job[\s\S]*?q\.claim_token\s*=\s*p_claim_token/i);
  assert.match(text, /claim token mismatch or job is not processing/gi);
});

test("queue ไม่เปิดสิทธิ์ให้ browser roles", async () => {
  const text = await sql();
  assert.match(text, /revoke all on public\.device_employee_import_queue from public, anon, authenticated/i);
  assert.doesNotMatch(text, /grant\s+(insert|update|delete)[^;]*\s+to\s+(anon|authenticated)/i);
});

test("ตารางรับได้ทุกสาขา Store 1-5 และไม่มี default branch", async () => {
  const text = await sql();
  assert.match(text, /check \(branch in \('Store 1', 'Store 2', 'Store 3', 'Store 4', 'Store 5'\)\)/i);
  // default ค้างไว้จะพาให้ผู้เรียกที่ลืมใส่ branch ส่งงานไปลงเครื่องผิดสาขาแบบเงียบ ๆ
  assert.doesNotMatch(text, /branch text not null default/i);
});

test("claim RPC ล็อกแยกรายสาขา ไม่มี literal 'Store 2' หลงเหลือ", async () => {
  const text = await sql();
  assert.match(text, /pg_advisory_xact_lock\(hashtextextended\('HRSCAN:' \|\| v_branch/i);
  assert.match(text, /q\.branch = v_branch/i);
  assert.match(text, /raise exception 'unsupported branch %'/i);
  // เหลือ literal ไว้แม้จุดเดียวก็กลับไปทำงานเฉพาะ Store 2 เงียบ ๆ
  assert.doesNotMatch(text, /branch = 'Store 2'/i);
  assert.match(text, /grant execute on function public\.claim_device_employee_import_jobs\(text, text, integer\) to service_role/i);
});
