import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { manageableTeams } from '../utils/rsvpManagement.js';
import { emptyGameReport, FINISH_LABELS, reportScoreLabel, validateGameReport } from '../utils/gameReport.js';
import './gameReport.css';

function ReportSummary({ report, teams }) {
    return <div className="report-summary">
        <p className="report-score">{reportScoreLabel(report)}</p>
        <p>Home: {teams[0].name} · Away: {teams[1].name}</p>
        <h4>Penalties</h4>
        {report.penalties.length ? <ul className="report-penalty-list">{report.penalties.map((penalty, index) =>
            <li key={index}><strong>{teams.find(team => String(team.id) === penalty.team_id)?.name ?? 'Team'} · {penalty.player}</strong>
                <span>{penalty.infraction} · {penalty.minutes} min · {penalty.period === 'OT' ? 'OT' : 'Period ' + penalty.period}{penalty.time ? ' · ' + penalty.time : ''}</span>
            </li>)}</ul> : <p>No penalties recorded.</p>}
        <h4>Game notes</h4><p className="report-notes">{report.notes || 'No notes recorded.'}</p>
    </div>;
}

export default function GameReport({ game, access, onDirtyChange, onBusyChange, onSaved }) {
    const teams = [{ id: game.home_team_id, name: game.home_team_name || 'Home team' },
        { id: game.away_team_id, name: game.away_team_name || 'Away team' }];
    const canEdit = manageableTeams(teams.filter(team => team.id != null), access).length > 0;
    const [loaded, setLoaded] = useState(null);
    const [draft, setDraft] = useState(emptyGameReport);
    const [history, setHistory] = useState([]);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [revision, setRevision] = useState(0);
    const dirty = loaded && JSON.stringify(draft) !== JSON.stringify(loaded.report);
    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const [current, versions] = await Promise.all([
                    supabase.from('game_reports').select('*').eq('game_id', game.id).maybeSingle(),
                    supabase.from('game_report_history').select('*').eq('game_id', game.id).order('version', { ascending: false }).limit(50),
                ]);
                if (current.error) throw current.error;
                if (versions.error) throw versions.error;
                if (!cancelled) {
                    const record = current.data ?? { report: emptyGameReport(), version: 0 };
                    setLoaded(record); setDraft(record.report); setHistory(versions.data ?? []);
                }
            } catch (failure) {
                if (!cancelled) setError('Could not load the game report: ' + failure.message);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [game.id, revision]);
    useEffect(() => {
        if (!dirty) return;
        const preventLeave = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', preventLeave);
        return () => window.removeEventListener('beforeunload', preventLeave);
    }, [dirty]);
    function update(next) {
        setDraft(next); setNotice('');
        onDirtyChange?.(JSON.stringify(next) !== JSON.stringify(loaded.report));
    }
    function updatePenalty(index, patch) {
        update({ ...draft, penalties: draft.penalties.map((penalty, i) => i === index ? { ...penalty, ...patch } : penalty) });
    }
    function reload() {
        if (dirty && !window.confirm('Discard your unsaved report changes and reload?')) return;
        setLoaded(null); setEditing(false); setError(''); setNotice(''); onDirtyChange?.(false);
        setRevision(value => value + 1);
    }
    function cancel() {
        setDraft(loaded.report); setEditing(false); setError(''); onDirtyChange?.(false);
    }
    async function save(event) {
        event.preventDefault();
        if (saving || !canEdit) return;
        const validation = validateGameReport(draft, teams.map(team => team.id));
        if (validation) { setError(validation); return; }
        setSaving(true); onBusyChange?.(true); setError(''); setNotice('');
        try {
            const { data, error: failure } = await supabase.rpc('save_game_report', {
                p_game_id: String(game.id), p_report: draft, p_expected_version: loaded.version,
            });
            if (failure) throw failure;
            setLoaded(data); setDraft(data.report); setHistory(previous => [data, ...previous].slice(0, 50));
            setEditing(false); onDirtyChange?.(false); setNotice('Game report saved.');
            onSaved?.();
        } catch (failure) { setError('Could not save the report: ' + failure.message); }
        finally { setSaving(false); onBusyChange?.(false); }
    }
    if (!loaded) return <section className="game-report">
        {error ? <p role="alert">{error} <button type="button" onClick={reload}>Retry</button></p> : <p role="status">Loading game report...</p>}
    </section>;
    const numberValue = value => value === '' ? '' : Number(value);
    return <section className="game-report" aria-label="Game report">
        <div className="report-heading"><div><h4>Game report</h4><p>{loaded.version
            ? 'Last saved by ' + loaded.editor_name + ' · ' + new Date(loaded.updated_at).toLocaleString()
            : 'No post-game report has been entered.'}</p></div>
            {!editing && canEdit && <button type="button" className="action-btn action-btn--primary"
                onClick={() => setEditing(true)}>{loaded.version ? 'Edit report' : 'Add report'}</button>}
        </div>
        {!canEdit && <p>Captains of either participating team and league admins can edit this report.</p>}
        {error && <p role="alert" className="admin-save-error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {editing ? <form onSubmit={save}>
            <fieldset disabled={saving} className="report-fields">
                <legend>Final result</legend>
                <div className="report-result-fields">
                    {teams.map((team, index) => {
                        const key = index === 0 ? 'home_score' : 'away_score';
                        return <label key={key}>{index === 0 ? 'Home' : 'Away'}: {team.name}
                            <input type="number" required min="0" max="99" step="1" value={draft[key]}
                                onChange={event => update({ ...draft, [key]: numberValue(event.target.value) })} /></label>;
                    })}
                    <label>Finished in<select value={draft.finish} onChange={event => update({ ...draft, finish: event.target.value })}>
                        {Object.entries(FINISH_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select></label>
                </div>
                <h4>Penalties</h4>
                <p>Use a player name, jersey number, or Bench. Clock time is optional.</p>
                {draft.penalties.map((penalty, index) => <fieldset key={index} className="report-penalty">
                    <legend>Penalty {index + 1}</legend>
                    <div className="report-penalty-fields">
                        <label>Team<select value={penalty.team_id} onChange={event => updatePenalty(index, { team_id: event.target.value })}>
                            {teams.filter(team => team.id != null).map(team => <option key={team.id} value={String(team.id)}>{team.name}</option>)}
                        </select></label>
                        <label>Player or bench<input required maxLength={120} value={penalty.player}
                            onChange={event => updatePenalty(index, { player: event.target.value })} /></label>
                        <label>Infraction<input required maxLength={120} placeholder="e.g. Tripping" value={penalty.infraction}
                            onChange={event => updatePenalty(index, { infraction: event.target.value })} /></label>
                        <label>Minutes<input type="number" required min="1" max="60" step="1" value={penalty.minutes}
                            onChange={event => updatePenalty(index, { minutes: numberValue(event.target.value) })} /></label>
                        <label>Period<select value={penalty.period} onChange={event => updatePenalty(index, { period: event.target.value })}>
                            {['1', '2', '3', 'OT'].map(period => <option key={period}>{period}</option>)}
                        </select></label>
                        <label>Clock time<input placeholder="MM:SS" maxLength={5} value={penalty.time}
                            onChange={event => updatePenalty(index, { time: event.target.value })} /></label>
                    </div>
                    <button type="button" className="action-btn action-btn--ghost" aria-label={'Remove penalty ' + (index + 1)}
                        onClick={() => update({ ...draft, penalties: draft.penalties.filter((_, i) => i !== index) })}>Remove penalty</button>
                </fieldset>)}
                <button type="button" className="action-btn action-btn--secondary" disabled={draft.penalties.length >= 100}
                    onClick={() => update({ ...draft, penalties: [...draft.penalties, {
                        team_id: String(teams.find(team => team.id != null)?.id ?? ''), player: '', infraction: '', minutes: 2, period: '1', time: '',
                    }] })}>Add penalty</button>
                <label className="report-notes-field">Game notes<textarea rows={5} maxLength={5000} value={draft.notes}
                    onChange={event => update({ ...draft, notes: event.target.value })} /></label>
                <div className="report-actions">
                    <button type="submit" className="action-btn action-btn--primary" disabled={!dirty}>{saving ? 'Saving...' : 'Save report'}</button>
                    <button type="button" className="action-btn action-btn--secondary" onClick={cancel}>Cancel</button>
                </div>
            </fieldset>
        </form> : loaded.version > 0 && <ReportSummary report={loaded.report} teams={teams} />}
        <button type="button" className="action-btn action-btn--ghost" disabled={saving} onClick={reload}>Reload saved report</button>
        {history.length > 0 && <details className="report-history"><summary>Edit history ({history.length}{loaded.version > history.length ? ' most recent' : ''})</summary>
            {history.map(record => <details key={record.version}>
                <summary>Revision {record.version} · {record.editor_name} · {new Date(record.updated_at).toLocaleString()}</summary>
                <ReportSummary report={record.report} teams={teams} />
            </details>)}
        </details>}
    </section>;
}
