import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

test("โปรเซสอื่นที่ยังมีชีวิตถือล็อกอยู่ ต้องขอไม่ผ่าน", () => {
  const file = lockFile();
  // ใช้ PID ของ process ปัจจุบันแทนโปรเซสอื่นที่ยังรันอยู่จริง
  writeFileSync(file, JSON.stringify({ pid: process.pid + 0, owner: "service" }));
  // pid เดียวกับตัวเองถือว่าเป็นล็อกของเราเอง — จำลองโปรเซสอื่นด้วย pid ของ init/System ที่มีอยู่เสมอ
  writeFileSync(file, JSON.stringify({ pid: 4, owner: "service" }));
  assert.throws(() => acquireDeviceLock(file, { owner: "cli sync-now" }), /กำลังคุยกับเครื่องสแกนอยู่/);
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
