import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_GRANTS, MEMBER_GRANTS, TEAM_TYPE, requireProfile, privateRequest,
  tokenClaims, membershipChanges, stableId, assertPrivateGrants } from './streamPolicy.mjs';
import { createPrivateConversation, issueToken, reconcileTeam } from './streamService.mjs';
const alice = { id: 1, auth_user_id: 'alice', full_name: 'Alice', is_system_account: false };
const bob = { id: 2, auth_user_id: 'bob', full_name: 'Bob', is_system_account: false };
const carol = { id: 3, auth_user_id: 'carol', full_name: 'Carol', is_system_account: false };
const caller = requireProfile(alice, 'alice');
const config = () => ({ grants: structuredClone(CHANNEL_GRANTS), reactions: true, replies: true, uploads: true, read_events: true });
test('profile ID never substitutes for the authenticated user ID', () => {
  assert.deepEqual(caller, { id: 'alice', name: 'Alice', role: 'user' });
  for (const profile of [null, { ...alice, auth_user_id: 'bob' }, { ...alice, is_system_account: true }]) {
    assert.throws(() => requireProfile(profile, 'alice'), /linked player/);
  }
});
test('JWT identity and expiry are explicit seconds with bounded lifetime', () => {
  assert.deepEqual(tokenClaims('alice', 10000), { user_id: 'alice', iat: 10000, exp: 13600 });
});
test('private creation ignores forged caller, role, team, and channel identifiers', async () => {
  let request;
  await createPrivateConversation({
    stream: { upsertUsers: async () => {}, chat: { getOrCreateChannel: async value => { request = value; } } },
    caller, profiles: [bob],
    body: { kind: 'direct', profileIds: ['2'], userId: 'carol', teamId: 'unrelated',
      role: 'admin', id: 'stolen-private-channel', members: ['carol'] },
  });
  assert.equal(request.type, 'hockey_private');
  assert.equal(request.data.created_by_id, 'alice');
  assert.deepEqual(request.data.members, [{ user_id: 'alice' }, { user_id: 'bob' }]);
  assert.match(request.id, /^dm-/);
});
test('unlinked, system, self, and nonexistent recipients cannot be added', () => {
  for (const profiles of [[], [{ ...bob, auth_user_id: null }], [{ ...bob, is_system_account: true }], [{ ...bob, auth_user_id: 'alice' }]]) {
    assert.throws(() => privateRequest({ kind: 'direct', profileIds: ['2'] }, caller, profiles), /cannot be messaged/);
  }
});
test('group constraints and unknown actions fail closed', () => {
  const base = { kind: 'group', profileIds: ['2', '3'], name: 'Hockey', requestId: '11111111-1111-4111-8111-111111111111' };
  assert.deepEqual(privateRequest(base, caller, [bob, carol]).members, ['alice', 'bob', 'carol']);
  for (const change of [{ name: '' }, { name: 'x'.repeat(81) }, { requestId: 'bad' }, { profileIds: ['2'] },
    { profileIds: Array.from({ length: 20 }, (_, i) => String(i)) }, { kind: 'team' }]) {
    assert.throws(() => privateRequest({ ...base, ...change }, caller, [bob, carol]));
  }
});
test('direct conversations deduplicate regardless of who starts them', async () => {
  const ids = [];
  const stream = { upsertUsers: async () => {}, chat: { getOrCreateChannel: async ({ id }) => ids.push(id) } };
  await createPrivateConversation({ stream, caller, body: { kind: 'direct', profileIds: ['2'] }, profiles: [bob] });
  await createPrivateConversation({ stream, caller: requireProfile(bob, 'bob'), body: { kind: 'direct', profileIds: ['1'] }, profiles: [alice] });
  assert.equal(ids[0], ids[1]);
  assert.equal((await stableId('team-', '1')).length, 53);
});
test('permissions permit members only and forbid client channel/membership management', () => {
  assertPrivateGrants(config());
  for (const grant of ['create-channel', 'update-channel', 'update-channel-members', 'add-channel-members', 'join-channel']) {
    assert.ok(!MEMBER_GRANTS.includes(grant));
    const changed = config(); changed.grants.channel_member.push(grant);
    assert.throws(() => assertPrivateGrants(changed), /permissions/);
  }
  const changed = config(); changed.grants.user = ['read-channel'];
  assert.throws(() => assertPrivateGrants(changed), /permissions/);
  assert.throws(() => assertPrivateGrants({ ...config(), uploads: false }));
});
test('tokens are not issued when authorization configuration is unsafe', async () => {
  let claims;
  const stream = { chat: { getChannelType: async () => config() }, upsertUsers: async () => {},
     };
  const result = await issueToken({ stream, profile: alice, userId: 'alice', apiKey: 'public', now: 10000, signToken: async value => { claims = value; return 'signed'; } });
  assert.deepEqual(result, { apiKey: 'public', userId: 'alice', token: 'signed' });
  assert.equal(claims.exp, 13600);
  assert.equal(claims.user_id, 'alice');
  stream.chat.getChannelType = async () => ({ ...config(), grants: { user: ['read-channel'] } });
  await assert.rejects(issueToken({ stream, profile: alice, userId: 'alice', apiKey: 'public' }));
});
test('membership diff removes former members and never duplicates additions', () => {
  assert.deepEqual(membershipChanges(['alice', 'former'], ['alice', 'bob', 'bob']), { remove: ['former'], add: ['bob'] });
});
test('team reconciliation revokes before granting and excludes unlinked/system profiles', async () => {
  const operations = [];
  const stream = { upsertUsers: async users => operations.push(['users', users.map(user => user.id)]),
    chat: {
      getOrCreateChannel: async () => {},
      queryMembers: async () => ({ members: [{ user_id: 'former' }, { user_id: 'alice' }] }),
      updateChannel: async request => operations.push(request),
      updateChannelPartial: async () => {},
    } };
  await reconcileTeam({ stream, team: { id: 1, name: 'Team' }, id: 'team-1',
    profiles: [alice, bob, { ...carol, is_system_account: true }, { ...carol, auth_user_id: null }] });
  assert.deepEqual(operations[0], { type: TEAM_TYPE, id: 'team-1', remove_members: ['former'] });
  assert.deepEqual(operations.at(-1).add_members, [{ user_id: 'bob' }]);
});
test('deleted teams lose all members and failed revocation prevents additions', async () => {
  let removed;
  const stream = { upsertUsers: async () => {}, chat: {
    getOrCreateChannel: async () => {}, queryMembers: async () => ({ members: [{ user_id: 'former' }] }),
    updateChannel: async request => { removed = request.remove_members; }, updateChannelPartial: async () => {},
  } };
  await reconcileTeam({ stream, team: null, id: 'old-team', profiles: [] });
  assert.deepEqual(removed, ['former']);
  stream.chat.updateChannel = async request => { assert.ok(request.remove_members); throw new Error('outage'); };
  stream.upsertUsers = () => assert.fail('must not grant after failed revocation');
  await assert.rejects(reconcileTeam({ stream, team: { id: 1 }, id: 'team', profiles: [bob] }), /outage/);
});

test('signing failure propagates without returning credentials', async () => {
  const stream = { chat: { getChannelType: async () => config() }, upsertUsers: async () => {} };
  await assert.rejects(issueToken({ stream, profile: alice, userId: 'alice', apiKey: 'public',
    signToken: async () => { throw new Error('signing failed'); } }), /signing failed/);
});
