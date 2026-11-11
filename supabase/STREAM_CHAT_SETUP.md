# Stream Chat deployment

## Identity and compatibility

The stream-token function follows the supplied dashboard implementation:
withSupabase({ auth: "user" }) from @supabase/server@^1 validates the caller;
ctx.userClaims.id supplies the identity, and jose@^6 SignJWT signs the token.
The response is exactly { apiKey, userId, token }. The local version also checks
linked-player eligibility, reconciles dirty team access, verifies channel permissions,
and upserts the Stream user before signing. Deploy this local version to retain those
checks; the original dashboard snippet only authenticates the Supabase account.
The stream-chat endpoint retains getUser(bearer) verification using
@supabase/supabase-js@2.108.2; both paths use the same Supabase Auth UUID.

Stream user IDs are Supabase Auth UUIDs (profiles.auth_user_id), NEVER profiles.id.
Existing Stream users/channels created under another ID scheme need a migration.
The server SDK is @stream-io/node-sdk@0.7.40, separate from browser stream-chat@10.0.1.
SignJWT signs an HS256 JWT with user_id, iat and exp in seconds.
Tokens last one hour, matching the supplied dashboard function. The frontend does
not require an expiresAt response field; Stream validates token expiry and invokes
the token provider to renew it.
The browser supplies an async token provider, refreshes Supabase sessions when needed,
and disconnects on logout/account change/unmount. No Stream secret or server token
is returned to the browser. Stream credentials are held in memory only.

References:
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/auth-legacy-jwt
- https://getstream.io/chat/docs/react/tokens-and-authentication/
- https://getstream.io/chat/docs/sdk/react/release-guides/upgrade-to-v15/
- https://getstream.io/chat/docs/node/chat-permission-policies/
- https://getstream.io/chat/docs/react/channel-members/

## Supabase dashboard / deployment

1. Apply 20261110000000_stream_chat.sql after the application's existing schema.
   It adds a server-only registry, reconciliation lease/generation, and creation
   rate limits. Triggers track team, membership, and profile changes. No existing
   application policies are replaced. Existing profile/team authorization and
   save_player_teams must already prevent unauthorized changes.
2. Set Edge Function secrets STREAM_API_KEY, STREAM_API_SECRET and
   STREAM_SYNC_SECRET (an independently generated random secret, at least 32 bytes).
   Standard SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must exist.
   Never put the Stream secret in a VITE_ variable, .env committed to git, or frontend code.
   No new frontend environment variable is needed: stream-token returns the public key.
3. Deploy stream-token, stream-chat, and stream-sync from this repository.
   verify_jwt=false is intentional: stream-token uses withSupabase user validation,
   stream-chat calls getUser, and the worker validates its own private bearer secret. This also supports asymmetric
   Supabase signing keys. Do not deploy these endpoints without their handler checks.
4. Call stream-sync once with Authorization: Bearer <STREAM_SYNC_SECRET> and
   JSON {"action":"configure"}. This creates/configures hockey_private and hockey_team,
   reconciles team channels, and rejects unauthenticated callers.
   Use a trusted terminal or the Supabase function tester, never frontend code.
5. Create database webhooks on INSERT/UPDATE/DELETE for team_members, profiles, and
   teams, targeting /functions/v1/stream-sync, using POST and the private bearer
   header above. Payload IDs are ignored: the worker reads the database itself.
6. Enable pg_cron, pg_net and Vault. Store the worker secret and project function URL
   in Vault as stream_sync_secret and stream_sync_url. Apply setup/stream_chat_cron.sql.
   The once-per-minute schedule retries missed webhooks and temporary failures.
   Confirm successful worker responses and generation = synced_generation.
7. Keep Stream authentication and permission checks ENABLED. Use permissions v2.
   The configure action sets explicit allowlists: only channel members can read,
   send/reply/react/upload; no browser role can create channels, join, add/remove
   members, or change channel settings. Creators do not receive extra privileges.
   Token issuance checks these channel-type grants and refuses unsafe configurations.
   Use a dedicated Stream app or audit other channel types: a user token is app-wide.
   Disable permissive client channel creation on unused types.
8. Configure Stream upload file types/size limits and retention to your league's
   requirements. Uploads use Stream's attachment service, not a public Supabase bucket.
   Stream attachment URLs are bearer links: recipients can share downloaded files/URLs.
   Do not treat an already-issued attachment URL as independently membership-gated.

## Membership semantics and operational limits

Team chat membership follows ONLY team_members, not spare preferences, active_team_id,
or client-supplied IDs. All linked main-team players are provisioned by the worker.
Admins do not automatically read every conversation. Private conversations contain
the authenticated creator and explicitly selected linked players; DMs are deterministic
and group retries are idempotent. Private member editing is deliberately unavailable.

Membership replication across Supabase and Stream is not atomic. A removed player
can retain access until the webhook/worker successfully removes them in Stream;
the cron fallback normally runs within a minute, but outages can extend that window.
Stream then denies subsequent requests; previously delivered/downloaded data cannot
be recalled. If immediate revocation is mandatory, do not enable this deployment
until a synchronous, fail-closed membership-change workflow is implemented.
Monitor stream_sync_state and Edge Function errors. New token issuance fails closed
while a dirty membership generation is being reconciled. The worker uses a 120-second
lease and an 80-second work deadline; a changed generation stays dirty for retry.
For large leagues exceeding this window, split reconciliation into per-team jobs.
Supabase logout disconnects this browser. An independently stolen Stream token can
remain usable until its one-hour expiry; emergency revocation requires Stream's
server-side user-token revocation/deactivation.

Profile and membership writes must already be authorized in Supabase. The legacy
schema/RLS and save_player_teams SQL are absent here, so verify those in the dashboard.
Changing a player's Auth link or marking them as system removes them from team chats
on sync; existing private memberships require an explicit account-offboarding policy.

## Verification

Local: node --test src/lib/*.test.mjs src/utils/*.test.mjs supabase/functions/_shared/*.test.mjs
and npm run build. Edge type checks use Deno check on all three function entrypoints.

Before rollout, use two player accounts and one outsider:
- Sign in via both Google and password; verify matching UUIDs and token expiry.
- Wait for token refresh; sign out/in as another user and confirm no old channels.
- Start a DM from both ends; confirm one channel. Create a group; reload for history.
- Send emoji reactions, threaded/quoted replies, image/file attachments; test errors.
- Verify unread badges on other tabs, reconnect, and scroll back through history.
- At mobile width, test conversation navigation, keyboard and long messages.
- Using a browser token directly, attempt another private channel ID, joining,
  adding members, channel creation, and modifying grants: all must fail.
- Forge sender/profile/team fields in Edge requests: no impersonation or team access.
- Change main team, spare preferences, remove a membership, delete a team, and
  verify reconciliation removes obsolete access. Test failed sync and cron recovery.
- Verify anonymous, expired-session, unlinked, system-account and oversized requests fail.
