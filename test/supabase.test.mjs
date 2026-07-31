import { test } from "node:test";
import assert from "node:assert/strict";
import { toPayload, pushRows } from "../src/supabase.mjs";

const branch = { code: "Store 1", machineCode: "FP-01" };
const record = {
  employeeCode: "001",
  employeeName: "สมชาย",
  scannedAt: new Date(2026, 6, 27, 9, 18, 22),
};

// client ปลอมที่บันทึกว่าถูกเรียกด้วยอะไรบ้าง
function fakeClient(respond) {
  const calls = [];
  return {
    calls,
    from() {
      return {
        upsert(rows, options) {
          calls.push({ rows, options });
          return Promise.resolve(respond(calls.length));
        },
      };
    },
  };
}

test("payload ตรงกับ schema ฝั่ง Supabase", () => {
  assert.deepEqual(toPayload([record], branch)[0], {
    branch: "Store 1",
    employee_code: "001",
    employee_name: "สมชาย",
    scan_date: "2026-07-27",
    scan_time: "09:18:22",
    source: "k50id",
    source_machine: "FP-01",
  });
});

test("Store 2 ใช้ payload และ natural key ชุดเดียวกับ Store 1", () => {
  assert.deepEqual(toPayload([record], { code: "Store 2", machineCode: "Jaybon02" })[0], {
    branch: "Store 2",
    employee_code: "001",
    employee_name: "สมชาย",
    scan_date: "2026-07-27",
    scan_time: "09:18:22",
    source: "k50id",
    source_machine: "Jaybon02",
  });
});

test("ไม่มีชื่อพนักงาน → ส่ง null ไม่ใช่สตริงว่าง", () => {
  const rows = toPayload([{ ...record, employeeName: "" }], branch);
  assert.equal(rows[0].employee_name, null);
});

test("upsert ต้องใช้ natural key และเปิด ignoreDuplicates", () => {
  const client = fakeClient(() => ({ error: null }));
  return pushRows(client, toPayload([record], branch), { delays: [0, 0, 0] }).then(() => {
    assert.equal(client.calls[0].options.onConflict, "branch,employee_code,scan_date,scan_time");
    assert.equal(client.calls[0].options.ignoreDuplicates, true);
  });
});

test("ไม่มีแถวให้ส่ง → ไม่เรียก Supabase เลย", async () => {
  const client = fakeClient(() => ({ error: null }));
  const res = await pushRows(client, [], { delays: [0, 0, 0] });
  assert.equal(res.pushed, 0);
  assert.equal(client.calls.length, 0);
});

test("retry แล้วสำเร็จในครั้งที่ 3", async () => {
  const client = fakeClient((n) => (n < 3 ? { error: { message: "เน็ตหลุด" } } : { error: null }));
  const res = await pushRows(client, toPayload([record], branch), { delays: [0, 0, 0] });
  assert.equal(client.calls.length, 3);
  assert.equal(res.pushed, 1);
});

test("ล้มครบ 3 ครั้ง → throw เพื่อให้ cursor ไม่ขยับ", async () => {
  const client = fakeClient(() => ({ error: { message: "Supabase ล่ม" } }));
  await assert.rejects(
    () => pushRows(client, toPayload([record], branch), { delays: [0, 0, 0] }),
    /Supabase ล่ม/,
  );
  assert.equal(client.calls.length, 3);
});
