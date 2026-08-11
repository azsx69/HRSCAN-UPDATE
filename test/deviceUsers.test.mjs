import { test } from "node:test";
import assert from "node:assert/strict";
import iconv from "iconv-lite";
import {
  encodeUserPacket,
  importEmployeeToDevice,
  planEmployeeUpsert,
  writeEmployeeToConnectedDevice,
} from "../src/deviceUsers.mjs";

function rawUser({ uid = 2, privilege = 0, password = "", name = "เดิม", card = 0, code = "888" } = {}) {
  const packet = Buffer.alloc(72, 0);
  packet.writeUInt16LE(uid, 0);
  packet.writeUInt8(privilege, 2);
  Buffer.from(password, "ascii").copy(packet, 3, 0, 8);
  iconv.encode(name, "cp874").copy(packet, 11, 0, 24);
  packet.writeUInt32LE(card, 35);
  packet.writeUInt8(7, 39);
  Buffer.from("GROUP01", "ascii").copy(packet, 40, 0, 7);
  packet.writeUInt8(9, 47);
  Buffer.from(code, "ascii").copy(packet, 48, 0, 24);
  return packet;
}

function decoded(packet) {
  return {
    uid: packet.readUInt16LE(0),
    privilege: packet.readUInt8(2),
    name: iconv.decode(packet.subarray(11, 35), "cp874").split("\0")[0],
    card: packet.readUInt32LE(35),
    userId: packet.subarray(48, 72).toString("ascii").split("\0")[0],
    rawPacket: Buffer.from(packet),
  };
}

test("สร้าง ZK8 user packet ใหม่ขนาด 72 ไบต์และเก็บชื่อไทยเป็น cp874", () => {
  const packet = encodeUserPacket({
    uid: 2, employeeCode: "888", employeeName: "ทดสอบ 888", cardNumber: 1234, created: true,
  });
  assert.equal(packet.length, 72);
  assert.equal(packet.readUInt16LE(0), 2);
  assert.equal(packet.subarray(48, 72).toString("ascii").split("\0")[0], "888");
  assert.equal(iconv.decode(packet.subarray(11, 35), "cp874").split("\0")[0], "ทดสอบ 888");
  assert.equal(packet.readUInt32LE(35), 1234);
  assert.equal(packet.readUInt8(2), 0);
});

test("อัปเดตพนักงานเดิมต้องรักษา privilege/password/group/reserved เดิม", () => {
  const original = rawUser({ uid: 2, privilege: 14, password: "secret", card: 555, code: "888" });
  const plan = planEmployeeUpsert(
    [decoded(original)],
    { employee_code: "888", employee_name: "ชื่อใหม่" },
  );
  const packet = encodeUserPacket(plan);
  assert.equal(plan.created, false);
  assert.equal(plan.uid, 2);
  assert.equal(packet.readUInt8(2), 14);
  assert.deepEqual(packet.subarray(3, 11), original.subarray(3, 11));
  assert.deepEqual(packet.subarray(39, 48), original.subarray(39, 48));
  assert.equal(packet.readUInt32LE(35), 555, "ไม่ส่ง card_number ต้องรักษาบัตรเดิม");
  assert.equal(iconv.decode(packet.subarray(11, 35), "cp874").split("\0")[0], "ชื่อใหม่");
});

test("รหัส canonical ซ้ำหลายบัญชีต้องหยุด ไม่เลือกบัญชีแรกแบบคลุมเครือ", () => {
  assert.throws(
    () => planEmployeeUpsert(
      [decoded(rawUser({ uid: 1, code: "1" })), decoded(rawUser({ uid: 2, code: "001" }))],
      { employee_code: "001", employee_name: "ชื่อใหม่" },
    ),
    /ซ้ำ|คลุมเครือ/,
  );
});

test("พนักงานใหม่ใช้ UID ว่างตัวแรกโดยไม่ชนผู้ใช้เดิม", () => {
  const plan = planEmployeeUpsert(
    [decoded(rawUser({ uid: 1, code: "201" })), decoded(rawUser({ uid: 2, code: "888" })), decoded(rawUser({ uid: 4, code: "202" }))],
    { employee_code: "999", employee_name: "คนใหม่" },
  );
  assert.equal(plan.uid, 3);
  assert.equal(plan.created, true);
});

