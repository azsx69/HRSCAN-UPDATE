# Device Clock Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ service ตั้งนาฬิกาเครื่องสแกน ZKTeco ให้ตรงกับ PC ทุกรอบ sync เมื่อเพี้ยนตั้งแต่ 10 วินาที โดยยืนยันนาฬิกา PC กับเวลาเซิร์ฟเวอร์ Supabase ก่อน

**Architecture:** เพิ่ม `encodeDeviceTime` คู่กับ `decodeDeviceTime` ใน `device.mjs` และสร้างโมดูลใหม่ `deviceClock.mjs` ซึ่งมีฟังก์ชันบริสุทธิ์สำหรับตัดสินใจ, ฟังก์ชันอ่านเวลา Supabase, คำสั่ง GET/SET_TIME และ factory `createDeviceClockSync` ที่ถือตัวจำกัดความถี่ของคำเตือน จากนั้นต่อเข้า `tick()` ใน `index.mjs` หลังคิวนำเข้าพนักงาน และเพิ่มบรรทัดแสดงความคลาดเคลื่อนใน `test-source`

**Tech Stack:** Node.js 24 (ESM `.mjs`), `node-zklib`, `node:test` + `node:assert/strict`, global `fetch`

**Spec:** [docs/superpowers/specs/2026-09-17-device-clock-sync-design.md](../specs/2026-09-17-device-clock-sync-design.md)

## Global Constraints

