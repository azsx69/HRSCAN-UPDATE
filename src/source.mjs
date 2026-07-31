// เลือกแหล่งข้อมูลสแกนตาม [source] type แล้วผูกค่าตั้งของแหล่งนั้นไว้ให้เรียบร้อย
// ส่วนที่เหลือของระบบ (sync, cursor, การ push) จึงไม่ต้องรู้ว่าข้อมูลมาจากทางไหน
// เพราะทั้งสองแหล่งคืน record หน้าตาเดียวกัน: { employeeCode, employeeName, scannedAt }
import { readAttendance as readFromDevice, testDevice } from "./device.mjs";
import { readAttendance as readFromBiotime, testSource as testBiotime } from "./biotime.mjs";

export function isBiotime(config) {
  return config.source?.type === "biotime";
}

export function createReader(config) {
  return isBiotime(config)
    ? (options) => readFromBiotime(config.biotime, options)
    : (options) => readFromDevice(config.device, options);
}

export function createTester(config) {
  return isBiotime(config) ? () => testBiotime(config.biotime) : () => testDevice(config.device);
}

export function describeSource(config) {
  const b = config.biotime;
  return isBiotime(config)
    ? `ZKBioTime ${b.host}:${b.port}/${b.database}`
    : `เครื่องสแกน ${config.device.ip}:${config.device.port}`;
}
