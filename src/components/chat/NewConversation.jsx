import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { invokeChat } from '../../lib/streamAuth';

export default function NewConversation({ userId, onCreated, onCancel }) {
  const [kind, setKind] = useState('direct');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await invokeChat(supabase, userId, 'stream-chat', { action: 'people', search, offset });
        if (cancelled) return;
        setPeople(current => offset ? [...current, ...result.people] : result.people);
        setHasMore(result.hasMore);
        setError('');
      } catch (error) { if (!cancelled) setError(error.message); }
      finally { if (!cancelled) setLoading(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId, search, offset]);
  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const channel = await invokeChat(supabase, userId, 'stream-chat', {
        action: 'create', kind, name, profileIds: selected.map(player => String(player.id)), requestId,
      });
      await onCreated(channel);
    } catch (error) { setError(error.message); setSaving(false); }
  }
  function toggle(player) {
    setSelected(current => current.some(item => item.id === player.id)
      ? current.filter(item => item.id !== player.id)
      : kind === 'direct' ? [player] : [...current, player].slice(0, 19));
  }
  return <form className="hockey-new-chat" onSubmit={submit} aria-label="New conversation">
    <h3>New conversation</h3>
    <label>Conversation type<select value={kind} disabled={saving}
      onChange={event => { setKind(event.target.value); setSelected([]); }}>
      <option value="direct">Direct message</option><option value="group">Group chat</option>
    </select></label>
    {kind === 'group' && <label>Group name<input required maxLength={80} value={name}
      disabled={saving} onChange={event => setName(event.target.value)} /></label>}
    <label>Find a player<input type="search" value={search} disabled={saving}
      onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label>
    <p>{selected.length ? selected.map(player => player.full_name).join(', ') : 'Choose players with linked accounts.'}</p>
    <div className="hockey-people-list" aria-busy={loading}>
      {people.map(player => <label key={player.id}>
        <input type="checkbox" checked={selected.some(item => item.id === player.id)}
          disabled={saving} onChange={() => toggle(player)} />{player.full_name}
      </label>)}
      {!loading && !people.length && <p>No matching players.</p>}
      {loading && <p role="status">Loading players?</p>}
      {hasMore && <button type="button" disabled={loading || saving} onClick={() => setOffset(value => value + 30)}>More players</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="hockey-chat-actions">
      <button className="action-btn action-btn--primary" disabled={saving || selected.length < (kind === 'group' ? 2 : 1)}>
        {saving ? 'Opening?' : 'Start conversation'}
      </button>
      <button className="action-btn action-btn--ghost" type="button" disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
