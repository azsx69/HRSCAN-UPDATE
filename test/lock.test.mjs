import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { acquireDeviceLock, withDeviceLock } from "../src/lock.mjs";

function lockFile() {
  return path.join(mkdtempSync(path.join(tmpdir(), "hrscan-lock-")), ".sync.lock");
}

test("ถือล็อกแล้วปล่อย ไฟล์ต้องหายไป", () => {
  const file = lockFile();
  const release = acquireDeviceLock(file, { owner: "service" });
  assert.ok(existsSync(file));
  release();
  assert.equal(existsSync(file), false);
});

test("โปรเซสอื่นที่ยังมีชีวิตถือล็อกอยู่ ต้องขอไม่ผ่าน", async () => {
  const file = lockFile();
  // จำลอง service อีกตัวด้วยโปรเซส node ลูกที่ยังรันอยู่จริง
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
  try {
    writeFileSync(file, JSON.stringify({ pid: other.pid, owner: "service" }));
    assert.throws(() => acquireDeviceLock(file, { owner: "cli sync-now" }), /กำลังคุยกับเครื่องสแกนอยู่/);
  } finally {
    other.kill();
  }
});

test("PID ในล็อกถูก Windows เอาไปให้โปรเซสอื่นที่ไม่ใช่ node ต้องแย่งมาได้", { skip: process.platform !== "win32" }, () => {
  const file = lockFile();
  // เหตุจริง: service ถูก kill กลางรอบ แล้ว PID เดิมกลายเป็นของ svchost.exe — ล็อกค้างข้ามวัน
  // จำลองด้วย PID 4 (System) ที่มีอยู่เสมอแต่ไม่ใช่ node
  writeFileSync(file, JSON.stringify({ pid: 4, owner: "service" }));
  const release = acquireDeviceLock(file, { owner: "service" });
  assert.ok(existsSync(file));
  release();
});

test("ล็อกค้างจากโปรเซสที่ตายไปแล้ว ต้องแย่งมาได้ ไม่ใช่ค้างถาวร", () => {
  const file = lockFile();
  // PID ที่ไม่มีทางมีอยู่จริง — service ที่ถูก kill กลางคันจะทิ้งไฟล์แบบนี้ไว้
  writeFileSync(file, JSON.stringify({ pid: 0x7ffffff0, owner: "service" }));
  const release = acquireDeviceLock(file, { owner: "cli sync-now" });
  assert.ok(existsSync(file));
  release();
});

test("ไฟล์ล็อกพัง ต้องแย่งมาได้ ไม่ใช่ throw จนสั่งอะไรไม่ได้เลย", () => {
  const file = lockFile();
  writeFileSync(file, "{{{ ไม่ใช่ json");
  const release = acquireDeviceLock(file, { owner: "cli" });
  release();
});

test("withDeviceLock ปล่อยล็อกแม้งานข้างในจะพัง", async () => {
  const file = lockFile();
  await assert.rejects(
    () => withDeviceLock(file, "cli", async () => { throw new Error("ต่อเครื่องไม่ได้"); }),
    /ต่อเครื่องไม่ได้/,
  );
  assert.equal(existsSync(file), false);
});
