import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyGameLines, validateGameLines, assignedPlayerIds } from './gameLines.js';

test('new games have independent blank lines', () => {
    const first = emptyGameLines();
    first.forwards[0][0] = 'a';
    assert.equal(emptyGameLines().forwards[0][0], '');
    assert.equal(first.forwards[1][0], '');
    assert.equal(validateGameLines(emptyGameLines(), new Set()), '');
});
test('a player cannot occupy two positions, including across forward and defense groups', () => {
    const lines = emptyGameLines();
    lines.forwards[0][0] = 'a'; lines.defense[0][1] = 'a';
    assert.match(validateGameLines(lines, new Set(['a'])), /only fill one/);
});
test('players outside the team roster must be removed before saving', () => {
    const lines = emptyGameLines(); lines.goalies[0][0] = 'former-player';
    assert.match(validateGameLines(lines, new Set(['a'])), /no longer on this team/);
});
test('valid mixed lineup and empty positions are accepted', () => {
    const lines = emptyGameLines(); lines.forwards[0][1] = 'center'; lines.goalies[0][0] = 'goalie';
    assert.equal(validateGameLines(lines, new Set(['center', 'goalie'])), '');
    assert.deepEqual(assignedPlayerIds(lines), ['center', 'goalie']);
});
test('reject malformed groups, wrong slot counts and too many lines', () => {
    for (const lines of [null, [], {}, { ...emptyGameLines(), extra: [] },
        { ...emptyGameLines(), forwards: [] }, { ...emptyGameLines(), defense: [['a']] },
        { ...emptyGameLines(), goalies: [[null]] },
        { ...emptyGameLines(), goalies: [[''], [''], ['']] }]) {
        assert.ok(validateGameLines(lines, new Set(['a'])));
    }
});
