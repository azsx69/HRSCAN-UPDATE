// กันสองโปรเซสคุยกับเครื่องสแกนพร้อมกัน — เครื่อง ZKTeco รับได้ทีละ 1 การเชื่อมต่อ
// ถ้าชนกันจะต่อไม่ติดทั้งคู่ และรอบของ service จะจบด้วย error ทั้งที่ไม่มีอะไรเสีย
//
// เมนูข้อ 5 หยุด service ให้ก่อนอยู่แล้ว แต่คนที่รัน `node src\cli.mjs` เองจากบรรทัดคำสั่งไม่ได้ผ่านทางนั้น
// ล็อกนี้จึงเป็นตาข่ายชั้นสุดท้าย: ทั้ง service และ CLI ต้องถือล็อกก่อนแตะเครื่องเสมอ
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

// โปรเซสที่จับ PID นี้ไว้ยังอยู่ไหม — EPERM แปลว่ามีอยู่จริงแต่คนละสิทธิ์ (service รันด้วย LocalSystem)
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code !== "EPERM") return false;
  }
  return isNodeProcess(pid);
}

// Windows เอา PID ของโปรเซสที่ตายแล้วไปให้โปรเซสอื่นใช้ต่อ — ถ้า service ถูก kill กลางรอบ
// ล็อกจะชี้ไปที่ svchost.exe หรืออะไรก็ได้ที่ได้ PID นั้นไป แล้วค้างถาวร จึงต้องเช็คว่ายังเป็น node อยู่
function isNodeProcess(pid) {
  if (process.platform !== "win32") return true;
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return /^"node\.exe",/im.test(out);
  } catch {
    // เรียก tasklist ไม่ได้ = ไม่รู้แน่ ถือว่ายังมีชีวิตไว้ก่อน ดีกว่าสองโปรเซสแย่งเครื่องกัน
    return true;
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    // ไฟล์พังหรืออ่านไม่ได้ = ถือว่าไม่มีล็อก ปล่อยให้เขียนทับ ดีกว่าค้างจนสั่งงานอะไรไม่ได้เลย
    return null;
  }
}

export function acquireDeviceLock(lockPath, { owner = "cli" } = {}) {
  if (existsSync(lockPath)) {
    const held = readLock(lockPath);
    if (held && isAlive(held.pid) && held.pid !== process.pid) {
      throw new Error(
        `${held.owner ?? "โปรเซสอื่น"} (PID ${held.pid}) กำลังคุยกับเครื่องสแกนอยู่ — ` +
          "ใช้เมนูข้อ 5 ซึ่งหยุด service ให้ก่อน หรือหยุด service เองแล้วสั่งใหม่",
      );
    }
  }
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, owner, at: new Date().toISOString() }));
  return () => {
    // ปลดเฉพาะล็อกของตัวเอง — ถ้ามีคนแย่งไปแล้วห้ามลบของเขา
    const held = readLock(lockPath);
    if (held?.pid === process.pid) {
      try { unlinkSync(lockPath); } catch { /* ถูกลบไปแล้วก็ไม่เป็นไร */ }
    }
  };
}

// ครอบงานที่ต้องแตะเครื่อง แล้วปลดล็อกให้เสมอแม้งานจะพัง
export async function withDeviceLock(lockPath, owner, fn) {
  const release = acquireDeviceLock(lockPath, { owner });
  try {
    return await fn();
  } finally {
    release();
  }
}
