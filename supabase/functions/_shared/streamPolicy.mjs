export const PRIVATE_TYPE = 'hockey_private';
export const TEAM_TYPE = 'hockey_team';
export const TOKEN_TTL = 60 * 60;

export const MEMBER_GRANTS = [
  'read-channel',
  'read-channel-members',
  'create-message',
  'create-attachment',
  'update-message-owner',
  'delete-message-owner',
  'create-reaction',
  'delete-reaction-owner',
  'upload-attachment',
  'delete-attachment-owner',
  'add-links',
];

export const CHANNEL_GRANTS = {
  user: [], guest: [], anonymous: [], admin: [], moderator: [],
  channel_member: MEMBER_GRANTS, channel_moderator: MEMBER_GRANTS,
};
export class ChatError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function requireProfile(profile, userId) {
  if (!profile || profile.auth_user_id !== userId || profile.is_system_account !== false) {
    throw new ChatError('A linked player profile is required.', 403);
  }
  return { id: userId, name: profile.full_name || 'League player', role: 'user' };
}
export function tokenClaims(userId, now = Math.floor(Date.now() / 1000)) {
  return { user_id: userId, iat: now, exp: now + TOKEN_TTL };
}
export function privateRequest(body, caller, profiles) {
  if (!['direct', 'group'].includes(body.kind) || !Array.isArray(body.profileIds)
      || body.profileIds.some(id => typeof id !== 'string' || !id || id.length > 100)) {
    throw new ChatError('Choose players for this conversation.');
  }
  const ids = [...new Set(body.profileIds)];
  if (ids.length < 1 || ids.length > 19 || (body.kind === 'direct' && ids.length !== 1)) {
    throw new ChatError('Choose one player for a direct message, or up to 19 for a group.');
  }
  const recipients = ids.map(id => profiles.find(p => String(p.id) === id));
  if (recipients.some(p => !p || !p.auth_user_id || p.is_system_account !== false
      || p.auth_user_id === caller.id)) throw new ChatError('One or more players cannot be messaged.', 403);
  const users = [caller, ...recipients.map(p => requireProfile(p, p.auth_user_id))];
  const members = [...new Set(users.map(u => u.id))].sort();
  if (body.kind === 'group' && members.length < 3) throw new ChatError('Choose at least two other players for a group.');
  const name = body.kind === 'group' && typeof body.name === 'string' ? body.name.trim() : '';
  if (body.kind === 'group' && (!name || name.length > 80 || !/^[0-9a-f-]{36}$/i.test(body.requestId ?? ''))) {
    throw new ChatError('A group name (up to 80 characters) and request ID are required.');
  }
  return { users, members, name, kind: body.kind };
}
export async function stableId(prefix, value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return prefix + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
export function membershipChanges(existing, desired) {
  const before = new Set(existing);
  const after = new Set(desired);
  return { remove: [...before].filter(id => !after.has(id)), add: [...after].filter(id => !before.has(id)) };
}
export function assertPrivateGrants(config) {
  const grants = config.grants;
  if (!grants || !config.reactions || !config.replies || !config.uploads || !config.read_events) {
    throw new ChatError('Chat permissions have not been configured.', 503);
  }
  // Exact allowlist: a channel owner must never gain membership-management privileges.
  for (const [role, allowed] of Object.entries(CHANNEL_GRANTS)) {
    const actual = grants[role] ?? [];
    if (actual.length !== allowed.length || actual.some(grant => !allowed.includes(grant))) {
      throw new ChatError('Chat permissions have not been configured.', 503);
    }
  }
  // Stream includes built-in privileged roles in channel grants.
  // Our application never assigns these roles to players.
  const STREAM_GLOBAL_ROLES = new Set([
    'global_admin',
    'global_moderator',
    'global_read_only',
  ]);

  for (const role of Object.keys(grants)) {
    if (
      !Object.hasOwn(CHANNEL_GRANTS, role) &&
      !STREAM_GLOBAL_ROLES.has(role) &&
      grants[role]?.length
    ) {
      throw new ChatError('Unexpected chat role grants.', 503);
    }
  }
  }
