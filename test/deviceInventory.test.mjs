import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isInventoryDue,
  normalizeInventoryUsers,
  readDeviceInventory,
  syncDeviceInventory,
} from "../src/deviceInventory.mjs";

const rawUsers = () => [
  { uid: 25, userId: "125", name: "จิตรลดา", card: 1234, privilege: 0 },
  { uid: 26, userId: "001", name: "สมชาย", card: 0, privilege: 14 },
];

test("แปลงรายชื่อจากเครื่องเป็น payload inventory ครบทุกฟิลด์", () => {
  assert.deepEqual(normalizeInventoryUsers(rawUsers()), [
    { device_uid: 25, employee_code: "125", device_name: "จิตรลดา", card_number: 1234, privilege: 0 },
    { device_uid: 26, employee_code: "001", device_name: "สมชาย", card_number: 0, privilege: 14 },
  ]);
});

test("snapshot ที่ UID ซ้ำหรือข้อมูลผิดต้องหยุดทั้งรอบ", () => {
  assert.throws(
    () => normalizeInventoryUsers([{ uid: 1, userId: "001" }, { uid: 1, userId: "002" }]),
    /UID 1 ซ้ำ/,
  );
  assert.throws(() => normalizeInventoryUsers([{ uid: 0, userId: "001" }]), /UID/);
  assert.throws(() => normalizeInventoryUsers([{ uid: 1, userId: "" }]), /รหัสพนักงาน/);
});

test("อ่าน inventory ผ่าน TCP และ disconnect เสมอ", async () => {
  const calls = [];
  const fake = {
    connectionType: null,
    zklibTcp: {
      async freeData() { calls.push("free"); },
      async readWithBuffer() {
        const packet = Buffer.alloc(72);
        packet.writeUInt16LE(25, 0);
        Buffer.from("125").copy(packet, 48);
        const data = Buffer.alloc(76);
        data.writeUInt32LE(72, 0);
        packet.copy(data, 4);
        return { data, err: null };
      },
    },
    async createSocket() { this.connectionType = "tcp"; calls.push("connect"); },
    async disconnect() { calls.push("disconnect"); },
  };
  const users = await readDeviceInventory(
    { ip: "127.0.0.1", port: 4370, timeoutMs: 10, udpLocalPort: 4000 },
    { createZk: () => fake },
  );
  assert.equal(users[0].uid, 25);
  assert.equal(users[0].userId, "125");
  assert.equal(calls.at(-1), "disconnect");
});

test("inventory ปฏิเสธ UDP fallback เพราะ UID/card/privilege ไม่ครบ", async () => {
  let disconnected = false;
  const fake = {
    connectionType: null,
    async createSocket() { this.connectionType = "udp"; },
    async disconnect() { disconnected = true; },
  };
  await assert.rejects(
    () => readDeviceInventory(
      { ip: "127.0.0.1", port: 4370, timeoutMs: 10, udpLocalPort: 4000 },
      { createZk: () => fake },
    ),
    /TCP/,
  );
  assert.equal(disconnected, true);
});

test("ส่ง snapshot ทั้งก้อนไป RPC และอ่านผลยืนยัน", async () => {
  let call;
  const client = {
    async rpc(name, args) {
      call = { name, args };
      return {
        data: [{ snapshot_id: 7, observed_at: "2026-08-18T10:00:00Z", present_count: 2, missing_count: 1 }],
        error: null,
      };
    },
  };
  const result = await syncDeviceInventory({
    client,
    branch: "Store 5",
    machineCode: "FP-05",
    device: {},
    readUsers: async () => rawUsers(),
  });
  assert.equal(call.name, "sync_device_employee_inventory");
  assert.equal(call.args.p_branch, "Store 5");
  assert.equal(call.args.p_source_machine, "FP-05");
  assert.equal(call.args.p_users.length, 2);
  assert.deepEqual(result, {
    read: 2,
    snapshotId: 7,
    observedAt: "2026-08-18T10:00:00Z",
    present: 2,
    missing: 1,
  });
});

test("RPC ล้มต้อง throw และไม่รายงานว่า snapshot สำเร็จ", async () => {
  await assert.rejects(
    () => syncDeviceInventory({
      client: { rpc: async () => ({ data: null, error: { message: "ฐานล่ม" } }) },
      branch: "Store 1",
      machineCode: "FP-01",
      device: {},
      readUsers: async () => rawUsers(),
    }),
    /ฐานล่ม/,
  );
});

test("กำหนดรอบ inventory จากเวลาที่พยายามล่าสุด", () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  assert.equal(isInventoryDue(null, 60, now), true);
  assert.equal(isInventoryDue("2026-08-18 11:30:00", 60, now), false);
  assert.equal(isInventoryDue("2026-08-18 11:00:00", 60, now), true);
});
