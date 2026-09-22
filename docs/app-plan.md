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
| 1 | Scaffold: Next.js + TypeScript in `web/`, Supabase auth (email + password sign-in), theme tokens, app shell with bottom nav, read-only character sheet (level, XP, ability scores, classes, jobs) from the game tables, CI workflow (lint, typecheck, build) | In progress |
| 2 | First-run setup + Settings: suggested targets (Mifflin-St Jeor, rules in `targets.*`), writes `profiles` + `user_settings`, medical disclaimer on every target screen. Adds `public.rescore_me()` so the app can rescore after logging | Planned |
| 3 | Food logging: search (`search_foods`), portions, `log_food`, food log by meal, recents, remove (void) | Planned |
| 4 | Today dashboard: calories as HP, macros, quests, weekly boss, water quick-add, daily stack button, CHA quick log, weigh-in, training feed, skip buttons | Planned |
| 5 | Liftosaur connect screen (validate key, `set_liftosaur_key` via a server action with the service role key) | Planned |
| 6 | Packaged foods: live FDC API lookup + Open Food Facts barcode scan | Planned |

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
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
   anon / publishable key, which is safe in the browser).
4. Deploy. Every merge to `main` redeploys.
