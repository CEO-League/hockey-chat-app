-- Requires the existing is_league_admin() function and profiles.auth_user_id.
-- Infer identifier types from the existing schema (UUID or integer).
begin;
create table public.team_captains as
select team_id, profile_id from public.team_members with no data;
alter table public.team_captains
    add primary key (team_id, profile_id),
    add foreign key (team_id) references public.teams(id) on delete cascade,
    add foreign key (profile_id) references public.profiles(id) on delete cascade;
alter table public.team_captains enable row level security;
revoke all on public.team_captains from public, anon, authenticated;
grant select on public.team_captains to authenticated;
create policy captain_read on public.team_captains for select to authenticated using (true);

create function public.rsvp_management_access() returns jsonb
language sql stable security definer set search_path = '' as $$
    select jsonb_build_object(
        'is_admin', auth.uid() is not null and coalesce(public.is_league_admin(), false),
        'team_ids', coalesce((
            select jsonb_agg(distinct c.team_id::text)
            from public.team_captains c
            join public.profiles p on p.id = c.profile_id
            join public.team_members m on m.profile_id = c.profile_id and m.team_id = c.team_id
            where p.auth_user_id = auth.uid()
        ), '[]'::jsonb)
    );
$$;

create function public.assign_team_captain(p_team_id text, p_profile_id text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare member public.team_members%rowtype;
begin
    if auth.uid() is null or not coalesce(public.is_league_admin(), false) then
        raise exception 'Only administrators can assign team captains' using errcode = '42501';
    end if;
    if p_enabled is null then raise exception 'Captain assignment is required'; end if;
    if not p_enabled then
        delete from public.team_captains where team_id::text = p_team_id and profile_id::text = p_profile_id;
        return;
    end if;
    select * into member from public.team_members
        where team_id::text = p_team_id and profile_id::text = p_profile_id for update;
    if not found then raise exception 'The captain must be a member of this team'; end if;
    insert into public.team_captains(team_id, profile_id) values (member.team_id, member.profile_id)
        on conflict do nothing;
end;
$$;

-- Remove the assignment when a player leaves or changes their main team.
create function public.remove_departed_captain() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'UPDATE' then
        if new.team_id is not distinct from old.team_id
            and new.profile_id is not distinct from old.profile_id then return new; end if;
    end if;
    delete from public.team_captains where team_id = old.team_id and profile_id = old.profile_id;
    return old;
end;
$$;
create trigger remove_captain_on_departure after delete or update of team_id, profile_id
on public.team_members for each row execute function public.remove_departed_captain();

create function public.manage_game_rsvp(p_game_id text, p_profile_id text, p_status text, p_team_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
    target_game public.games%rowtype;
    target_member public.team_members%rowtype;
    saved_status public.game_rsvps.status%type;
begin
    if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
    if p_status is null or p_status not in ('going', 'maybe', 'out', 'pending') then
        raise exception 'Invalid RSVP status';
    end if;
    select * into target_game from public.games where id::text = p_game_id for share;
    if not found then raise exception 'Game not found'; end if;
    select * into target_member from public.team_members
        where profile_id::text = p_profile_id and team_id::text = p_team_id
        and team_id in (target_game.home_team_id, target_game.away_team_id) for share;
    if not found then raise exception 'Player must belong to a team playing in this game'; end if;
    if not coalesce(public.is_league_admin(), false) then
        perform c.profile_id from public.team_captains c
            join public.profiles p on p.id = c.profile_id
            join public.team_members m on m.profile_id = c.profile_id and m.team_id = c.team_id
            where p.auth_user_id = auth.uid() and c.team_id = target_member.team_id
            for share of c, m;
        if not found then
            raise exception 'Only administrators or this team captain can update attendance' using errcode = '42501';
        end if;
    end if;
    if p_status = 'pending' then
        delete from public.game_rsvps where game_id = target_game.id and profile_id = target_member.profile_id;
    else
        saved_status := p_status;
        insert into public.game_rsvps(game_id, profile_id, status, updated_at)
            values (target_game.id, target_member.profile_id, saved_status, now())
            on conflict (game_id, profile_id) do update set status = excluded.status, updated_at = excluded.updated_at;
    end if;
end;
$$;
revoke all on function public.rsvp_management_access() from public, anon;
revoke all on function public.assign_team_captain(text, text, boolean) from public, anon;
revoke all on function public.manage_game_rsvp(text, text, text, text) from public, anon;
revoke all on function public.remove_departed_captain() from public, anon, authenticated;
grant execute on function public.rsvp_management_access() to authenticated;
grant execute on function public.assign_team_captain(text, text, boolean) to authenticated;
grant execute on function public.manage_game_rsvp(text, text, text, text) to authenticated;
commit;
