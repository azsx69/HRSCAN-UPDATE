import { test } from "node:test";
import assert from "node:assert/strict";
import { toThaiParts, toThaiStamp, parseThaiStamp } from "../src/thaiTime.mjs";

test("แยกวัน/เวลาตามเวลาเครื่อง ไม่ใช่ UTC", () => {
  const d = new Date(2026, 6, 27, 9, 18, 22); // 27 ก.ค. 2026 09:18:22
  assert.deepEqual(toThaiParts(d), { scanDate: "2026-07-27", scanTime: "09:18:22" });
});

test("เที่ยงคืนไม่เลื่อนไปเป็นวันก่อนหน้า", () => {
  // จุดที่ toISOString() จะพัง: 00:30 ไทย = 17:30 UTC ของเมื่อวาน
  const d = new Date(2026, 6, 27, 0, 30, 0);
  assert.deepEqual(toThaiParts(d), { scanDate: "2026-07-27", scanTime: "00:30:00" });
});

test("ช่วงดึกก็ยังอยู่วันเดิม", () => {
  const d = new Date(2026, 6, 27, 23, 59, 59);
  assert.deepEqual(toThaiParts(d), { scanDate: "2026-07-27", scanTime: "23:59:59" });
});

test("เติมศูนย์ครบทุกช่อง", () => {
  const d = new Date(2026, 0, 5, 7, 5, 9);
  assert.equal(toThaiStamp(d), "2026-01-05 07:05:09");
});

test("parseThaiStamp กลับไปกลับมาได้ค่าเดิม", () => {
  const d = new Date(2026, 6, 27, 9, 18, 22);
  assert.equal(toThaiStamp(parseThaiStamp("2026-07-27 09:18:22")), toThaiStamp(d));
});

test("parseThaiStamp คืน null เมื่อรูปแบบผิด", () => {
  assert.equal(parseThaiStamp("ไม่ใช่วันที่"), null);
  assert.equal(parseThaiStamp(""), null);
  assert.equal(parseThaiStamp(null), null);
  assert.equal(parseThaiStamp(undefined), null);
});

test("parseThaiStamp รับรูปแบบวันที่ล้วน (ใช้กับ start_date)", () => {
  assert.equal(toThaiStamp(parseThaiStamp("2026-01-01")), "2026-01-01 00:00:00");
});
