// แปลงเวลาเป็นข้อความ "เวลาไทย" — ทั้งระบบ (เครื่องสแกน -> Supabase -> HR) เก็บเป็นเวลาไทยตรงกันหมด
//
// ห้ามใช้ toISOString() กับเวลาสแกนเด็ดขาด เพราะจะแปลงเป็น UTC แล้วเวลาเพี้ยนไป 7 ชั่วโมง
// ที่ร้ายกว่านั้นคือแถวที่สแกนก่อน 07:00 จะถูกบันทึกเป็นวันก่อนหน้า ซึ่งเป็นความผิดที่มองไม่เห็น
// จากยอดรวม จึงต้องอ่านค่าจาก getFullYear/getMonth/getDate/... ซึ่งให้เวลาตามเครื่องเสมอ

const pad = (n, width = 2) => String(n).padStart(width, "0");

export function toThaiParts(date) {
  return {
    scanDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    scanTime: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  };
}

export function toThaiStamp(date) {
  const { scanDate, scanTime } = toThaiParts(date);
  return `${scanDate} ${scanTime}`;
}

// รับได้ทั้ง "YYYY-MM-DD HH:MM:SS" (cursor) และ "YYYY-MM-DD" (start_date ใน config)
// สร้าง Date ด้วย constructor แบบแยกส่วน ไม่ใช่ new Date(string) เพราะรูปแบบวันที่ล้วน
// จะถูกตีความเป็น UTC ตามสเปกของ JS แล้ววันเลื่อน
export function parseThaiStamp(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}
