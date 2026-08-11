// เพิ่มหรือแก้ไขบัญชีพนักงานบนเครื่อง ZKTeco ผ่าน CMD_USER_WRQ
// แตะเฉพาะ user profile ที่ระบุ — ไม่เพิ่ม/ลบ biometric templates หรือ attendance logs
import { createRequire } from "node:module";
import iconv from "iconv-lite";
import ZKLib from "node-zklib";
import { getUsersThai, padEmployeeCode } from "./device.mjs";

const require = createRequire(import.meta.url);
const { COMMANDS } = require("node-zklib/constants.js");
const USER_PACKET_SIZE = 72;

function clearAndCopyField(target, offset, length, value, encoding = "ascii") {
  target.fill(0, offset, offset + length);
  const encoded = encoding === "cp874"
    ? iconv.encode(String(value ?? ""), "cp874")
    : Buffer.from(String(value ?? ""), encoding);
  encoded.copy(target, offset, 0, Math.min(encoded.length, length));
}

function normalizeEmployee(row) {
  const employeeCode = String(row?.employee_code ?? "").trim();
  const employeeName = String(row?.employee_name ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(employeeCode)) {
    throw new Error("รหัสพนักงานต้องมี 1-24 ตัว และใช้ได้เฉพาะ A-Z, a-z, 0-9, _ หรือ -");
  }
  if (!employeeName) throw new Error("ชื่อพนักงานห้ามว่าง");
  const nameBytes = iconv.encode(employeeName, "cp874");
  if (nameBytes.length > 24) throw new Error("ชื่อพนักงานยาวเกิน 24 ไบต์สำหรับเครื่อง ZKTeco");
  if (iconv.decode(nameBytes, "cp874") !== employeeName) {
    throw new Error("ชื่อพนักงานมีอักขระที่ CP874 ไม่รองรับ");
  }

  const hasCard = row?.card_number !== undefined && row?.card_number !== null && row?.card_number !== "";
  const cardNumber = hasCard ? Number(row.card_number) : null;
  if (cardNumber !== null && (!Number.isSafeInteger(cardNumber) || cardNumber < 0 || cardNumber > 0xffffffff)) {
    throw new Error("เลขบัตรต้องเป็นจำนวนเต็ม 0-4294967295");
  }
  return { employeeCode, employeeName, cardNumber };
}

function canonicalEmployeeCode(value) {
  const code = String(value ?? "").trim();
  return /^\d+$/.test(code) ? code.replace(/^0+(?=\d)/, "") : code;
}

export function planEmployeeUpsert(users, row) {
  const employee = normalizeEmployee(row);
  const canonical = canonicalEmployeeCode(employee.employeeCode);
  const matches = users.filter((u) => canonicalEmployeeCode(u.userId) === canonical);
  if (matches.length > 1) {
    throw new Error(`พบรหัสพนักงาน canonical ซ้ำ/คลุมเครือในเครื่อง: ${employee.employeeCode}`);
  }
  const existing = matches[0];
  if (existing) {
    if (!Buffer.isBuffer(existing.rawPacket) || existing.rawPacket.length !== USER_PACKET_SIZE) {
      throw new Error("ข้อมูลพนักงานเดิมไม่ใช่ TCP user packet 72 ไบต์ จึงไม่อนุญาตให้อัปเดต");
    }
    // เขียนทับ byte 48-71 = เปลี่ยนรหัสบนเครื่อง ซึ่งเปลี่ยน employee_code ของ log ที่ส่งขึ้น Supabase ตามไปด้วย
    // ยอมได้เฉพาะกรณีที่ padEmployeeCode ให้ผลเท่ากัน (เช่น "1" -> "001" ซึ่ง HR เห็นเป็นค่าเดิมอยู่แล้ว)
    // ต่างกันเมื่อไหร่แปลว่าประวัติการสแกนของคนนี้จะขาดเป็นสองรหัส — ต้องให้คนตัดสิน ไม่ใช่เขียนทับเงียบ ๆ
    const deviceCode = String(existing.userId ?? "").trim();
    if (padEmployeeCode(deviceCode) !== padEmployeeCode(employee.employeeCode)) {
      throw new Error(
        `เครื่องเก็บรหัสนี้เป็น "${deviceCode}" แต่คิวส่ง "${employee.employeeCode}" — ` +
          "เขียนทับจะทำให้ประวัติการสแกนแยกเป็นสองรหัส ให้แก้รหัสในทะเบียน HR ให้ตรงกับเครื่องก่อน",
      );
    }
    return {
      uid: Number(existing.uid),
      ...employee,
      cardNumber: employee.cardNumber ?? Number(existing.card ?? 0),
      originalPrivilege: Number(existing.privilege ?? 0),
      basePacket: Buffer.from(existing.rawPacket),
      created: false,
    };
  }

  // ใช้ max+1 ไม่ใช่เลขว่างต่ำสุด — uid ของคนที่ถูกลบไปอาจยังมีแม่แบบลายนิ้วมือค้างอยู่ในเครื่อง
  // ถ้าเอา uid นั้นมาใช้ซ้ำ พนักงานใหม่จะสแกนด้วยนิ้วของคนเก่าได้โดยไม่มีใครรู้
  const used = users.map((u) => Number(u.uid)).filter(Number.isInteger);
  const uid = Math.max(0, ...used) + 1;
  if (uid > 65535) throw new Error("ไม่มี UID ว่างในเครื่อง ZKTeco");
  return {
    uid,
    ...employee,
    cardNumber: employee.cardNumber ?? 0,
    originalPrivilege: 0,
    basePacket: null,
    created: true,
  };
}

