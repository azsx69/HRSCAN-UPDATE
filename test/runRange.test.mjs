import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runRange } from "../src/sync.mjs";
import { readState, writeState } from "../src/state.mjs";

const newStatePath = () => path.join(mkdtempSync(path.join(tmpdir(), "hrscan-range-")), "state.json");

const silentLogger = { info() {}, ok() {}, err() {} };

const config = {
  branch: { code: "Store 1", machineCode: "FP-01" },
  sync: { intervalMinutes: 5, startDate: "2026-01-01", batchSize: 500 },
};

const rec = (code, mo, d, h = 9) => ({
  employeeCode: code,
  employeeName: `ชื่อ${code}`,
  scannedAt: new Date(2026, mo - 1, d, h, 0, 0),
});

function deps(overrides = {}) {
  return {
    config,
    logger: silentLogger,
    client: {},
    from: "2026-07-01 00:00:00",
    until: "2026-07-31 23:59:59",
    readAttendance: async () => [],
    pushRows: async () => ({ pushed: 0 }),
    ...overrides,
  };
}

test("ส่งเฉพาะแถวที่อยู่ในช่วง ตัดทั้งก่อนและหลัง", async () => {
  let sent = [];
  const res = await runRange(
    deps({
      readAttendance: async () => [rec("001", 6, 30), rec("002", 7, 15), rec("003", 8, 1)],
      pushRows: async (_client, rows) => { sent = rows; },
    }),
  );
  assert.equal(res.pushed, 1);
  assert.deepEqual(sent.map((r) => r.employee_code), ["002"]);
});

test("แถววันสุดท้ายของช่วงต้องไม่หลุด (ขอบบนรวมทั้งวัน)", async () => {
  const res = await runRange(
    deps({ readAttendance: async () => [rec("001", 7, 31, 23)] }),
  );
  assert.equal(res.pushed, 1);
});

test("ไม่แตะ state.json — ตัวจำของ service ต้องเท่าเดิมหลังดึงย้อนหลัง", async () => {
  // ถ้าโหมดนี้ขยับ cursor ไปวันปลายช่วง service จะหยุดส่งข้อมูลปัจจุบันโดยไม่มี error ให้เห็น
  // ส่ง statePath เข้าไปด้วยทั้งที่ runRange ไม่รับ เพื่อให้เทสต์ล้มทันทีถ้าวันหน้ามีใครเพิ่ม writeState เข้าไป
  const statePath = newStatePath();
  writeState(statePath, { last_scan_at: "2026-07-27 08:00:00", pushed_total: 5 });
  await runRange(deps({ statePath, readAttendance: async () => [rec("002", 7, 15)] }));
  assert.equal(readState(statePath).last_scan_at, "2026-07-27 08:00:00");
  assert.equal(readState(statePath).pushed_total, 5);
});

test("ดึงย้อนหลังได้แม้ cursor ปัจจุบันอยู่หลังช่วงที่ขอไปแล้ว", async () => {
  // จุดประสงค์หลักของคำสั่งนี้: เติมข้อมูลที่ขาดของเดือนก่อน โดย service เดินหน้าอยู่แล้ว
  const res = await runRange(deps({ readAttendance: async () => [rec("002", 7, 15)] }));
  assert.equal(res.pushed, 1);
});

test("บอกช่วงให้แหล่งข้อมูลกรองตั้งแต่ต้นทาง", async () => {
  let options;
  await runRange(deps({ readAttendance: async (opts) => { options = opts; return []; } }));
  assert.equal(options.since, "2026-07-01 00:00:00");
  assert.equal(options.until, "2026-07-31 23:59:59");
});

test("ไม่มีข้อมูลในช่วง → จบอย่างสงบ ไม่เรียก pushRows", async () => {
  let called = false;
  const res = await runRange(
    deps({ readAttendance: async () => [rec("001", 6, 30)], pushRows: async () => { called = true; } }),
  );
  assert.equal(called, false);
  assert.equal(res.selected, 0);
  assert.equal(res.ok, true);
});

test("แบ่ง batch ตาม batch_size", async () => {
  const many = Array.from({ length: 1200 }, (_, i) => rec(String(i).padStart(4, "0"), 7, (i % 30) + 1));
  let batches = 0;
  await runRange(
    deps({
      config: { ...config, sync: { ...config.sync, batchSize: 500 } },
      readAttendance: async () => many,
      pushRows: async () => { batches++; },
    }),
  );
  assert.equal(batches, 3);
});

test("push ล้ม → throw ออกมาให้ cli คืน exit code 1", async () => {
  await assert.rejects(() =>
    runRange(
      deps({
        readAttendance: async () => [rec("002", 7, 15)],
        pushRows: async () => { throw new Error("Supabase ล่ม"); },
      }),
    ),
  );
});

test("แถวเวลาอนาคตยังถูกกันไว้ แม้ขอบบนของช่วงจะกว้างพอจะรับมันได้", async () => {
  // เครื่องของสาขาที่ถ่าน RTC ใกล้หมดยังมีแถวปี 2119 ค้างอยู่ ห้ามหลุดขึ้น Supabase ตอนดึงย้อนหลัง
  const bogus = { employeeCode: "099", employeeName: "ชื่อ099", scannedAt: new Date(2119, 6, 26, 20, 5, 9) };
  const res = await runRange(
    deps({ until: "2199-12-31 23:59:59", readAttendance: async () => [rec("002", 7, 15), bogus] }),
  );
  assert.equal(res.pushed, 1);
});
