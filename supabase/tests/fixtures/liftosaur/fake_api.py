#!/usr/bin/env python3
"""A stand-in for the Liftosaur API, for supabase/tests/40_liftosaur_sync.sh.

Usage: fake_api.py STATE_FILE PORT

STATE_FILE is JSON: {"keys": {"lftsk_...": {"history": [{"id", "text"}],
"programs": [{"id", "name", "text"}]}}}. It's re-read on every request, so a
test can swap it between syncs. Paging copies the real API
(lambda/utils/apiv1.ts): newest id first, cursor = "ids below this", and with
startDate every record in range is returned (cursor ignored).
"""
import json
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "scripts" / "liftosaur"))
import liftohistory  # noqa: E402

STATE = sys.argv[1]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        with open(STATE) as f:
            state = json.load(f)
        key = self.headers.get("Authorization", "").removeprefix("Bearer ")
        account = state["keys"].get(key)
        if account is None:
            return self.reply(401, {"error": {"code": "unauthorized", "message": "bad key"}})
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        path = url.path.removeprefix("/api/v1")
        if path == "/history":
            limit = min(int(q.get("limit", 50)), 200)
            records = sorted(account["history"], key=lambda r: -r["id"])
            if "startDate" in q:
                start = datetime.fromisoformat(q["startDate"])
                records = [r for r in records
                           if liftohistory.parse_record(r["text"])["occurred_at"] >= start]
            elif "cursor" in q:
                records = [r for r in records if r["id"] < int(q["cursor"])]
            page = records[:limit]
            body = {"records": page, "hasMore": len(records) > limit}
            if body["hasMore"]:
                body["nextCursor"] = page[-1]["id"]
            return self.reply(200, {"data": body})
        if path == "/programs":
            return self.reply(200, {"data": {"programs": [
                {"id": p["id"], "name": p["name"], "isCurrent": True} for p in account["programs"]]}})
        if path.startswith("/programs/"):
            pid = path.split("/")[-1]
            for p in account["programs"]:
                if p["id"] == pid:
                    return self.reply(200, {"data": p})
        return self.reply(404, {"error": {"code": "not_found", "message": path}})


HTTPServer(("127.0.0.1", int(sys.argv[2])), Handler).serve_forever()