- ค่าคงที่: `SET_THRESHOLD_SEC = 10`, `PC_DRIFT_LIMIT_SEC = 60`, `VERIFY_TOLERANCE_SEC = 3`, `SEVERE_DRIFT_SEC = 3600`, `WARN_INTERVAL_MS = 3,600,000`
- timezone ของ PC ต้องเป็น UTC+07:00 (`getTimezoneOffset() === -420`) ไม่งั้นข้าม
- ใช้เวลาท้องถิ่นของ PC (getter แบบ local) แนวเดียวกับ `thaiTime.mjs` — ห้ามใช้ `toISOString()` กับเวลาที่จะตั้งลงเครื่อง
- ข้ามทั้งหมดเมื่อ `source = biotime`
- ไม่มีค่าเปิด/ปิดใน `config.ini`
- ไม่เรียก `disableDevice` ตอนตั้งเวลา
- logger มีแค่ `info` / `ok` / `err` — คำเตือนใช้ `logger.err` แบบจำกัดไม่เกินชั่วโมงละครั้ง ไม่เพิ่ม level ใหม่
- การตั้งเวลาล้มต้องไม่ทำให้ attendance sync หรือ service ล้ม
- comment ในโค้ดเป็นภาษาไทย ชื่อตัวแปร/ฟังก์ชันเป็นภาษาอังกฤษ ชื่อ test เป็นภาษาไทย ตามไฟล์เดิม
- **ขั้น commit ทุกขั้นต้องได้รับอนุญาตจากผู้ใช้ก่อน** (กฎของผู้ใช้: commit เฉพาะเมื่อสั่ง) — ถ้ายังไม่ได้รับอนุญาต ให้ข้าม commit แล้วทำงานต่อ
- ห้ามเขียนลงเครื่องสแกนจริงก่อน Task 5 และ Task 5 ต้องขออนุมัติผู้ใช้ก่อน

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/device.mjs` | แก้ | เพิ่ม `encodeDeviceTime`, export `decodeDeviceTime` |
| `src/deviceClock.mjs` | ใหม่ | ตรรกะนาฬิกาเครื่องสแกนทั้งหมด |
| `src/index.mjs` | แก้ | เรียก `syncDeviceClock()` ใน `tick()` |
| `src/cli.mjs` | แก้ | `test-source` แสดงความคลาดเคลื่อนของนาฬิกา |
| `test/device.test.mjs` | แก้ | test การเข้า/ถอดรหัสเวลา |
| `test/deviceClock.test.mjs` | ใหม่ | test ของ `deviceClock.mjs` |

Baseline ก่อนเริ่ม: `npm test` → `tests 146 · pass 146 · fail 0`

---

### Task 1: เข้ารหัสเวลาแบบ ZKTeco

**Files:**
- Modify: `src/device.mjs:63` (บรรทัด `function decodeDeviceTime(value) {`)
- Test: `test/device.test.mjs`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `export function encodeDeviceTime(date: Date): number` — uint32
  - `export function decodeDeviceTime(value: number): Date | null` (มีอยู่แล้ว เปลี่ยนเป็น export)

- [ ] **Step 1: เขียน test ที่ล้ม**

แก้บรรทัด import บนสุดของ `test/device.test.mjs` จาก

```js
import { buildRecords, decodeAttendanceData, getAttendanceLogs, getUsersThai } from "../src/device.mjs";
```

เป็น

```js
import {
  buildRecords,
  decodeAttendanceData,
  decodeDeviceTime,
  encodeDeviceTime,
  getAttendanceLogs,
  getUsersThai,
} from "../src/device.mjs";
```

แล้วต่อท้ายไฟล์:

```js
test("encodeDeviceTime ได้ค่าตามสูตร ZKTeco", () => {
  // ((26*12*31 + 8*31 + 16) * 86400) + (10*60 + 25)*60 + 12
  assert.equal(encodeDeviceTime(new Date(2026, 8, 17, 10, 25, 12)), 858507912);
});

test("encodeDeviceTime แล้ว decodeDeviceTime กลับได้เวลาเดิม", () => {
  const samples = [
    new Date(2026, 8, 17, 10, 25, 12),
    new Date(2026, 0, 1, 0, 0, 0),
    new Date(2026, 11, 31, 23, 59, 59),
    new Date(2028, 1, 29, 12, 0, 0),
    new Date(2099, 11, 31, 23, 59, 59),
  ];
  for (const date of samples) {
    assert.equal(decodeDeviceTime(encodeDeviceTime(date))?.getTime(), date.getTime(), date.toString());
  }
});

test("encodeDeviceTime ของปี 2099 ยังไม่เกิน uint32", () => {
  assert.ok(encodeDeviceTime(new Date(2099, 11, 31, 23, 59, 59)) <= 0xffffffff);
});
```

- [ ] **Step 2: รัน test ให้เห็นว่าล้ม**

Run: `node --test test/device.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../src/device.mjs' does not provide an export named 'decodeDeviceTime'`

- [ ] **Step 3: implement**

ใน `src/device.mjs` เปลี่ยน

```js
function decodeDeviceTime(value) {
```

เป็น

```js
export function decodeDeviceTime(value) {
```

แล้วเพิ่มต่อจากจบฟังก์ชัน `decodeDeviceTime` (หลัง `return result;` และ `}` ของมัน):

```js

// ทางกลับของ decodeDeviceTime — ใช้ตอนตั้งนาฬิกาเครื่อง
// อ่านค่าด้วย getter แบบ local เพราะทั้งระบบถือว่าเวลาท้องถิ่นของ PC คือเวลาไทย (ดู thaiTime.mjs)
export function encodeDeviceTime(date) {
  const days = (date.getFullYear() % 100) * 12 * 31 + date.getMonth() * 31 + date.getDate() - 1;
  return ((days * 24 + date.getHours()) * 60 + date.getMinutes()) * 60 + date.getSeconds();
}
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `node --test test/device.test.mjs`
Expected: PASS ทุก test

Run: `npm test`
Expected: `tests 149 · pass 149 · fail 0`

- [ ] **Step 5: Commit** (ขออนุญาตผู้ใช้ก่อน)

```bash
git add src/device.mjs test/device.test.mjs
git commit -m "feat(device): encode ZKTeco device time"
```

---

### Task 2: ฟังก์ชันตัดสินใจและเวลาเซิร์ฟเวอร์

**Files:**
- Create: `src/deviceClock.mjs`
- Create: `test/deviceClock.test.mjs`

**Interfaces:**
- Consumes: ไม่มี (Task นี้ยังไม่แตะเครื่อง)
- Produces (จาก `src/deviceClock.mjs`):
  - ค่าคงที่ `SET_THRESHOLD_SEC`, `PC_DRIFT_LIMIT_SEC`, `VERIFY_TOLERANCE_SEC`, `SEVERE_DRIFT_SEC`, `WARN_INTERVAL_MS`
  - `pcClockDriftSec({ pcNow: Date, serverNow: Date }): number` — บวก = PC เร็วกว่าเซิร์ฟเวอร์
  - `decideClockAction({ pcNow: Date, deviceNow: Date | null }): { action: "ok" | "set", deviceDriftSec: number | null, severe: boolean }` — บวก = เครื่องเร็วกว่า PC
  - `describeDrift(sec: number | null): string`
  - `fetchServerTime({ url: string, serviceKey: string }, { fetch? }): Promise<Date | null>`

- [ ] **Step 1: เขียน test ที่ล้ม**

สร้าง `test/deviceClock.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideClockAction,
  describeDrift,
  fetchServerTime,
  pcClockDriftSec,
} from "../src/deviceClock.mjs";

