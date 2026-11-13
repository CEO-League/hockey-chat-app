// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
// Uses an in-memory PostgreSQL instance; never connects to the application database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyGameLines } from '../../src/utils/gameLines.js';

const users = { captain: '00000000-0000-0000-0000-000000000001',
    player: '00000000-0000-0000-0000-000000000002',
    admin: '00000000-0000-0000-0000-000000000003' };

test('game lines enforce database permissions, validation, isolation, and version checks',
    { skip: !process.env.PGLITE_MODULE }, async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE);
    const db = new PGlite();
    try {
        await db.exec(`
            create role anon; create role authenticated;
            create schema auth;
            create table auth.users(id uuid primary key);
            create function auth.uid() returns uuid language sql stable as
                $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            grant usage on schema auth to anon, authenticated;
            grant execute on function auth.uid() to anon, authenticated;
            create function public.is_league_admin() returns boolean language sql stable as
                $$ select auth.uid() = '${users.admin}'::uuid $$;
            create table public.teams(id bigint primary key);
            create table public.games(id bigint primary key, home_team_id bigint references teams, away_team_id bigint references teams);
            create table public.profiles(id bigint primary key, auth_user_id uuid references auth.users);
            create table public.team_members(team_id bigint references teams, profile_id bigint references profiles);
            create table public.team_captains(team_id bigint references teams, profile_id bigint references profiles);
            insert into auth.users values ('${users.captain}'), ('${users.player}'), ('${users.admin}');
            insert into teams values (1), (2), (3);
            insert into games values (10, 1, 2), (11, 1, 2);
            insert into profiles values (100, '${users.captain}'), (101, '${users.player}'), (102, '${users.admin}');
            insert into team_members values (1, 100), (1, 101), (2, 102);
            insert into team_captains values (1, 100);
        `);
        await db.exec(await readFile(new URL('../migrations/20261112000000_game_lines.sql', import.meta.url), 'utf8'));
        const asUser = async (id, role = 'authenticated') => {
            await db.exec('reset role');
            await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
            await db.exec(`set role ${role}`);
        };
        const save = (lines, team = '1', version = 0, game = '10') => db.query(
            'select public.save_game_lines($1, $2, $3::jsonb, $4) as saved', [game, team, JSON.stringify(lines), version]);
        const lines = emptyGameLines(); lines.forwards[0][0] = '100';
        await asUser(users.player);
        await assert.rejects(save(lines), /Only administrators or this team captain/);
        await assert.rejects(db.exec("insert into public.game_lines(game_id, team_id, lines) values (10, 1, '{}'::jsonb)"), /permission denied/);
        await asUser(null, 'anon');
        await assert.rejects(save(lines), /permission denied/);
        await assert.rejects(db.exec('select * from public.game_lines'), /permission denied/);
        await asUser(null);
        await assert.rejects(save(lines), /Sign in required/);
        await asUser(users.captain);
        const result = await save(lines);
        assert.equal(result.rows[0].saved.version, 1);
        await assert.rejects(save(lines, '2'), /Only administrators or this team captain/);
        await assert.rejects(save(lines, '3'), /Team must be playing/);
        await assert.rejects(save(lines, '1', 0), /Lines changed since/);
        assert.equal((await save(lines, '1', 1)).rows[0].saved.version, 2);
        await save(lines, '1', 0, '11');
        const duplicate = emptyGameLines(); duplicate.forwards[0][0] = '100'; duplicate.defense[0][0] = '100';
        await assert.rejects(save(duplicate, '1', 2), /only fill one/);
        const outsider = emptyGameLines(); outsider.goalies[0][0] = '102';
        await assert.rejects(save(outsider, '1', 2), /must be on this team roster/);
        for (const malformed of [null, [], {}, { ...emptyGameLines(), extra: [] },
            { ...emptyGameLines(), forwards: [] }, { ...emptyGameLines(), defense: [['100']] },
            { ...emptyGameLines(), goalies: [[null]] }]) {
            await assert.rejects(save(malformed, '1', 2), /Invalid/);
        }
        await asUser(users.admin);
        await save(outsider, '2');
        await save(lines, '1', 2);
        await asUser(users.player);
        const visible = await db.query('select game_id, team_id, version from public.game_lines order by game_id, team_id');
        assert.equal(visible.rows.length, 3);
        assert.equal(visible.rows[0].version, 3);
        await assert.rejects(db.exec('update public.game_lines set version = 99'), /permission denied/);
        await assert.rejects(db.exec('delete from public.game_lines'), /permission denied/);
        await db.exec('reset role; delete from public.team_members where profile_id = 100');
        await asUser(users.captain);
        await assert.rejects(save(emptyGameLines(), '1', 3), /Only administrators or this team captain/);
        await asUser(users.admin);
        await assert.rejects(save(lines, '1', 3), /must be on this team roster/);
    } finally { await db.close(); }
});
