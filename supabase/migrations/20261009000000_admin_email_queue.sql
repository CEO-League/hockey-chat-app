-- Only service_role may enqueue or operate the queue. Edge Functions authorize callers.
create table public.admin_email_batches (
  id uuid primary key,
  caller_id uuid not null references auth.users(id),
  sender text not null,
  recipients text[] not null check (cardinality(recipients) between 1 and 20),
  subject text not null check (length(subject) between 1 and 200),
  message text not null check (length(message) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index admin_email_batches_caller on public.admin_email_batches(caller_id, created_at desc);
create table public.admin_email_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.admin_email_batches(id),
  recipient text not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','needs_review')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  last_error text,
  unique(batch_id, recipient)
);
create index admin_email_jobs_ready on public.admin_email_jobs(status, available_at);
create table public.admin_email_gate (
  id integer primary key check (id = 1),
  available_at timestamptz not null default now()
);
insert into public.admin_email_gate(id) values (1);
alter table public.admin_email_batches enable row level security;
alter table public.admin_email_jobs enable row level security;
alter table public.admin_email_gate enable row level security;
revoke all on public.admin_email_batches, public.admin_email_jobs, public.admin_email_gate from public, anon, authenticated;
grant all on public.admin_email_batches, public.admin_email_jobs, public.admin_email_gate to service_role;

create function public.enqueue_admin_email(p_id uuid, p_caller uuid, p_sender text, p_recipients text[], p_subject text, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous public.admin_email_batches; last_submission timestamptz; waiting integer;
begin
  -- One transaction serializes duplicate submissions, cooldown and queue capacity.
  perform 1 from public.admin_email_gate where id = 1 for update;
  select * into previous from public.admin_email_batches where id = p_id;
  if found then
    if previous.caller_id <> p_caller or previous.recipients <> p_recipients
       or previous.subject <> p_subject or previous.message <> p_message then
      return jsonb_build_object('error', 'Request ID already used for another message.', 'status', 409);
    end if;
    return jsonb_build_object('batchId', p_id, 'queued', cardinality(previous.recipients), 'requested', cardinality(previous.recipients));
  end if;
  select max(created_at) into last_submission from public.admin_email_batches where caller_id = p_caller;
  if last_submission > clock_timestamp() - interval '30 seconds' then
    return jsonb_build_object('error', 'Please wait before sending another message.', 'status', 429,
      'retryAfter', greatest(1, ceil(extract(epoch from last_submission + interval '30 seconds' - clock_timestamp()))));
  end if;
  select count(*) into waiting from public.admin_email_jobs where status in ('pending', 'processing');
  if waiting + cardinality(p_recipients) > 1000 then
    return jsonb_build_object('error', 'Email queue is full. Please try again later.', 'status', 429, 'retryAfter', 60);
  end if;
  insert into public.admin_email_batches(id,caller_id,sender,recipients,subject,message)
    values (p_id,p_caller,p_sender,p_recipients,p_subject,p_message);
  insert into public.admin_email_jobs(batch_id,recipient) select p_id, unnest(p_recipients);
  return jsonb_build_object('batchId', p_id, 'queued', cardinality(p_recipients), 'requested', cardinality(p_recipients));
end $$;

create function public.claim_admin_email()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare gate_time timestamptz; job public.admin_email_jobs; batch public.admin_email_batches; token uuid;
begin
  select available_at into gate_time from public.admin_email_gate where id = 1 for update;
  if gate_time > clock_timestamp() then return null; end if;
  -- Never overlap live leases, including across concurrent worker invocations.
  if exists(select 1 from public.admin_email_jobs where status = 'processing' and lease_until > clock_timestamp()) then return null; end if;
  -- Stop ambiguous retries before Resend's 24-hour idempotency window expires.
  update public.admin_email_jobs set status = 'needs_review', last_error = 'Retry window expired; check Resend before resending.', lease_token = null, lease_until = null
    where status in ('pending','processing') and first_attempt_at < clock_timestamp() - interval '23 hours';
  update public.admin_email_jobs set status = 'needs_review', last_error = 'Retry limit reached; check Resend before resending.', lease_token = null, lease_until = null
    where status in ('pending','processing') and attempts >= 8;
  select * into job from public.admin_email_jobs
    where (status = 'pending' and available_at <= clock_timestamp())
       or (status = 'processing' and lease_until <= clock_timestamp())
    order by available_at, id limit 1 for update;
  if not found then return null; end if;
  token := gen_random_uuid();
  update public.admin_email_jobs set status = 'processing', attempts = attempts + 1,
    first_attempt_at = coalesce(first_attempt_at, clock_timestamp()), lease_token = token,
    lease_until = clock_timestamp() + interval '60 seconds' where id = job.id;
  update public.admin_email_gate set available_at = clock_timestamp() + interval '1 second' where id = 1;
  select * into batch from public.admin_email_batches where id = job.batch_id;
  return jsonb_build_object('id', job.id, 'token', token, 'attempt', job.attempts + 1,
    'sender', batch.sender, 'recipient', job.recipient, 'subject', batch.subject, 'message', batch.message);
end $$;

create function public.finish_admin_email(p_id uuid, p_token uuid, p_status text, p_delay integer, p_global_pause boolean, p_error text, p_provider_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.admin_email_gate where id = 1 for update;
  if p_status not in ('sent','pending','failed','needs_review') or p_delay < 0 then
    raise exception 'Invalid result';
  end if;
  update public.admin_email_jobs set status = p_status, available_at = clock_timestamp() + make_interval(secs => p_delay),
    lease_token = null, lease_until = null, last_error = p_error, provider_id = p_provider_id
    where id = p_id and lease_token = p_token and status = 'processing';
  if not found then return false; end if;
  update public.admin_email_gate set available_at = greatest(available_at,
    clock_timestamp() + make_interval(secs => case when p_global_pause then greatest(1,p_delay) else 1 end)) where id = 1;
  return true;
end $$;

revoke all on function public.enqueue_admin_email(uuid,uuid,text,text[],text,text) from public, anon, authenticated;
revoke all on function public.claim_admin_email() from public, anon, authenticated;
revoke all on function public.finish_admin_email(uuid,uuid,text,integer,boolean,text,text) from public, anon, authenticated;
grant execute on function public.enqueue_admin_email(uuid,uuid,text,text[],text,text) to service_role;
grant execute on function public.claim_admin_email() to service_role;
grant execute on function public.finish_admin_email(uuid,uuid,text,integer,boolean,text,text) to service_role;
