#!/usr/bin/env python3
"""Sync Liftosaur workout history into Statblock events.

For every connected Liftosaur integration:
  1. read the user's API key from Supabase Vault,
  2. fetch history: the whole history on the first sync, then the last
     WINDOW_DAYS days, which also catches workouts edited or deleted in
     Liftosaur since the last run,
  3. parse each record and tag sets with GZCL tiers from the program,
  4. hand the batch to liftosaur.apply_records(), which inserts new
     workouts, replaces edited ones and voids deleted ones, in one
     transaction per user.

--full re-fetches the whole history even after the first sync. Records
whose parsed sets changed (a parser fix, or a program restructured so
tiers differ) are rewritten; unchanged ones are skipped.

Connects to Postgres with psql (DATABASE_URL, or the PG* variables).
LIFTOSAUR_API_BASE overrides the API URL (tests use a local fake).
Exit status 1 if any user failed.
"""
import csv
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import liftohistory  # noqa: E402

API_BASE = os.environ.get("LIFTOSAUR_API_BASE", "https://www.liftosaur.com/api/v1")
WINDOW_DAYS = 21  # the 14-day stat window plus a week for late edits
PAGE = 200        # the API's maximum page size


class AuthError(Exception):
    """The key was rejected (401) or the subscription lapsed (403)."""


def psql(*args, stdin=None):
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
    if os.environ.get("DATABASE_URL"):
        cmd.append(os.environ["DATABASE_URL"])
    out = subprocess.run(cmd + list(args), input=stdin, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return out.stdout


def query(sql, **params):
    """Run one query with psql variables; return rows as lists of strings."""
    args = ["-At", "-F", "\t"]
    for k, v in params.items():
        args += ["-v", f"{k}={v}"]
    out = psql(*args, stdin=sql)
    return [line.split("\t") for line in out.splitlines() if line]


def api_get(path, key, params=None):
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {key}", "User-Agent": "statblock-sync"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)["data"]
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise AuthError(f"Liftosaur returned {e.code} for {path}") from None
            if e.code < 500 and e.code != 429:
                raise
            err = e
        except urllib.error.URLError as e:
            err = e
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"Liftosaur {path} failed after retries: {err}")


def fetch_history(key, since):
    """All records since `since` (None = the whole history), newest first."""
    if since is not None:
        # With startDate the API ignores cursor, so one page must hold the
        # whole window. 200 workouts in three weeks isn't a real risk.
        data = api_get("/history", key, {"startDate": since.isoformat(), "limit": PAGE})
        if data.get("hasMore"):
            raise RuntimeError(f"more than {PAGE} workouts since {since:%Y-%m-%d}")
        return data["records"]
    records, cursor = [], None
    while True:
        params = {"limit": PAGE}
        if cursor is not None:
            params["cursor"] = cursor
        data = api_get("/history", key, params)
        records += data["records"]
        if not data.get("hasMore"):
            return records
        cursor = data["nextCursor"]


class Programs:
    """Program text by name, fetched once per sync, for GZCL tiers."""

    def __init__(self, key):
        self.key = key
        self.by_name = None
        self.cache = {}

    def tiers(self, name):
        if not name:
            return []
        if self.by_name is None:
            listing = api_get("/programs", self.key)["programs"]
            self.by_name = {p["name"]: p["id"] for p in listing}
        if name not in self.cache:
            pid = self.by_name.get(name)
            text = api_get(f"/programs/{pid}", self.key)["text"] if pid else ""
            self.cache[name] = liftohistory.program_tiers(text)
        return self.cache[name]