const PC_NOW = new Date(2026, 8, 17, 13, 49, 19);
const plus = (date, sec) => new Date(date.getTime() + sec * 1000);

test("pcClockDriftSec: บวกเมื่อ PC เร็วกว่าเซิร์ฟเวอร์", () => {
  assert.equal(pcClockDriftSec({ pcNow: PC_NOW, serverNow: plus(PC_NOW, -61) }), 61);
  assert.equal(pcClockDriftSec({ pcNow: PC_NOW, serverNow: PC_NOW }), 0);
});

test("decideClockAction: เพี้ยน 9 วินาที ยังไม่ต้องตั้ง", () => {
  assert.deepEqual(decideClockAction({ pcNow: PC_NOW, deviceNow: plus(PC_NOW, 9) }), {
    action: "ok", deviceDriftSec: 9, severe: false,
  });
});

test("decideClockAction: เพี้ยนครบ 10 วินาที ต้องตั้ง", () => {
  assert.equal(decideClockAction({ pcNow: PC_NOW, deviceNow: plus(PC_NOW, 10) }).action, "set");
});

test("decideClockAction: เครื่องช้า 25 วินาที ต้องตั้ง แต่ไม่ใช่อาการรุนแรง", () => {
  assert.deepEqual(decideClockAction({ pcNow: PC_NOW, deviceNow: plus(PC_NOW, -25) }), {
    action: "set", deviceDriftSec: -25, severe: false,
  });
});

test("decideClockAction: เพี้ยน 2 ชั่วโมง ถือว่ารุนแรง", () => {
  const r = decideClockAction({ pcNow: PC_NOW, deviceNow: plus(PC_NOW, -7200) });
  assert.equal(r.action, "set");
  assert.equal(r.severe, true);
});

test("decideClockAction: อ่านเวลาเครื่องไม่ได้ ต้องตั้งและถือว่ารุนแรง", () => {
  assert.deepEqual(decideClockAction({ pcNow: PC_NOW, deviceNow: null }), {
    action: "set", deviceDriftSec: null, severe: true,
  });
});

test("describeDrift บอกทิศทางเป็นภาษาไทย", () => {
  assert.equal(describeDrift(-25), "ช้ากว่า PC 25 วินาที");
  assert.equal(describeDrift(12), "เร็วกว่า PC 12 วินาที");
  assert.equal(describeDrift(0), "ตรงกับ PC");
  assert.equal(describeDrift(null), "อ่านเวลาเครื่องไม่ได้");
});

test("fetchServerTime ส่ง HEAD พร้อม apikey แล้วอ่าน Date header", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { status: 401, headers: new Headers({ date: "Thu, 17 Sep 2026 06:49:19 GMT" }) };
  };
  const date = await fetchServerTime({ url: "https://x.supabase.co/", serviceKey: "k" }, { fetch });
  assert.equal(date.toISOString(), "2026-09-17T06:49:19.000Z");
  assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/");
  assert.equal(calls[0].options.method, "HEAD");
  assert.equal(calls[0].options.headers.apikey, "k");
});

test("fetchServerTime คืน null เมื่อไม่มี Date header", async () => {
  const fetch = async () => ({ status: 200, headers: new Headers() });
  assert.equal(await fetchServerTime({ url: "https://x.supabase.co", serviceKey: "k" }, { fetch }), null);
});

test("fetchServerTime คืน null เมื่อต่อเน็ตไม่ได้", async () => {
  const fetch = async () => { throw new Error("ENOTFOUND"); };
  assert.equal(await fetchServerTime({ url: "https://x.supabase.co", serviceKey: "k" }, { fetch }), null);
});
```

- [ ] **Step 2: รัน test ให้เห็นว่าล้ม**

Run: `node --test test/deviceClock.test.mjs`
Expected: FAIL — `Cannot find module '...src/deviceClock.mjs'`

- [ ] **Step 3: implement**

สร้าง `src/deviceClock.mjs`:

```js
// ตั้งนาฬิกาเครื่องสแกนให้ตรงกับ PC ทุกรอบ sync
// เวลาที่ผิดในเครื่องจะติดไปกับ log ทุกแถว แล้วไหลต่อไปถึง Supabase และระบบ HR
//
// ไม่เชื่อนาฬิกา PC ลอย ๆ: ต้องเทียบกับเวลาเซิร์ฟเวอร์ Supabase ก่อน และ timezone ต้องเป็นเวลาไทย
// ไม่งั้นเครื่องสแกนจะถูกตั้งผิดตาม PC ไปทั้งสาขา

