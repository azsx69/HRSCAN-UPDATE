import { test } from "node:test";
import assert from "node:assert/strict";
import { selectNewRows } from "../src/sync.mjs";

const rec = (code, y, mo, d, h, mi, s) => ({
  employeeCode: code,
  employeeName: `ชื่อ${code}`,
  scannedAt: new Date(y, mo - 1, d, h, mi, s),
});

test("ใช้ >= ไม่ใช่ > : แถวที่เวลาตรงกับ cursor พอดีต้องถูกส่งซ้ำ ไม่ใช่ถูกข้าม", () => {
  // พนักงานหลายคนสแกนวินาทีเดียวกันได้ ถ้าใช้ > แถวที่เหลือจะหายถาวร
  // ยอมส่งซ้ำแล้วให้ unique constraint ฝั่ง Supabase กันซ้ำแทน
  const rows = [rec("001", 2026, 7, 27, 9, 0, 0), rec("002", 2026, 7, 27, 9, 0, 0)];
  const out = selectNewRows(rows, { cursor: "2026-07-27 09:00:00", startDate: "2026-01-01" });
  assert.equal(out.length, 2);
});

test("ตัดแถวที่เก่ากว่า cursor", () => {
  const rows = [rec("001", 2026, 7, 27, 8, 59, 59), rec("002", 2026, 7, 27, 9, 0, 1)];
  const out = selectNewRows(rows, { cursor: "2026-07-27 09:00:00", startDate: "2026-01-01" });
  assert.deepEqual(out.map((r) => r.employeeCode), ["002"]);
});

test("ตัดแถวที่เก่ากว่า start_date แม้ยังไม่มี cursor", () => {
  const rows = [rec("001", 2025, 12, 31, 23, 59, 59), rec("002", 2026, 1, 1, 0, 0, 0)];
  const out = selectNewRows(rows, { cursor: null, startDate: "2026-01-01" });
  assert.deepEqual(out.map((r) => r.employeeCode), ["002"]);
});

test("start_date ยังมีผลแม้มี cursor ที่เก่ากว่า", () => {
  const rows = [rec("001", 2026, 1, 5, 8, 0, 0), rec("002", 2026, 3, 1, 8, 0, 0)];
  const out = selectNewRows(rows, { cursor: "2026-01-01 00:00:00", startDate: "2026-02-01" });
  assert.deepEqual(out.map((r) => r.employeeCode), ["002"]);
});

test("เรียงจากเก่าไปใหม่เสมอ เพื่อให้ cursor ขยับถูกลำดับ", () => {
  const rows = [rec("002", 2026, 7, 27, 10, 0, 0), rec("001", 2026, 7, 27, 9, 0, 0)];
  const out = selectNewRows(rows, { cursor: null, startDate: "2026-01-01" });
  assert.deepEqual(out.map((r) => r.employeeCode), ["001", "002"]);
});

test("ไม่มีแถวใหม่ → คืน array ว่าง", () => {
  const rows = [rec("001", 2026, 7, 27, 8, 0, 0)];
  const out = selectNewRows(rows, { cursor: "2026-07-27 09:00:00", startDate: "2026-01-01" });
  assert.equal(out.length, 0);
});

test("cursor เสีย → ถือว่าไม่มี cursor แล้วใช้ start_date แทน", () => {
  const rows = [rec("001", 2026, 7, 27, 8, 0, 0)];
  const out = selectNewRows(rows, { cursor: "ค่าพัง", startDate: "2026-01-01" });
  assert.equal(out.length, 1);
});

test("ไม่มีทั้ง cursor และ start_date → ส่งทุกแถว", () => {
  const rows = [rec("001", 2020, 1, 1, 0, 0, 0)];
  const out = selectNewRows(rows, { cursor: null, startDate: null });
  assert.equal(out.length, 1);
});

test("ข้ามแถวที่เวลาอยู่ในอนาคต — นาฬิกาเครื่องสแกนเพี้ยน", () => {
  // เครื่องที่ถ่าน RTC ใกล้หมดจะบันทึกปีผิดเป็นครั้งคราว (พบจริงถึงปี 2119)
  const rows = [rec("001", 2026, 7, 27, 9, 0, 0), rec("002", 2119, 7, 26, 20, 5, 9)];
  const out = selectNewRows(rows, { cursor: null, startDate: "2026-01-01", now: new Date(2026, 6, 31, 12, 0, 0) });
  assert.deepEqual(out.map((r) => r.employeeCode), ["001"]);
});

test("แถวอนาคตต้องไม่ไปอยู่ท้ายชุด เพราะ cursor จะขยับตามแถวสุดท้าย", () => {
  // นี่คือหัวใจของบั๊ก: ถ้าแถวปี 2119 หลุดไปเป็นแถวสุดท้าย cursor จะกระโดดไปปีนั้น
  // แล้วรอบถัดไปทุกรอบจะกรองข้อมูลจริงทิ้งหมด — sync ตายเงียบ ๆ
  const rows = [rec("002", 2119, 7, 26, 20, 5, 9), rec("001", 2026, 7, 27, 9, 0, 0)];
  const out = selectNewRows(rows, { cursor: null, startDate: "2026-01-01", now: new Date(2026, 6, 31, 12, 0, 0) });
  assert.equal(out.at(-1).employeeCode, "001");
});

test("แถวอนาคตไม่ทำให้แถวปกติในรอบเดียวกันหายไปด้วย", () => {
  const rows = [
    rec("001", 2026, 7, 27, 9, 0, 0),
    rec("002", 2119, 7, 26, 20, 5, 9),
    rec("003", 2026, 7, 27, 10, 0, 0),
  ];
  const out = selectNewRows(rows, { cursor: null, startDate: "2026-01-01", now: new Date(2026, 6, 31, 12, 0, 0) });
  assert.deepEqual(out.map((r) => r.employeeCode), ["001", "003"]);
});

test("แถวที่เวลาเท่ากับ now พอดี ยังส่งได้ตามปกติ", () => {
  const now = new Date(2026, 6, 31, 12, 0, 0);
  const rows = [rec("001", 2026, 7, 31, 12, 0, 0)];
  const out = selectNewRows(rows, { cursor: null, startDate: "2026-01-01", now });
  assert.equal(out.length, 1);
});
