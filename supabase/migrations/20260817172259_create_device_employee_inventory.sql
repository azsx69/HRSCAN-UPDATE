-- Phase 1: read-only inventory of employee profiles found on each ZKTeco terminal.
-- A complete snapshot is committed atomically; partial device reads never mark users missing.

create table if not exists public.device_employee_inventory_snapshots (
  id bigint generated always as identity primary key,
  branch text not null
    check (branch in ('Store 1', 'Store 2', 'Store 3', 'Store 4', 'Store 5')),
  source_machine text,
  observed_at timestamptz not null default now(),
  user_count integer not null check (user_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.device_employee_inventory (
  branch text not null
    check (branch in ('Store 1', 'Store 2', 'Store 3', 'Store 4', 'Store 5')),
  device_uid integer not null check (device_uid between 1 and 65535),
  employee_code text not null check (char_length(employee_code) between 1 and 24),
  device_name text not null default '',
  card_number bigint not null default 0 check (card_number between 0 and 4294967295),
  privilege smallint not null default 0 check (privilege between 0 and 255),
  source_machine text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_snapshot_id bigint not null
    references public.device_employee_inventory_snapshots(id),
  present boolean not null default true,
  missing_since timestamptz,
  updated_at timestamptz not null default now(),
  primary key (branch, device_uid),
  check ((present and missing_since is null) or (not present and missing_since is not null))
);

create index if not exists device_employee_inventory_snapshots_branch_observed_idx
  on public.device_employee_inventory_snapshots (branch, observed_at desc);
create index if not exists device_employee_inventory_branch_code_idx
  on public.device_employee_inventory (branch, employee_code);
create index if not exists device_employee_inventory_missing_idx
  on public.device_employee_inventory (branch, missing_since)
  where present = false;

create or replace function public.sync_device_employee_inventory(
  p_branch text,
  p_source_machine text,
  p_users jsonb
)
returns table (
  snapshot_id bigint,
  observed_at timestamptz,
  present_count integer,
  missing_count integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_branch text;
  v_snapshot_id bigint;
  v_observed_at timestamptz := clock_timestamp();
  v_present_count integer;
  v_missing_count integer;
begin
  v_branch := regexp_replace(trim(coalesce(p_branch, '')), '\s+', ' ', 'g');
  if lower(v_branch) ~ '^store [1-5]$' then
    v_branch := 'Store ' || right(v_branch, 1);
  end if;
  if v_branch not in ('Store 1', 'Store 2', 'Store 3', 'Store 4', 'Store 5') then
    raise exception 'unsupported branch %', p_branch;
  end if;
  if p_users is null or jsonb_typeof(p_users) <> 'array' then
    raise exception 'p_users must be a JSON array';
  end if;
  if jsonb_array_length(p_users) > 10000 then
    raise exception 'inventory snapshot is too large';
  end if;

  -- Validate before creating the snapshot so a malformed/partial payload changes nothing.
  if exists (
    select 1
      from jsonb_to_recordset(p_users) as u(
        device_uid integer,
        employee_code text,
        device_name text,
        card_number bigint,
        privilege smallint
      )
     where u.device_uid is null or u.device_uid not between 1 and 65535
        or nullif(trim(u.employee_code), '') is null
        or char_length(trim(u.employee_code)) > 24
        or coalesce(u.card_number, 0) not between 0 and 4294967295
        or coalesce(u.privilege, 0) not between 0 and 255
  ) then
    raise exception 'inventory snapshot contains an invalid user';
  end if;
  if exists (
    select u.device_uid
      from jsonb_to_recordset(p_users) as u(device_uid integer)
     group by u.device_uid
    having count(*) > 1
  ) then
    raise exception 'inventory snapshot contains duplicate device_uid';
  end if;

  v_present_count := jsonb_array_length(p_users);
  insert into public.device_employee_inventory_snapshots (
    branch, source_machine, observed_at, user_count
  ) values (
    v_branch, nullif(trim(coalesce(p_source_machine, '')), ''), v_observed_at, v_present_count
  ) returning id into v_snapshot_id;

  insert into public.device_employee_inventory as current_inventory (
    branch,
    device_uid,
    employee_code,
    device_name,
    card_number,
    privilege,
    source_machine,
    first_seen_at,
    last_seen_at,
    last_snapshot_id,
    present,
    missing_since,
    updated_at
  )
  select
    v_branch,
    u.device_uid,
    trim(u.employee_code),
    trim(coalesce(u.device_name, '')),
    coalesce(u.card_number, 0),
    coalesce(u.privilege, 0),
    nullif(trim(coalesce(p_source_machine, '')), ''),
    v_observed_at,
    v_observed_at,
    v_snapshot_id,
    true,
    null,
    v_observed_at
  from jsonb_to_recordset(p_users) as u(
    device_uid integer,
    employee_code text,
    device_name text,
    card_number bigint,
    privilege smallint
  )
  on conflict (branch, device_uid) do update
    set employee_code = excluded.employee_code,
        device_name = excluded.device_name,
        card_number = excluded.card_number,
        privilege = excluded.privilege,
        source_machine = excluded.source_machine,
        first_seen_at = case
          when current_inventory.employee_code is distinct from excluded.employee_code
            then excluded.first_seen_at
          else current_inventory.first_seen_at
        end,
        last_seen_at = excluded.last_seen_at,
        last_snapshot_id = excluded.last_snapshot_id,
        present = true,
        missing_since = null,
        updated_at = excluded.updated_at;

  update public.device_employee_inventory
     set present = false,
         missing_since = coalesce(missing_since, v_observed_at),
         updated_at = v_observed_at
   where branch = v_branch
     and last_snapshot_id <> v_snapshot_id
     and present = true;

  select count(*)::integer
    into v_missing_count
    from public.device_employee_inventory
   where branch = v_branch
     and present = false;

  return query select v_snapshot_id, v_observed_at, v_present_count, v_missing_count;
end;
$$;

alter table public.device_employee_inventory_snapshots enable row level security;
alter table public.device_employee_inventory enable row level security;

revoke all on public.device_employee_inventory_snapshots from public, anon, authenticated;
revoke all on public.device_employee_inventory from public, anon, authenticated;
grant select, insert on public.device_employee_inventory_snapshots to service_role;
grant select, insert, update on public.device_employee_inventory to service_role;
grant usage, select on sequence public.device_employee_inventory_snapshots_id_seq to service_role;

revoke all on function public.sync_device_employee_inventory(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_device_employee_inventory(text, text, jsonb)
  to service_role;

comment on table public.device_employee_inventory is
  'Latest complete read-only snapshot of employee profiles found on each branch terminal.';
comment on table public.device_employee_inventory_snapshots is
  'Audit record for each complete terminal user inventory snapshot.';
comment on function public.sync_device_employee_inventory(text, text, jsonb) is
  'Atomically upserts a complete device-user snapshot and marks users absent only after a successful full read.';
