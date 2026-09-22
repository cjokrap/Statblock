# Statblock

Food and workout tracking that plays like a D&D character sheet.

Logging meals, water, supplements, workouts and self-care earns XP for classes
(workouts) and jobs (food and habits). Six ability scores (STR, DEX, CON, INT,
WIS, CHA) rise and fall with your real habits over a rolling 14-day window.
The game rewards logging honestly, never under-eating.

## Status

Pre-alpha. v1 is being built for a single user; every table is multi-user
ready (user IDs everywhere, row-level security on) so it can open up later.

## Stack

- Next.js on Vercel
- Supabase: Postgres, Auth, Storage (character portraits), scheduled jobs
- Food data: USDA FoodData Central (bulk-loaded), Open Food Facts (barcodes),
  FatSecret (gap filler); supplements from the NIH Dietary Supplement Label
  Database
- Workouts: Liftosaur REST API (user supplies their own Premium API key)

## Repo layout

```
supabase/
  migrations/   SQL migrations, applied in filename order
  tests/        SQL tests (RLS isolation, effective-dated settings)
docs/
  schema.md     Table-by-table notes for review
```

## Not medical advice

Suggested targets are estimates only. Talk to your doctor before starting any
diet or fitness program.

## Feedback

Ideas and bug reports go in GitHub Issues.