test("รหัสตัวเลขที่ต่างกันเฉพาะเลขศูนย์นำหน้าต้องใช้ UID เดิม", () => {
  const plan = planEmployeeUpsert(
    [decoded(rawUser({ uid: 7, code: "1" }))],
    { employee_code: "001", employee_name: "ชื่อใหม่" },
  );
  assert.equal(plan.uid, 7);
  assert.equal(plan.created, false);
});

test("ปฏิเสธรหัสพนักงานที่ไม่ปลอดภัยก่อนส่งคำสั่งเข้าเครื่อง", () => {
  assert.throws(
    () => planEmployeeUpsert([], { employee_code: "888\nBAD", employee_name: "x" }),
    /รหัสพนักงาน/,
  );
});

test("ปฏิเสธชื่อที่ CP874 เข้ารหัสแบบ lossless ไม่ได้ก่อนส่งคำสั่ง", async () => {
  let wrote = false;
  const zk = { connectionType: "tcp", executeCmd: async () => { wrote = true; } };
  await assert.rejects(
    () => writeEmployeeToConnectedDevice(
      zk,
      { employee_code: "888", employee_name: "Alice 😀" },
      { readUsers: async () => [decoded(rawUser({ uid: 2, code: "888" }))] },
    ),
    /CP874|รองรับ/,
  );
  assert.equal(wrote, false);
});

test("อ่านกลับต้องยืนยัน UID ชื่อ code card และ privilege", async () => {
  const commands = [];
  let reads = 0;
  const beforePacket = rawUser({ uid: 2, privilege: 3, password: "pw", name: "เดิม", card: 55, code: "888" });
  const afterPacket = rawUser({ uid: 2, privilege: 3, password: "pw", name: "ทดสอบ 888", card: 1234, code: "888" });
  const zk = { connectionType: "tcp", executeCmd: async (command, data) => { commands.push({ command, data }); } };
  const result = await writeEmployeeToConnectedDevice(
    zk,
    { employee_code: "888", employee_name: "ทดสอบ 888", card_number: 1234 },
    { readUsers: async () => decoded(++reads === 1 ? beforePacket : afterPacket) ? [decoded(reads === 1 ? beforePacket : afterPacket)] : [] },
  );
  assert.equal(commands[0].command, 8);
  assert.equal(commands[1].command, 1013);
  assert.deepEqual(result, { deviceUid: 2, created: false, verifiedName: "ทดสอบ 888" });
});

test("UID หรือ card ที่อ่านกลับผิดต้องไม่ mark สำเร็จ", async () => {
  let reads = 0;
  const before = decoded(rawUser({ uid: 2, code: "888", card: 10 }));
  const wrong = decoded(rawUser({ uid: 3, code: "888", card: 99, name: "ใหม่" }));
  const zk = { connectionType: "tcp", executeCmd: async () => {} };
  await assert.rejects(
    () => writeEmployeeToConnectedDevice(
      zk,
      { employee_code: "888", employee_name: "ใหม่", card_number: 10 },
      { readUsers: async () => [++reads === 1 ? before : wrong] },
    ),
    /UID|บัตร/,
  );
});

test("ห้ามเขียนผ่าน UDP fallback เพราะข้อมูล UID ไม่ครบ", async () => {
  let wrote = false;
  const fake = {
    connectionType: null,
    async createSocket() { this.connectionType = "udp"; },
    async executeCmd() { wrote = true; },
    async disconnect() {},
  };
  await assert.rejects(
    () => importEmployeeToDevice(
      { ip: "127.0.0.1", port: 4370, timeoutMs: 10, udpLocalPort: 4000 },
      { employee_code: "999", employee_name: "ใหม่" },
      { createZk: () => fake },
    ),
    /TCP/,
  );
  assert.equal(wrote, false);
});
