import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecords, decodeAttendanceData, getAttendanceLogs, getUsersThai } from "../src/device.mjs";

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

function encodeDeviceTime(year, month, day, hour, minute, second) {
  return (((((year - 2000) * 12 + (month - 1)) * 31 + (day - 1)) * 24 + hour) * 60 + minute) * 60 + second;
}

function makeAttendancePacket(packetSize, { userId, year = 2026, month = 7, day = 31, hour = 14, minute = 12, second = 1 }) {
  const record = Buffer.alloc(packetSize);
  record.writeUInt16LE(1, 0);
  record.write(userId, 2, "ascii");
  record.writeUInt32LE(encodeDeviceTime(year, month, day, hour, minute, second), 27);
  const data = Buffer.alloc(4 + packetSize);
  data.writeUInt32LE(packetSize, 0);
  record.copy(data, 4);
  return data;
}

test("อ่าน attendance packet 49 ไบต์ของ MB40-VL สาขา 2 ได้", () => {
  const rows = decodeAttendanceData(makeAttendancePacket(49, { userId: "202" }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deviceUserId, "202");
  assert.equal(rows[0].recordTime.getFullYear(), 2026);
  assert.equal(rows[0].recordTime.getMonth(), 6);
  assert.equal(rows[0].recordTime.getDate(), 31);
  assert.equal(rows[0].recordTime.getHours(), 14);
});

test("ยังอ่าน attendance packet 40 ไบต์ของเครื่องสาขา 1 ได้เหมือนเดิม", () => {
  const rows = decodeAttendanceData(makeAttendancePacket(40, { userId: "001", hour: 9 }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deviceUserId, "001");
  assert.equal(rows[0].recordTime.getHours(), 9);
});

test("ปฏิเสธ buffer 49 ไบต์ที่รับมาไม่ครบ เพื่อไม่ให้ cursor ข้ามข้อมูล", () => {
  const complete = makeAttendancePacket(49, { userId: "202" });
  const partial = complete.subarray(0, complete.length - 1);
  assert.throws(() => decodeAttendanceData(partial, { packetSize: 49 }), /ไม่สมบูรณ์/);
});

test("Store 1 ยังเรียก getAttendances เดิมและไม่ใช้ raw TCP path", async () => {
  let called = 0;
  const expected = [{ deviceUserId: "1", recordTime: new Date(2026, 6, 31, 9) }];
  const zk = {
    getAttendances: async () => { called++; return { data: expected }; },
    zklibTcp: { freeData: async () => assert.fail("Store 1 ต้องไม่เข้า raw path") },
  };
  assert.deepEqual(await getAttendanceLogs(zk), expected);
  assert.equal(called, 1);
});

test("Store 2 throw เมื่อ readWithBuffer คืน partial error และ cleanup buffer", async () => {
  let frees = 0;
  const zk = {
    connectionType: "tcp",
    zklibTcp: {
      freeData: async () => { frees++; },
      readWithBuffer: async () => ({ data: makeAttendancePacket(49, { userId: "202" }), err: new Error("partial timeout") }),
    },
  };
  await assert.rejects(() => getAttendanceLogs(zk, { packetSize: 49 }), /partial timeout/);
  assert.equal(frees, 2);
});

test("ปฏิเสธ attendance header-only ที่ประกาศว่ามี payload", () => {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(49, 0);
  assert.throws(() => decodeAttendanceData(data, { packetSize: 49 }), /ไม่สมบูรณ์/);
  assert.throws(() => decodeAttendanceData("not-a-buffer", { packetSize: 49 }), /Buffer/);
});

test("ปฏิเสธ user buffer ที่ read ไม่ครบและ cleanup buffer", async () => {
  let frees = 0;
  const zk = {
    connectionType: "tcp",
    zklibTcp: {
      freeData: async () => { frees++; },
      readWithBuffer: async () => ({ data: Buffer.alloc(4), err: new Error("users partial timeout") }),
    },
  };
  await assert.rejects(() => getUsersThai(zk), /users partial timeout/);
  assert.equal(frees, 2);
});
