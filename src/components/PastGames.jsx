import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatDateKey, formatGameDate } from '../utils/scheduleHelpers.js';
import { reportScoreLabel } from '../utils/gameReport.js';
import './gameReport.css';

export default function PastGames({ games, onSelect, revision }) {
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                // Chunk requests to keep long season schedules within URL limits.
                const batches = [];
                for (let i = 0; i < games.length; i += 100) {
                    batches.push(supabase.from('game_reports').select('game_id, report').in('game_id', games.slice(i, i + 100).map(game => game.id)));
                }
                const responses = await Promise.all(batches);
                const failure = responses.find(response => response.error);
                if (failure) throw failure.error;
                if (!cancelled) {
                    setResult({ games, revision, reports: Object.fromEntries(responses.flatMap(response => response.data ?? []).map(row => [row.game_id, row.report])) });
                    setError('');
                }
            } catch (failure) { if (!cancelled) setError('Could not load results: ' + failure.message); }
        }
        load();
        return () => { cancelled = true; };
    }, [games, revision, retry]);
    const past = games.filter(game => game.game_date <= formatDateKey(new Date()))
        .sort((a, b) => b.game_date.localeCompare(a.game_date) || (b.start_time ?? '').localeCompare(a.start_time ?? ''));
    const loading = !result || result.games !== games || result.revision !== revision;
    return <section className="content-card past-games" aria-label="Past games">
        <h3>Past Games</h3><p>Recent games, including today. Open a game to view or add its report.</p>
        {error ? <p role="alert">{error} <button type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</button></p>
            : loading && <p role="status">Loading results...</p>}
        {!past.length && <p>No games to report yet.</p>}
        <ul>{past.map(game => <li key={game.id}>
            <button type="button" onClick={() => onSelect(game)}>
                <span>{formatGameDate(game.game_date, { includeYear: true })}</span>
                <strong>{game.home_team_name} vs {game.away_team_name}</strong>
                <span>{error ? 'Result unavailable' : loading ? 'Loading result...' : reportScoreLabel(result.reports[game.id])}</span>
            </button>
        </li>)}</ul>
    </section>;
}
