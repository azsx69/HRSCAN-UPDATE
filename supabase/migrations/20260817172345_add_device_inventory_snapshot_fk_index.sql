-- Cover the inventory -> snapshot foreign key for efficient parent checks and joins.
create index if not exists device_employee_inventory_last_snapshot_idx
  on public.device_employee_inventory (last_snapshot_id);
