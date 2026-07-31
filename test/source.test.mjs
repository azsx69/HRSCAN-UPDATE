import { test } from "node:test";
import assert from "node:assert/strict";
import { createReader, createTester, describeSource, isBiotime } from "../src/source.mjs";

const base = {
  device: { ip: "192.168.88.175", port: 4370, timeoutMs: 100, udpLocalPort: 4000 },
  biotime: {
    psqlPath: "C:\\ไม่มีจริง\\psql.exe",
    host: "127.0.0.1",
    port: 7496,
    database: "biotime",
    user: "postgres",
    timeoutMs: 1000,
  },
};

const withSource = (type) => ({ ...base, source: { type } });

test("type = biotime → อ่านจากฐาน ZKBioTime", () => {
  assert.equal(isBiotime(withSource("biotime")), true);
});

test("type = device หรือค่าอื่น → ต่อเครื่องสแกนตรง", () => {
  assert.equal(isBiotime(withSource("device")), false);
  assert.equal(isBiotime(withSource("อะไรก็ไม่รู้")), false);
});

test("reader ของโหมด biotime ผูกกับค่าตั้ง biotime ไม่ใช่ค่าเครื่องสแกน", async () => {
  // psql_path ชี้ไปที่ไฟล์ที่ไม่มีจริง จึงต้องได้ข้อความของฝั่ง biotime ไม่ใช่ timeout ของเครื่องสแกน
  const read = createReader(withSource("biotime"));
  await assert.rejects(() => read({ since: "2026-07-27 09:00:00" }), /psql\.exe/);
});

test("ตัวทดสอบการเชื่อมต่อก็เลือกตามชนิดแหล่งเดียวกัน", async () => {
  await assert.rejects(() => createTester(withSource("biotime"))(), /psql\.exe/);
});

test("คำอธิบายแหล่งข้อมูลบอกได้ว่าสาขานี้อ่านจากทางไหน", () => {
  assert.match(describeSource(withSource("biotime")), /ZKBioTime/);
  assert.match(describeSource(withSource("biotime")), /7496/);
  assert.match(describeSource(withSource("device")), /192\.168\.88\.175:4370/);
});
