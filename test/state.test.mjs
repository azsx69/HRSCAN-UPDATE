import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readState, writeState } from "../src/state.mjs";

const newPath = () => path.join(mkdtempSync(path.join(tmpdir(), "hrscan-state-")), "state.json");

test("ไฟล์ยังไม่มี → คืนค่าเริ่มต้น ไม่ throw", () => {
  const s = readState(newPath());
  assert.equal(s.last_scan_at, null);
  assert.equal(s.pushed_total, 0);
  assert.equal(s.last_result, null);
});

test("ไฟล์เสีย (JSON พัง) → คืนค่าเริ่มต้น ไม่ throw", () => {
  // state.json พังต้องไม่ทำให้ service ตาย — เริ่มจาก start_date ใหม่ได้เพราะ upsert กันซ้ำอยู่แล้ว
  const p = newPath();
  writeFileSync(p, "{{{ ไม่ใช่ json", "utf8");
  assert.equal(readState(p).last_scan_at, null);
});

test("writeState merge ทับเฉพาะคีย์ที่ส่งมา", () => {
  const p = newPath();
  writeState(p, { pushed_total: 5 });
  writeState(p, { last_result: "ok" });
  const s = readState(p);
  assert.equal(s.pushed_total, 5);
  assert.equal(s.last_result, "ok");
});

test("เขียนแล้วอ่านกลับได้ค่าเดิม", () => {
  const p = newPath();
  writeState(p, { last_scan_at: "2026-07-27 09:18:22", pushed_total: 120 });
  const s = readState(p);
  assert.equal(s.last_scan_at, "2026-07-27 09:18:22");
  assert.equal(s.pushed_total, 120);
});

test("ไฟล์ที่เขียนอ่านออกด้วยตาได้ (เว้นวรรคจัดรูป)", () => {
  const p = newPath();
  writeState(p, { pushed_total: 1 });
  assert.match(readFileSync(p, "utf8"), /\n\s+"pushed_total"/);
});
