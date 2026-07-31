import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSync } from "../src/sync.mjs";
import { readState, writeState } from "../src/state.mjs";

const newStatePath = () => path.join(mkdtempSync(path.join(tmpdir(), "hrscan-run-")), "state.json");

const silentLogger = { info() {}, ok() {}, err() {} };

const config = {
  branch: { code: "Store 1", machineCode: "FP-01" },
  device: { ip: "1.2.3.4", port: 4370, timeoutMs: 100, udpLocalPort: 4000 },
  sync: { intervalMinutes: 5, startDate: "2026-01-01", batchSize: 500 },
};

const rec = (code, h, mi, s = 0) => ({
  employeeCode: code,
  employeeName: `ชื่อ${code}`,
  scannedAt: new Date(2026, 6, 27, h, mi, s),
});

// แถวที่นาฬิกาเครื่องสแกนเพี้ยนจนบันทึกปีผิด — ค่าที่พบจริงจากเครื่องของสาขา
const bogus = (code) => ({
  employeeCode: code,
  employeeName: `ชื่อ${code}`,
  scannedAt: new Date(2119, 6, 26, 20, 5, 9),
});

function deps(overrides = {}) {
  return {
    config,
    logger: silentLogger,
    client: {},
    readAttendance: async () => [],
    pushRows: async () => ({ pushed: 0 }),
    ...overrides,
  };
}

test("push สำเร็จ → cursor = เวลาแถวสุดท้าย", async () => {
  const statePath = newStatePath();
  const res = await runSync({
    ...deps({ readAttendance: async () => [rec("001", 9, 0), rec("002", 9, 18, 22)] }),
    statePath,
  });
  assert.equal(res.pushed, 2);
  assert.equal(readState(statePath).last_scan_at, "2026-07-27 09:18:22");
});

test("push ล้ม → cursor ไม่ขยับ (ข้อมูลจะถูกส่งซ้ำรอบหน้า)", async () => {
  const statePath = newStatePath();
  writeState(statePath, { last_scan_at: "2026-07-27 08:00:00" });
  await assert.rejects(() =>
    runSync({
      ...deps({
        readAttendance: async () => [rec("001", 9, 0)],
        pushRows: async () => { throw new Error("Supabase ล่ม"); },
      }),
      statePath,
    }),
  );
  assert.equal(readState(statePath).last_scan_at, "2026-07-27 08:00:00");
});

test("ต่อเครื่องไม่ได้ → ไม่ throw ออกนอก แต่บันทึกว่า error", async () => {
  // service ต้องไม่ตายเพราะเครื่องสแกนออฟไลน์ชั่วคราว
  const statePath = newStatePath();
  const res = await runSync({
    ...deps({ readAttendance: async () => { throw new Error("timeout"); } }),
    statePath,
  });
  assert.equal(res.ok, false);
  assert.equal(readState(statePath).last_result, "error");
  assert.match(readState(statePath).last_error, /timeout/);
});

test("ทุกแถวเก่ากว่า cursor → ไม่เรียก pushRows เลย", async () => {
  const statePath = newStatePath();
  writeState(statePath, { last_scan_at: "2026-07-27 10:00:00" });
  let called = false;
  const res = await runSync({
    ...deps({
      readAttendance: async () => [rec("001", 8, 0), rec("002", 9, 30)],
      pushRows: async () => { called = true; },
    }),
    statePath,
  });
  assert.equal(called, false);
  assert.equal(res.selected, 0);
  assert.equal(readState(statePath).last_result, "empty");
  assert.equal(readState(statePath).last_scan_at, "2026-07-27 10:00:00");
});

test("เครื่องไม่มี log เลย → จบรอบอย่างสงบ", async () => {
  const statePath = newStatePath();
  let called = false;
  const res = await runSync({
    ...deps({ readAttendance: async () => [], pushRows: async () => { called = true; } }),
    statePath,
  });
  assert.equal(called, false);
  assert.equal(res.read, 0);
  assert.equal(readState(statePath).last_result, "empty");
});

test("แบ่ง batch ตาม batch_size", async () => {
  const statePath = newStatePath();
  const many = Array.from({ length: 1200 }, (_, i) => rec(String(i).padStart(3, "0"), 9, Math.floor(i / 60), i % 60));
  let batches = 0;
  await runSync({
    ...deps({
      config: { ...config, sync: { ...config.sync, batchSize: 500 } },
      readAttendance: async () => many,
      pushRows: async () => { batches++; },
    }),
    statePath,
  });
  assert.equal(batches, 3);
});

