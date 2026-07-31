import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.mjs";

function makeRoot(ini, env) {
  const dir = mkdtempSync(path.join(tmpdir(), "hrscan-cfg-"));
  if (ini !== undefined) writeFileSync(path.join(dir, "config.ini"), ini, "utf8");
  if (env !== undefined) writeFileSync(path.join(dir, ".env"), env, "utf8");
  return dir;
}

test("อ่านค่าจาก config.ini ครบทุกหมวด", () => {
  const root = makeRoot(`
[branch]
code = Store 3
machine_code = FP-03

[device]
ip = 10.0.0.5
port = 4370
timeout_ms = 8000
udp_local_port = 4001

[sync]
interval_minutes = 10
start_date = 2026-02-01
batch_size = 250

[log]
keep_days = 14
`);
  const cfg = loadConfig(root);
  assert.equal(cfg.branch.code, "Store 3");
  assert.equal(cfg.branch.machineCode, "FP-03");
  assert.equal(cfg.device.ip, "10.0.0.5");
  assert.equal(cfg.sync.startDate, "2026-02-01");
  assert.equal(cfg.log.keepDays, 14);
});

test("ค่าตัวเลขต้องเป็น number ไม่ใช่ string", () => {
  const cfg = loadConfig(makeRoot("[device]\nport = 4370\n[sync]\nbatch_size = 500\n"));
  assert.equal(typeof cfg.device.port, "number");
  assert.equal(typeof cfg.sync.batchSize, "number");
});

test("ไม่มี config.ini → ใช้ค่าเริ่มต้น ไม่ throw", () => {
  const cfg = loadConfig(makeRoot(undefined));
  assert.equal(cfg.device.port, 4370);
  assert.equal(cfg.sync.intervalMinutes, 5);
  assert.equal(cfg.log.keepDays, 30);
});

test("ข้ามบรรทัด comment และบรรทัดว่าง", () => {
  const cfg = loadConfig(makeRoot("; หมายเหตุ\n# อีกแบบ\n\n[branch]\ncode = Store 9\n"));
  assert.equal(cfg.branch.code, "Store 9");
});

test("ค่าที่มีเว้นวรรครอบ = ต้องถูก trim", () => {
  const cfg = loadConfig(makeRoot("[branch]\n   code   =   Store 2   \n"));
  assert.equal(cfg.branch.code, "Store 2");
});

test("อ่าน SUPABASE_URL / SUPABASE_SERVICE_KEY จาก .env", () => {
  const cfg = loadConfig(makeRoot("", "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_KEY=abc123\n"));
  assert.equal(cfg.supabase.url, "https://x.supabase.co");
  assert.equal(cfg.supabase.serviceKey, "abc123");
});

test(".env รองรับ comment และค่าที่มีเครื่องหมาย = อยู่ข้างใน", () => {
  const cfg = loadConfig(makeRoot("", "# comment\nSUPABASE_SERVICE_KEY=ab=cd=ef\n"));
  assert.equal(cfg.supabase.serviceKey, "ab=cd=ef");
});

test("ไม่มี .env → คืนค่าว่าง ไม่ throw", () => {
  const cfg = loadConfig(makeRoot("[branch]\ncode = Store 1\n"));
  assert.equal(cfg.supabase.url, "");
  assert.equal(cfg.supabase.serviceKey, "");
});

test("ไม่ระบุชนิดแหล่งข้อมูล → ต่อเครื่องสแกนตรงเหมือนเดิม", () => {
  // สาขาที่ติดตั้งไปแล้วต้องทำงานต่อได้โดยไม่ต้องแก้ config.ini
  assert.equal(loadConfig(makeRoot("[branch]\ncode = Store 1\n")).source.type, "device");
});

test("อ่านค่าหมวด biotime ครบ", () => {
  const cfg = loadConfig(
    makeRoot(`
[source]
type = biotime

[biotime]
psql_path  = C:\\ZKBioTime\\pgsql\\bin\\psql.exe
host       = 127.0.0.1
port       = 7496
database   = biotime
user       = postgres
timeout_ms = 20000
`),
  );
  assert.equal(cfg.source.type, "biotime");
  assert.equal(cfg.biotime.database, "biotime");
  assert.equal(cfg.biotime.port, 7496);
  assert.equal(typeof cfg.biotime.timeoutMs, "number");
});

test("ชนิดแหล่งข้อมูลไม่สนตัวพิมพ์เล็กใหญ่", () => {
  assert.equal(loadConfig(makeRoot("[source]\ntype = BioTime\n")).source.type, "biotime");
});

test("ค่าเริ่มต้นของ biotime ตรงกับที่ ZKBioTime ติดตั้งมา", () => {
  const cfg = loadConfig(makeRoot("[source]\ntype = biotime\n"));
  assert.equal(cfg.biotime.host, "127.0.0.1");
  assert.equal(cfg.biotime.port, 7496);
  assert.equal(cfg.biotime.user, "postgres");
  assert.match(cfg.biotime.psqlPath, /psql\.exe$/);
});

test("รหัสผ่าน biotime อ่านจาก .env เท่านั้น ไม่เก็บใน config.ini", () => {
  const cfg = loadConfig(makeRoot("[source]\ntype = biotime\n", "BIOTIME_PASSWORD=s3cret\n"));
  assert.equal(cfg.biotime.password, "s3cret");
});

test("Store 2 บังคับอ่านจากเครื่องโดยตรงแม้ config เก่าเคยตั้ง biotime", () => {
  const cfg = loadConfig(makeRoot("[branch]\ncode = Store 2\n[source]\ntype = biotime\n"));
  assert.equal(cfg.source.type, "device");
});

test("Store 2 ใช้ IP เครื่อง Jaybon02 โดยไม่กระทบ Store 1", () => {
  const store2 = loadConfig(makeRoot("[branch]\ncode = Store 2\n[device]\nip = 192.168.88.175\ntimeout_ms = 10000\n"));
  const store1 = loadConfig(makeRoot("[branch]\ncode = Store 1\n[device]\nip = 192.168.88.175\ntimeout_ms = 10000\n"));
  assert.equal(store2.device.ip, "192.168.1.69");
  assert.equal(store2.device.timeoutMs, 120000);
  assert.equal(store2.device.attendancePacketSize, 49);
  assert.equal(store1.device.ip, "192.168.88.175");
  assert.equal(store1.device.timeoutMs, 10000);
  assert.equal(store1.device.attendancePacketSize, undefined);
});
