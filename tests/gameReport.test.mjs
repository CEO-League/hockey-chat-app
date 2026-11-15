import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyGameReport, validateGameReport, reportScoreLabel } from '../src/utils/gameReport.js';
const valid = () => ({ ...emptyGameReport(), home_score: 3, away_score: 1 });
const penalty = () => ({ team_id: '1', player: 'Bench', infraction: 'Too many players', minutes: 2, period: '2', time: '9:05' });
test('blank scores are not mistaken for a 0-0 final; zero and regulation ties are accepted', () => {
    assert.ok(validateGameReport(emptyGameReport(), [1, 2]));
    assert.equal(validateGameReport({ ...valid(), home_score: 0, away_score: 0 }, [1, 2]), '');
    for (const value of [-1, 1.5, 100, '3', null, NaN]) assert.ok(validateGameReport({ ...valid(), home_score: value }, [1, 2]));
});
test('finish, notes, and penalty details are validated', () => {
    assert.equal(validateGameReport({ ...valid(), penalties: [penalty()] }, [1, 2]), '');
    for (const patch of [{ team_id: '3' }, { player: ' ' }, { infraction: '' }, { minutes: 0 }, { minutes: 1.5 },
        { period: '4' }, { time: '2:60' }, { time: '100:00' }, { time: null }]) {
        assert.ok(validateGameReport({ ...valid(), penalties: [{ ...penalty(), ...patch }] }, [1, 2]), JSON.stringify(patch));
    }
    assert.equal(validateGameReport({ ...valid(), penalties: [{ ...penalty(), time: '', period: 'OT' }] }, [1, 2]), '');
    for (const patch of [{ finish: 'unknown' }, { finish: 'toString' }, { notes: 'a'.repeat(5001) }, { penalties: Array(101).fill(penalty()) },
        { home_score: 1, finish: 'overtime' }, { home_score: 1, finish: 'shootout' }]) {
        assert.ok(validateGameReport({ ...valid(), ...patch }, [1, 2]));
    }
});
test('score summaries preserve home/away ordering and finish', () => {
    assert.equal(reportScoreLabel(null), 'Report not entered');
    assert.equal(reportScoreLabel(valid()), '3 – 1 · Final');
    assert.equal(reportScoreLabel({ ...valid(), finish: 'shootout' }), '3 – 1 · Final (SO)');
});
