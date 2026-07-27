// อ่าน log การสแกนจากเครื่อง ZKTeco (K50/ID) ผ่าน TCP
//
// เครื่องเก็บชื่อพนักงานเป็น cp874 (ไทย) แต่ node-zklib decode ฟิลด์ name ด้วย 'ascii' ซึ่งตัด bit สูงทิ้ง
// ทำให้อักษรไทยเพี้ยน จึงต้องอ่าน buffer ดิบเองแล้ว decode ด้วย iconv-lite
// (วิธีเดียวกับที่ระบบ HR ใช้ใน server/fingerprint.mjs)
import { createRequire } from "node:module";
import iconv from "iconv-lite";
import ZKLib from "node-zklib";

const require = createRequire(import.meta.url);
const { REQUEST_DATA } = require("node-zklib/constants.js");

const USER_PACKET_SIZE = 72;

function decodeUserRecord(buf) {
  const userId = buf.subarray(48, 48 + 9).toString("ascii").split("\0").shift() ?? "";
  const rawName = buf.subarray(11).toString("latin1").split("\0").shift() ?? "";
  const name = iconv.decode(Buffer.from(rawName, "latin1"), "cp874").trim();
  return { userId, name };
}

async function getUsersThai(zk) {
  if (zk.connectionType !== "tcp") {
    // UDP fallback: ใช้ decode ของไลบรารี (ชื่อไทยอาจเพี้ยน แต่ยังได้รหัสพนักงานถูก)
    const { data } = await zk.getUsers();
    return data.map((u) => ({ userId: String(u.userId), name: u.name }));
  }
  const t = zk.zklibTcp;
  await t.freeData();
  const { data } = await t.readWithBuffer(REQUEST_DATA.GET_USERS);
  await t.freeData();

  let buf = data.subarray(4);
  const users = [];
  while (buf.length >= USER_PACKET_SIZE) {
    users.push(decodeUserRecord(buf.subarray(0, USER_PACKET_SIZE)));
    buf = buf.subarray(USER_PACKET_SIZE);
  }
  return users;
}

// รหัสพนักงานในระบบ HR เป็นเลข 3 หลัก แต่เครื่องเก็บเป็น "1" บ้าง "001" บ้าง
function padEmployeeCode(id) {
  return /^\d+$/.test(id) ? id.padStart(3, "0") : id;
}

// แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้ทดสอบได้โดยไม่ต้องต่อเครื่องจริง
export function buildRecords(logs, users) {
  const userMap = new Map(users.map((u) => [u.userId, u.name]));
  const records = [];
  for (const log of logs) {
    if (!log?.recordTime) continue;
    const rawId = String(log.deviceUserId);
    const employeeCode = padEmployeeCode(rawId);
    records.push({
      employeeCode,
      employeeName: userMap.get(rawId) ?? userMap.get(employeeCode) ?? "",
      scannedAt: new Date(log.recordTime),
    });
  }
  return records;
}

export async function readAttendance({ ip, port, timeoutMs, udpLocalPort }) {
  const zk = new ZKLib(ip, port, timeoutMs, udpLocalPort);
  try {
    await zk.createSocket();
    const users = await getUsersThai(zk);
    const { data: logs } = await zk.getAttendances();
    return buildRecords(logs, users);
  } finally {
    try {
      await zk.disconnect();
    } catch {
      // เครื่องอาจหลุดไปแล้ว ไม่ต้องสนใจ error ตอนปิด
    }
  }
}

// ใช้กับเมนู "ทดสอบการเชื่อมต่อ" — คืนข้อมูลสรุปพอให้รู้ว่าคุยกับเครื่องรู้เรื่อง
export async function testDevice(device) {
  const records = await readAttendance(device);
  const latest = records.reduce((max, r) => (max === null || r.scannedAt > max ? r.scannedAt : max), null);
  return { total: records.length, latest, sampleName: records.at(-1)?.employeeName ?? "" };
}