export const SET_THRESHOLD_SEC = 10;
export const PC_DRIFT_LIMIT_SEC = 60;
export const VERIFY_TOLERANCE_SEC = 3;
// เพี้ยนเป็นชั่วโมงไม่ใช่อาการนาฬิกาเดินคลาด แต่มักเป็นถ่าน RTC หมดแล้วเวลารีเซ็ต
export const SEVERE_DRIFT_SEC = 3600;
export const WARN_INTERVAL_MS = 60 * 60 * 1000;

const diffSec = (a, b) => Math.round((a.getTime() - b.getTime()) / 1000);

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
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `node --test test/deviceClock.test.mjs`
Expected: PASS 10 tests

Run: `npm test`
Expected: `tests 159 · pass 159 · fail 0`

- [ ] **Step 5: Commit** (ขออนุญาตผู้ใช้ก่อน)

```bash
git add src/deviceClock.mjs test/deviceClock.test.mjs
git commit -m "feat(clock): decide device clock action from PC and server time"
```

---

### Task 3: คุยกับเครื่องและ factory `createDeviceClockSync`

**Files:**
- Modify: `src/deviceClock.mjs`
- Modify: `test/deviceClock.test.mjs`

**Interfaces:**
- Consumes:
  - `encodeDeviceTime(date): number`, `decodeDeviceTime(value): Date | null` จาก `src/device.mjs` (Task 1)
  - `pcClockDriftSec`, `decideClockAction`, `describeDrift`, `fetchServerTime` และค่าคงที่จาก Task 2
- Produces (จาก `src/deviceClock.mjs`):
  - `readDeviceTime(zk): Promise<Date | null>`
  - `writeDeviceTime(zk, date: Date): Promise<void>`
  - `measureDeviceClockDrift(device, { createZk?, now? }): Promise<number | null>`
  - `createDeviceClockSync({ device, supabase, logger, createZk?, fetchTime?, now?, timezoneOffset? }): () => Promise<{ action: string, ... }>`
    - ค่า `action` ที่คืน: `"skip-timezone"`, `"skip-no-server-time"`, `"skip-pc-drift"`, `"skip-device-unreachable"`, `"ok"`, `"set"` (มี `verified: boolean` เมื่อเป็น `"set"`)

- [ ] **Step 1: เขียน test ที่ล้ม**

ใน `test/deviceClock.test.mjs` แก้ import บนสุดเป็น:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeDeviceTime, encodeDeviceTime } from "../src/device.mjs";
import {
  WARN_INTERVAL_MS,
  createDeviceClockSync,
  decideClockAction,
  describeDrift,
  fetchServerTime,
  measureDeviceClockDrift,
  pcClockDriftSec,
} from "../src/deviceClock.mjs";

const { COMMANDS } = createRequire(import.meta.url)("node-zklib/constants.js");
```

แล้วต่อท้ายไฟล์:

```js
// เครื่องสแกนปลอม: เก็บเวลาไว้ในตัว ตอบ GET_TIME ตามรูปแบบจริง (header 8 ไบต์ + uint32)
function fakeDevice(deviceTime, { ignoreSet = false, failConnect = false } = {}) {
  const state = { deviceTime, commands: [], disconnected: false };
  state.zk = {
    async createSocket() {
      if (failConnect) throw new Error("ETIMEDOUT");
    },
    async executeCmd(command, data) {
      state.commands.push(command);
      if (command === COMMANDS.CMD_GET_TIME) {
        const reply = Buffer.alloc(12);
        reply.writeUInt32LE(encodeDeviceTime(state.deviceTime), 8);
        return reply;
      }
      if (command === COMMANDS.CMD_SET_TIME && !ignoreSet) {
        state.deviceTime = decodeDeviceTime(data.readUInt32LE(0));
      }
      return Buffer.alloc(8);
    },
    async disconnect() {
      state.disconnected = true;
    },
  };
  return state;
}

function fakeLogger() {
  const lines = [];
  return {
    lines,
    info: (m) => lines.push(["info", m]),
    ok: (m) => lines.push(["ok", m]),
    err: (m) => lines.push(["err", m]),
  };
}

