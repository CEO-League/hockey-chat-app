# Game reports

Apply `supabase/migrations/20261114000000_game_reports.sql` after the team-captains migration, using the project's migration process or the Supabase SQL editor. Deploy the frontend after the migration. This change does not apply the migration to your live project automatically.

Open Schedule, choose a game, then Game Report. The tabs are visible on desktop and mobile; mobile Lines still opens its existing full-page editor. Schedule's Past Games view includes today so a captain can enter a result immediately after a game, plus older games ordered newest first.

Either participating team's current captain or a league admin can create and edit the one shared report. Other authenticated users can read it, matching existing game-line visibility. Reports record home/away final scores, regulation/overtime/shootout, penalties (team, player name/number or Bench, infraction, minutes, period, optional clock time), and notes. Player labels are historical text so substitutes and departed players remain readable.

Every successful save creates an immutable revision snapshot with the editor's name and time. The editor shows the 50 most recent revisions; all revisions remain stored. Saves reject stale versions and preserve the unsaved draft until the editor chooses to reload. Direct client writes to reports and revisions are denied; validation and permissions are enforced by the database RPC. Game deletion cascades to its report and history.

Checks:
- `node --test tests/gameReport.test.mjs`
- `npm run build`
- Set `PGLITE_MODULE` to a file URL for an installed `@electric-sql/pglite/dist/index.js`, then run `node --test tests/game_reports.test.mjs`. This uses an isolated database and never production. Without the variable, the test is skipped.

After deployment, verify with a captain, ordinary player, and admin. Save and reopen a report, revise it and inspect history, try simultaneous edits in two tabs, confirm another game's report stays unchanged, and check mobile tabs plus Past Games results.
