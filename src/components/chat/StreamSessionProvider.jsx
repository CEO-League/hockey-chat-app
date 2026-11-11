import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { credentialsFor, startChatSession } from '../../lib/streamAuth';
import { StreamContext } from './StreamContext';

function Connection({ userId, children, retry }) {
  const [state, setState] = useState({ client: null, error: '', unread: 0, online: true });
  useEffect(() => {
    let stopped = false;
    let subscription;
    let stopSession;
    import('stream-chat').then(({ StreamChat }) => {
      if (stopped) return;
      stopSession = startChatSession({
        loadCredentials: (key) => credentialsFor(supabase, userId, key),
        createClient: (key) => new StreamChat(key),
        onReady: (client) => {
          setState({ client, error: '', unread: client.user?.total_unread_count ?? 0, online: true });
          subscription = client.on((event) => {
            if (stopped) return;
            if (typeof event.total_unread_count === 'number') {
              setState(current => ({ ...current, unread: event.total_unread_count }));
            }
            if (event.type === 'connection.changed') {
              setState(current => ({ ...current, online: event.online !== false }));
            }
          });
        },
        onError: (error) => setState(current => ({ ...current, error: error.message })),
      });
    }).catch(() => {
      if (!stopped) setState(current => ({ ...current, error: 'Could not load chat. Please retry.' }));
    });
    return () => { stopped = true; subscription?.unsubscribe(); stopSession?.(); };
  }, [userId]);
  return <StreamContext.Provider value={{ ...state, userId, retry }}>{children}</StreamContext.Provider>;
}
export default function StreamSessionProvider({ userId, children }) {
  const [attempt, setAttempt] = useState(0);
  return <Connection key={`${userId}:${attempt}`} userId={userId} retry={() => setAttempt(value => value + 1)}>
    {children}
  </Connection>;
}