// ประกอบ syncDeviceClock พร้อม dependency ปลอม — clock คือเวลา PC ที่เลื่อนได้ใน test
function setup({ deviceOffsetSec = -25, serverOffsetSec = 0, tz = -420, serverTime = true, ...deviceOptions } = {}) {
  const clock = { now: PC_NOW };
  const device = fakeDevice(plus(PC_NOW, deviceOffsetSec), deviceOptions);
  const logger = fakeLogger();
  let zkCreated = 0;
  const syncDeviceClock = createDeviceClockSync({
    device: { ip: "192.168.1.201" },
    supabase: { url: "https://x.supabase.co", serviceKey: "k" },
    logger,
    createZk: () => {
      zkCreated++;
      return device.zk;
    },
    fetchTime: async () => (serverTime ? plus(clock.now, serverOffsetSec) : null),
    now: () => clock.now,
    timezoneOffset: () => tz,
  });
  return { syncDeviceClock, device, logger, clock, zkCreatedCount: () => zkCreated };
}

test("เครื่องช้า 25 วินาที → ตั้งเวลาเป็นเวลา PC แล้วยืนยันผ่าน", async () => {
  const { syncDeviceClock, device, logger } = setup({ deviceOffsetSec: -25 });
  const r = await syncDeviceClock();
  assert.equal(r.action, "set");
  assert.equal(r.verified, true);
  assert.ok(device.commands.includes(COMMANDS.CMD_SET_TIME));
  assert.equal(device.deviceTime.getTime(), PC_NOW.getTime());
  assert.deepEqual(logger.lines, [["ok", "ตั้งเวลาเครื่องสแกนแล้ว — ก่อนตั้ง ช้ากว่า PC 25 วินาที"]]);
  assert.equal(device.disconnected, true);
});

test("เครื่องเพี้ยน 5 วินาที → ไม่ตั้ง และไม่เขียน log", async () => {
  const { syncDeviceClock, device, logger } = setup({ deviceOffsetSec: 5 });
  const r = await syncDeviceClock();
  assert.equal(r.action, "ok");
  assert.ok(!device.commands.includes(COMMANDS.CMD_SET_TIME));
  assert.deepEqual(logger.lines, []);
  assert.equal(device.disconnected, true);
});

test("timezone ไม่ใช่เวลาไทย → ไม่ต่อเครื่องเลย", async () => {
  const { syncDeviceClock, logger, zkCreatedCount } = setup({ tz: 0 });
  assert.equal((await syncDeviceClock()).action, "skip-timezone");
  assert.equal(zkCreatedCount(), 0);
  assert.equal(logger.lines[0][0], "err");
});

test("อ่านเวลาเซิร์ฟเวอร์ไม่ได้ → ไม่ต่อเครื่องเลย", async () => {
  const { syncDeviceClock, zkCreatedCount } = setup({ serverTime: false });
  assert.equal((await syncDeviceClock()).action, "skip-no-server-time");
  assert.equal(zkCreatedCount(), 0);
});

test("PC ต่างจากเซิร์ฟเวอร์ 61 วินาที → ไม่ต่อเครื่อง และเตือนไม่เกินชั่วโมงละครั้ง", async () => {
  const { syncDeviceClock, logger, clock, zkCreatedCount } = setup({ serverOffsetSec: -61 });
  const r = await syncDeviceClock();
  assert.equal(r.action, "skip-pc-drift");
  assert.equal(r.pcDriftSec, 61);
  assert.equal(zkCreatedCount(), 0);
  assert.equal(logger.lines.length, 1);

  clock.now = plus(PC_NOW, 5 * 60); // รอบถัดไป 5 นาที
  await syncDeviceClock();
  assert.equal(logger.lines.length, 1);

  clock.now = plus(PC_NOW, WARN_INTERVAL_MS / 1000); // ครบ 1 ชั่วโมง
  await syncDeviceClock();
  assert.equal(logger.lines.length, 2);
});

test("PC ต่างจากเซิร์ฟเวอร์ 60 วินาที พอดี → ยังตั้งเวลาได้", async () => {
  const { syncDeviceClock } = setup({ serverOffsetSec: -60 });
  assert.equal((await syncDeviceClock()).action, "set");
});

test("ต่อเครื่องไม่ได้ → ข้าม ไม่ log ซ้ำกับ runSync", async () => {
  const { syncDeviceClock, logger } = setup({ failConnect: true });
  assert.equal((await syncDeviceClock()).action, "skip-device-unreachable");
  assert.deepEqual(logger.lines, []);
});

