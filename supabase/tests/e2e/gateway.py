"""A tiny local stand-in for Supabase: /auth/v1 (password sign-in, user,
logout) with HS256 JWTs, and /rest/v1 proxied to PostgREST. Test only."""
import base64, hashlib, hmac, json, os, subprocess, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = b"e2e-secret-e2e-secret-e2e-secret-0123"
REST = "http://127.0.0.1:3001"

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def unb64(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def jwt(claims):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64(json.dumps(claims).encode())
    sig = b64(hmac.new(SECRET, f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"

def verify(tok):
    h, p, s = tok.split(".")
    good = b64(hmac.new(SECRET, f"{h}.{p}".encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(good, s): raise ValueError("bad sig")
    c = json.loads(unb64(p))
    if c.get("exp", 0) < time.time(): raise ValueError("expired")
    return c

def user_id(email):
    out = subprocess.run(["psql", "-At", "-d", os.environ.get("E2E_DB", "statblock_e2e"), "-c",
                          f"select id from auth.users where email = '{email.replace(chr(39), '')}'"],
                         capture_output=True, text=True).stdout.strip()
    return out or None

def user_obj(uid, email):
    return {"id": uid, "aud": "authenticated", "role": "authenticated", "email": email,
            "app_metadata": {"provider": "email"}, "user_metadata": {},
            "created_at": "2026-09-01T00:00:00Z"}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body=None, headers=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def auth(self, method):
        path = self.path.split("?")[0]
        if path == "/auth/v1/token" and method == "POST":
            req = json.loads(self.body() or b"{}")
            email = req.get("email", "")
            uid = user_id(email)
            if not uid or req.get("password") != "test-password":
                return self.send(400, {"code": 400, "error_code": "invalid_credentials",
                                       "msg": "Invalid login credentials"})
            now = int(time.time())
            claims = {"sub": uid, "email": email, "role": "authenticated", "aud": "authenticated",
                      "iat": now, "exp": now + 3600, "session_id": "s1", "aal": "aal1"}
            return self.send(200, {"access_token": jwt(claims), "token_type": "bearer",
                                   "expires_in": 3600, "expires_at": now + 3600,
                                   "refresh_token": "refresh-" + uid, "user": user_obj(uid, email)})
        if path == "/auth/v1/user" and method == "GET":
            try:
                c = verify(self.headers.get("Authorization", "").removeprefix("Bearer "))
            except Exception:
                return self.send(401, {"code": 401, "msg": "invalid JWT"})
            return self.send(200, user_obj(c["sub"], c.get("email", "")))
        if path == "/auth/v1/logout":
            return self.send(204)
        return self.send(404, {"msg": "not in the e2e stand-in: " + path})

    def rest(self, method):
        url = REST + self.path.removeprefix("/rest/v1")
        data = self.body() if method in ("POST", "PATCH", "PUT", "DELETE") else None
        req = urllib.request.Request(url, data=data, method=method)
        for k in ("Authorization", "Accept", "Content-Type", "Prefer", "Range", "Accept-Profile", "Content-Profile"):
            if self.headers.get(k): req.add_header(k, self.headers[k])
        try:
            with urllib.request.urlopen(req) as r:
                code, headers, payload = r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            code, headers, payload = e.code, e.headers, e.read()
        self.send_response(code)
        for k in ("Content-Type", "Content-Range"):
            if headers.get(k): self.send_header(k, headers[k])
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers(); self.wfile.write(payload)

    def route(self, method):
        if self.path.startswith("/auth/v1"): return self.auth(method)
        if self.path.startswith("/rest/v1"): return self.rest(method)
        self.send(404, {"msg": "unknown"})

    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_PATCH(self): self.route("PATCH")
    def do_DELETE(self): self.route("DELETE")

if __name__ == "__main__":
    print("anon key:", jwt({"role": "anon", "iss": "supabase", "iat": 0, "exp": 4102444800}))
    print("service key:", jwt({"role": "service_role", "iss": "supabase", "iat": 0, "exp": 4102444800}), flush=True)
    ThreadingHTTPServer(("127.0.0.1", 54321), H).serve_forever()