def stage_rows(records, programs):
    for rec in records:
        text = rec["text"]
        try:
            session = liftohistory.parse_record(text)
        except liftohistory.ParseError as e:
            raise RuntimeError(f"history record {rec['id']}: {e}") from None
        tiers = liftohistory.day_tiers(programs.tiers(session["program"]), session)
        sets = liftohistory.session_sets(session, tiers)
        # The fingerprint covers the parsed sets, not just the text, so a
        # parser fix or a program change that retags tiers rewrites the record.
        fingerprint = hashlib.sha1((text + json.dumps(sets, sort_keys=True)).encode())
        yield [
            rec["id"],
            fingerprint.hexdigest()[:12],
            session["occurred_at"].isoformat(),
            session["program"] or "",
            session["day_name"] or "",
            session["week"] or "",
            session["day_in_week"] or session["day"] or "",
            session["duration_s"] if session["duration_s"] is not None else "",
            json.dumps(sets),
        ]


def sync_user(user_id, key, backfilled, full=False):
    # LIFTOSAUR_SYNC_NOW pins the clock for tests.
    now = datetime.fromisoformat(os.environ["LIFTOSAUR_SYNC_NOW"]) if os.environ.get(
        "LIFTOSAUR_SYNC_NOW") else datetime.now(timezone.utc)
    since = None if full or not backfilled else now - timedelta(days=WINDOW_DAYS)
    records = fetch_history(key, since)
    programs = Programs(key)
    with tempfile.NamedTemporaryFile("w", suffix=".csv", newline="", delete=False) as f:
        writer = csv.writer(f)
        for row in stage_rows(records, programs):
            writer.writerow([user_id] + row)
        path = f.name
    try:
        # \copy takes its file name literally (no psql variables), so quote it here.
        quoted = "'" + path.replace("'", "''") + "'"
        # -1 wraps -f input in one transaction (plain stdin wouldn't be).
        out = psql("-1", "-f", "-", "-At", "-F", "\t", "-v", f"user={user_id}",
                   "-v", f"since={since.isoformat() if since else ''}", stdin=r"""
delete from liftosaur.stage_records where user_id = :'user';
\copy liftosaur.stage_records (user_id, record_id, text_hash, occurred_at, program, day_name, week, day_in_week, duration_s, sets) from """ + quoted + r""" with (format csv)
select * from liftosaur.apply_records(:'user', nullif(:'since', '')::timestamptz);
""")
    finally:
        os.unlink(path)
    inserted, replaced, removed, unchanged = out.split()
    mode = "full history" if since is None else f"last {WINDOW_DAYS} days"
    print(f"user {user_id}: {len(records)} workouts in Liftosaur ({mode}); "
          f"{inserted} new, {replaced} edited, {removed} removed, {unchanged} unchanged")


def main():
    full = "--full" in sys.argv[1:]
    users = query("""
        select i.user_id, s.decrypted_secret, i.sync_cursor is not null
        from public.integrations i
        join vault.decrypted_secrets s on s.id = i.vault_secret_id
        where i.provider = 'liftosaur' and i.status = 'connected'
        order by i.connected_at""")
    if not users:
        print("no connected Liftosaur accounts")
        return 0
    failed = 0
    for user_id, key, backfilled in users:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::add-mask::{key}")
        try:
            sync_user(user_id, key, backfilled == "t", full)
            query("""update public.integrations
                     set last_synced_at = now(), sync_cursor = coalesce(sync_cursor, 'backfilled'),
                         last_error = null
                     where user_id = :'user' and provider = 'liftosaur'""", user=user_id)
        except AuthError as e:
            failed += 1
            # Stop retrying a dead key; set_liftosaur_key() reconnects.
            print(f"user {user_id}: {e}; marking the integration as errored", file=sys.stderr)
            query("""update public.integrations set status = 'error', last_error = :'err'
                     where user_id = :'user' and provider = 'liftosaur'""",
                  user=user_id, err=str(e))
        except Exception as e:  # noqa: BLE001 - report, try the next user
            failed += 1
            print(f"user {user_id}: sync failed: {e}", file=sys.stderr)
            query("""update public.integrations set last_error = :'err'
                     where user_id = :'user' and provider = 'liftosaur'""",
                  user=user_id, err=str(e)[:500])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
