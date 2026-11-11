# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Database migrations

Before deploying the editable industry field, run
`supabase/migrations/20260928000000_add_custom_industry.sql` in the Supabase SQL
editor (or apply it through your migration workflow). This adds a custom industry
to business listings and makes the preset industry optional. Existing preset
selections are preserved; listing access continues to use existing policies.

### Main and spare teams

Apply `supabase/migrations/20260928010000_player_team_settings.sql` before deploying
team settings. The app uses `profiles` for players, `team_members` for the main
team, and the existing `sub_team_preferences` for spare teams. Existing spare
preferences become visible below team rosters. `profiles.active_team_id` stores
the team whose schedule and tonight's roster the player views.

The migration adds `save_player_teams`, which validates the signed-in player or
league administrator and saves all team settings in one transaction. It preserves
an existing main membership's ID and rejects ambiguous multiple main memberships.
It depends on the existing `is_league_admin()` function. Apply both migrations
listed above when deploying these changes together.

Verification: `node --test src/utils/teamHelpers.test.mjs` and `npm run build`.
After applying the migration, check saving main/spare teams, reloading the profile,
switching the viewing team, and removing a spare team. Confirm that one player
cannot save another player's settings and that admins can edit players.

Spare-team viewing shows that team's schedule and roster; RSVP controls remain
available when viewing the player's main team. Team-specific spare call-up RSVPs
are not introduced by this migration.

### Team captains and managed RSVPs

Apply `supabase/migrations/20261004000000_team_captains.sql` before deploying this
version. It requires the existing `is_league_admin()` function, which must recognize
the main administrators. The UI now uses that database function for administrator
access instead of a separate hardcoded email list. Verify both existing admin
accounts are recognized before rollout. Earlier migrations referenced above are
absent from this checkout; this migration assumes the current deployed schema.

Administrators use **Manage RSVPs** to select a team and assign/remove captains
using the roster checkboxes. Multiple captains per team are supported. Captains
must be main roster members; departing members lose their assignment. Captains
can only manage their assigned teams, with no additional admin privileges.
Select a game to set Going, Maybe, Out, or reset to No response. Administrators
can manage every team, even when they are not rostered on that team. Spare call-up
RSVPs remain outside this feature.

Assignment writes are restricted to an administrator-only database function.
Managed RSVP writes validate the caller, current captain assignment, player team,
game teams, and status on every request. Existing self-RSVP policies are unchanged.
No database migration has been applied by the code change itself.

Run `node --test src/utils/*.test.mjs` and `npm run build`. In a staging database,
verify an admin can assign/revoke captains and change any rostered player's RSVP;
a captain can update only their own team's game RSVPs; and ordinary players and
anonymous callers cannot invoke either privileged write successfully. Also test
forged game/team/player IDs, invalid statuses, revoked captains, team transfers,
resetting to No response, and direct writes to `team_captains` being denied.
Verify updated counts and the player's own RSVP after returning to Dashboard
and Schedule, and check the management page on mobile.

### Admin email queue

Admin email delivery uses a durable queue with shared pacing, retries, idempotent
submission, and a per-admin cooldown. See [deployment instructions](supabase/ADMIN_EMAIL_SETUP.md)
for the migration, updated functions, worker secret, and scheduler. These server
changes must be deployed before queue protections are active.