test("เครื่องรับคำสั่งแต่เวลาไม่เปลี่ยน → verified false และ log error", async () => {
  const { syncDeviceClock, logger } = setup({ deviceOffsetSec: -25, ignoreSet: true });
  const r = await syncDeviceClock();
  assert.equal(r.action, "set");
  assert.equal(r.verified, false);
  assert.deepEqual(logger.lines, [["err", "ตั้งเวลาเครื่องสแกนแล้วแต่อ่านกลับไม่ตรง (ช้ากว่า PC 25 วินาที) — จะลองใหม่รอบหน้า"]]);
});

test("เพี้ยน 2 ชั่วโมง → เตือนเรื่องถ่านนาฬิกา แล้วตั้งเวลา", async () => {
  const { syncDeviceClock, logger } = setup({ deviceOffsetSec: -7200 });
  const r = await syncDeviceClock();
  assert.equal(r.verified, true);
  assert.equal(logger.lines[0][0], "err");
  assert.match(logger.lines[0][1], /ถ่านนาฬิกา/);
  assert.equal(logger.lines[1][0], "ok");
});

test("measureDeviceClockDrift อ่านอย่างเดียว ไม่ส่ง SET_TIME", async () => {
  const device = fakeDevice(plus(PC_NOW, -25));
  const drift = await measureDeviceClockDrift({}, { createZk: () => device.zk, now: () => PC_NOW });
  assert.equal(drift, -25);
  assert.ok(!device.commands.includes(COMMANDS.CMD_SET_TIME));
  assert.equal(device.disconnected, true);
});
```

- [ ] **Step 2: รัน test ให้เห็นว่าล้ม**

Run: `node --test test/deviceClock.test.mjs`
Expected: FAIL — `does not provide an export named 'createDeviceClockSync'`

- [ ] **Step 3: implement**

ใน `src/deviceClock.mjs` แทรกต่อจาก comment หัวไฟล์ (ก่อน `export const SET_THRESHOLD_SEC`):

```js
import { createRequire } from "node:module";
import ZKLib from "node-zklib";
import { decodeDeviceTime, encodeDeviceTime } from "./device.mjs";

const require = createRequire(import.meta.url);
const { COMMANDS } = require("node-zklib/constants.js");

```

และเพิ่มหลังบรรทัด `export const WARN_INTERVAL_MS = ...`:

```js
// getTimezoneOffset() ของ UTC+07:00 เป็นค่าลบ (นาทีจาก local ไป UTC)
const THAI_TZ_OFFSET_MIN = -420;
```

แล้วต่อท้ายไฟล์:

```js
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
    try {
      try {
        await zk.createSocket();
      } catch {
        // runSync รอบเดียวกันรายงานเรื่องต่อเครื่องไม่ได้ไว้แล้ว ไม่ต้อง log ซ้ำ
        return { action: "skip-device-unreachable" };
      }

      const decision = decideClockAction({ pcNow: now(), deviceNow: await readDeviceTime(zk) });
      if (decision.action === "ok") return decision;

      if (decision.severe) {
        logger.err(
          `นาฬิกาเครื่องสแกนเพี้ยนผิดปกติ (${describeDrift(decision.deviceDriftSec)}) — อาจเป็นถ่านนาฬิกา ให้ช่างตรวจ`,
        );
      }
      await writeDeviceTime(zk, now());

      // เฟิร์มแวร์บางรุ่นตอบรับคำสั่งแต่ไม่เปลี่ยนเวลาจริง จึงต้องอ่านกลับทุกครั้ง
      const readBack = await readDeviceTime(zk);
      const afterSec = readBack ? diffSec(readBack, now()) : null;
      if (afterSec === null || Math.abs(afterSec) > VERIFY_TOLERANCE_SEC) {
        logger.err(`ตั้งเวลาเครื่องสแกนแล้วแต่อ่านกลับไม่ตรง (${describeDrift(afterSec)}) — จะลองใหม่รอบหน้า`);
        return { ...decision, verified: false };
      }
      logger.ok(`ตั้งเวลาเครื่องสแกนแล้ว — ก่อนตั้ง ${describeDrift(decision.deviceDriftSec)}`);
      return { ...decision, verified: true };
    } finally {
      try { await zk.disconnect(); } catch {}
    }
  };
}
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `node --test test/deviceClock.test.mjs`
Expected: PASS 20 tests

Run: `npm test`
Expected: `tests 169 · pass 169 · fail 0`

- [ ] **Step 5: Commit** (ขออนุญาตผู้ใช้ก่อน)

```bash
git add src/deviceClock.mjs test/deviceClock.test.mjs
git commit -m "feat(clock): set scanner clock from verified PC time"
```

