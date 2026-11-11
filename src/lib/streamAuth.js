// Supabase remains the only login/session authority. No Stream secrets belong here.
export async function invokeChat(db, userId, name, body = {}) {
  const { data, error } = await db.auth.getSession();
  if (error || data.session?.user?.id !== userId) throw new Error('Please sign in again.');
  let session = data.session;
  if (!session.expires_at || session.expires_at * 1000 < Date.now() + 60000) {
    const refreshed = await db.auth.refreshSession();
    if (refreshed.error || refreshed.data.session?.user?.id !== userId) throw new Error('Please sign in again.');
    session = refreshed.data.session;
  }
  let result = await db.functions.invoke(name, { body, headers: { Authorization: `Bearer ${session.access_token}` } });
  if (result.error?.context?.status === 401) {
    const refreshed = await db.auth.refreshSession();
    if (refreshed.error || refreshed.data.session?.user?.id !== userId) throw new Error('Please sign in again.');
    result = await db.functions.invoke(name, { body, headers: { Authorization: `Bearer ${refreshed.data.session.access_token}` } });
  }
  if (result.error) {
    let message = 'Chat is unavailable. Please retry.';
    try { message = (await result.error.context.json()).error || message; } catch { /* Network error. */ }
    throw new Error(message);
  }
  return result.data;
}
export async function credentialsFor(db, userId, expectedKey) {
  const data = await invokeChat(db, userId, 'stream-token');
  if (data?.userId !== userId || typeof data.token !== 'string' || !data.token
      || typeof data.apiKey !== 'string' || !data.apiKey
      || (expectedKey && expectedKey !== data.apiKey)) {
    throw new Error('Chat returned invalid credentials. Please retry.');
  }
  // The response contract matches the dashboard function. Stream validates JWT expiry
  // and signature; its token provider obtains a fresh token when required.
  return { apiKey: data.apiKey, token: data.token, user: { id: data.userId } };
}
// Each mount owns its own instance. Cleanup waits for an in-flight connection before
// disconnecting it; an older effect can never disconnect a newer account's client.
export function startChatSession({ loadCredentials, createClient, onReady, onError }) {
  let disposed = false;
  let client;
  const ready = (async () => {
    const initial = await loadCredentials();
    if (disposed) return;
    client = createClient(initial.apiKey);
    let first = initial.token;
    await client.connectUser(initial.user, async () => {
      if (disposed) throw new Error('Chat session closed.');
      if (first) { const token = first; first = null; return token; }
      return (await loadCredentials(initial.apiKey)).token;
    });
    if (!disposed) onReady(client);
  })().catch(error => { if (!disposed) onError(error); });
  return () => {
    disposed = true;
    return ready.then(() => client?.disconnectUser()).catch(() => {});
  };
}
