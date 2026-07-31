// ประกอบการทำงานหนึ่งรอบ: อ่านจากเครื่อง -> เลือกแถวใหม่ -> ส่งขึ้น Supabase -> ขยับ cursor
import { parseThaiStamp, toThaiStamp } from "./thaiTime.mjs";
import { readState, writeState } from "./state.mjs";
import { toPayload } from "./supabase.mjs";

// แถวที่เวลาอยู่ในอนาคตเกิดจากนาฬิกาในเครื่องสแกนอ่านค่าปีผิดชั่วคราว (ถ่าน RTC ใกล้หมด)
// ไม่ใช่ข้อมูลปลอม — เป็นการสแกนจริงที่ติดปีผิดมาเท่านั้น จึงไม่ลบทิ้งจากเครื่อง
export function isFutureRow(record, now) {
  return record.scannedAt > now;
}

// เลือกเฉพาะแถวที่ยังไม่ได้ส่ง แล้วเรียงจากเก่าไปใหม่
//
// เทียบ cursor แบบ >= ไม่ใช่ > เพราะพนักงานหลายคนสแกนในวินาทีเดียวกันได้:
// ถ้าใช้ > แถวที่เวลาชนกับ cursor พอดีจะหายถาวรโดยไม่มีใครรู้
// ยอมส่งซ้ำแถวขอบแล้วให้ unique constraint ฝั่ง Supabase กันซ้ำ ซึ่งถูกกว่าข้อมูลหาย
//
// ส่วนแถวเวลาอนาคตต้องกันออกตรงนี้ เพราะ runSync ขยับ cursor ตามแถวสุดท้ายของชุดที่เรียงแล้ว
// ถ้าปล่อยผ่าน cursor จะกระโดดไปปีนั้นแล้วรอบถัดไปทุกรอบจะกรองข้อมูลจริงทิ้งหมด
// ข้อมูลไม่ได้หายจากเครื่อง แต่จะไม่มีวันถูกส่งอีกเลยและไม่มี error ให้เห็น
export function selectNewRows(records, { cursor, startDate, now = new Date() }) {
  const cursorAt = parseThaiStamp(cursor);
  const startAt = parseThaiStamp(startDate);

  return records
    .filter((r) => {
      if (isFutureRow(r, now)) return false;
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

  const state = readState(statePath);

  let records;
  try {
    // บอกจุดเริ่มไปด้วย เพื่อให้แหล่งที่กรองได้ (ฐาน ZKBioTime) ไม่ต้องส่งข้อมูลเก่ามาทั้งหมดทุกรอบ
    // แหล่งที่กรองไม่ได้ (เครื่องสแกน) จะเมินค่านี้แล้วให้ selectNewRows กรองในหน่วยความจำเหมือนเดิม
    records = await readAttendance({ since: state.last_scan_at || config.sync.startDate });
  } catch (e) {
    // แหล่งข้อมูลออฟไลน์เป็นเรื่องปกติ ไม่ใช่เหตุให้ service ตาย — cursor ไม่ขยับ รอบหน้าลองใหม่
    logger.err(`อ่านข้อมูลสแกนไม่ได้ (${e.message}) — จะลองใหม่รอบหน้า`);
    writeState(statePath, { last_run_at: toThaiStamp(started), last_result: "error", last_error: e.message });
    return { read: 0, selected: 0, pushed: 0, ok: false };
  }

  const fresh = selectNewRows(records, {
    cursor: state.last_scan_at,
    startDate: config.sync.startDate,
    now: started,
  });
  logger.info(`อ่าน log ได้ ${records.length.toLocaleString()} แถว`);

  // ต้องบอกให้เห็นในรายงาน ไม่ใช่ข้ามเงียบ ๆ — เป็นอาการนาฬิกาที่ต้องให้ช่างไปเปลี่ยนถ่าน
  const future = records.filter((r) => isFutureRow(r, started)).length;
  if (future > 0) {
    logger.err(
      `ข้าม ${future.toLocaleString()} แถวที่เวลาอยู่ในอนาคต — นาฬิกาเครื่องสแกนเพี้ยน ` +
        "(ข้อมูลยังอยู่ในเครื่องครบ ไม่ได้ถูกลบ) ให้ช่างตรวจถ่านนาฬิกาของเครื่อง",
    );
  }

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
