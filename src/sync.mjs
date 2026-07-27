// ประกอบการทำงานหนึ่งรอบ: อ่านจากเครื่อง -> เลือกแถวใหม่ -> ส่งขึ้น Supabase -> ขยับ cursor
import { parseThaiStamp, toThaiStamp } from "./thaiTime.mjs";
import { readState, writeState } from "./state.mjs";
import { toPayload } from "./supabase.mjs";

// เลือกเฉพาะแถวที่ยังไม่ได้ส่ง แล้วเรียงจากเก่าไปใหม่
//
// เทียบ cursor แบบ >= ไม่ใช่ > เพราะพนักงานหลายคนสแกนในวินาทีเดียวกันได้:
// ถ้าใช้ > แถวที่เวลาชนกับ cursor พอดีจะหายถาวรโดยไม่มีใครรู้
// ยอมส่งซ้ำแถวขอบแล้วให้ unique constraint ฝั่ง Supabase กันซ้ำ ซึ่งถูกกว่าข้อมูลหาย
export function selectNewRows(records, { cursor, startDate }) {
  const cursorAt = parseThaiStamp(cursor);
  const startAt = parseThaiStamp(startDate);

  return records
    .filter((r) => {
      if (startAt && r.scannedAt < startAt) return false;
      if (cursorAt && r.scannedAt < cursorAt) return false;
      return true;
    })
    .sort((a, b) => a.scannedAt - b.scannedAt);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// รับ readAttendance/pushRows เข้ามาเป็นพารามิเตอร์ เพื่อให้ทดสอบได้โดยไม่ต้องมีเครื่องสแกนและเน็ตจริง
export async function runSync({ config, logger, statePath, readAttendance, pushRows, client }) {
  const started = new Date();
  logger.info("เริ่มรอบ sync");

  let records;
  try {
    records = await readAttendance(config.device);
  } catch (e) {
    // เครื่องสแกนออฟไลน์เป็นเรื่องปกติ ไม่ใช่เหตุให้ service ตาย — cursor ไม่ขยับ รอบหน้าลองใหม่
    logger.err(`ต่อเครื่องสแกนไม่ได้ (${e.message}) — จะลองใหม่รอบหน้า`);
    writeState(statePath, { last_run_at: toThaiStamp(started), last_result: "error", last_error: e.message });
    return { read: 0, selected: 0, pushed: 0, ok: false };
  }

  const state = readState(statePath);
  const fresh = selectNewRows(records, { cursor: state.last_scan_at, startDate: config.sync.startDate });
  logger.info(`อ่าน log จากเครื่อง ${records.length.toLocaleString()} แถว`);

  if (fresh.length === 0) {
    logger.info("ไม่มีข้อมูลใหม่");
    writeState(statePath, { last_run_at: toThaiStamp(started), last_result: "empty", last_error: null });
    return { read: records.length, selected: 0, pushed: 0, ok: true };
  }

  logger.info(`ใหม่กว่า cursor (${state.last_scan_at ?? "ยังไม่เคยส่ง"}): ${fresh.length.toLocaleString()} แถว`);

  // ส่งทีละ batch แล้วขยับ cursor ทันทีที่ batch นั้นสำเร็จ
  // ถ้า batch ถัดไปล้ม ความคืบหน้าที่ทำได้แล้วจะไม่หาย และแถวที่เหลือถูกส่งซ้ำรอบหน้า
  let pushed = 0;
  try {
    for (const part of chunk(fresh, config.sync.batchSize)) {
      await pushRows(client, toPayload(part, config.branch));
      pushed += part.length;
      const cursor = toThaiStamp(part[part.length - 1].scannedAt);
      writeState(statePath, {
        last_scan_at: cursor,
        last_run_at: toThaiStamp(new Date()),
        last_result: "ok",
        last_error: null,
        pushed_total: readState(statePath).pushed_total + part.length,
      });
    }
  } catch (e) {
    logger.err(`ส่งข้อมูลไม่สำเร็จ (${e.message}) — ส่งได้ ${pushed} แถว ที่เหลือจะส่งซ้ำรอบหน้า`);
    writeState(statePath, { last_run_at: toThaiStamp(new Date()), last_result: "error", last_error: e.message });
    throw e;
  }

  const cursor = readState(statePath).last_scan_at;
  logger.ok(`push สำเร็จ ${pushed.toLocaleString()} แถว → cursor = ${cursor}`);
  return { read: records.length, selected: fresh.length, pushed, cursor, ok: true };
}
