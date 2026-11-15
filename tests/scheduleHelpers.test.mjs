import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterUpcomingGamesForTeam, filterGamesForTeam, formatDateKey, formatGameDate, gameEndTime } from '../src/utils/scheduleHelpers.js';

const game = (id, date, time = '19:00:00', team = 'red') => ({
    id, game_date: date, start_time: time, home_team_id: team, away_team_id: 'blue',
});

test('September 27 drops off the dashboard on September 28, while today stays', () => {
    const games = [game('yesterday', '2026-09-27'), game('today', '2026-09-28'), game('next', '2026-10-01')];
    assert.deepEqual(filterUpcomingGamesForTeam(games, 'red', '2026-09-28').map(g => g.id), ['today', 'next']);
    assert.equal(filterGamesForTeam(games, 'red').length, 3);
});

test('upcoming games are team-scoped and ordered by calendar date and time', () => {
    const games = [game('later', '2026-10-01'), game('evening', '2026-09-28', '21:00:00'),
        game('other-team', '2026-09-28', '18:00:00', 'green'), game('early', '2026-09-28', '19:00:00')];
    assert.deepEqual(filterUpcomingGamesForTeam(games, 'red', '2026-09-28').map(g => g.id), ['early', 'evening', 'later']);
});

test('midnight rollover removes the previous date, including across years', () => {
    const games = [game('old', '2026-12-31'), game('new', '2027-01-01')];
    const before = formatDateKey(new Date(2026, 11, 31, 23, 59));
    const after = formatDateKey(new Date(2027, 0, 1, 0, 0));
    assert.equal(filterUpcomingGamesForTeam(games, 'red', before).length, 2);
    assert.deepEqual(filterUpcomingGamesForTeam(games, 'red', after).map(g => g.id), ['new']);
});

test('no upcoming games or missing team produces an empty dashboard list', () => {
    assert.deepEqual(filterUpcomingGamesForTeam([game('past', '2026-09-27')], 'red', '2026-09-28'), []);
    assert.deepEqual(filterUpcomingGamesForTeam([], 'red', '2026-09-28'), []);
    assert.deepEqual(filterUpcomingGamesForTeam([game('today', '2026-09-28')], null, '2026-09-28'), []);
});


test('games end exactly an hour after their start, including midnight', () => {
    assert.equal(gameEndTime('19:30'), '20:30:00');
    assert.equal(gameEndTime('11:45:15'), '12:45:15');
    assert.equal(gameEndTime('23:30:00'), '00:30:00');
    for (const invalid of [null, '', 'TBD', '24:00', '12:60', '12:30:60']) {
        assert.equal(gameEndTime(invalid), null);
    }
});


test('game labels show the stored year across December and January', () => {
    assert.equal(formatGameDate('2026-12-31', { includeYear: true }), 'Thu, Dec 31, 2026');
    assert.equal(formatGameDate('2027-01-01', { includeYear: true }), 'Fri, Jan 1, 2027');
    assert.equal(formatGameDate('2027-01-01'), 'Fri, Jan 1');
    assert.equal(formatGameDate(null, { includeYear: true }), 'TBD');
});
