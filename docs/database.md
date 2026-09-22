# Database setup and migrations

The files in `supabase/migrations` build the Supabase database. Nothing sends
them to Supabase on its own. The **Migrate database** GitHub workflow runs any
that haven't been applied yet, oldest first.

## First-time setup (empty database)

### 1. Get the connection string

1. In the Supabase dashboard, open the project and click **Connect** at the
   top.
2. Choose **Session pooler** (port 5432). Don't use the transaction pooler
   (port 6543).
3. Copy the URI. It looks like:
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with the database password. If you don't know
   it, reset it under **Project Settings → Database**.

The password sits inside a URL, so symbols like `@ # / ? % :` break it.
If yours has any, the simplest fix is to reset it to letters and numbers
only.

### 2. Save it as a repo secret

1. On GitHub, open the repo and go to **Settings → Secrets and variables →
   Actions**.
2. Click **New repository secret**.
3. Name: `SUPABASE_DB_URL`. Secret: the full connection string.
4. Click **Add secret**.

GitHub hides the value once it's saved. You can replace it later but can't
view it again.

### 3. Run the migrations

1. On GitHub, open the **Actions** tab.
2. Pick **Migrate database** from the list on the left.
3. Click **Run workflow** (on the right), leave the mode on **apply**, then
   click the green **Run workflow** button.
4. Click the run when it appears. It lists each migration as it applies it
   and ends with `Applied 10 migration(s).` A green check means it worked.

To check, run this in the Supabase **SQL Editor**:

```sql
select count(*) from public.nutrients;   -- 29
```

**Already built the tables by pasting migrations into the SQL Editor?** Run
the workflow once with mode **baseline** instead. It records the migrations
as applied without running them again. After that, use **apply** as normal.
If you run **apply** on a database built by hand, it stops before changing
anything and tells you to baseline.

### 4. Load USDA foods

Go to **Actions → USDA sync → Run workflow**. See `docs/usda-loader.md`.

## Adding migrations later

1. Name the new file `supabase/migrations/<YYYYMMDDHHMMSS>_<what_it_does>.sql`,
   with a timestamp newer than every existing file.
2. Merge the PR.
3. Run **Migrate database** again. Only the new file is applied.

## How it works

`scripts/db/migrate.sh` (`--dry-run` only lists pending files; `--baseline`
records every file as applied without running it, only while history is
empty and the database has tables):

- **Each file runs in its own transaction.** The file and its history row
  commit together. If a migration fails, the database is left exactly as it
  was before that file, the run stops, and the log shows the error. Fix the
  file and run again.
- **History** lives in `supabase_migrations.schema_migrations`, the same
  table the Supabase CLI uses. If you set up the CLI later, `supabase
  migration list` and `supabase db push` see the same history.
- **Out-of-order files are refused.** A pending migration older than the
  newest applied one is probably a mistake, such as a file from a stale
  branch. The script stops rather than guessing. Rename the file with a
  newer timestamp.
- **Tests:** `supabase/tests/run_local.sh` builds its test databases with this
  script. `30_migrate.sh` also tests dry runs, re-runs, rollback of a
  failing migration, the out-of-order check, and baselining a database
  built by hand.