---

### Task 4: ต่อเข้า service และ `test-source`

**Files:**
- Modify: `src/index.mjs` (import บนสุด, หลัง `const readAttendance = createReader(config);`, ใน `tick()` หลังบล็อก `if (config.employeeImport.enabled) { ... }`)
- Modify: `src/cli.mjs` (import บนสุด, ฟังก์ชัน `checkSource`)

**Interfaces:**
- Consumes: `createDeviceClockSync`, `measureDeviceClockDrift`, `describeDrift` จาก `src/deviceClock.mjs` (Task 2–3); `isBiotime(config)` จาก `src/source.mjs` (มีอยู่แล้ว)
- Produces: ไม่มี (จุดปลายทาง)

โปรเจกต์ไม่มี test ของ `index.mjs` / `cli.mjs` — ตรวจด้วย `npm test` (ต้องไม่พัง) และรัน `test-source` จริงซึ่งอ่านอย่างเดียว

- [ ] **Step 1: แก้ `src/index.mjs`**

แก้ import จาก

```js
import { createReader, describeSource } from "./source.mjs";
```

เป็น

```js
import { createReader, describeSource, isBiotime } from "./source.mjs";
```

และเพิ่มต่อจาก `import { withDeviceLock } from "./lock.mjs";`:

```js
import { createDeviceClockSync } from "./deviceClock.mjs";
```

เพิ่มต่อจาก `const readAttendance = createReader(config);`:

```js

// ZKBioTime ยึดการเชื่อมต่อเครื่องไว้ จึงตั้งนาฬิกาได้เฉพาะสาขาที่ต่อเครื่องตรง
const syncDeviceClock = isBiotime(config)
  ? null
  : createDeviceClockSync({ device: config.device, supabase: config.supabase, logger });
```

ใน `tick()` ต่อจากปีกกาปิดของ `if (config.employeeImport.enabled) { ... }` (ยังอยู่ใน callback ของ `withDeviceLock`):

```js
      if (syncDeviceClock) {
        try {
          await syncDeviceClock();
        } catch (e) {
          // ตั้งนาฬิกาล้มต้องไม่ขัดขวาง attendance sync ซึ่งเป็นงานหลัก
          logger.err(`ตรวจนาฬิกาเครื่องสแกนไม่สำเร็จ (${e.message}) — จะลองใหม่รอบหน้า`);
        }
      }
```

- [ ] **Step 2: แก้ `src/cli.mjs`**

เพิ่ม import ต่อจาก `import { acquireDeviceLock } from "./lock.mjs";`:

```js
import { describeDrift, measureDeviceClockDrift } from "./deviceClock.mjs";
```

ใน `checkSource` ต่อจากบรรทัด `if (r.sampleName) console.log(...)` และก่อน `return 0;`:

```js
    if (!isBiotime(config)) {
      // ดูอย่างเดียว — service เป็นคนตั้งเวลาให้ทุกรอบ
      try {
        console.log(`     นาฬิกาเครื่องสแกน: ${describeDrift(await measureDeviceClockDrift(config.device))}`);
      } catch (e) {
        console.log(`     อ่านนาฬิกาเครื่องสแกนไม่ได้: ${e.message}`);
      }
    }
```

- [ ] **Step 3: ตรวจว่า test เดิมไม่พัง**

Run: `npm test`
Expected: `tests 169 · pass 169 · fail 0`

Run: `node --check src/index.mjs && node --check src/cli.mjs`
Expected: ไม่มี output (syntax ถูก)

- [ ] **Step 4: รัน `test-source` กับเครื่องจริง (อ่านอย่างเดียว)**

Run: `node src/cli.mjs test-source`
Expected (ค่าวินาทีอาจต่างจากนี้):

```
กำลังเชื่อมต่อ เครื่องสแกน 192.168.1.201:4370 ...
[OK] อ่าน log ได้ N แถว
     สแกนล่าสุดที่บันทึกไว้: ...
     ตัวอย่างชื่อพนักงาน: ...
     นาฬิกาเครื่องสแกน: ช้ากว่า PC 25 วินาที
```

ถ้าเครื่องออฟไลน์ คำสั่งจะล้มตั้งแต่ขั้นอ่าน log เหมือนเดิม ไม่ใช่ปัญหาของ Task นี้ ให้ลองใหม่ตอนเครื่องออนไลน์

- [ ] **Step 5: Commit** (ขออนุญาตผู้ใช้ก่อน)

