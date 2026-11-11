import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialsFor, invokeChat, startChatSession } from './streamAuth.js';

const session = (id = 'user-a', access_token = 'supabase-token') => ({ user: { id }, access_token, expires_at: Date.now() / 1000 + 3600 });
const wireCredentials = () => ({ apiKey: 'public-key', userId: 'user-a', token: 'signed-token' });
const credentials = () => ({ apiKey: 'public-key', user: { id: 'user-a' }, token: 'signed-token' });
function dbMock(overrides = {}) {
  return { auth: { getSession: async () => ({ data: { session: session() } }),
    refreshSession: async () => ({ data: { session: session('user-a', 'fresh-token') } }) },
    functions: { invoke: async () => ({ data: wireCredentials() }) }, ...overrides };
}
test('token requests carry the Supabase bearer and no client identity', async () => {
  const db = dbMock();
  db.functions.invoke = async (name, options) => {
    assert.equal(name, 'stream-token');
    assert.deepEqual(options, { body: {}, headers: { Authorization: 'Bearer supabase-token' } });
    return { data: wireCredentials() };
  };
  assert.equal((await credentialsFor(db, 'user-a')).token, 'signed-token');
});
test('expired Supabase session refreshes before invoking the function', async () => {
  const db = dbMock();
  db.auth.getSession = async () => ({ data: { session: { ...session(), expires_at: 1 } } });
  db.functions.invoke = async (_, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fresh-token');
    return { data: wireCredentials() };
  };
  await credentialsFor(db, 'user-a');
});
test('a 401 gets one refresh/retry, while permission errors do not retry', async () => {
  const db = dbMock();
  let calls = 0;
  db.functions.invoke = async () => ++calls === 1
    ? { error: { context: { status: 401 } } } : { data: wireCredentials() };
  await credentialsFor(db, 'user-a');
  assert.equal(calls, 2);
  calls = 0;
  db.functions.invoke = async () => { calls++; return { error: { context: { status: 403, json: async () => ({ error: 'Denied' }) } } }; };
  await assert.rejects(credentialsFor(db, 'user-a'), /Denied/);
  assert.equal(calls, 1);
});
test('logout and account switching cannot mint credentials for the previous account', async () => {
  for (const next of [null, session('user-b')]) {
    const db = dbMock();
    db.auth.getSession = async () => ({ data: { session: next } });
    db.functions.invoke = () => assert.fail('must not invoke');
    await assert.rejects(credentialsFor(db, 'user-a'), /sign in/);
  }
});
test('account switching during refresh aborts the request', async () => {
  const db = dbMock();
  db.auth.getSession = async () => ({ data: { session: { ...session(), expires_at: 1 } } });
  db.auth.refreshSession = async () => ({ data: { session: session('user-b') } });
  db.functions.invoke = () => assert.fail('must not invoke');
  await assert.rejects(invokeChat(db, 'user-a', 'stream-chat'), /sign in/);
});
test('mismatched identity, missing token, and changed API key are rejected', async () => {
  for (const change of [{ userId: 'forged' }, { userId: undefined }, { token: '' }, { apiKey: 'wrong-key' }]) {
    const db = dbMock();
    db.functions.invoke = async () => ({ data: { ...wireCredentials(), ...change } });
    await assert.rejects(credentialsFor(db, 'user-a', 'public-key'), /invalid credentials/);
  }
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('token provider obtains new credentials after initial connect', async () => {
  let provider, loads = 0, disconnects = 0;
  const stop = startChatSession({
    loadCredentials: async key => { if (loads) assert.equal(key, 'public-key'); loads++; return credentials(); },
    createClient: () => ({ connectUser: async (_, fn) => { provider = fn; assert.equal(await fn(), 'signed-token'); },
      disconnectUser: async () => { disconnects++; } }),
    onReady: () => {}, onError: assert.fail,
  });
  await tick();
  await provider();
  assert.equal(loads, 2);
  await stop();
  assert.equal(disconnects, 1);
  await assert.rejects(provider(), /closed/);
});
test('unmount during connect suppresses stale state and disconnects after completion', async () => {
  let resolveConnect, ready = 0, disconnected = 0;
  const stop = startChatSession({
    loadCredentials: async () => credentials(),
    createClient: () => ({ connectUser: () => new Promise(resolve => { resolveConnect = resolve; }),
      disconnectUser: async () => { disconnected++; } }),
    onReady: () => ready++, onError: assert.fail,
  });
  await tick();
  const cleanup = stop();
  assert.equal(disconnected, 0);
  resolveConnect();
  await cleanup;
  assert.equal(ready, 0);
  assert.equal(disconnected, 1);
});
test('StrictMode cancelled bootstrap never constructs a client', async () => {
  let resolveLoad;
  const stop = startChatSession({
    loadCredentials: () => new Promise(resolve => { resolveLoad = resolve; }),
    createClient: () => assert.fail('cancelled effect must not connect'),
    onReady: assert.fail, onError: assert.fail,
  });
  const cleanup = stop();
  resolveLoad(credentials());
  await cleanup;
});
test('connection failure is reported and cleanup handles rejected connection', async () => {
  let failure, disconnected = 0;
  const stop = startChatSession({
    loadCredentials: async () => credentials(),
    createClient: () => ({ connectUser: async () => { throw new Error('offline'); },
      disconnectUser: async () => disconnected++ }),
    onReady: assert.fail, onError: error => { failure = error.message; },
  });
  await tick();
  assert.equal(failure, 'offline');
  await stop();
  assert.equal(disconnected, 1);
});

test('dashboard response needs no user object or expiresAt field', async () => {
  assert.deepEqual(await credentialsFor(dbMock(), 'user-a'), credentials());
});
