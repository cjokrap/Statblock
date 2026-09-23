"""A stand-in for the USDA FoodData Central API (Branded foods) for the e2e
test: /fdc/v1/foods/search and /fdc/v1/food/{fdcId}, in FDC's shapes."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

YOGURT = {
    "fdcId": 2110226, "dataType": "Branded", "description": "GREEK YOGURT, PLAIN NONFAT",
    "brandOwner": "Chobani, Inc.", "brandName": "CHOBANI", "gtinUpc": "818290014108",
    "servingSize": 150.0, "servingSizeUnit": "g", "householdServingFullText": "1 container",
    "publishedDate": "2021-10-28",
}
NUTRIENTS = [(1008, "KCAL", 53), (1003, "G", 10), (1005, "G", 4), (1004, "G", 0), (1087, "MG", 110)]

def search_shape():
    return dict(YOGURT, foodNutrients=[{"nutrientId": i, "unitName": u, "value": v} for i, u, v in NUTRIENTS])

def detail_shape():
    d = {k: v for k, v in YOGURT.items() if k != "publishedDate"}
    d["publicationDate"] = "10/28/2021"
    d["foodNutrients"] = [{"type": "FoodNutrient", "nutrient": {"id": i, "unitName": u.lower()}, "amount": v}
                          for i, u, v in NUTRIENTS]
    return d

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if q.get("api_key") != "e2e-fdc-key":
            return self.send(403, {"error": {"code": "API_KEY_INVALID"}})
        if u.path == "/fdc/v1/foods/search":
            hit = any(w in "greek yogurt chobani" for w in q.get("query", "").lower().split())
            return self.send(200, {"totalHits": int(hit), "foods": [search_shape()] if hit else []})
        if u.path == f"/fdc/v1/food/{YOGURT['fdcId']}":
            return self.send(200, detail_shape())
        return self.send(404, {"error": "not found"})

ThreadingHTTPServer(("127.0.0.1", 3002), H).serve_forever()
