import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Chat, Channel, ChannelHeader, MessageList, MessageComposer, Thread, ThreadHeader,
  WorkspaceNavigationProvider, defaultWorkspaceNavigation,
} from 'stream-chat-react';
import 'stream-chat-react/dist/css/index.css';
import { useStreamSession } from './StreamContext';
import NewConversation from './NewConversation';
import './chat.css';

const TYPES = ['hockey_private', 'hockey_team'];
function conversationName(channel, userId) {
  return channel.data?.custom?.name || Object.values(channel.state.members)
    .filter(member => member.user?.id !== userId).map(member => member.user?.name || 'League player').join(', ') || 'Conversation';
}
function Workspace({ client, userId, active, draft, onDraftChange, gameContext, onQuickAction }) {
  const [channels, setChannels] = useState([]);
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [, rerender] = useState(0);
  const filters = useMemo(() => ({ type: { $in: TYPES }, members: { $in: [userId] } }), [userId]);

  useEffect(() => {
    let cancelled = false;
    client.queryChannelsAndHydrate({ filter_conditions: filters, sort: [{ field: 'last_message_at', direction: -1 }],
      limit: 30, message_limit: 30, state: true, watch: true }).then(result => {
      if (cancelled) return;
      setChannels(result); setHasMore(result.length === 30); setError('');
    }).catch(() => { if (!cancelled) setError('Conversations could not be loaded. Retry below.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, filters, revision]);
  useEffect(() => {
    const subscription = client.on(event => {
      rerender(value => value + 1);
      if (['notification.added_to_channel', 'notification.message_new', 'connection.recovered'].includes(event.type)) {
        setRevision(value => value + 1);
      }
      if (['notification.removed_from_channel', 'channel.deleted'].includes(event.type)) {
        setChannels(current => current.filter(channel => channel.cid !== event.cid));
        setSelected(current => current?.cid === event.cid ? null : current);
        setThread(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [client]);
  useEffect(() => {
    if (!active || !selected || !draft) return;
    selected.messageComposer.textComposer.setText(draft);
    onDraftChange('');
  }, [active, selected, draft, onDraftChange]);
  useEffect(() => { if (active && thread) return thread.activate(); }, [active, thread]);
  const choose = useCallback((channel) => {
    setSelected(channel); setThread(null); setCreating(false);
  }, []);
  const navigation = useMemo(() => ({
    ...defaultWorkspaceNavigation,
    openChannel: choose,
    openThread: target => setThread(target.message
      ? client.threads.ensure({ channel: target.channel, parentMessage: target.message }) : target),
    closeThread: () => setThread(null),
    closeChannel: () => { setSelected(null); setThread(null); },
    goBack: () => { if (thread) setThread(null); else setSelected(null); },
    canGoBack: () => true,
    isChannelActive: cid => active && selected?.cid === cid,
    isThreadActive: id => active && thread?.id === id,
    isThreadDismissable: () => true,
    openChannels: selected ? [selected] : [],
    openThreads: thread ? [thread] : [],
  }), [active, choose, client, selected, thread]);
  async function created({ type, id }) {
    const channel = client.channel(type, id);
    await channel.watch();
    setChannels(current => [channel, ...current.filter(item => item.cid !== channel.cid)]);
    choose(channel);
  }
  async function loadMore() {
    setLoading(true);
    try {
      const result = await client.queryChannelsAndHydrate({ filter_conditions: filters,
        sort: [{ field: 'last_message_at', direction: -1 }], limit: 30, offset: channels.length,
        message_limit: 30, state: true, watch: true });
      setChannels(current => [...new Map([...current, ...result].map(channel => [channel.cid, channel])).values()]);
      setHasMore(result.length === 30);
    } catch { setError('More conversations could not be loaded. Please retry.'); }
    finally { setLoading(false); }
  }
  return <Chat client={client} theme="messaging light">
    <WorkspaceNavigationProvider value={navigation}>
      <div className={`hockey-chat-workspace ${selected || creating ? 'has-selection' : ''}`}>
        <aside className="hockey-conversations" aria-label="Conversations">
          <button className="action-btn action-btn--primary" onClick={() => { setCreating(true); setThread(null); }}>New conversation</button>
          {loading && <p role="status">Loading conversations?</p>}
          {!loading && !channels.length && <p>No conversations yet. Start a direct message or group chat. Main-team chats appear automatically.</p>}
          {channels.map(channel => <button key={channel.cid} className={`hockey-conversation ${selected?.cid === channel.cid ? 'is-active' : ''}`}
            aria-pressed={selected?.cid === channel.cid} onClick={() => choose(channel)}>
            <span>{conversationName(channel, userId)}</span>
            <small>{channel.data?.custom?.kind === 'team' ? 'Team' : channel.data?.custom?.kind === 'group' ? 'Group' : 'Direct message'}</small>
            {channel.countUnread() > 0 && <span className="hockey-chat-badge" aria-label={`${channel.countUnread()} unread messages`}>{channel.countUnread()}</span>}
          </button>)}
          {hasMore && <button disabled={loading} onClick={loadMore}>More conversations</button>}
          {error && <p role="alert">{error} <button onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
        </aside>
        <section className="hockey-conversation-panel" aria-label="Conversation">
          {(selected || creating) && <button className="hockey-chat-back action-btn action-btn--ghost"
            onClick={() => { setSelected(null); setThread(null); setCreating(false); }}>Back to conversations</button>}
          {creating ? <NewConversation userId={userId} onCreated={created} onCancel={() => setCreating(false)} />
            : selected && active ? <Channel channel={selected}>
              {thread ? <Thread thread={thread}>
                <ThreadHeader /><MessageList hideDeletedMessages /><MessageComposer />
              </Thread> : <>
                <ChannelHeader title={conversationName(selected, userId)} />
                {draft && <p className="hockey-chat-context">Your game message is ready.</p>}
                {gameContext && <details className="hockey-chat-context">
                  <summary>Next game: {gameContext.matchup}</summary>
                  <p>{gameContext.date} ? {gameContext.time} ? {gameContext.rink}</p>
                  <div className="hockey-chat-actions">
                    <button onClick={() => onQuickAction('game')}>Message about game</button>
                    <button onClick={() => onQuickAction('sub')}>Request a sub</button>
                    <button onClick={() => onQuickAction('goalie')}>Ask for goalie</button>
                    <button onClick={() => onQuickAction('prompt')}>Prompt replies</button>
                  </div>
                </details>}
                <MessageList hideDeletedMessages /><MessageComposer />
              </>}
            </Channel> : <div className="hockey-chat-placeholder">
              <h3>Your hockey conversations</h3>
              <p>Select a conversation or start a new one.</p>
              {draft && <p>Your game message will be added when you select a conversation.</p>}
            </div>}
        </section>
      </div>
    </WorkspaceNavigationProvider>
  </Chat>;
}
export default function ChatPage(props) {
  const session = useStreamSession();
  return <div className="page-view hockey-chat-page">
    <header className="page-header"><h2>Chat</h2><p className="page-subtitle">Players, groups, and your team</p></header>
    {session.error ? <section className="content-card" role="alert"><p>{session.error}</p>
      <button className="action-btn action-btn--primary" onClick={session.retry}>Retry chat</button></section>
      : !session.client ? <p role="status">Connecting to chat?</p>
      : <>
        {!session.online && <p role="status">Reconnecting? Messages will update when the connection returns.</p>}
        <Workspace key={session.userId} client={session.client} userId={session.userId} {...props} />
      </>}
  </div>;
}
