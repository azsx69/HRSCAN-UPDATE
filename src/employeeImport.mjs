// Queue Supabase -> employee profile บนเครื่องสแกน Store 2
// Claim ทีละงานและใช้ UUID claim token เพื่อกัน stale worker ปิดงานของ worker ใหม่
import { importEmployeeToDevice } from "./deviceUsers.mjs";

const CLAIM_RPC = "claim_device_employee_import_jobs";
const COMPLETE_RPC = "complete_device_employee_import_job";
const FAIL_RPC = "fail_device_employee_import_job";
const RENEW_RPC = "renew_device_employee_import_lease";

export async function claimEmployeeImports(client, { branch, workerId }) {
  if (String(branch).trim().toLowerCase() !== "store 2") return [];
  const { data, error } = await client.rpc(CLAIM_RPC, {
    p_branch: "Store 2",
    p_worker_id: workerId,
    p_limit: 1,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function completeEmployeeImport(client, { id, claimToken, deviceUid }) {
  const { data, error } = await client.rpc(COMPLETE_RPC, {
    p_id: id,
    p_claim_token: claimToken,
    p_device_uid: deviceUid,
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("complete RPC ไม่ได้ยืนยัน ownership ของ job");
}

export async function renewEmployeeImportLease(client, { id, claimToken }) {
  const { data, error } = await client.rpc(RENEW_RPC, {
    p_id: id,
    p_claim_token: claimToken,
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("renew RPC ไม่ได้ยืนยัน ownership ของ job");
}

export async function failEmployeeImport(client, { id, claimToken, error: message }) {
  const { data, error } = await client.rpc(FAIL_RPC, {
    p_id: id,
    p_claim_token: claimToken,
    p_error: String(message).slice(0, 2000),
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("fail RPC ไม่ได้ยืนยัน ownership ของ job");
}

export async function runEmployeeImportQueue({
  client,
  branch,
  workerId,
  limit = 10,
  heartbeatMs = 60_000,
  device,
  logger,
  claimJobs = claimEmployeeImports,
  importEmployee = (job) => importEmployeeToDevice(device, job),
  renewLease = renewEmployeeImportLease,
  completeJob = completeEmployeeImport,
  failJob = failEmployeeImport,
}) {
  if (String(branch).trim().toLowerCase() !== "store 2") {
    return { claimed: 0, completed: 0, failed: 0 };
  }

  const maxJobs = Math.max(1, Math.min(Number(limit) || 1, 100));
  let claimed = 0;
  let completed = 0;
  let failed = 0;

  for (let index = 0; index < maxJobs; index++) {
    const jobs = await claimJobs(client, { branch: "Store 2", workerId, limit: 1 });
    const job = jobs[0];
    if (!job) break;
    claimed++;

    let result;
    let deviceError = null;
    let heartbeatError = null;
    let renewalChain = Promise.resolve();
    const renewNow = async () => {
      try {
        await renewLease(client, { id: job.id, claimToken: job.claim_token });
        heartbeatError = null;
      } catch (e) {
        heartbeatError = e;
        logger?.err?.(`ต่อ lease งาน ${job.id} ไม่สำเร็จ: ${e.message}`);
      }
    };
    const timer = setInterval(() => {
      renewalChain = renewalChain.then(renewNow);
    }, Math.max(1, Number(heartbeatMs) || 60_000));
    timer.unref?.();

    try {
      result = await importEmployee(job);
    } catch (e) {
      deviceError = e;
    } finally {
      clearInterval(timer);
      await renewalChain;
    }

    if (deviceError) {
      failed++;
      logger?.err?.(`นำเข้าพนักงาน ${job.employee_code} ไม่สำเร็จ: ${deviceError.message}`);
      await failJob(client, {
        id: job.id,
        claimToken: job.claim_token,
        error: deviceError.message,
      });
      continue;
    }
    if (heartbeatError) {
      // เครื่องอาจเขียนสำเร็จแล้ว จึงห้ามเรียก fail; ปล่อยให้ token/lease fencing reconcile รอบถัดไป
      throw new Error(`เขียนเครื่องสำเร็จแต่ยืนยัน lease ไม่ได้: ${heartbeatError.message}`);
    }

    // แยก queue finalization ออกจาก device write: ถ้า complete ล้ม ห้ามเปลี่ยนงานที่เขียนแล้วเป็น retry เอง
    await completeJob(client, {
      id: job.id,
      claimToken: job.claim_token,
      deviceUid: result.deviceUid,
    });
    completed++;
    logger?.ok?.(`นำเข้าพนักงาน ${job.employee_code} สำเร็จ (UID ${result.deviceUid})`);
  }

  return { claimed, completed, failed };
}
