import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuery, parseRows } from "../src/biotime.mjs";

test("แปลงบรรทัดจาก psql เป็น record ครบทุกฟิลด์", () => {
  const out = parseRows("001|สมชาย ใจดี|2026-07-27 09:18:22\n");
  assert.equal(out.length, 1);
  assert.equal(out[0].employeeCode, "001");
  assert.equal(out[0].employeeName, "สมชาย ใจดี");
  assert.equal(out[0].scannedAt.getTime(), new Date(2026, 6, 27, 9, 18, 22).getTime());
});

test("เติมศูนย์รหัสพนักงานให้ครบ 3 หลัก เหมือนฝั่งเครื่องสแกน", () => {
  const out = parseRows("1|สมชาย|2026-07-27 09:00:00");
  assert.equal(out[0].employeeCode, "001");
});

test("รหัสที่ไม่ใช่ตัวเลขล้วนต้องไม่ถูกเติมศูนย์", () => {
  const out = parseRows("A12|สมชาย|2026-07-27 09:00:00");
  assert.equal(out[0].employeeCode, "A12");
});

test("ไม่มีชื่อในฐาน → คืนสตริงว่าง ไม่ใช่ undefined", () => {
  const out = parseRows("001||2026-07-27 09:00:00");
  assert.equal(out[0].employeeName, "");
});

test("เวลาก่อนเที่ยงคืนถึงเช้าต้องไม่เลื่อนวัน (ห้ามตีความเป็น UTC)", () => {
  // 00:30 ไทย = 17:30 UTC ของเมื่อวาน ถ้าใช้ new Date(string) วันจะเพี้ยนไปหนึ่งวัน
  const out = parseRows("001|สมชาย|2026-07-27 00:30:00");
  assert.equal(out[0].scannedAt.getTime(), new Date(2026, 6, 27, 0, 30, 0).getTime());
});

test("ข้ามบรรทัดว่างและบรรทัดที่ไม่ครบสามคอลัมน์", () => {
  const out = parseRows("\n001|สมชาย|2026-07-27 09:00:00\n\nขยะ\n002|สมหญิง\n");
  assert.deepEqual(out.map((r) => r.employeeCode), ["001"]);
});

test("ข้ามแถวที่เวลาอ่านไม่ได้ ดีกว่าส่งเวลาผิดขึ้น Supabase", () => {
  const out = parseRows("001|สมชาย|ไม่ใช่วันที่\n002|สมหญิง|2026-07-27 09:00:00");
  assert.deepEqual(out.map((r) => r.employeeCode), ["002"]);
});

test("ชื่อที่มีอักขระคั่นปนอยู่ต้องยังแยกคอลัมน์ถูก", () => {
  // แยกจากตัวคั่นตัวแรกและตัวสุดท้าย ไม่ใช่ split ทั้งบรรทัด
  const out = parseRows("001|สมชาย|ใจดี|2026-07-27 09:00:00");
  assert.equal(out[0].employeeName, "สมชาย|ใจดี");
  assert.equal(out[0].employeeCode, "001");
});

test("ไม่มีข้อมูลเลย → คืน array ว่าง", () => {
  assert.deepEqual(parseRows(""), []);
  assert.deepEqual(parseRows(null), []);
});

test("มี cursor → query กรองตั้งแต่เวลานั้นเป็นต้นไปแบบ >=", () => {
  const sql = buildQuery("2026-07-27 09:00:00");
  assert.match(sql, />= TIMESTAMP '2026-07-27 09:00:00'/);
});

test("ไม่มี cursor → query ไม่มีเงื่อนไขเวลา (ดึงทั้งหมด)", () => {
  assert.doesNotMatch(buildQuery(null), /WHERE/);
  assert.doesNotMatch(buildQuery(""), /WHERE/);
});

test("cursor รูปแบบพัง → ตัดทิ้ง ไม่หลุดเข้า SQL", () => {
  // ค่ามาจาก state.json/config ที่แก้ด้วยมือได้ จึงต้องกันไม่ให้ประกอบเข้า SQL ตรง ๆ
  const sql = buildQuery("2026-07-27'; DROP TABLE iclock_transaction; --");
  assert.doesNotMatch(sql, /DROP TABLE/);
  assert.doesNotMatch(sql, /WHERE/);
});

test("cursor ที่เป็นวันที่ล้วนใช้ได้ (start_date ใน config)", () => {
  assert.match(buildQuery("2026-02-01"), />= TIMESTAMP '2026-02-01 00:00:00'/);
});

test("มี until → query มีขอบบนแบบ <= ด้วย", () => {
  const sql = buildQuery("2026-07-01 00:00:00", "2026-07-31 23:59:59");
  assert.match(sql, />= TIMESTAMP '2026-07-01 00:00:00'/);
  assert.match(sql, /<= TIMESTAMP '2026-07-31 23:59:59'/);
});

test("มี until อย่างเดียว → query มีแต่ขอบบน", () => {
  const sql = buildQuery(null, "2026-07-31 23:59:59");
  assert.match(sql, /<= TIMESTAMP '2026-07-31 23:59:59'/);
  assert.doesNotMatch(sql, />=/);
});

test("until รูปแบบพัง → ตัดทิ้ง ไม่หลุดเข้า SQL", () => {
  // ค่ามาจากบรรทัดคำสั่งที่คนพิมพ์เอง จึงต้องกันไม่ให้ประกอบเข้า SQL ตรง ๆ
  const sql = buildQuery(null, "2026-07-31'; DROP TABLE iclock_transaction; --");
  assert.doesNotMatch(sql, /DROP TABLE/);
  assert.doesNotMatch(sql, /WHERE/);
});

test("query อ่านจากตารางของ ZKBioTime และเรียงจากเก่าไปใหม่", () => {
  const sql = buildQuery(null);
  assert.match(sql, /iclock_transaction/);
  assert.match(sql, /personnel_employee/);
  assert.match(sql, /Asia\/Bangkok/);
  assert.match(sql, /ORDER BY t\.punch_time/);
});
