import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { manageableTeams } from '../utils/rsvpManagement.js';
import { LINE_GROUPS, emptyGameLines, assignedPlayerIds, validateGameLines } from '../utils/gameLines.js';
import './gameLines.css';

const RSVP_LABELS = { going: 'Going', maybe: 'Maybe', out: 'Out', pending: 'No response' };

export default function GameLines({ game, access, initialTeamId, onDirtyChange, onBusyChange }) {
    const teams = [
        { id: game.home_team_id, name: game.home_team_name || 'Home team' },
        { id: game.away_team_id, name: game.away_team_name || 'Away team' },
    ].filter(team => team.id != null);
    const [teamId, setTeamId] = useState(() => String(
        teams.find(team => String(team.id) === String(initialTeamId))?.id ?? teams[0]?.id ?? ''));
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const team = teams.find(item => String(item.id) === teamId);
    function markDirty(value) { setDirty(value); onDirtyChange?.(value); }
    function markBusy(value) { setBusy(value); onBusyChange?.(value); }
    function changeTeam(value) {
        if (busy) return;
        if (dirty && !window.confirm('Discard your unsaved line changes?')) return;
        markDirty(false);
        setTeamId(value);
    }
    return <section className="game-lines" aria-label="Game lines">
        <div className="game-lines-toolbar">
            <label>Team<select disabled={busy} value={teamId} onChange={event => changeTeam(event.target.value)}>
                {teams.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
            </select></label>
            <p>Lines are saved for this game only.</p>
        </div>
        {team && <TeamLines key={`${game.id}:${teamId}`} gameId={game.id} team={team}
            canEdit={manageableTeams([team], access).length > 0} onDirtyChange={markDirty} onBusyChange={markBusy} />}
    </section>;
}

function TeamLines({ gameId, team, canEdit, onDirtyChange, onBusyChange }) {
    const [loaded, setLoaded] = useState(null);
    const [draft, setDraft] = useState(null);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [revision, setRevision] = useState(0);
    const [activeGroup, setActiveGroup] = useState('forwards');
    const dirty = draft && loaded && JSON.stringify(draft) !== JSON.stringify(loaded.lines);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const results = await Promise.all([
                    supabase.from('game_lines').select('lines, version, updated_at').eq('game_id', gameId).eq('team_id', team.id).maybeSingle(),
                    supabase.from('team_members').select('profile_id, position, profiles(id, full_name)').eq('team_id', team.id),
                    supabase.from('game_rsvps').select('profile_id, status').eq('game_id', gameId),
                ]);
                const failure = results.find(result => result.error);
                if (failure) throw failure.error;
                if (cancelled) return;
                const record = results[0].data;
                const roster = [...new Map((results[1].data ?? []).map(member => [String(member.profile_id), {
                    id: String(member.profile_id), name: member.profiles?.full_name || 'Unnamed player', position: member.position,
                }])).values()].sort((a, b) => a.name.localeCompare(b.name));
                const lines = record?.lines ?? emptyGameLines();
                setLoaded({ lines, roster, version: record?.version ?? 0, updatedAt: record?.updated_at,
                    responses: Object.fromEntries((results[2].data ?? []).map(row => [String(row.profile_id), row.status])) });
                setDraft(lines);
            } catch (failure) {
                if (!cancelled) setError(`Could not load lines: ${failure.message}`);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [gameId, team.id, revision]);

    useEffect(() => {
        if (!dirty) return;
        const preventLeave = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', preventLeave);
        return () => window.removeEventListener('beforeunload', preventLeave);
    }, [dirty]);

    function update(next) {
        setDraft(next);
        setNotice('');
        onDirtyChange(JSON.stringify(next) !== JSON.stringify(loaded.lines));
    }
    function cancel() {
        setDraft(loaded.lines); setEditing(false); setError(''); onDirtyChange(false);
    }
    function reload() {
        if (dirty && !window.confirm('Discard your unsaved changes and reload saved lines?')) return;
        setLoaded(null); setDraft(null); setEditing(false); setError(''); setNotice('');
        onDirtyChange(false); setRevision(value => value + 1);
    }
    async function save() {
        if (saving || !canEdit) return;
        const validation = validateGameLines(draft, new Set(loaded.roster.map(player => player.id)));
        if (validation) { setError(validation); return; }
        setSaving(true); onBusyChange(true); setError(''); setNotice('');
        try {
            const { data, error: failure } = await supabase.rpc('save_game_lines', {
                p_game_id: String(gameId), p_team_id: String(team.id), p_lines: draft, p_expected_version: loaded.version,
            });
            if (failure) throw failure;
            setLoaded(previous => ({ ...previous, lines: draft, version: data.version, updatedAt: data.updated_at }));
            setEditing(false); onDirtyChange(false); setNotice('Lines saved.');
        } catch (failure) { setError(`Could not save lines: ${failure.message}`); }
        finally { setSaving(false); onBusyChange(false); }
    }
    if (!loaded) return <div>
        {error ? <p role="alert">{error} <button type="button" onClick={reload}>Retry</button></p>
            : <p role="status">Loading lines...</p>}
    </div>;
    const assigned = new Set(assignedPlayerIds(draft));
    return <>
        <div className="game-lines-heading">
            <div><h4>{team.name} lines</h4><p>{loaded.updatedAt
                ? `Last saved ${new Date(loaded.updatedAt).toLocaleString()}` : 'No lines have been saved yet.'}</p></div>
            {!editing && canEdit && <button type="button" className="action-btn action-btn--primary"
                onClick={() => { setEditing(true); setNotice(''); }}>Edit lines</button>}
        </div>
        {!canEdit && <p className="game-lines-note">Only this team's captains and admins can change these lines.</p>}
        {error && <p role="alert" className="admin-save-error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <nav className="game-lines-segments" aria-label="Line groups">
            {LINE_GROUPS.map(group => <button key={group.key} type="button"
                aria-pressed={activeGroup === group.key} onClick={() => setActiveGroup(group.key)}>
                {{ forwards: 'Forwards', defense: 'Defense', goalies: 'Goalies' }[group.key]}
            </button>)}
        </nav>
        <fieldset className={`game-lines-fields${editing ? ' is-editing' : ''}`} disabled={saving}>
            <legend className="sr-only">Player positions</legend>
            {LINE_GROUPS.map(group => <section className={`game-lines-group${activeGroup === group.key ? ' is-active' : ''}`} key={group.key}>
                <h5>{group.title}</h5>
                {draft[group.key].map((row, rowIndex) => <div className="game-line" key={rowIndex}>
                    <div className="game-line-heading"><strong>{group.label} {rowIndex + 1}</strong>
                        {editing && draft[group.key].length > 1 && <button type="button" className="game-line-remove"
                            disabled={row.some(Boolean)} title={row.some(Boolean) ? 'Clear this group before removing it' : undefined}
                            onClick={() => update({ ...draft, [group.key]: draft[group.key].filter((_, index) => index !== rowIndex) })}
                            aria-label={`Remove ${group.label.toLowerCase()} ${rowIndex + 1}`}>Remove</button>}
                    </div>
                    <div className="game-line-positions" style={{ '--line-columns': group.positions.length }}>
                        {group.positions.map((position, positionIndex) => {
                            const id = row[positionIndex];
                            const player = loaded.roster.find(item => item.id === id);
                            const status = loaded.responses[id] ?? 'pending';
                            return <label className="game-line-position" key={position}>
                                <span>{position}</span>
                                {editing ? <select aria-label={`${group.label} ${rowIndex + 1} ${position}`}
                                    value={id} onChange={event => update({ ...draft, [group.key]: draft[group.key].map((values, index) =>
                                        index === rowIndex ? values.map((value, slot) => slot === positionIndex ? event.target.value : value) : values) })}>
                                    <option value="">Unassigned</option>
                                    {id && !player && <option value={id}>Player no longer on roster</option>}
                                    {loaded.roster.map(item => <option key={item.id} value={item.id} disabled={assigned.has(item.id) && item.id !== id}>
                                        {item.name}{item.position ? ` (${item.position})` : ''} - {RSVP_LABELS[loaded.responses[item.id]] ?? 'No response'}
                                    </option>)}
                                </select> : <strong>{player?.name ?? (id ? 'Player no longer on roster' : 'Unassigned')}</strong>}
                                {player && <small className={`game-line-status game-line-status--${status}`}>{RSVP_LABELS[status] ?? 'No response'}</small>}
                            </label>;
                        })}
                    </div>
                </div>)}
                {editing && draft[group.key].length < group.max && <button type="button" className="action-btn action-btn--secondary"
                    onClick={() => update({ ...draft, [group.key]: [...draft[group.key], group.positions.map(() => '')] })}>
                    Add {group.label.toLowerCase()}</button>}
            </section>)}
        </fieldset>
        <p className="game-lines-note">{loaded.roster.filter(player => !assigned.has(player.id)).length} rostered players unassigned{dirty ? ' · Unsaved changes' : ''}</p>
        <div className="game-lines-actions">
            {editing && <>
                <button type="button" className="action-btn action-btn--primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save lines'}</button>
                <button type="button" className="action-btn action-btn--secondary" disabled={saving} onClick={cancel}>Cancel</button>
            </>}
            <button type="button" className="action-btn action-btn--ghost" disabled={saving} onClick={reload}>Reload saved lines</button>
        </div>
    </>;
}
