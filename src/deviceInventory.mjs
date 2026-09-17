// Phase 1: อ่านรายชื่อผู้ใช้ทั้งหมดจากเครื่องแล้วเก็บ inventory บน Supabase
// ไม่เขียน แก้ไข หรือลบข้อมูลใด ๆ บนเครื่องสแกน
import ZKLib from "node-zklib";
import { getUsersThai } from "./device.mjs";
import { parseThaiStamp } from "./thaiTime.mjs";

const SYNC_RPC = "sync_device_employee_inventory";

export function normalizeInventoryUsers(users) {
  if (!Array.isArray(users)) throw new TypeError("รายชื่อผู้ใช้จากเครื่องต้องเป็น array");
  const seenUids = new Set();
  return users.map((user) => {
    const deviceUid = Number(user?.uid);
    const employeeCode = String(user?.userId ?? "").trim();
    const deviceName = String(user?.name ?? "").trim();
    const cardNumber = Number(user?.card ?? 0);
    const privilege = Number(user?.privilege ?? 0);

    if (!Number.isInteger(deviceUid) || deviceUid < 1 || deviceUid > 65535) {
      throw new Error(`UID จากเครื่องไม่ถูกต้อง (${user?.uid ?? "ว่าง"})`);
    }
    if (seenUids.has(deviceUid)) throw new Error(`พบ UID ${deviceUid} ซ้ำใน snapshot เดียวกัน`);
    seenUids.add(deviceUid);
    if (!employeeCode || employeeCode.length > 24) {
      throw new Error(`รหัสพนักงานของ UID ${deviceUid} ไม่ถูกต้อง`);
    }
    if (!Number.isSafeInteger(cardNumber) || cardNumber < 0 || cardNumber > 0xffffffff) {
      throw new Error(`เลขบัตรของ UID ${deviceUid} ไม่ถูกต้อง`);
    }
    if (!Number.isInteger(privilege) || privilege < 0 || privilege > 255) {
      throw new Error(`privilege ของ UID ${deviceUid} ไม่ถูกต้อง`);
    }
    return {
      device_uid: deviceUid,
      employee_code: employeeCode,
      device_name: deviceName,
      card_number: cardNumber,
      privilege,
    };
  });
}

export async function readDeviceInventory(device, { createZk } = {}) {
  const zk = createZk
    ? createZk(device)
    : new ZKLib(device.ip, device.port, device.timeoutMs, device.udpLocalPort);
  try {
    await zk.createSocket();
    if (zk.connectionType !== "tcp") {
      throw new Error("การอ่าน inventory ต้องเชื่อมต่อเครื่องผ่าน TCP เท่านั้น; ปฏิเสธ UDP fallback");
    }
    return await getUsersThai(zk);
  } finally {
    try { await zk.disconnect(); } catch {}
  }
}

export function isInventoryDue(lastAttemptAt, intervalMinutes, now = new Date()) {
  const last = parseThaiStamp(lastAttemptAt);
  if (!last) return true;
  const intervalMs = Math.max(1, Number(intervalMinutes) || 60) * 60_000;
  return now.getTime() - last.getTime() >= intervalMs;
}

export async function syncDeviceInventory({
  client,
  branch,
  machineCode,
  device,
  logger,
  readUsers = readDeviceInventory,
}) {
  const users = normalizeInventoryUsers(await readUsers(device));
  const { data, error } = await client.rpc(SYNC_RPC, {
    p_branch: branch,
    p_source_machine: machineCode || null,
    p_users: users,
  });
  if (error) throw new Error(error.message);
  const summary = Array.isArray(data) ? data[0] : data;
  if (!summary || summary.snapshot_id === undefined) {
    throw new Error("Supabase ไม่คืนผลยืนยัน inventory snapshot");
  }
  const result = {
    read: users.length,
    snapshotId: Number(summary.snapshot_id),
    observedAt: summary.observed_at,
    present: Number(summary.present_count),
    missing: Number(summary.missing_count),
  };
  logger?.ok?.(
    `inventory เครื่อง: พบ ${result.present.toLocaleString()} · ไม่อยู่ในเครื่อง ${result.missing.toLocaleString()} ` +
      `(snapshot ${result.snapshotId})`,
  );
  return result;
}