test("batch ที่ 2 ล้ม → cursor ขยับถึงแค่ท้าย batch แรก", async () => {
  const statePath = newStatePath();
  const rows = [rec("001", 9, 0), rec("002", 9, 1), rec("003", 9, 2), rec("004", 9, 3)];
  let n = 0;
  await assert.rejects(() =>
    runSync({
      ...deps({
        config: { ...config, sync: { ...config.sync, batchSize: 2 } },
        readAttendance: async () => rows,
        pushRows: async () => { if (++n === 2) throw new Error("ล่มกลางคัน"); },
      }),
      statePath,
    }),
  );
  assert.equal(readState(statePath).last_scan_at, "2026-07-27 09:01:00");
});

test("ส่ง cursor ให้แหล่งข้อมูลกรองตั้งแต่ต้นทาง", async () => {
  // ฐานของ ZKBioTime สะสมข้อมูลย้อนหลังเป็นแสนแถว ถ้าไม่บอกจุดเริ่มจะดึงทั้งฐานทุก 5 นาที
  const statePath = newStatePath();
  writeState(statePath, { last_scan_at: "2026-07-27 08:00:00" });
  let options;
  await runSync({
    ...deps({ readAttendance: async (opts) => { options = opts; return []; } }),
    statePath,
  });
  assert.equal(options.since, "2026-07-27 08:00:00");
});

test("ยังไม่เคยส่ง → ใช้ start_date เป็นจุดเริ่ม", async () => {
  const statePath = newStatePath();
  let options;
  await runSync({
    ...deps({ readAttendance: async (opts) => { options = opts; return []; } }),
    statePath,
  });
  assert.equal(options.since, "2026-01-01");
});

test("แถวเวลาอนาคตต้องไม่ทำให้ cursor กระโดดไปอนาคต", async () => {
  // เครื่องสแกนที่ถ่าน RTC ใกล้หมดบันทึกปีผิดเป็นครั้งคราว ถ้าปล่อยให้แถวนั้นขยับ cursor
  // รอบถัดไปจะไม่มีข้อมูลผ่านเกณฑ์อีกเลย — ข้อมูลยังอยู่ในเครื่อง แต่ไม่มีวันถูกส่ง
  const statePath = newStatePath();
  const res = await runSync({
    ...deps({ readAttendance: async () => [rec("001", 9, 0), bogus("002")] }),
    statePath,
  });
  assert.equal(res.pushed, 1);
  assert.equal(readState(statePath).last_scan_at, "2026-07-27 09:00:00");
});

test("รอบถัดไปยังส่งข้อมูลจริงได้ หลังเจอแถวเวลาอนาคต", async () => {
  // regression ของบั๊กจริง: เดิมรอบแรกทำ cursor พัง แล้วรอบสองส่งอะไรไม่ได้อีกเลย
  const statePath = newStatePath();
  await runSync({
    ...deps({ readAttendance: async () => [rec("001", 9, 0), bogus("002")] }),
    statePath,
  });
  const res = await runSync({
    ...deps({ readAttendance: async () => [rec("003", 10, 0), bogus("002")] }),
    statePath,
  });
  assert.equal(res.pushed, 1);
  assert.equal(readState(statePath).last_scan_at, "2026-07-27 10:00:00");
});

test("มีแต่แถวเวลาอนาคต → จบรอบว่าง ไม่ push และ cursor ไม่ขยับ", async () => {
  const statePath = newStatePath();
  writeState(statePath, { last_scan_at: "2026-07-27 08:00:00" });
  let called = false;
  const res = await runSync({
    ...deps({ readAttendance: async () => [bogus("002")], pushRows: async () => { called = true; } }),
    statePath,
  });
  assert.equal(called, false);
  assert.equal(res.selected, 0);
  assert.equal(readState(statePath).last_scan_at, "2026-07-27 08:00:00");
});

test("เจอแถวเวลาอนาคตแล้วต้องเขียน log ไว้ ไม่ข้ามแบบเงียบ ๆ", async () => {
  const statePath = newStatePath();
  const lines = [];
  await runSync({
    ...deps({
      logger: { info: (m) => lines.push(m), ok: (m) => lines.push(m), err: (m) => lines.push(m) },
      readAttendance: async () => [rec("001", 9, 0), bogus("002")],
    }),
    statePath,
  });
  assert.ok(lines.some((m) => m.includes("อนาคต")), `ไม่พบ log เรื่องแถวเวลาอนาคต: ${lines.join(" / ")}`);
});

test("pushed_total สะสมข้ามรอบ", async () => {
  const statePath = newStatePath();
  await runSync({ ...deps({ readAttendance: async () => [rec("001", 9, 0)] }), statePath });
  await runSync({ ...deps({ readAttendance: async () => [rec("002", 10, 0)] }), statePath });
  assert.equal(readState(statePath).pushed_total, 2);
});