```bash
git add src/index.mjs src/cli.mjs
git commit -m "feat(clock): sync scanner clock every service round"
```

---

### Task 5: ทดสอบตั้งเวลากับเครื่องจริง Store 4

**⚠️ เป็นการเขียนลงเครื่องสแกน — ต้องขออนุมัติผู้ใช้ก่อนเริ่ม Step 2**

**Files:** ไม่แก้ไฟล์ในโปรเจกต์ (สคริปต์ชั่วคราวอยู่ใน scratchpad)

**Interfaces:**
- Consumes: `createDeviceClockSync` (Task 3), `loadConfig` จาก `src/config.mjs`, `createLogger` จาก `src/logger.mjs`, `acquireDeviceLock` จาก `src/lock.mjs`
- Produces: ไม่มี

- [ ] **Step 1: ตรวจความคลาดเคลื่อนก่อนตั้ง (อ่านอย่างเดียว)**

Run: `node src/cli.mjs test-source`
Expected: บรรทัด `นาฬิกาเครื่องสแกน:` แสดงค่าปัจจุบัน — จดไว้เทียบ

- [ ] **Step 2: ขออนุมัติผู้ใช้ แล้วรันตั้งเวลา 2 รอบติดกัน**

สร้างไฟล์ `C:/Users/Jaybo/AppData/Local/Temp/claude/d--HRSCAN-UPDATE/6903df5c-57e0-48c0-9bf5-15b3fea341d6/scratchpad/clock-trial.mjs`:

```js
// ทดลองตั้งนาฬิกาเครื่องจริง 2 รอบ: รอบแรกควรตั้ง รอบสองต้องไม่ตั้งซ้ำ
import { createDeviceClockSync } from "file:///D:/HRSCAN-UPDATE/src/deviceClock.mjs";
import { loadConfig } from "file:///D:/HRSCAN-UPDATE/src/config.mjs";
import { createLogger } from "file:///D:/HRSCAN-UPDATE/src/logger.mjs";
import { acquireDeviceLock } from "file:///D:/HRSCAN-UPDATE/src/lock.mjs";

const root = "D:/HRSCAN-UPDATE";
const config = loadConfig(root);
const logger = createLogger({ dir: `${root}/logs`, keepDays: config.log.keepDays });
const release = acquireDeviceLock(`${root}/.sync.lock`, { owner: "clock trial" });
try {
  const syncDeviceClock = createDeviceClockSync({ device: config.device, supabase: config.supabase, logger });
  console.log("รอบ 1:", await syncDeviceClock());
  console.log("รอบ 2:", await syncDeviceClock());
} finally {
  release();
}
```

Run: `cd /d/HRSCAN-UPDATE && node "C:/Users/Jaybo/AppData/Local/Temp/claude/d--HRSCAN-UPDATE/6903df5c-57e0-48c0-9bf5-15b3fea341d6/scratchpad/clock-trial.mjs"`
Expected:

```
... [OK  ] ตั้งเวลาเครื่องสแกนแล้ว — ก่อนตั้ง ช้ากว่า PC 25 วินาที
รอบ 1: { action: 'set', deviceDriftSec: -25, severe: false, verified: true }
รอบ 2: { action: 'ok', deviceDriftSec: 0, severe: false }
```

ถ้ารอบ 1 ได้ `verified: false` → หยุด แล้วรายงานผู้ใช้ (เฟิร์มแวร์อาจไม่รับ `CMD_SET_TIME`)
ถ้าได้ `skip-*` → รายงานสาเหตุตาม action (timezone / เวลาเซิร์ฟเวอร์ / นาฬิกา PC / ต่อเครื่องไม่ได้)

- [ ] **Step 3: ยืนยันด้วย `test-source`**

Run: `node src/cli.mjs test-source`
Expected: `นาฬิกาเครื่องสแกน: ตรงกับ PC` หรือต่างไม่เกิน 3 วินาที

- [ ] **Step 4: ให้ผู้ใช้สแกนที่หน้าเครื่อง 1 ครั้ง แล้วเทียบเวลาใน log กับนาฬิกาจริง**

แจ้งผู้ใช้ แล้วรอคำตอบ จากนั้น Run: `node src/cli.mjs test-source`
Expected: `สแกนล่าสุดที่บันทึกไว้` ตรงกับเวลาที่ผู้ใช้สแกนจริง (คลาดไม่เกิน 3 วินาที)

- [ ] **Step 5: สรุปผลให้ผู้ใช้** — ไม่มี commit ใน Task นี้
