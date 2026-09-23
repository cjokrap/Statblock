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

# For ranking and paging: FDC matches any word and doesn't favour the brand,
# so the decoys come back before the Fairlife shake.
SHAKES = [
    {"fdcId": 3000000 + n, "dataType": "Branded", "description": "CHOCOLATE PROTEIN SHAKE",
     "brandOwner": f"Other Brand {n}"} for n in range(1, 31)
] + [
    {"fdcId": 2900001, "dataType": "Branded", "description": "ULTRA-FILTERED MILK", "brandName": "FAIRLIFE"},
    {"fdcId": 2900002, "dataType": "Branded", "description": "CHOCOLATE NUTRITION PLAN PROTEIN SHAKES",
     "brandOwner": "fairlife, LLC"},
]
# Its details record lists amounts without saying which nutrient each is
# (as the real fdcId 2278100 does), so the app must use its search entry.
CORE_POWER = {"fdcId": 2278100, "dataType": "Branded", "description": "CHOCOLATE HIGH PROTEIN MILK SHAKE, CHOCOLATE",
              "brandOwner": "Fair Oaks Farms Brands, Inc.", "brandName": "FA!RLIFE", "subbrandName": "CORE POWER",
              "gtinUpc": "811620022002", "servingSize": 414.0, "servingSizeUnit": "ml",
              "householdServingFullText": "1 bottle"}
SHAKES.insert(0, CORE_POWER)

def search_shape(food=YOGURT):
    return dict(food, foodNutrients=[{"nutrientId": i, "unitName": u, "value": v} for i, u, v in NUTRIENTS])

def text(food):
    keys = ("description", "brandName", "subbrandName", "brandOwner", "gtinUpc")
    return " ".join(food.get(k, "") for k in keys).lower().replace("!", "i")

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
            words = q.get("query", "").lower().split()
            if q.get("requireAllWords") == "true":
                hits = [f for f in [YOGURT] + SHAKES if all(w in text(f) for w in words)]
            else:
                hits = [f for f in [YOGURT] + SHAKES if any(w in text(f) for w in words)]
            size, page = int(q.get("pageSize", 50)), int(q.get("pageNumber", 1))
            return self.send(200, {"totalHits": len(hits), "currentPage": page,
                                   "totalPages": (len(hits) + size - 1) // size,
                                   "foods": [search_shape(f) for f in hits[(page - 1) * size:page * size]]})
        if u.path == f"/fdc/v1/food/{CORE_POWER['fdcId']}":
            return self.send(200, dict(CORE_POWER, labelNutrients={}, foodNutrients=[
                {"type": "FoodNutrient", "id": 27975523 + n, "amount": v} for n, (_, _, v) in enumerate(NUTRIENTS)]))
        if u.path == f"/fdc/v1/food/{YOGURT['fdcId']}":
            return self.send(200, detail_shape())
        return self.send(404, {"error": "not found"})

ThreadingHTTPServer(("127.0.0.1", 3002), H).serve_forever()
