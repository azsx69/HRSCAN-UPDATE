// เขียนค่าลง config.ini หรือ .env โดยรักษาคอมเมนต์และลำดับบรรทัดเดิมไว้
//   node install/patch-config.mjs config.ini "branch.code=Store 1" "device.ip=10.0.0.5"
//   node install/patch-config.mjs --env .env "SUPABASE_URL=https://x.supabase.co"
// ใช้จาก bootstrap.bat — เขียนด้วย Node เพราะ batch แก้ไฟล์ทีละบรรทัดแล้วภาษาไทยเพี้ยนง่าย
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const isEnv = args[0] === "--env";
const file = isEnv ? args[1] : args[0];
const pairs = args.slice(isEnv ? 2 : 1);

if (!file || pairs.length === 0) {
  console.error("usage: patch-config.mjs [--env] <file> \"section.key=value\" ...");
  process.exit(1);
}

const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];

function setEnv(key, value) {
  const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (i === -1) lines.push(`${key}=${value}`);
  else lines[i] = `${key}=${value}`;
}

function setIni(section, key, value) {
  let start = lines.findIndex((l) => l.trim().toLowerCase() === `[${section.toLowerCase()}]`);
  if (start === -1) {
    if (lines.length && lines.at(-1).trim() !== "") lines.push("");
    lines.push(`[${section}]`, `${key} = ${value}`);
    return;
  }
  // หาขอบเขตของ section นี้ (จนกว่าจะเจอ [section] ถัดไป)
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.+]\s*$/.test(lines[i])) { end = i; break; }
  }
  for (let i = start + 1; i < end; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq !== -1 && line.slice(0, eq).trim().toLowerCase() === key.toLowerCase()) {
      lines[i] = `${key} = ${value}`;
      return;
    }
  }
  // ไม่มีคีย์นี้ใน section — แทรกท้าย section โดยข้ามบรรทัดว่างท้าย
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, `${key} = ${value}`);
}

for (const pair of pairs) {
  const eq = pair.indexOf("=");
  if (eq === -1) continue;
  const rawKey = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (isEnv) {
    setEnv(rawKey, value);
    continue;
  }
  const dot = rawKey.indexOf(".");
  if (dot === -1) continue;
  setIni(rawKey.slice(0, dot), rawKey.slice(dot + 1), value);
}

writeFileSync(file, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
console.log(`[OK] เขียน ${file} แล้ว`);
