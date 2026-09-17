// ตั้งนาฬิกาเครื่องสแกนให้ตรงกับ PC ทุกรอบ sync
// เวลาที่ผิดในเครื่องจะติดไปกับ log ทุกแถว แล้วไหลต่อไปถึง Supabase และระบบ HR
//
// ไม่เชื่อนาฬิกา PC ลอย ๆ: ต้องเทียบกับเวลาเซิร์ฟเวอร์ Supabase ก่อน และ timezone ต้องเป็นเวลาไทย
// ไม่งั้นเครื่องสแกนจะถูกตั้งผิดตาม PC ไปทั้งสาขา

import { createRequire } from "node:module";
import ZKLib from "node-zklib";
import { decodeDeviceTime, encodeDeviceTime } from "./device.mjs";

const require = createRequire(import.meta.url);
const { COMMANDS } = require("node-zklib/constants.js");

export const SET_THRESHOLD_SEC = 10;
export const PC_DRIFT_LIMIT_SEC = 60;
export const VERIFY_TOLERANCE_SEC = 3;
// MB10-VL เปลี่ยนเวลาไม่ทันทีหลังรับคำสั่ง (ทดลองกับ Store 4: เสร็จภายในราว 1 วินาที) จึงอ่านยืนยันซ้ำได้
export const VERIFY_ATTEMPTS = 3;
export const VERIFY_RETRY_DELAY_MS = 1000;
// เพี้ยนเป็นชั่วโมงไม่ใช่อาการนาฬิกาเดินคลาด แต่มักเป็นถ่าน RTC หมดแล้วเวลารีเซ็ต
export const SEVERE_DRIFT_SEC = 3600;
export const WARN_INTERVAL_MS = 60 * 60 * 1000;
// getTimezoneOffset() ของ UTC+07:00 เป็นค่าลบ (นาทีจาก local ไป UTC)
const THAI_TZ_OFFSET_MIN = -420;

// || 0 กัน -0 จากการปัดค่าลบที่ใกล้ศูนย์ ซึ่งจะโผล่ออกมาใน log/ผลลัพธ์ดูแปลก
const diffSec = (a, b) => Math.round((a.getTime() - b.getTime()) / 1000) || 0;

// บวก = PC เร็วกว่าเซิร์ฟเวอร์
export function pcClockDriftSec({ pcNow, serverNow }) {
  return diffSec(pcNow, serverNow);
}

// บวก = เครื่องสแกนเร็วกว่า PC
// deviceNow = null คือถอดรหัสเวลาเครื่องไม่ได้ (วันที่เสีย) — ต้องตั้งใหม่แน่นอน
export function decideClockAction({ pcNow, deviceNow }) {
  if (!deviceNow) return { action: "set", deviceDriftSec: null, severe: true };
  const deviceDriftSec = diffSec(deviceNow, pcNow);
  const abs = Math.abs(deviceDriftSec);
  if (abs < SET_THRESHOLD_SEC) return { action: "ok", deviceDriftSec, severe: false };
  return { action: "set", deviceDriftSec, severe: abs > SEVERE_DRIFT_SEC };
}

export function describeDrift(sec) {
  if (sec === null) return "อ่านเวลาเครื่องไม่ได้";
  if (sec === 0) return "ตรงกับ PC";
  return `${sec < 0 ? "ช้า" : "เร็ว"}กว่า PC ${Math.abs(sec).toLocaleString()} วินาที`;
}

