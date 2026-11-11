begin;

-- Reconciliation reads existing league tables with the server-only service role.
-- RLS bypass does not replace table privileges. Leave browser grants unchanged.
grant select on table public.teams, public.team_members, public.profiles to service_role;

commit;
