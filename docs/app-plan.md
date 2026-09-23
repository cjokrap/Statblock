# App plan (Next steps, step 4)

The Next.js app lives in `web/` (Vercel "Root Directory" = `web`). It's built
in small PRs so each one is reviewable and a new session can resume from
this file. **Update the status column when a PR merges.**

Design source: the clickable mockup (see CLAUDE.md). Its look is:
- Fonts: Cinzel (headings, section labels), Source Sans 3 (everything else)
- Colors:
  - Parchment `#F3EDE2` (page), `#FBF8F2` (cards)
  - `#DDD2BF` (borders), `#EAE2D3` (row dividers)
  - Ink `#1F1B16`, muted `#5E554A`
  - Accents: red `#8E3326`, teal `#2D5A5E`, gold `#D9A441`, green `#35602F`
- Mobile-first, 390 px wide phone layout
- A character sheet (dark card) on top, a plain fast tracker below
- Touch targets of at least 44 px

| # | PR | Status |
| --- | --- | --- |
| 1 | Scaffold: Next.js + TypeScript in `web/`, Supabase auth (email + password sign-in), theme tokens, read-only character sheet (level, XP, ability scores, classes, jobs), Web CI workflow | Merged (#7) |
| 2 | Food logging: search (`search_foods`), portions, `log_food`, food log by meal on Today, recents, remove (void). Adds `public.rescore_me()` so XP updates right after a log. e2e browser test in `supabase/tests/e2e/`. Readable setup-error page | Merged (#8) |
| 3 | Packaged foods: live USDA FoodData Central search under whole-food results, product page, and save-on-first-log into `foods` (server-side, secret key). Moved up because branded foods were the first gap in daily use | Merged (#9) |
| 4 | First-run setup + Settings: suggested targets (Mifflin-St Jeor, rules in `targets.*`), writes `profiles` + `user_settings`, medical disclaimer on every target screen. Fix the `user_settings` edit policy to use the profile time zone (it uses UTC `current_date`). Home-screen icon + full-screen launch (web app manifest) | Merged (#12) |
| 5 | Today dashboard: calories as HP, macros, quests, weekly bosses, water quick-add, daily stack button (plus managing the stack in Settings), CHA quick log, weigh-in, training feed with PRs, skip buttons and "I'm recovered", undo for each tap. Streaks wait for the engine | Merged (#13) |
| 6 | Liftosaur connect screen: Settings → Liftosaur shows status, last sync, errors and workouts imported; a pasted key is checked with Liftosaur, then saved with `set_liftosaur_key` from a server action (secret key); Disconnect deletes it from Vault (`disconnect_liftosaur`) | Merged (#14) |
| 7 | Barcode scanning with Open Food Facts (camera) | Planned |
| 8 | Edit a logged food: change the amount or portion, or move it to another meal, from the Today food log, instead of deleting and re-logging it. Since `events` is append-only, an edit is one server-side transaction that voids the old entry and logs the new one with the same `occurred_at`, so quest timing and meal-slot XP stay honest | Planned |

**Why logging comes before setup:** saving settings starts food judging
(see `docs/rules-engine.md`). If setup shipped first, every day would count
as unlogged until logging existed. Logging needs no settings and earns
Quartermaster XP from day one.

## Testing the app end to end

`supabase/tests/e2e/run.sh` runs the real app against a local stand-in for
Supabase:
- **Postgres** with every migration and the USDA fixture foods
- **PostgREST** for `/rest/v1`
- **`gateway.py`** for `/auth/v1` sign-in

It also runs a fake USDA FoodData Central (`fake_fdc.py`). It then drives
the app in headless Chromium: sign in, search, log, re-log, remove, and log
a packaged food, then run first-run setup and Settings and check what they saved in the database. Screenshots are saved to its work directory. Extend `flow.mjs` with
each app PR.

## Decisions

- **Auth:** Supabase Auth, email + password. Charles's user already exists
  (created in the dashboard). No sign-up screen in v1.
- **Data access:** the browser and server components use the Supabase anon
  key plus the user's session, so RLS protects everything. The service role
  key is used only in server actions that need it (the Liftosaur key), and
  never reaches the browser.
- **Rescoring:** after a log, the app calls `rescore_me()`, a security
  definer function that runs `game.recompute` for `auth.uid()` for today
  only. The scheduled job still rescores the last 21 days every 2 hours.

## Deploying (Charles, once PR 1 merges)

1. Go to vercel.com → Add New → Project → import `cjokrap/Statblock`.
2. Set **Root Directory** to `web`.
3. Add environment variables from Supabase → Project Settings → API:
   - `NEXT_PUBLIC_SUPABASE_URL`: the Project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the **Publishable** key
     (`sb_publishable_…`), or the legacy anon key. Both are safe in the
     browser.
   - Never the Secret or service_role key in a `NEXT_PUBLIC_` variable:
     those bypass RLS, and `NEXT_PUBLIC_` values reach the browser.
   - For packaged foods (server-only, no `NEXT_PUBLIC_` prefix):
     `FDC_API_KEY`, a free key from https://fdc.nal.usda.gov/api-key-signup,
     and `SUPABASE_SECRET_KEY`, the Supabase Secret key (`sb_secret_…`).
4. Deploy. Every merge to `main` redeploys.
