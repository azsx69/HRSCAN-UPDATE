import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimEmployeeImports,
  completeEmployeeImport,
  failEmployeeImport,
  renewEmployeeImportLease,
  runEmployeeImportQueue,
} from "../src/employeeImport.mjs";

test("claim queue ส่ง branch canonical และ claim ครั้งละหนึ่งงาน", async () => {
  const calls = [];
  const client = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: [{ id: "job-1", claim_token: "token-1" }], error: null };
    },
  };
  const rows = await claimEmployeeImports(client, { branch: "store 2", workerId: "jaybon02", limit: 99 });
  assert.equal(rows.length, 1);
  assert.deepEqual(calls[0], {
    name: "claim_device_employee_import_jobs",
    params: { p_branch: "Store 2", p_worker_id: "jaybon02", p_limit: 1 },
  });
});

test("complete/fail ใช้ claim token ผ่าน RPC ไม่ update table โดยตรง", async () => {
  const calls = [];
  const client = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: true, error: null };
    },
  };
  await completeEmployeeImport(client, { id: "11111111-1111-1111-1111-111111111111", claimToken: "22222222-2222-2222-2222-222222222222", deviceUid: 2 });
  await failEmployeeImport(client, { id: "11111111-1111-1111-1111-111111111111", claimToken: "22222222-2222-2222-2222-222222222222", error: "offline" });
  assert.equal(calls[0].name, "complete_device_employee_import_job");
  assert.equal(calls[0].params.p_claim_token, "22222222-2222-2222-2222-222222222222");
  assert.equal(calls[1].name, "fail_device_employee_import_job");
});

test("renew lease ใช้ claim token ผ่าน RPC", async () => {
  const calls = [];
  const client = { rpc: async (name, params) => { calls.push({ name, params }); return { data: true, error: null }; } };
  await renewEmployeeImportLease(client, {
    id: "11111111-1111-1111-1111-111111111111",
    claimToken: "22222222-2222-2222-2222-222222222222",
  });
  assert.deepEqual(calls[0], {
    name: "renew_device_employee_import_lease",
    params: {
      p_id: "11111111-1111-1111-1111-111111111111",
      p_claim_token: "22222222-2222-2222-2222-222222222222",
    },
  });
});

test("งานที่นานกว่า heartbeat ต้องต่อ lease ก่อนเสร็จ", async () => {
  let renewals = 0;
  let claimed = false;
  const result = await runEmployeeImportQueue({
    client: {}, branch: "Store 2", workerId: "jaybon02", limit: 1, heartbeatMs: 5,
    claimJobs: async () => {
      if (claimed) return [];
      claimed = true;
      return [{ id: "slow", claim_token: "tslow", employee_code: "888" }];
    },
    importEmployee: async () => { await new Promise((resolve) => setTimeout(resolve, 25)); return { deviceUid: 2 }; },
    renewLease: async (_client, payload) => {
      assert.equal(payload.claimToken, "tslow");
      renewals++;
    },
    completeJob: async () => {},
    failJob: async () => assert.fail(),
  });
  assert.equal(result.completed, 1);
  assert.ok(renewals >= 2, `expected >=2 lease renewals, got ${renewals}`);
});

test("RPC ปฏิเสธ ownership ต้อง throw", async () => {
  const client = { rpc: async () => ({ data: null, error: { message: "claim token mismatch" } }) };
  await assert.rejects(
    () => completeEmployeeImport(client, { id: "x", claimToken: "stale", deviceUid: 2 }),
    /claim token mismatch/,
  );
});

test("worker claim ทีละหนึ่ง ทำเสร็จแล้วจึง claim งานถัดไป", async () => {
  const events = [];
  const queue = [
    { id: "a", claim_token: "ta", employee_code: "888" },
    { id: "b", claim_token: "tb", employee_code: "889" },
  ];
  const result = await runEmployeeImportQueue({
    client: {}, branch: "store 2", workerId: "jaybon02", limit: 10,
    claimJobs: async (_client, options) => {
      events.push(`claim:${options.limit}`);
      return queue.length ? [queue.shift()] : [];
    },
    importEmployee: async (job) => { events.push(`write:${job.id}`); return { deviceUid: job.id === "a" ? 2 : 3 }; },
    completeJob: async (_client, payload) => { events.push(`complete:${payload.id}:${payload.claimToken}`); },
    failJob: async () => assert.fail(),
  });
  assert.deepEqual(result, { claimed: 2, completed: 2, failed: 0 });
  assert.deepEqual(events, [
    "claim:1", "write:a", "complete:a:ta",
    "claim:1", "write:b", "complete:b:tb",
    "claim:1",
  ]);
});

test("device write ล้มเหลวจึงเรียก fail ด้วย claim token แล้วค่อย claim งานต่อไป", async () => {
  const queue = [
    { id: "bad", claim_token: "tbad", employee_code: "888" },
    { id: "good", claim_token: "tgood", employee_code: "889" },
  ];
  const failed = [];
  const completed = [];
  const result = await runEmployeeImportQueue({
    client: {}, branch: "Store 2", workerId: "jaybon02", limit: 2,
    claimJobs: async () => queue.length ? [queue.shift()] : [],
    importEmployee: async (job) => {
      if (job.id === "bad") throw new Error("เครื่องออฟไลน์");
      return { deviceUid: 3 };
    },
    completeJob: async (_client, payload) => completed.push(payload),
    failJob: async (_client, payload) => failed.push(payload),
  });
  assert.deepEqual(result, { claimed: 2, completed: 1, failed: 1 });
  assert.equal(failed[0].claimToken, "tbad");
  assert.equal(completed[0].claimToken, "tgood");
});

test("complete RPC ล้มหลังเขียนเครื่องสำเร็จ ห้ามเปลี่ยนเป็น fail", async () => {
  let failed = false;
  await assert.rejects(
    () => runEmployeeImportQueue({
      client: {}, branch: "Store 2", workerId: "jaybon02", limit: 1,
      claimJobs: async () => [{ id: "a", claim_token: "ta", employee_code: "888" }],
      importEmployee: async () => ({ deviceUid: 2 }),
      completeJob: async () => { throw new Error("Supabase down"); },
      failJob: async () => { failed = true; },
    }),
    /Supabase down/,
  );
  assert.equal(failed, false);
});

test("สาขาอื่นไม่ claim งาน Store 2", async () => {
  let called = false;
  const result = await runEmployeeImportQueue({
    client: {}, branch: "Store 1", workerId: "fp-01", limit: 10,
    claimJobs: async () => { called = true; return []; },
  });
  assert.equal(called, false);
  assert.deepEqual(result, { claimed: 0, completed: 0, failed: 0 });
});
