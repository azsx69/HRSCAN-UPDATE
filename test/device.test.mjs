import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecords } from "../src/device.mjs";

const users = [
  { userId: "1", name: "สมชาย ใจดี" },
  { userId: "002", name: "สมหญิง รักไทย" },
];

test("เติมศูนย์รหัสพนักงานให้ครบ 3 หลัก", () => {
  const out = buildRecords([{ deviceUserId: 1, recordTime: new Date(2026, 6, 27, 9, 0, 0) }], users);
  assert.equal(out[0].employeeCode, "001");
});

test("จับคู่ชื่อได้ทั้งรหัสแบบเติมศูนย์และไม่เติม", () => {
  const logs = [
    { deviceUserId: 1, recordTime: new Date(2026, 6, 27, 9, 0, 0) },
    { deviceUserId: "002", recordTime: new Date(2026, 6, 27, 9, 1, 0) },
  ];
  const out = buildRecords(logs, users);
  assert.equal(out[0].employeeName, "สมชาย ใจดี");
  assert.equal(out[1].employeeName, "สมหญิง รักไทย");
});

test("ไม่พบชื่อ → คืนสตริงว่าง ไม่ใช่ undefined", () => {
  const out = buildRecords([{ deviceUserId: 999, recordTime: new Date(2026, 6, 27, 9, 0, 0) }], users);
  assert.equal(out[0].employeeName, "");
});

test("ข้ามแถวที่ไม่มีเวลาสแกน", () => {
  const logs = [
    { deviceUserId: 1, recordTime: null },
    { deviceUserId: 1 },
    { deviceUserId: 1, recordTime: new Date(2026, 6, 27, 9, 0, 0) },
  ];
  assert.equal(buildRecords(logs, users).length, 1);
});

test("scannedAt เป็น Date ที่ใช้เทียบเวลาได้", () => {
  const t = new Date(2026, 6, 27, 9, 18, 22);
  const out = buildRecords([{ deviceUserId: 1, recordTime: t }], users);
  assert.ok(out[0].scannedAt instanceof Date);
  assert.equal(out[0].scannedAt.getTime(), t.getTime());
});

test("รหัสที่ไม่ใช่ตัวเลขล้วนต้องไม่ถูกเติมศูนย์", () => {
  const out = buildRecords([{ deviceUserId: "A12", recordTime: new Date(2026, 6, 27, 9, 0, 0) }], users);
  assert.equal(out[0].employeeCode, "A12");
});

test("ไม่มี log เลย → คืน array ว่าง", () => {
  assert.deepEqual(buildRecords([], users), []);
});
