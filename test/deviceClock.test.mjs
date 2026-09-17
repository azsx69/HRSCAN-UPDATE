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

// เครื่องสแกนปลอม: เก็บเวลาไว้ในตัว ตอบ GET_TIME ตามรูปแบบจริง (header 8 ไบต์ + uint32)
// applyOnDisconnect = จำลอง MB10-VL ที่อ่านซ้ำใน connection เดิมยังได้เวลาเก่า
// applyAfterConnections = จำลองเครื่องที่เปลี่ยนเวลาช้า: connection ใหม่ N ครั้งแรกหลัง SET ยังเห็นเวลาเก่า
function fakeDevice(
  deviceTime,
  { ignoreSet = false, failConnect = false, applyOnDisconnect = false, applyAfterConnections = null } = {},
) {
  const state = { deviceTime, pending: null, delayed: null, commands: [], disconnected: false };
  state.zk = {
    async createSocket() {
      if (failConnect) throw new Error("ETIMEDOUT");
      if (state.delayed) {
        if (state.delayed.connectionsLeft === 0) {
          state.deviceTime = state.delayed.time;
          state.delayed = null;
        } else {
          state.delayed.connectionsLeft--;
        }
      }
    },
    async executeCmd(command, data) {
      state.commands.push(command);
      if (command === COMMANDS.CMD_GET_TIME) {
        const reply = Buffer.alloc(12);
        reply.writeUInt32LE(encodeDeviceTime(state.deviceTime), 8);
        return reply;
      }
      if (command === COMMANDS.CMD_SET_TIME && !ignoreSet) {
        const next = decodeDeviceTime(data.readUInt32LE(0));
        if (applyAfterConnections !== null) state.delayed = { time: next, connectionsLeft: applyAfterConnections };
        else if (applyOnDisconnect) state.pending = next;
        else state.deviceTime = next;
      }
      return Buffer.alloc(8);
    },
    async disconnect() {
      state.disconnected = true;
      if (state.pending) {
        state.deviceTime = state.pending;
        state.pending = null;
      }
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
  const sleeps = [];
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
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { syncDeviceClock, device, logger, clock, sleeps, zkCreatedCount: () => zkCreated };
}

test("เครื่องช้า 25 วินาที → ตั้งเวลาเป็นเวลา PC แล้วยืนยันผ่าน", async () => {
  const { syncDeviceClock, device, logger, sleeps } = setup({ deviceOffsetSec: -25 });
  const r = await syncDeviceClock();
  assert.equal(r.action, "set");
  assert.equal(r.verified, true);
  assert.deepEqual(sleeps, []);
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
  const { syncDeviceClock, logger, sleeps, zkCreatedCount } = setup({ deviceOffsetSec: -25, ignoreSet: true });
  const r = await syncDeviceClock();
  assert.equal(r.action, "set");
  assert.equal(r.verified, false);
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.equal(zkCreatedCount(), 4); // ตั้ง 1 + อ่านยืนยัน 3
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

test("เครื่องเปลี่ยนเวลาหลังปิด connection → ยืนยันด้วย connection ใหม่แล้วผ่าน", async () => {
  const { syncDeviceClock, device, logger, zkCreatedCount } = setup({ deviceOffsetSec: -25, applyOnDisconnect: true });
  const r = await syncDeviceClock();
  assert.equal(r.verified, true);
  assert.equal(zkCreatedCount(), 2);
  assert.equal(device.deviceTime.getTime(), PC_NOW.getTime());
  assert.deepEqual(logger.lines, [["ok", "ตั้งเวลาเครื่องสแกนแล้ว — ก่อนตั้ง ช้ากว่า PC 25 วินาที"]]);
});

test("decideClockAction: ต่างไม่ถึงครึ่งวินาที ได้ 0 ไม่ใช่ -0", () => {
  const r = decideClockAction({ pcNow: PC_NOW, deviceNow: new Date(PC_NOW.getTime() - 400) });
  assert.ok(Object.is(r.deviceDriftSec, 0));
});

test("เครื่องเปลี่ยนเวลาช้า (connection แรกหลังตั้งยังเห็นเวลาเก่า) → รอ 1 วินาทีแล้วอ่านซ้ำผ่าน", async () => {
  const { syncDeviceClock, logger, sleeps } = setup({ deviceOffsetSec: -30, applyAfterConnections: 1 });
  const r = await syncDeviceClock();
  assert.equal(r.verified, true);
  assert.deepEqual(sleeps, [1000]);
  assert.deepEqual(logger.lines, [["ok", "ตั้งเวลาเครื่องสแกนแล้ว — ก่อนตั้ง ช้ากว่า PC 30 วินาที"]]);
});