// ต้องการแค่ Date header จึงใช้ HEAD (ไม่มี body = ไม่เปลือง egress) และไม่สนใจ HTTP status
export async function fetchServerTime({ url, serviceKey }, { fetch = globalThis.fetch } = {}) {
  try {
    const res = await fetch(`${String(url).replace(/\/+$/, "")}/rest/v1/`, {
      method: "HEAD",
      headers: { apikey: serviceKey },
      signal: AbortSignal.timeout(10_000),
    });
    const header = res.headers.get("date");
    const date = header ? new Date(header) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

// คำตอบของเครื่อง = header คำสั่ง 8 ไบต์ ตามด้วยเวลาแบบ uint32
export async function readDeviceTime(zk) {
  const reply = await zk.executeCmd(COMMANDS.CMD_GET_TIME, "");
  if (!Buffer.isBuffer(reply) || reply.length < 12) {
    throw new Error("อ่านเวลาเครื่องสแกนไม่ได้ (คำตอบสั้นเกินไป)");
  }
  return decodeDeviceTime(reply.readUInt32LE(8));
}

// ไม่ต้อง disableDevice — คำสั่งเดียวจบ คนที่กำลังสแกนอยู่ไม่ติดขัด
export async function writeDeviceTime(zk, date) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(encodeDeviceTime(date), 0);
  await zk.executeCmd(COMMANDS.CMD_SET_TIME, data);
}

const defaultCreateZk = (d) => new ZKLib(d.ip, d.port, d.timeoutMs, d.udpLocalPort);

// ใช้กับ test-source — ดูอย่างเดียว ไม่ตั้งเวลา
export async function measureDeviceClockDrift(device, { createZk = defaultCreateZk, now = () => new Date() } = {}) {
  const zk = createZk(device);
  try {
    await zk.createSocket();
    const deviceNow = await readDeviceTime(zk);
    return deviceNow ? diffSec(deviceNow, now()) : null;
  } finally {
    try { await zk.disconnect(); } catch {}
  }
}

// สร้างครั้งเดียวตอน service เริ่ม แล้วเรียกฟังก์ชันที่คืนมาทุกรอบ
// ตัวจำเวลาเตือนล่าสุดต้องอยู่ข้ามรอบ จึงเป็น factory ไม่ใช่ฟังก์ชันเดี่ยว
export function createDeviceClockSync({
  device,
  supabase,
  logger,
  createZk = defaultCreateZk,
  fetchTime = fetchServerTime,
  now = () => new Date(),
  timezoneOffset = () => new Date().getTimezoneOffset(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const lastWarnAt = new Map();
  // ปัญหาฝั่ง PC หรือเน็ตมักค้างเป็นชั่วโมง ถ้าเตือนทุก 5 นาทีจะกลบ log เรื่องอื่นจนอ่านไม่ออก
  const warn = (kind, message) => {
    const t = now().getTime();
    if (lastWarnAt.has(kind) && t - lastWarnAt.get(kind) < WARN_INTERVAL_MS) return;
    lastWarnAt.set(kind, t);
    logger.err(message);
  };

  return async function syncDeviceClock() {
    // Windows ตั้ง timezone ผิด เวลา UTC ยังตรงกับเซิร์ฟเวอร์ได้ แต่เวลาท้องถิ่นผิดเป็นชั่วโมง
    if (timezoneOffset() !== THAI_TZ_OFFSET_MIN) {
      warn("timezone", "ไม่ตั้งเวลาเครื่องสแกน — timezone ของ Windows ไม่ใช่ UTC+07:00 (เวลาไทย)");
      return { action: "skip-timezone" };
    }

    const serverNow = await fetchTime(supabase);
    if (!serverNow) {
      warn("server", "ไม่ตั้งเวลาเครื่องสแกน — อ่านเวลาเซิร์ฟเวอร์ Supabase ไม่ได้ จึงยืนยันนาฬิกา PC ไม่ได้");
      return { action: "skip-no-server-time" };
    }

    const pcDriftSec = pcClockDriftSec({ pcNow: now(), serverNow });
    if (Math.abs(pcDriftSec) > PC_DRIFT_LIMIT_SEC) {
      warn(
        "pc-drift",
        `ไม่ตั้งเวลาเครื่องสแกน — นาฬิกา PC ต่างจากเซิร์ฟเวอร์ ${pcDriftSec} วินาที ให้ตรวจการตั้งเวลาของ Windows`,
      );
      return { action: "skip-pc-drift", pcDriftSec };
    }

    const zk = createZk(device);
    let decision;
    try {
      try {
        await zk.createSocket();
      } catch {
        // runSync รอบเดียวกันรายงานเรื่องต่อเครื่องไม่ได้ไว้แล้ว ไม่ต้อง log ซ้ำ
        return { action: "skip-device-unreachable" };
      }

      decision = decideClockAction({ pcNow: now(), deviceNow: await readDeviceTime(zk) });
      if (decision.action === "ok") return decision;

      if (decision.severe) {
        logger.err(
          `นาฬิกาเครื่องสแกนเพี้ยนผิดปกติ (${describeDrift(decision.deviceDriftSec)}) — อาจเป็นถ่านนาฬิกา ให้ช่างตรวจ`,
        );
      }
      await writeDeviceTime(zk, now());
    } finally {
      try { await zk.disconnect(); } catch {}
    }

    // อ่านกลับด้วย connection ใหม่และลองซ้ำ: MB10-VL ของ Store 4 อ่านใน connection เดิมได้เวลาเก่าเสมอ
    // และ connection ใหม่ที่ต่อเร็วเกินไปก็ยังอาจเห็นเวลาเก่า — ถ้าครบทุกครั้งแล้วยังไม่ตรง
    // แปลว่าเฟิร์มแวร์ตอบรับคำสั่งแต่ไม่เปลี่ยนเวลาจริง
    const withinTolerance = (sec) => sec !== null && Math.abs(sec) <= VERIFY_TOLERANCE_SEC;
    let afterSec = null;
    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
      afterSec = await measureDeviceClockDrift(device, { createZk, now });
      if (withinTolerance(afterSec) || attempt === VERIFY_ATTEMPTS) break;
      await sleep(VERIFY_RETRY_DELAY_MS);
    }
    if (!withinTolerance(afterSec)) {
      logger.err(`ตั้งเวลาเครื่องสแกนแล้วแต่อ่านกลับไม่ตรง (${describeDrift(afterSec)}) — จะลองใหม่รอบหน้า`);
      return { ...decision, verified: false };
    }
    logger.ok(`ตั้งเวลาเครื่องสแกนแล้ว — ก่อนตั้ง ${describeDrift(decision.deviceDriftSec)}`);
    return { ...decision, verified: true };
  };
}
