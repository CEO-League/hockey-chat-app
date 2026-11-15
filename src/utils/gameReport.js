export const FINISH_LABELS = { regulation: 'Regulation', overtime: 'Overtime', shootout: 'Shootout' };
export function emptyGameReport() {
    return { home_score: '', away_score: '', finish: 'regulation', penalties: [], notes: '' };
}
export function validateGameReport(report, teamIds) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) return 'Invalid game report.';
    for (const side of ['home', 'away']) {
        const score = report[side + '_score'];
        if (!Number.isInteger(score) || score < 0 || score > 99) return 'Enter a whole-number score from 0 to 99 for each team.';
    }
    if (!Object.hasOwn(FINISH_LABELS, report.finish)) return 'Choose how the game finished.';
    if (report.finish !== 'regulation' && report.home_score === report.away_score) return 'An overtime or shootout result cannot be tied.';
    if (typeof report.notes !== 'string' || report.notes.length > 5000) return 'Keep game notes under 5,000 characters.';
    if (!Array.isArray(report.penalties) || report.penalties.length > 100) return 'A report can contain up to 100 penalties.';
    for (const penalty of report.penalties) {
        if (!penalty || !teamIds.map(String).includes(penalty.team_id)) return 'Choose a participating team for every penalty.';
        if (typeof penalty.player !== 'string' || !penalty.player.trim() || penalty.player.length > 120) return 'Enter a player name, jersey number, or Bench (up to 120 characters).';
        if (typeof penalty.infraction !== 'string' || !penalty.infraction.trim() || penalty.infraction.length > 120) return 'Enter each infraction (up to 120 characters).';
        if (!Number.isInteger(penalty.minutes) || penalty.minutes < 1 || penalty.minutes > 60) return 'Penalty minutes must be a whole number from 1 to 60.';
        if (!['1', '2', '3', 'OT'].includes(penalty.period)) return 'Choose a period for every penalty.';
        if (typeof penalty.time !== 'string' || (penalty.time !== '' && !/^\d{1,2}:[0-5]\d$/.test(penalty.time))) return 'Use M:SS or MM:SS for the optional clock time.';
    }
    return '';
}
export function reportScoreLabel(report) {
    return report ? `${report.home_score} – ${report.away_score} · Final${report.finish === 'regulation' ? '' : report.finish === 'overtime' ? ' (OT)' : ' (SO)'}` : 'Report not entered';
}
