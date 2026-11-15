-- One shared report per game, with immutable snapshots of every saved revision.
begin;
create table public.game_reports as select id as game_id from public.games with no data;
alter table public.game_reports
    add primary key (game_id),
    add foreign key (game_id) references public.games(id) on delete cascade,
    add column report jsonb not null,
    add column version integer not null check (version > 0),
    add column updated_at timestamptz not null default now(),
    add column updated_by uuid references auth.users(id) on delete set null,
    add column editor_name text not null;
create table public.game_report_history (like public.game_reports including defaults);
alter table public.game_report_history
    add primary key (game_id, version),
    add foreign key (game_id) references public.games(id) on delete cascade,
    add foreign key (updated_by) references auth.users(id) on delete set null;
alter table public.game_reports enable row level security;
alter table public.game_report_history enable row level security;
revoke all on public.game_reports, public.game_report_history from public, anon, authenticated;
grant select on public.game_reports, public.game_report_history to authenticated;
create policy game_reports_read on public.game_reports for select to authenticated using (true);
create policy game_report_history_read on public.game_report_history for select to authenticated using (true);

create function public.save_game_report(p_game_id text, p_report jsonb, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target_game public.games%rowtype;
    saved public.game_reports%rowtype;
    penalty jsonb;
    score_key text;
    author_name text;
begin
    if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
    select * into target_game from public.games where id::text = p_game_id for share;
    if not found then raise exception 'Game not found'; end if;
    if not coalesce(public.is_league_admin(), false) then
        perform c.profile_id from public.team_captains c
            join public.profiles p on p.id = c.profile_id
            join public.team_members m on m.profile_id = c.profile_id and m.team_id = c.team_id
            where p.auth_user_id = auth.uid() and c.team_id in (target_game.home_team_id, target_game.away_team_id)
            for share of c, m;
        if not found then
            raise exception 'Only administrators or captains of participating teams can change this report' using errcode = '42501';
        end if;
    end if;
    if p_expected_version is null or p_expected_version < 0 then raise exception 'Invalid report version'; end if;
    if p_report is null or jsonb_typeof(p_report) <> 'object' or octet_length(p_report::text) > 65536 then
        raise exception 'Invalid report';
    end if;
    if not (p_report ?& array['home_score', 'away_score', 'finish', 'penalties', 'notes'])
        or (select count(*) from jsonb_object_keys(p_report)) <> 5 then raise exception 'Invalid report fields'; end if;
    foreach score_key in array array['home_score', 'away_score'] loop
        if jsonb_typeof(p_report -> score_key) <> 'number' then raise exception 'Invalid score'; end if;
        if (p_report ->> score_key)::numeric < 0 or (p_report ->> score_key)::numeric > 99
            or trunc((p_report ->> score_key)::numeric) <> (p_report ->> score_key)::numeric then
            raise exception 'Invalid score: enter a whole number from 0 to 99';
        end if;
    end loop;
    if jsonb_typeof(p_report -> 'finish') <> 'string'
        or p_report ->> 'finish' not in ('regulation', 'overtime', 'shootout') then raise exception 'Invalid finish'; end if;
    if p_report ->> 'finish' <> 'regulation' and (p_report ->> 'home_score')::numeric = (p_report ->> 'away_score')::numeric then
        raise exception 'An overtime or shootout result cannot be tied';
    end if;
    if jsonb_typeof(p_report -> 'notes') <> 'string' or length(p_report ->> 'notes') > 5000 then raise exception 'Invalid notes'; end if;
    if jsonb_typeof(p_report -> 'penalties') <> 'array' then raise exception 'Invalid penalties'; end if;
    if jsonb_array_length(p_report -> 'penalties') > 100 then raise exception 'Too many penalties'; end if;
    for penalty in select value from jsonb_array_elements(p_report -> 'penalties') loop
        if jsonb_typeof(penalty) <> 'object' then raise exception 'Invalid penalty'; end if;
        if not (penalty ?& array['team_id', 'player', 'infraction', 'minutes', 'period', 'time'])
            or (select count(*) from jsonb_object_keys(penalty)) <> 6 then raise exception 'Invalid penalty fields'; end if;
        if jsonb_typeof(penalty -> 'team_id') <> 'string' or not coalesce(
            penalty ->> 'team_id' in (target_game.home_team_id::text, target_game.away_team_id::text), false) then
            raise exception 'Penalty team must be participating in this game';
        end if;
        if jsonb_typeof(penalty -> 'player') <> 'string' or length(btrim(penalty ->> 'player')) = 0
            or length(penalty ->> 'player') > 120 then raise exception 'Invalid penalty player'; end if;
        if jsonb_typeof(penalty -> 'infraction') <> 'string' or length(btrim(penalty ->> 'infraction')) = 0
            or length(penalty ->> 'infraction') > 120 then raise exception 'Invalid penalty infraction'; end if;
        if jsonb_typeof(penalty -> 'minutes') <> 'number' then raise exception 'Invalid penalty minutes'; end if;
        if (penalty ->> 'minutes')::numeric < 1 or (penalty ->> 'minutes')::numeric > 60
            or trunc((penalty ->> 'minutes')::numeric) <> (penalty ->> 'minutes')::numeric then raise exception 'Invalid penalty minutes'; end if;
        if jsonb_typeof(penalty -> 'period') <> 'string' or penalty ->> 'period' not in ('1', '2', '3', 'OT') then raise exception 'Invalid penalty period'; end if;
        if jsonb_typeof(penalty -> 'time') <> 'string' or
            (penalty ->> 'time' <> '' and penalty ->> 'time' !~ '^[0-9]{1,2}:[0-5][0-9]$') then raise exception 'Invalid penalty clock time'; end if;
    end loop;
    -- Lock on the stored identifier, so alternate input spellings cannot bypass the lock.
    perform pg_advisory_xact_lock(hashtextextended('game_report:' || target_game.id::text, 0));
    select * into saved from public.game_reports where game_id = target_game.id for update;
    if coalesce(saved.version, 0) <> p_expected_version then
        raise exception 'Report changed since you opened it. Reload the saved report before editing again.' using errcode = '40001';
    end if;
    select coalesce(nullif(btrim(p.full_name), ''), 'League member') into author_name
        from public.profiles p where p.auth_user_id = auth.uid() limit 1;
    insert into public.game_reports(game_id, report, version, updated_at, updated_by, editor_name)
        values (target_game.id, p_report, 1, now(), auth.uid(), coalesce(author_name, 'League administrator'))
        on conflict (game_id) do update set report = excluded.report, version = public.game_reports.version + 1,
            updated_at = excluded.updated_at, updated_by = excluded.updated_by, editor_name = excluded.editor_name
        returning * into saved;
    insert into public.game_report_history select saved.*;
    return to_jsonb(saved);
end;
$$;
revoke all on function public.save_game_report(text, jsonb, integer) from public, anon;
grant execute on function public.save_game_report(text, jsonb, integer) to authenticated;
commit;
