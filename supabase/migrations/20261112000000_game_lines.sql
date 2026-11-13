-- Game-specific lines. Match existing identifier types (UUID or integer).
begin;
create table public.game_lines as
select g.id as game_id, t.id as team_id from public.games g cross join public.teams t with no data;
alter table public.game_lines
    add primary key (game_id, team_id),
    add foreign key (game_id) references public.games(id) on delete cascade,
    add foreign key (team_id) references public.teams(id) on delete cascade,
    add column lines jsonb not null,
    add column version integer not null default 1 check (version > 0),
    add column updated_at timestamptz not null default now(),
    add column updated_by uuid references auth.users(id) on delete set null;

alter table public.game_lines enable row level security;
revoke all on public.game_lines from public, anon, authenticated;
grant select on public.game_lines to authenticated;
-- Match the game-details roster visibility. All writes go through the checked RPC.
create policy game_lines_read on public.game_lines for select to authenticated using (true);

create function public.save_game_lines(p_game_id text, p_team_id text, p_lines jsonb, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target_game public.games%rowtype;
    target_team public.teams%rowtype;
    saved public.game_lines%rowtype;
    group_key text;
    group_rows jsonb;
    line_row jsonb;
    player_value jsonb;
    player_id text;
    seen_players text[] := array[]::text[];
    slots integer;
    max_rows integer;
begin
    if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
    select * into target_game from public.games where id::text = p_game_id for share;
    if not found then raise exception 'Game not found'; end if;
    select * into target_team from public.teams where id::text = p_team_id
        and id in (target_game.home_team_id, target_game.away_team_id) for share;
    if not found then raise exception 'Team must be playing in this game'; end if;

    if not coalesce(public.is_league_admin(), false) then
        perform c.profile_id from public.team_captains c
            join public.profiles p on p.id = c.profile_id
            join public.team_members m on m.profile_id = c.profile_id and m.team_id = c.team_id
            where p.auth_user_id = auth.uid() and c.team_id = target_team.id
            for share of c, m;
        if not found then
            raise exception 'Only administrators or this team captain can change lines' using errcode = '42501';
        end if;
    end if;
    if p_expected_version is null or p_expected_version < 0 then raise exception 'Invalid lines version'; end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'object' or octet_length(p_lines::text) > 16384 then
        raise exception 'Invalid lines';
    end if;
    if (select count(*) from jsonb_object_keys(p_lines)) <> 3 then raise exception 'Invalid line groups'; end if;
    foreach group_key in array array['forwards', 'defense', 'goalies'] loop
        group_rows := p_lines -> group_key;
        slots := case group_key when 'forwards' then 3 when 'defense' then 2 else 1 end;
        max_rows := case group_key when 'goalies' then 2 else 4 end;
        if group_rows is null or jsonb_typeof(group_rows) <> 'array' then raise exception 'Invalid line group'; end if;
        if jsonb_array_length(group_rows) < 1 or jsonb_array_length(group_rows) > max_rows then
            raise exception 'Invalid number of lines';
        end if;
        for line_row in select value from jsonb_array_elements(group_rows) loop
            if jsonb_typeof(line_row) <> 'array' then raise exception 'Invalid line positions'; end if;
            if jsonb_array_length(line_row) <> slots then raise exception 'Invalid line positions'; end if;
            for player_value in select value from jsonb_array_elements(line_row) loop
                if jsonb_typeof(player_value) <> 'string' then raise exception 'Invalid player'; end if;
                player_id := player_value #>> '{}';
                if player_id = '' then continue; end if;
                if player_id = any(seen_players) then raise exception 'A player can only fill one position'; end if;
                perform profile_id from public.team_members
                    where team_id = target_team.id and profile_id::text = player_id for share;
                if not found then raise exception 'Every assigned player must be on this team roster'; end if;
                seen_players := array_append(seen_players, player_id);
            end loop;
        end loop;
    end loop;

    -- Serialize initial inserts as well as updates, then reject stale editors.
    perform pg_advisory_xact_lock(hashtextextended('game_lines:' || p_game_id || ':' || p_team_id, 0));
    select * into saved from public.game_lines where game_id = target_game.id and team_id = target_team.id for update;
    if coalesce(saved.version, 0) <> p_expected_version then
        raise exception 'Lines changed since you opened them. Reload saved lines before editing again.' using errcode = '40001';
    end if;
    insert into public.game_lines(game_id, team_id, lines, version, updated_at, updated_by)
        values (target_game.id, target_team.id, p_lines, 1, now(), auth.uid())
        on conflict (game_id, team_id) do update set lines = excluded.lines,
            version = public.game_lines.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by
        returning * into saved;
    return jsonb_build_object('version', saved.version, 'updated_at', saved.updated_at);
end;
$$;
revoke all on function public.save_game_lines(text, text, jsonb, integer) from public, anon;
grant execute on function public.save_game_lines(text, text, jsonb, integer) to authenticated;
commit;
