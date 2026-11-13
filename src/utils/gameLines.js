export const LINE_GROUPS = [
    { key: 'forwards', title: 'Forward lines', label: 'Line', positions: ['LW', 'C', 'RW'], max: 4 },
    { key: 'defense', title: 'Defense pairs', label: 'Pair', positions: ['LD', 'RD'], max: 4 },
    { key: 'goalies', title: 'Goalies', label: 'Goalie', positions: ['G'], max: 2 },
];

export function emptyGameLines() {
    return { forwards: Array.from({ length: 3 }, () => ['', '', '']),
        defense: Array.from({ length: 3 }, () => ['', '']), goalies: [['']] };
}

export function assignedPlayerIds(lines) {
    return LINE_GROUPS.flatMap(({ key }) => lines[key].flat()).filter(Boolean);
}

export function validateGameLines(lines, rosterIds) {
    if (!lines || typeof lines !== 'object' || Array.isArray(lines)
        || Object.keys(lines).length !== LINE_GROUPS.length) return 'Invalid lines.';
    for (const group of LINE_GROUPS) {
        const rows = lines[group.key];
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > group.max
            || rows.some(row => !Array.isArray(row) || row.length !== group.positions.length
                || row.some(id => typeof id !== 'string'))) return 'Invalid line positions.';
    }
    const assigned = assignedPlayerIds(lines);
    if (new Set(assigned).size !== assigned.length) return 'A player can only fill one position.';
    if (assigned.some(id => !rosterIds.has(id))) return 'Remove players who are no longer on this team before saving.';
    return '';
}