export function encodeUserPacket({
  uid, employeeCode, employeeName, cardNumber = 0, basePacket = null,
}) {
  if (!Number.isInteger(uid) || uid < 1 || uid > 65535) throw new Error("UID ไม่ถูกต้อง");
  if (basePacket !== null && (!Buffer.isBuffer(basePacket) || basePacket.length !== USER_PACKET_SIZE)) {
    throw new Error("base user packet ต้องมี 72 ไบต์");
  }
  const packet = basePacket ? Buffer.from(basePacket) : Buffer.alloc(USER_PACKET_SIZE);
  packet.writeUInt16LE(uid, 0);
  if (!basePacket) packet.writeUInt8(0, 2); // USER_DEFAULT สำหรับผู้ใช้ใหม่เท่านั้น
  clearAndCopyField(packet, 11, 24, employeeName, "cp874");
  packet.writeUInt32LE(cardNumber, 35);
  // รักษา byte 39, timezone/group bytes 40..46 และ reserved byte 47 ของผู้ใช้เดิม
  clearAndCopyField(packet, 48, 24, employeeCode);
  return packet;
}

export async function writeEmployeeToConnectedDevice(zk, row, { readUsers = getUsersThai } = {}) {
  if (zk.connectionType !== "tcp") {
    throw new Error("การนำเข้าพนักงานอนุญาตเฉพาะการเชื่อมต่อ TCP เท่านั้น");
  }
  const before = await readUsers(zk);
  const plan = planEmployeeUpsert(before, row);
  const packet = encodeUserPacket(plan);

  // ล็อกเครื่องระหว่างเขียน — ถ้ามีคนแตะนิ้วพอดี เครื่องบางรุ่นจะปฏิเสธคำสั่งหรือเขียนไม่ครบ
  // ต้องปลดล็อกคืนเสมอ ปล่อยค้างไว้แปลว่าพนักงานทั้งสาขาสแกนไม่ได้
  await zk.disableDevice();
  let failure = null;
  try {
    await zk.executeCmd(COMMANDS.CMD_USER_WRQ, packet);
    await zk.executeCmd(COMMANDS.CMD_REFRESHDATA, Buffer.alloc(0));
  } catch (e) {
    failure = e;
  }
  try {
    await zk.enableDevice();
  } catch (e) {
    // ใช้ finally ตรง ๆ ไม่ได้ — error ตอนปลดล็อกจะกลบสาเหตุจริงที่ทำให้เขียนไม่ผ่าน
    failure ??= new Error(`เขียนสำเร็จแต่ปลดล็อกเครื่องไม่ได้ (${e.message}) — ต้องรีสตาร์ทเครื่องสแกน`);
  }
  if (failure) throw failure;

  const after = await readUsers(zk);
  // เทียบแบบ canonical ให้ตรงกับตอนจับคู่ — เครื่องบางรุ่นเก็บ "001" ที่ส่งไปเป็น "1"
  // ถ้าเทียบตรงตัวจะสรุปว่าเขียนไม่สำเร็จทั้งที่เข้าเครื่องแล้ว แล้ววนเขียนซ้ำจนกลายเป็น failed
  const wanted = canonicalEmployeeCode(plan.employeeCode);
  const verified = after.find((u) => canonicalEmployeeCode(u.userId) === wanted);
  if (!verified) throw new Error(`เขียนรหัส ${plan.employeeCode} แล้ว แต่อ่านยืนยันกลับจากเครื่องไม่พบ`);
  if (Number(verified.uid) !== plan.uid) {
    throw new Error(`UID ที่อ่านกลับไม่ตรง (คาด ${plan.uid}, ได้ ${verified.uid})`);
  }
  if (String(verified.name ?? "").trim() !== plan.employeeName) {
    throw new Error(`ชื่อที่อ่านกลับจากเครื่องไม่ตรงกับคิว (${verified.name ?? ""})`);
  }
  if (Number(verified.card ?? 0) !== plan.cardNumber) {
    throw new Error(`เลขบัตรที่อ่านกลับไม่ตรง (คาด ${plan.cardNumber}, ได้ ${verified.card})`);
  }
  if (Number(verified.privilege ?? 0) !== plan.originalPrivilege) {
    throw new Error("privilege ที่อ่านกลับเปลี่ยนจากข้อมูลเดิม");
  }
  return { deviceUid: Number(verified.uid), created: plan.created, verifiedName: verified.name };
}

export async function importEmployeeToDevice(device, row, { createZk } = {}) {
  const zk = createZk
    ? createZk(device)
    : new ZKLib(device.ip, device.port, device.timeoutMs, device.udpLocalPort);
  try {
    await zk.createSocket();
    if (zk.connectionType !== "tcp") {
      throw new Error("การนำเข้าพนักงานต้องเชื่อมต่อเครื่องผ่าน TCP เท่านั้น; ปฏิเสธ UDP fallback");
    }
    return await writeEmployeeToConnectedDevice(zk, row);
  } finally {
    try { await zk.disconnect(); } catch {}
  }
}
