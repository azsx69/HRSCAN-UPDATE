// อ่าน config.ini (ค่าตั้งต่อสาขา) + .env (ความลับ) — รูปแบบเดียวกับที่ใช้ในระบบ HR
// อ่าน .env เองแทนที่จะพึ่ง --env-file เพราะ NSSM เรียก node.exe ตรง ๆ ส่งแฟล็กเพิ่มไม่ได้สะดวก
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseIni(content) {
  const data = {};
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      data[section] ??= {};
      continue;
    }
    const i = line.indexOf("=");
    if (i === -1 || !section) continue;
    data[section][line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return data;
}

function parseEnv(content) {
  const data = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    // ตัดที่ = ตัวแรกเท่านั้น — service key มี = อยู่ข้างในได้
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return data;
}

function readIfExists(file, parse) {
  return existsSync(file) ? parse(readFileSync(file, "utf8")) : {};
}

export function loadConfig(root = process.cwd()) {
  const ini = readIfExists(path.join(root, "config.ini"), parseIni);
  const env = readIfExists(path.join(root, ".env"), parseEnv);

  const cfg = (section, key, fallback = "") => ini[section]?.[key] ?? fallback;
  const num = (section, key, fallback) => Number(cfg(section, key, "")) || fallback;

  return {
    root,
    branch: {
      code: cfg("branch", "code", "Store 1"),
      machineCode: cfg("branch", "machine_code", ""),
    },
    // แหล่งข้อมูลสแกน: "device" = ต่อเครื่อง ZKTeco ตรง, "biotime" = อ่านจากฐานของ ZKBioTime ในเครื่อง
    // ไม่ระบุ = device เพื่อให้สาขาที่ติดตั้งไปแล้วทำงานต่อได้โดยไม่ต้องแก้ config.ini
    source: {
      type: cfg("source", "type", "device").toLowerCase(),
    },
    device: {
      ip: cfg("device", "ip", "192.168.88.175"),
      port: num("device", "port", 4370),
      timeoutMs: num("device", "timeout_ms", 10000),
      udpLocalPort: num("device", "udp_local_port", 4000),
    },
    biotime: {
      psqlPath: cfg("biotime", "psql_path", "C:\\ZKBioTime\\pgsql\\bin\\psql.exe"),
      host: cfg("biotime", "host", "127.0.0.1"),
      port: num("biotime", "port", 7496),
      database: cfg("biotime", "database", "biotime"),
      user: cfg("biotime", "user", "postgres"),
      timeoutMs: num("biotime", "timeout_ms", 30000),
      // ปกติ ZKBioTime ตั้งให้ต่อจากในเครื่องได้โดยไม่ต้องใช้รหัสผ่าน — ใส่เฉพาะเครื่องที่ตั้งไว้ต่างไป
      password: env.BIOTIME_PASSWORD ?? "",
    },
    sync: {
      intervalMinutes: num("sync", "interval_minutes", 5),
      startDate: cfg("sync", "start_date", ""),
      batchSize: num("sync", "batch_size", 500),
    },
    log: {
      keepDays: num("log", "keep_days", 30),
    },
    supabase: {
      url: env.SUPABASE_URL ?? "",
      serviceKey: env.SUPABASE_SERVICE_KEY ?? "",
    },
  };
}
