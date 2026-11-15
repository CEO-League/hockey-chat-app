import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleIcs } from '../src/utils/calendarExport.js';

test('calendar games last 60 minutes with missing or conflicting end times', () => {
    for (const end_time of [null, '22:00:00']) {
        const calendar = buildScheduleIcs([{ id: 'game', game_date: '2026-10-04', start_time: '19:30:00', end_time }]);
        assert.ok(calendar.includes('DTSTART:20261004T193000'));
        assert.ok(calendar.includes('DTEND:20261004T203000'));
    }
});

test('calendar end dates roll into the next year for late games', () => {
    const calendar = buildScheduleIcs([{ id: 'late', game_date: '2026-12-31', start_time: '23:30:00' }]);
    assert.ok(calendar.includes('DTSTART:20261231T233000'));
    assert.ok(calendar.includes('DTEND:20270101T003000'));
});
