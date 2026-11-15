import test from 'node:test';
import assert from 'node:assert/strict';
import { manageableTeams, gamesForManagedTeam } from '../src/utils/rsvpManagement.js';
const teams = [{ id: 1 }, { id: 2 }];
test('ordinary players and missing permissions cannot manage teams', () => {
    assert.deepEqual(manageableTeams(teams, null), []);
    assert.deepEqual(manageableTeams(teams, { is_admin: false, team_ids: [] }), []);
});
test('captains only see their assigned teams; admins see every team', () => {
    assert.deepEqual(manageableTeams(teams, { team_ids: ['2'] }), [{ id: 2 }]);
    assert.deepEqual(manageableTeams(teams, { is_admin: true }), teams);
});
test('managed games include home and away games and exclude unrelated games', () => {
    const games = [{ home_team_id: 1, away_team_id: 2 }, { home_team_id: 3, away_team_id: 1 }, { home_team_id: 2, away_team_id: 3 }];
    assert.deepEqual(gamesForManagedTeam(games, '1'), games.slice(0, 2));
    assert.deepEqual(gamesForManagedTeam(games, ''), []);
});
