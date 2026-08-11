-- Supabase queue: trusted HR backend -> ZKTeco employee profile at a branch terminal (Store 1..Store 5)
-- Apply in Supabase SQL Editor before enabling [employee_import] in config.ini.

create table if not exists public.device_employee_import_queue (
  id uuid primary key default gen_random_uuid(),
  -- No default on purpose: a default branch sends jobs to the wrong physical terminal whenever
  -- the caller forgets the column, and nothing about the queue looks broken while it happens.
  branch text not null check (branch in ('Store 1', 'Store 2', 'Store 3', 'Store 4', 'Store 5')),
  employee_code varchar(24) not null check (employee_code ~ '^[A-Za-z0-9_-]{1,24}$'),
  employee_name text not null check (char_length(btrim(employee_name)) between 1 and 24),
  -- NULL means preserve the existing card; a new user receives card 0.
  card_number bigint check (card_number between 0 and 4294967295),

  -- Producer event/revision key. Reusing the same key makes enqueue idempotent.
  request_key text unique,
  metadata jsonb not null default '{}'::jsonb,

  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'completed', 'failed', 'cancelled')),
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  locked_by text,
  claim_token uuid,
  device_uid integer check (device_uid between 1 and 65535),
  last_error text,
  requested_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists device_employee_import_queue_claim_idx
  on public.device_employee_import_queue (status, available_at, created_at)
  where status in ('pending', 'retry', 'processing');
create index if not exists device_employee_import_queue_employee_idx
  on public.device_employee_import_queue (branch, employee_code, created_at desc);

create or replace function public.touch_device_employee_import_queue_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_device_employee_import_queue_updated_at
  on public.device_employee_import_queue;
create trigger trg_device_employee_import_queue_updated_at
before update on public.device_employee_import_queue
for each row execute function public.touch_device_employee_import_queue_updated_at();

-- Per-branch terminal lease + atomic claim. Advisory lock serializes concurrent claim RPCs.
-- Only one queue job can own a given branch's terminal at a time, and every claim has a fresh token.
create or replace function public.claim_device_employee_import_jobs(
  p_branch text,
  p_worker_id text,
  p_limit integer default 1
)
returns setof public.device_employee_import_queue
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_branch text := btrim(coalesce(p_branch, ''));
begin
  -- Raise instead of returning empty: a typo in a branch config.ini must be loud in that branch's
  -- log, not look like an idle queue forever.
  if v_branch not in ('Store 1', 'Store 2', 'Store 3', 'Store 4', 'Store 5') then
    raise exception 'unsupported branch %', coalesce(p_branch, '(null)');
  end if;
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;

  -- One lock per branch: each branch owns a different physical terminal, so a busy branch must not
  -- block the others the way a single global lock would.
  perform pg_advisory_xact_lock(hashtextextended('HRSCAN:' || v_branch || ':employee import', 0));

  -- An expired final attempt must not remain processing forever.
  update public.device_employee_import_queue q
     set status = 'failed',
         processed_at = now(),
         last_error = coalesce(q.last_error, 'worker lease expired after final attempt'),
         locked_at = null,
         lease_expires_at = null,
         locked_by = null,
         claim_token = null
   where q.branch = v_branch
     and q.status = 'processing'
     and q.lease_expires_at < now()
     and q.attempts >= q.max_attempts;

  -- Do not claim another row while any valid lease exists for this branch's terminal.
  if exists (
    select 1 from public.device_employee_import_queue q
     where q.branch = v_branch
       and q.status = 'processing'
       and q.lease_expires_at >= now()
  ) then
    return;
  end if;

  return query
  with candidate as (
    select q.id
      from public.device_employee_import_queue q
     where q.branch = v_branch
       and q.attempts < q.max_attempts
       and (
         (q.status in ('pending', 'retry') and q.available_at <= now())
         or (q.status = 'processing' and q.lease_expires_at < now())
       )
     order by q.created_at, q.id
     for update skip locked
     limit 1
  )
  update public.device_employee_import_queue q
     set status = 'processing',
         attempts = q.attempts + 1,
         locked_at = now(),
         lease_expires_at = now() + interval '30 minutes',
         locked_by = p_worker_id,
         claim_token = gen_random_uuid(),
         last_error = null
    from candidate c
   where q.id = c.id
  returning q.*;
end;
$$;

create or replace function public.renew_device_employee_import_lease(
  p_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  affected integer;
begin
  update public.device_employee_import_queue
     set lease_expires_at = now() + interval '30 minutes'
   where id = p_id
     and status = 'processing'
     and claim_token = p_claim_token;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'claim token mismatch or job is not processing'; end if;
  return true;
end;
$$;

create or replace function public.complete_device_employee_import_job(
  p_id uuid,
  p_claim_token uuid,
  p_device_uid integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  affected integer;
begin
  update public.device_employee_import_queue
     set status = 'completed',
         device_uid = p_device_uid,
         processed_at = now(),
         last_error = null,
         locked_at = null,
         lease_expires_at = null,
         locked_by = null,
         claim_token = null
   where id = p_id
     and status = 'processing'
     and claim_token = p_claim_token;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'claim token mismatch or job is not processing'; end if;
  return true;
end;
$$;

create or replace function public.fail_device_employee_import_job(
  p_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  affected integer;
begin
  update public.device_employee_import_queue q
     set status = case when q.attempts >= q.max_attempts then 'failed' else 'retry' end,
         available_at = now() + case
           when q.attempts <= 1 then interval '1 minute'
           when q.attempts = 2 then interval '5 minutes'
           when q.attempts = 3 then interval '15 minutes'
           else interval '30 minutes'
         end,
         processed_at = case when q.attempts >= q.max_attempts then now() else null end,
         last_error = left(coalesce(p_error, 'unknown device error'), 2000),
         locked_at = null,
         lease_expires_at = null,
         locked_by = null,
         claim_token = null
   where q.id = p_id
     and q.status = 'processing'
     and q.claim_token = p_claim_token;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'claim token mismatch or job is not processing'; end if;
  return true;
end;
$$;

alter table public.device_employee_import_queue enable row level security;

-- Provisioning changes a physical terminal: browser roles receive no direct queue access.
revoke all on public.device_employee_import_queue from public, anon, authenticated;
grant select, insert, update on public.device_employee_import_queue to service_role;

revoke all on function public.touch_device_employee_import_queue_updated_at() from public, anon, authenticated;
revoke all on function public.claim_device_employee_import_jobs(text, text, integer) from public, anon, authenticated;
revoke all on function public.renew_device_employee_import_lease(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_device_employee_import_job(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.fail_device_employee_import_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_device_employee_import_jobs(text, text, integer) to service_role;
grant execute on function public.renew_device_employee_import_lease(uuid, uuid) to service_role;
grant execute on function public.complete_device_employee_import_job(uuid, uuid, integer) to service_role;
grant execute on function public.fail_device_employee_import_job(uuid, uuid, text) to service_role;

comment on table public.device_employee_import_queue is
  'Leased queue of employee profiles to upsert into a branch ZKTeco terminal (Store 1..Store 5); biometric templates are not stored here.';
comment on column public.device_employee_import_queue.branch is
  'Target branch terminal; required on every row because there is deliberately no default.';
comment on column public.device_employee_import_queue.request_key is
  'Producer event/revision idempotency key; do not use employee_code alone because later updates need new jobs.';
