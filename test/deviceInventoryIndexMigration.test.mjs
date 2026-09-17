import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260817172345_add_device_inventory_snapshot_fk_index.sql",
  import.meta.url,
);

test("foreign key ไป snapshot มี covering index", async () => {
  const text = await readFile(migrationUrl, "utf8");
  assert.match(
    text,
    /create index if not exists device_employee_inventory_last_snapshot_idx[\s\S]*?\(last_snapshot_id\)/i,
  );
});
