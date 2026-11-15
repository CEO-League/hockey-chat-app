// Isolated PostgreSQL tests; never connects to the application database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const users = { captain: '00000000-0000-0000-0000-000000000001',
    player: '00000000-0000-0000-0000-000000000002', admin: '00000000-0000-0000-0000-000000000003',
    opponent: '00000000-0000-0000-0000-000000000004', outsider: '00000000-0000-0000-0000-000000000005' };
test('reports enforce permissions, validate data, retain immutable history, and reject stale saves',
    { skip: !process.env.PGLITE_MODULE }, async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE);
    const db = new PGlite();
    try {
        await db.exec(`
            create role anon; create role authenticated; create schema auth;
            create table auth.users(id uuid primary key);
            create function auth.uid() returns uuid language sql stable as
                $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            grant usage on schema auth to anon, authenticated;
            grant execute on function auth.uid() to anon, authenticated;
            create function public.is_league_admin() returns boolean language sql stable as
                $$ select auth.uid() = '${users.admin}'::uuid $$;
            create table public.teams(id bigint primary key);
            create table public.games(id bigint primary key, home_team_id bigint references teams, away_team_id bigint references teams);
            create table public.profiles(id bigint primary key, auth_user_id uuid references auth.users, full_name text);
            create table public.team_members(team_id bigint references teams, profile_id bigint references profiles);
            create table public.team_captains(team_id bigint references teams, profile_id bigint references profiles);
            insert into auth.users values ${Object.values(users).map(id => "('" + id + "')").join(',')};
            insert into teams values (1), (2), (3);
            insert into games values (10, 1, 2), (11, 1, 2), (12, 2, 3);
            insert into profiles values (100, '${users.captain}', 'Home captain'), (101, '${users.player}', 'Player'),
                (102, '${users.admin}', 'Admin'), (103, '${users.opponent}', 'Away captain'), (104, '${users.outsider}', 'Other captain');
            insert into team_members values (1, 100), (1, 101), (2, 103), (3, 104);
            insert into team_captains values (1, 100), (2, 103), (3, 104);
        `);
        await db.exec(await readFile(new URL('../supabase/migrations/20261114000000_game_reports.sql', import.meta.url), 'utf8'));
        const asUser = async (id, role = 'authenticated') => {
            await db.exec('reset role');
            await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
            await db.exec('set role ' + role);
        };
        const report = { home_score: 3, away_score: 1, finish: 'regulation', notes: 'A close game.',
            penalties: [{ team_id: '1', player: 'Bench', infraction: 'Too many players', minutes: 2, period: '1', time: '9:05' }] };
        const save = (value = report, version = 0, game = '10') => db.query(
            'select public.save_game_report($1, $2::jsonb, $3) as saved', [game, JSON.stringify(value), version]);
        await asUser(users.player);
        await assert.rejects(save(), /Only administrators or captains/);
        await asUser(users.outsider);
        await assert.rejects(save(), /Only administrators or captains/);
        await asUser(null, 'anon');
        await assert.rejects(save(), /permission denied/);
        await assert.rejects(db.exec('select * from public.game_report_history'), /permission denied/);
        await asUser(null);
        await assert.rejects(save(), /Sign in required/);
        await asUser(users.captain);
        const first = (await save()).rows[0].saved;
        assert.equal(first.version, 1);
        assert.equal(first.editor_name, 'Home captain');
        await assert.rejects(save(), /Report changed since/);
        await assert.rejects(save(report, 1, '12'), /Only administrators or captains/);
        await assert.rejects(save(report, 0, '999'), /Game not found/);
        // Both missing keys and explicit JSON nulls must fail server validation.
        for (const key of Object.keys(report)) {
            const missing = { ...report }; delete missing[key];
            await assert.rejects(save(missing, 1), /Invalid/);
            await assert.rejects(save({ ...report, [key]: null }, 1), /Invalid/);
        }
        for (const value of [null, [], {}, { ...report, extra: true },
            { ...report, home_score: -1 }, { ...report, home_score: 100 }, { ...report, away_score: 1.5 },
            { ...report, home_score: '3' }, { ...report, finish: 'invalid' }, { ...report, notes: 'x'.repeat(5001) },
            { ...report, penalties: Array(101).fill(report.penalties[0]) }]) {
            await assert.rejects(save(value, 1), /Invalid|Too many/);
        }
        await assert.rejects(save({ ...report, home_score: 1, finish: 'shootout' }, 1), /cannot be tied/);
        for (const patch of [{ team_id: '3' }, { team_id: 1 }, { player: ' ' }, { infraction: '' },
            { minutes: 0 }, { minutes: 61 }, { minutes: 1.5 }, { minutes: '2' }, { period: '4' }, { time: '1:60' }, { time: '123:00' }]) {
            await assert.rejects(save({ ...report, penalties: [{ ...report.penalties[0], ...patch }] }, 1), /Invalid|participating/);
        }
        for (const key of Object.keys(report.penalties[0])) {
            const missing = { ...report.penalties[0] }; delete missing[key];
            await assert.rejects(save({ ...report, penalties: [missing] }, 1), /Invalid/);
            await assert.rejects(save({ ...report, penalties: [{ ...report.penalties[0], [key]: null }] }, 1), /Invalid|participating/);
        }
        await asUser(users.opponent);
        const second = (await save({ ...report, home_score: 4 }, 1)).rows[0].saved;
        assert.equal(second.version, 2);
        assert.equal(second.editor_name, 'Away captain');
        await asUser(users.admin);
        await save({ ...report, notes: 'Corrected by admin.' }, 2);
        await save({ ...report, home_score: 0, away_score: 0, penalties: [] }, 0, '11');
        await asUser(users.player);
        const history = (await db.query('select * from public.game_report_history where game_id = 10 order by version')).rows;
        assert.equal(history.length, 3);
        assert.equal(history[0].report.home_score, 3);
        assert.equal(history[1].report.home_score, 4);
        assert.equal(history[2].report.notes, 'Corrected by admin.');
        assert.equal((await db.query('select version from public.game_reports where game_id = 11')).rows[0].version, 1);
        for (const table of ['game_reports', 'game_report_history']) {
            await assert.rejects(db.exec('update public.' + table + ' set version = 99'), /permission denied/);
            await assert.rejects(db.exec('delete from public.' + table), /permission denied/);
            await assert.rejects(db.exec('insert into public.' + table + ' select * from public.' + table), /permission denied/);
        }
        await db.exec('reset role; delete from public.team_members where profile_id = 100');
        await asUser(users.captain);
        await assert.rejects(save(report, 3), /Only administrators or captains/);
        await asUser(users.admin);
        await assert.rejects(save(report, -1), /Invalid report version/);
        await assert.rejects(save(report, null), /Invalid report version/);
        assert.equal((await db.query('select count(*)::int as count from public.game_report_history where game_id = 10')).rows[0].count, 3);
    } finally { await db.close(); }
});
