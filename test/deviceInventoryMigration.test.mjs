import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260817172259_create_device_employee_inventory.sql",
  import.meta.url,
);

async function sql() {
  return readFile(migrationUrl, "utf8");
}

test("migration เก็บ snapshot และ inventory ด้วย natural composite key", async () => {
  const text = await sql();
  assert.match(text, /create table if not exists public\.device_employee_inventory_snapshots/i);
  assert.match(text, /create table if not exists public\.device_employee_inventory/i);
  assert.match(text, /primary key \(branch, device_uid\)/i);
  assert.match(text, /references public\.device_employee_inventory_snapshots\(id\)/i);
});

test("RPC รับ snapshot ทั้งก้อนและ mark missing ภายใน transaction เดียว", async () => {
  const text = await sql();
  assert.match(text, /sync_device_employee_inventory[\s\S]*?p_users jsonb/i);
  assert.match(text, /jsonb_typeof\(p_users\) <> 'array'/i);
  assert.match(text, /on conflict \(branch, device_uid\) do update/i);
  assert.match(text, /last_snapshot_id <> v_snapshot_id[\s\S]*?present = true/i);
  assert.match(text, /security invoker/i);
  assert.doesNotMatch(text, /security definer/i);
});

test("snapshot ว่างรองรับเครื่องที่ไม่มีผู้ใช้และทำให้รายการเดิมเป็น missing", async () => {
  const text = await sql();
  assert.match(text, /v_present_count := jsonb_array_length\(p_users\)/i);
  assert.match(text, /missing_since = coalesce\(missing_since, v_observed_at\)/i);
});

test("inventory เปิด RLS และให้สิทธิ์เขียนเฉพาะ service_role", async () => {
  const text = await sql();
  assert.match(text, /alter table public\.device_employee_inventory enable row level security/i);
  assert.match(text, /revoke all on public\.device_employee_inventory from public, anon, authenticated/i);
  assert.match(text, /grant select, insert, update on public\.device_employee_inventory to service_role/i);
  assert.doesNotMatch(text, /grant\s+(select|insert|update|delete)[^;]*\s+to\s+(anon|authenticated)/i);
  assert.match(text, /grant execute on function public\.sync_device_employee_inventory\(text, text, jsonb\)[\s\S]*?to service_role/i);
});

test("มี index รองรับค้นตามสาขา รหัส และรายการ missing", async () => {
  const text = await sql();
  assert.match(text, /device_employee_inventory_branch_code_idx[\s\S]*?\(branch, employee_code\)/i);
  assert.match(text, /device_employee_inventory_missing_idx[\s\S]*?where present = false/i);
});
