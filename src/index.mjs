// จุดเริ่มของ service — NSSM เรียกไฟล์นี้ (node.exe src\index.mjs)
// ทำงานเป็นรอบตาม [sync] interval_minutes ไม่มี UI ทุกอย่างออกทาง log
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createLogger } from "./logger.mjs";
import { createReader, describeSource } from "./source.mjs";
import { createClient, pushRows } from "./supabase.mjs";
import { runSync } from "./sync.mjs";
import { runEmployeeImportQueue } from "./employeeImport.mjs";
import { isInventoryDue, syncDeviceInventory } from "./deviceInventory.mjs";
import { withDeviceLock } from "./lock.mjs";
import { readState, writeState } from "./state.mjs";
import { toThaiStamp } from "./thaiTime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(root);
const logger = createLogger({ dir: path.join(root, "logs"), keepDays: config.log.keepDays });
const statePath = path.join(root, "state.json");
const lockPath = path.join(root, ".sync.lock");

let client;
try {
  client = createClient(config.supabase);
} catch (e) {
  logger.err(`${e.message} — service จะรอจนกว่าจะตั้งค่าเสร็จแล้ว restart`);
  process.exit(1); // NSSM จะ restart ให้เองตามที่ตั้งไว้ (หน่วง 10 วินาที)
}

// อ่านจากเครื่องสแกนตรง หรือจากฐานของ ZKBioTime ตาม [source] type ที่สาขาตั้งไว้
const readAttendance = createReader(config);

// รอบก่อนยังไม่จบห้ามเริ่มรอบใหม่ — เครื่อง ZKTeco รับได้ทีละ 1 การเชื่อมต่อ และ state.json
// ก็ต้องไม่ถูกเขียนพร้อมกันจากสองรอบ
let running = false;

async function tick() {
  if (running) {
    logger.info("รอบก่อนหน้ายังทำงานอยู่ — ข้ามรอบนี้");
    return;
  }
  running = true;
  try {
    // ถือล็อกตลอดรอบ เพื่อให้ CLI ที่คนหน้างานสั่งเองรู้ว่าห้ามแตะเครื่องตอนนี้
    await withDeviceLock(lockPath, "service", async () => {
      await runSync({ config, logger, statePath, readAttendance, pushRows, client });
      if (config.employeeImport.enabled) {
        try {
          const result = await runEmployeeImportQueue({
            client,
            branch: config.branch.code,
            workerId: config.employeeImport.workerId,
            limit: config.employeeImport.batchSize,
            device: config.device,
            logger,
          });
          if (result.claimed > 0) {
            logger.info(
              `คิวนำเข้าพนักงาน: รับ ${result.claimed} · สำเร็จ ${result.completed} · ไม่สำเร็จ ${result.failed}`,
            );
          }
        } catch (e) {
          // คิวพนักงานล้มต้องไม่ขัดขวาง attendance sync ซึ่งเป็นงานหลัก
          logger.err(`อ่านคิวนำเข้าพนักงานไม่ได้ (${e.message}) — จะลองใหม่รอบหน้า`);
        }
      }
      if (config.deviceInventory.enabled && config.source.type === "device") {
        const state = readState(statePath);
        const attemptedAt = new Date();
        if (isInventoryDue(state.last_inventory_attempt_at, config.deviceInventory.intervalMinutes, attemptedAt)) {
          writeState(statePath, { last_inventory_attempt_at: toThaiStamp(attemptedAt) });
          try {
            const result = await syncDeviceInventory({
              client,
              branch: config.branch.code,
              machineCode: config.branch.machineCode,
              device: config.device,
              logger,
            });
            writeState(statePath, {
              last_inventory_sync_at: toThaiStamp(new Date()),
              last_inventory_result: "ok",
              last_inventory_error: null,
              last_inventory_count: result.present,
            });
          } catch (e) {
            logger.err(`ส่ง inventory เครื่องไม่สำเร็จ (${e.message}) — จะลองใหม่ตามรอบ inventory`);
            writeState(statePath, {
              last_inventory_result: "error",
              last_inventory_error: e.message,
            });
          }
        }
      }
    });
  } catch (e) {
    // runSync บันทึก state และ log ไว้แล้ว ตรงนี้แค่กันไม่ให้ service ตาย
    logger.err(`รอบนี้ไม่สำเร็จ: ${e.message}`);
  } finally {
    running = false;
  }
}

logger.info(
  `เริ่มทำงาน — สาขา ${config.branch.code} · ${describeSource(config)} · ทุก ${config.sync.intervalMinutes} นาที`,
);
if (config.deviceInventory.enabled && config.source.type !== "device") {
  logger.err("เปิด device inventory ไว้ แต่ source ไม่ใช่ device — จะไม่ต่อเครื่องโดยตรงเพื่อไม่ชนกับ ZKBioTime");
}

await tick();
const timer = setInterval(tick, Math.max(1, config.sync.intervalMinutes) * 60_000);

function shutdown(signal) {
  logger.info(`ได้รับสัญญาณ ${signal} — กำลังปิด`);
  clearInterval(timer);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// error ที่หลุดมาถึงตรงนี้ต้องไม่ทำให้ service ตายเงียบ ๆ โดยไม่มีร่องรอยใน log
process.on("uncaughtException", (e) => logger.err(`ข้อผิดพลาดที่ไม่ได้ดัก: ${e.message}`));
process.on("unhandledRejection", (e) => logger.err(`promise ที่ไม่ได้ดัก: ${e?.message ?? e}`));
