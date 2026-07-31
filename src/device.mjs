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

function decodeUsersData(data) {
  if (!Buffer.isBuffer(data)) throw new TypeError("user response ต้องเป็น Buffer");
  if (data.length < 4) throw new Error(`user buffer ไม่สมบูรณ์ (${data.length} bytes)`);
  const payload = data.subarray(4);
  const declaredLength = data.readUInt32LE(0);
  if (declaredLength !== payload.length || payload.length % USER_PACKET_SIZE !== 0) {
    throw new Error(`user buffer ไม่สมบูรณ์ (ระบุ ${declaredLength} bytes แต่ได้รับ ${payload.length} bytes)`);
  }
  const users = [];
  for (let offset = 0; offset < payload.length; offset += USER_PACKET_SIZE) {
    users.push(decodeUserRecord(payload.subarray(offset, offset + USER_PACKET_SIZE)));
  }
  return users;
}

export async function getUsersThai(zk) {
  if (zk.connectionType !== "tcp") {
    // UDP fallback: ใช้ decode ของไลบรารี (ชื่อไทยอาจเพี้ยน แต่ยังได้รหัสพนักงานถูก)
    const { data } = await zk.getUsers();
    return data.map((u) => ({ userId: String(u.userId), name: u.name }));
  }
  const t = zk.zklibTcp;
  await t.freeData();
  try {
    const { data, err } = await t.readWithBuffer(REQUEST_DATA.GET_USERS);
    if (err) throw err;
    return decodeUsersData(data);
  } finally {
    try { await t.freeData(); } catch {}
  }
}

// รหัสพนักงานในระบบ HR เป็นเลข 3 หลัก แต่เครื่องเก็บเป็น "1" บ้าง "001" บ้าง
function padEmployeeCode(id) {
  return /^\d+$/.test(id) ? id.padStart(3, "0") : id;
}

function decodeDeviceTime(value) {
  const second = value % 60;
  value = Math.floor(value / 60);
  const minute = value % 60;
  value = Math.floor(value / 60);
  const hour = value % 24;
  value = Math.floor(value / 24);
  const day = value % 31 + 1;
  value = Math.floor(value / 31);
  const month = value % 12;
  const year = Math.floor(value / 12) + 2000;
  const result = new Date(year, month, day, hour, minute, second);
  // ป้องกัน record เสียที่ Date จะ normalize ข้ามเดือนไปเงียบ ๆ
  if (
    result.getFullYear() !== year || result.getMonth() !== month || result.getDate() !== day
    || result.getHours() !== hour || result.getMinutes() !== minute || result.getSeconds() !== second
  ) return null;
  return result;
}

function detectAttendancePacketSize(payloadLength, logCount, requestedSize) {
  if (requestedSize !== undefined) {
    if (requestedSize !== 40 && requestedSize !== 49) {
      throw new Error(`ไม่รองรับ attendance packet ขนาด ${requestedSize} ไบต์`);
    }
    if (payloadLength % requestedSize !== 0) {
      throw new Error(`attendance buffer ไม่สมบูรณ์ (${payloadLength} bytes ไม่ลงตัวกับ packet ${requestedSize} bytes)`);
    }
    return requestedSize;
  }
  if (logCount > 0 && payloadLength % logCount === 0) {
    const exact = payloadLength / logCount;
    if (exact === 40 || exact === 49) return exact;
  }
  const candidates = [49, 40].filter((size) => payloadLength % size === 0);
  if (candidates.length === 1) return candidates[0];
  throw new Error(`ไม่รู้จักรูปแบบ attendance packet (${payloadLength} bytes, ${logCount ?? "?"} logs)`);
}

// decode buffer ดิบเพื่อรองรับทั้ง K50/ID สาขา 1 (40 ไบต์) และ MB40-VL สาขา 2 (49 ไบต์)
export function decodeAttendanceData(data, { logCount, packetSize } = {}) {
  if (!Buffer.isBuffer(data)) throw new TypeError("attendance response ต้องเป็น Buffer");
  if (data.length < 4) throw new Error(`attendance buffer ไม่สมบูรณ์ (${data.length} bytes)`);
  const payload = data.subarray(4);
  const declaredLength = data.readUInt32LE(0);
  if (declaredLength !== payload.length) {
    throw new Error(`attendance buffer ไม่สมบูรณ์ (ระบุ ${declaredLength} bytes แต่ได้รับ ${payload.length} bytes)`);
  }
  if (declaredLength === 0) return [];
  const size = detectAttendancePacketSize(payload.length, logCount, packetSize);
  const records = [];
  for (let offset = 0; offset + size <= payload.length; offset += size) {
    const packet = payload.subarray(offset, offset + size);
    const deviceUserId = packet.subarray(2, 26).toString("ascii").split("\0").shift()?.trim() ?? "";
    const recordTime = decodeDeviceTime(packet.readUInt32LE(27));
    if (deviceUserId && recordTime) records.push({ deviceUserId, recordTime });
  }
  return records;
}

// Store 1 ใช้เส้นทางเดิมของ node-zklib; raw 49-byte path เปิดเฉพาะ Store 2 เท่านั้น
export async function getAttendanceLogs(zk, { packetSize } = {}) {
  if (packetSize !== 49) {
    const { data } = await zk.getAttendances();
    return data;
  }
  if (zk.connectionType !== "tcp") {
    throw new Error("MB40-VL attendance packet 49 ไบต์ต้องเชื่อมต่อผ่าน TCP");
  }
  const t = zk.zklibTcp;
  await t.freeData();
  try {
    const { data, err } = await t.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS);
    if (err) throw err;
    return decodeAttendanceData(data, { packetSize });
  } finally {
    // การ disconnect ด้านนอกจะทำงานต่อเสมอ และ cleanup error ต้องไม่กลบ read error ต้นฉบับ
    try { await t.freeData(); } catch {}
  }
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

export async function readAttendance({ ip, port, timeoutMs, udpLocalPort, attendancePacketSize }) {
  const zk = new ZKLib(ip, port, timeoutMs, udpLocalPort);
  try {
    await zk.createSocket();
    const users = await getUsersThai(zk);
    const logs = await getAttendanceLogs(zk, { packetSize: attendancePacketSize });
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
