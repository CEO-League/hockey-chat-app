import {
  PRIVATE_TYPE, TEAM_TYPE, ChatError, requireProfile, privateRequest,
  tokenClaims, stableId, membershipChanges, assertPrivateGrants,
} from './streamPolicy.mjs';

export async function assertConfiguration(stream) {
  for (const name of [PRIVATE_TYPE, TEAM_TYPE]) {
    const config = await stream.chat.getChannelType({ name });

    assertPrivateGrants(config);
  }
}
export async function issueToken({ stream, profile, userId, apiKey, signToken, now = Math.floor(Date.now() / 1000) }) {
  const user = requireProfile(profile, userId);
  await assertConfiguration(stream);
  await stream.upsertUsers([user]);
  const claims = tokenClaims(userId, now);
  return { apiKey, userId, token: await signToken(claims) };
}
export async function createPrivateConversation({ stream, caller, body, profiles }) {
  const plan = privateRequest(body, caller, profiles);
  const id = await stableId(plan.kind === 'direct' ? 'dm-' : 'group-',
    plan.kind === 'direct' ? plan.members : [caller.id, body.requestId, plan.members, plan.name]);
  await stream.upsertUsers(plan.users);
  await stream.chat.getOrCreateChannel({
    type: PRIVATE_TYPE, id,
    data: { created_by_id: caller.id, members: plan.members.map(user_id => ({ user_id })),
      custom: { kind: plan.kind, ...(plan.name ? { name: plan.name } : {}) } },
  });
  return { type: PRIVATE_TYPE, id };
}
export async function allMembers(stream, type, id) {
  const members = [];
  for (let offset = 0; ; offset += 100) {
    const page = await stream.chat.queryMembers({ payload: { type, id, limit: 100, offset } });
    members.push(...page.members.map(member => member.user_id ?? member.user?.id).filter(Boolean));
    if (page.members.length < 100) return members;
  }
}
export async function reconcileTeam({ stream, team, profiles, id, checkLease = async () => {} }) {
  const users = profiles.filter(p => p.auth_user_id && p.is_system_account === false)
    .map(p => requireProfile(p, p.auth_user_id));
  const uniqueUsers = [...new Map(users.map(user => [user.id, user])).values()];
  await checkLease();
  // The server creator is never a member and is never issued a client token.
  await stream.chat.getOrCreateChannel({ type: TEAM_TYPE, id,
    data: { created_by_id: 'hockey-system', custom: { kind: 'team', name: team?.name ?? 'Former team',
      team_id: team ? String(team.id) : null } } });
  const existing = await allMembers(stream, TEAM_TYPE, id);
  const { remove, add } = membershipChanges(existing, uniqueUsers.map(user => user.id));
  // Revoke before granting. Never use a browser-provided member list.
  for (let i = 0; i < remove.length; i += 100) {
    await checkLease();
    await stream.chat.updateChannel({ type: TEAM_TYPE, id, remove_members: remove.slice(i, i + 100) });
  }
  for (let i = 0; i < uniqueUsers.length; i += 100) {
    await checkLease();
    await stream.upsertUsers(uniqueUsers.slice(i, i + 100));
  }
  for (let i = 0; i < add.length; i += 100) {
    await checkLease();
    await stream.chat.updateChannel({ type: TEAM_TYPE, id,
      add_members: add.slice(i, i + 100).map(user_id => ({ user_id })) });
  }
  await checkLease();
  await stream.chat.updateChannelPartial({ type: TEAM_TYPE, id,
    set: { 'custom.name': team?.name ?? 'Former team' } });
}
export async function readRows(db, table, columns) {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await db.from(table).select(columns).order('id').range(start, start + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
export async function syncTeams(db, stream) {
  const lease = crypto.randomUUID();
  const { data: job, error } = await db.rpc('claim_stream_sync', { p_owner: lease });
  if (error) throw error;
  if (!job) return { busy: true };
  const generation = job.generation;
  const deadline = Date.now() + 80000;
  const checkLease = async () => {
    if (Date.now() > deadline) throw new ChatError('Team sync needs another pass.', 503);
  };
  try {
    await assertConfiguration(stream);
    await stream.upsertUsers([{ id: 'hockey-system', name: 'HockeyFirst', role: 'user' }]);
    const [teams, memberships, profiles, registry] = await Promise.all([
      readRows(db, 'teams', 'id,name'),
      readRows(db, 'team_members', 'id,team_id,profile_id'),
      readRows(db, 'profiles', 'id,auth_user_id,full_name,is_system_account'),
      readRows(db, 'stream_team_channels', 'id,team_id'),
    ]);
    const known = new Map(registry.map(row => [row.team_id, row.id]));
    for (const team of teams) {
      if (!known.has(String(team.id))) {
        const id = await stableId('team-', String(team.id));
        const { error: saveError } = await db.from('stream_team_channels').upsert({ id, team_id: String(team.id) });
        if (saveError) throw saveError;
        known.set(String(team.id), id);
      }
    }
    for (const [teamId, id] of known) {
      const team = teams.find(item => String(item.id) === teamId);
      const memberIds = new Set(memberships.filter(m => String(m.team_id) === teamId).map(m => String(m.profile_id)));
      await reconcileTeam({ stream, id, team,
        profiles: team ? profiles.filter(p => memberIds.has(String(p.id))) : [], checkLease });
    }
    const { data: clean, error: finishError } = await db.rpc('finish_stream_sync',
      { p_owner: lease, p_generation: generation, p_success: true });
    if (finishError) throw finishError;
    return { busy: !clean };
  } catch (error) {
    await db.rpc('finish_stream_sync', { p_owner: lease, p_generation: generation, p_success: false });
    throw error;
  }
}
