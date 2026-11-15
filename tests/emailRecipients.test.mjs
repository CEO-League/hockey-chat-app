import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEmailRecipients } from '../src/utils/emailRecipients.js';
const profiles = [{ id: 'p1', full_name: 'Zoe', email: 'zoe@example.com' }, { id: 'p2', full_name: 'Alex', email: 'alex@example.com' }, { id: 'p3', full_name: 'No Team' }];
const teams = [{ id: 2, name: 'Wolves' }, { id: 1, name: 'Bears' }, { id: 3, name: 'Hawks' }];
const memberships = [{ team_id: '1', profile_id: 'p1' }, { team_id: 2, profile_id: 'p2' }, { team_id: 1, profile_id: 'p1' }];
test('each team has its own roster, including empty teams and unassigned members', () => {
    const groups = groupEmailRecipients(profiles, teams, memberships);
    assert.deepEqual(groups.map((group) => [group.name, group.members.map((p) => p.id)]), [
        ['Bears', ['p1']], ['Hawks', []], ['Wolves', ['p2']], ['No team assigned', ['p3']],
    ]);
});
test('searching a team shows only that team roster; captain filter preserves sections', () => {
    const bothTeams = [...memberships, { team_id: 2, profile_id: 'p1' }];
    assert.deepEqual(groupEmailRecipients(profiles, teams, bothTeams, { search: 'bears' }).map((g) => g.name), ['Bears']);
    assert.deepEqual(groupEmailRecipients(profiles, teams, memberships, { captainsOnly: true, captainIds: new Set(['p2']) }).map((g) => [g.name, g.members[0].id]), [['Wolves', 'p2']]);
});
