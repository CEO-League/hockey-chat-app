begin;
-- No client can edit the channel registry, sync lease, or request counters.
create table public.stream_team_channels (
  id text primary key, team_id text not null unique
);
create table public.stream_sync_state (
  id integer primary key check (id = 1),
  generation bigint not null default 1,
  synced_generation bigint not null default 0,
  lease_owner uuid,
  lease_until timestamptz
);
insert into public.stream_sync_state(id) values (1);
create table public.stream_chat_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  requests integer not null default 0
);
alter table public.stream_team_channels enable row level security;
alter table public.stream_sync_state enable row level security;
alter table public.stream_chat_limits enable row level security;
revoke all on public.stream_team_channels, public.stream_sync_state, public.stream_chat_limits from public, anon, authenticated;
grant all on public.stream_team_channels, public.stream_sync_state, public.stream_chat_limits to service_role;

create function public.queue_stream_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.stream_sync_state set generation = generation + 1 where id = 1;
  return null;
end;
$$;
create trigger stream_members_changed after insert or update or delete on public.team_members
for each statement execute function public.queue_stream_sync();
create trigger stream_profiles_changed after insert or update or delete on public.profiles
for each statement execute function public.queue_stream_sync();
create trigger stream_teams_changed after insert or update or delete on public.teams
for each statement execute function public.queue_stream_sync();

create function public.claim_stream_sync(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare claimed public.stream_sync_state;
begin
  update public.stream_sync_state
  set lease_owner = p_owner, lease_until = now() + interval '120 seconds'
  where id = 1 and (lease_until is null or lease_until < now())
  returning * into claimed;
  if not found then return null; end if;
  return jsonb_build_object('generation', claimed.generation);
end;
$$;
create function public.finish_stream_sync(p_owner uuid, p_generation bigint, p_success boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare clean boolean;
begin
  update public.stream_sync_state
  set synced_generation = case when p_success then p_generation else synced_generation end,
      lease_owner = null, lease_until = null
  where id = 1 and lease_owner = p_owner and lease_until > now()
  returning (p_success and generation = p_generation) into clean;
  return coalesce(clean, false);
end;
$$;
create function public.allow_stream_chat_creation(p_user_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare current_count integer;
begin
  insert into public.stream_chat_limits(user_id, requests) values (p_user_id, 1)
  on conflict (user_id) do update set
    window_start = case when stream_chat_limits.window_start < now() - interval '1 minute' then now() else stream_chat_limits.window_start end,
    requests = case when stream_chat_limits.window_start < now() - interval '1 minute' then 1 else stream_chat_limits.requests + 1 end
  returning requests into current_count;
  return current_count <= 10;
end;
$$;
revoke all on function public.queue_stream_sync() from public, anon, authenticated;
revoke all on function public.claim_stream_sync(uuid) from public, anon, authenticated;
revoke all on function public.finish_stream_sync(uuid,bigint,boolean) from public, anon, authenticated;
revoke all on function public.allow_stream_chat_creation(uuid) from public, anon, authenticated;
grant execute on function public.claim_stream_sync(uuid) to service_role;
grant execute on function public.finish_stream_sync(uuid,bigint,boolean) to service_role;
grant execute on function public.allow_stream_chat_creation(uuid) to service_role;
commit;
