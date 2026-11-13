# Game lines

Apply `supabase/migrations/20261112000000_game_lines.sql` to the same Supabase project used by the app, after the team-captains migration. Use the project's usual migration process, or run this migration's contents in the Supabase SQL editor. Then deploy the frontend.

Open Schedule, choose a game, and select Lines. Desktop shows a tab inside game details; mobile opens a separate view with Back to game details. Select a team to view its lines. Captains can edit only their own team's lines; administrators can edit either team. Other signed-in users can view lines, matching existing game roster visibility.

Editors select rostered players for LW/C/RW, LD/RD, and goalie positions. Start with three forward lines, three defense pairs, and one goalie. Up to four forward lines, four pairs, and two goalies are supported. Empty groups can be removed. RSVP statuses are informational, so captains can plan before everyone responds. Each player can occupy one position. Saves are scoped to one game and team. Concurrent edits are rejected with a reload message instead of overwriting a newer save.

Validation:

- `node --test src/utils/gameLines.test.mjs src/utils/rsvpManagement.test.mjs src/utils/scheduleHelpers.test.mjs`
- `npm run build`
- `supabase/tests/game_lines.test.mjs` exercises the migration in an isolated PostgreSQL engine. Install `@electric-sql/pglite` in a temporary directory and set `PGLITE_MODULE` to the file URL of its `dist/index.js`, then run `node --test supabase/tests/game_lines.test.mjs`. It does not connect to production. Without this environment variable, the integration test is explicitly skipped.

After applying the migration, verify with a captain, ordinary player, and admin account. Confirm saved lines persist after reopening, and that changing one team's lineup does not change the opponent's lineup or another game. The feature does not require a Stream configuration change.
