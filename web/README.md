# Statblock web app

Next.js 16 (App Router) + Supabase. The build plan and its status are in
`../docs/app-plan.md`.

```
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm install
npm run dev                  # http://localhost:3000
```

Checks (the same ones CI runs in `.github/workflows/web.yml`):

```
npm run lint
npm run typecheck
npm test          # unit tests with Node's built-in runner
npm run build
```

## Layout

- `src/proxy.ts`: refreshes the Supabase session on every request and sends
  signed-out visitors to `/login`. (Next.js 16 renamed middleware to proxy.)
- `src/lib/supabase/`: Supabase clients for server code and the proxy.
- `src/lib/character.ts`: loads the character sheet with the user's session.
  RLS limits every query to their own rows.
- `src/lib/game.ts`: level, modifier and trend math for display.
- `src/app/login/`: sign-in (email + password).
- `src/app/(app)/`: signed-in screens.

Next.js 16 differs from older versions. Read `node_modules/next/dist/docs/`
before changing framework-level code (see `AGENTS.md`).
