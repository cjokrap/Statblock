#!/usr/bin/env python3
"""Cut a FoodData Central CSV release down to what the loader stages.

Reads the release's CSVs by header name, so column order and new columns in
future releases don't matter. Drops rows the loader never uses (other data
types, unmapped nutrients), cleans numbers and dates, and writes CSVs that
psql can \\copy straight into the usda.stage_* tables.

Usage: prepare.py CSV_DIR OUT_DIR --nutrients 1008,1003,...
Prints the staged files it wrote, one "table<TAB>columns<TAB>path" per line.
"""
import argparse
import csv
import re
import sys
from pathlib import Path

csv.field_size_limit(sys.maxsize)

DATA_TYPES = {"foundation_food", "sr_legacy_food", "survey_fndds_food", "branded_food"}
NUMBER = re.compile(r"-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?")
INTEGER = re.compile(r"(\d{1,9})(\.0*)?")  # some exports write ids as "1008.0"
ISO_DATE = re.compile(r"(\d{4}-\d{2}-\d{2})")
US_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def number(v):
    v = v.strip()
    return v if NUMBER.fullmatch(v) else ""


def integer(v):
    m = INTEGER.fullmatch(v.strip())
    return m.group(1) if m else ""


def date(v):
    v = v.strip()
    m = ISO_DATE.match(v)
    if m:
        return m.group(1)
    m = US_DATE.fullmatch(v)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return ""


def text(v):
    return " ".join(v.split())


# file -> (stage table, [(csv column, cleaner, required value, column must exist)], key column)
SPECS = {
    "food.csv": ("usda.stage_food", [
        ("fdc_id", integer, True, True),
        ("data_type", text, True, True),
        ("description", text, True, True),
        ("publication_date", date, False, False),
    ], "fdc_id"),
    "food_nutrient.csv": ("usda.stage_food_nutrient", [
        ("fdc_id", integer, True, True),
        ("nutrient_id", integer, True, True),
        ("amount", number, True, True),
    ], None),
    "food_portion.csv": ("usda.stage_food_portion", [
        ("fdc_id", integer, True, True),
        ("seq_num", integer, False, False),
        ("amount", number, False, False),
        ("measure_unit_id", integer, False, False),
        ("portion_description", text, False, False),
        ("modifier", text, False, False),
        ("gram_weight", number, True, True),
    ], None),
    "measure_unit.csv": ("usda.stage_measure_unit", [
        ("id", integer, True, True),
        ("name", text, True, True),
    ], "id"),
    "branded_food.csv": ("usda.stage_branded_food", [
        ("fdc_id", integer, True, True),
        ("brand_owner", text, False, False),
        ("brand_name", text, False, False),
        ("gtin_upc", text, False, False),
        ("serving_size", number, False, False),
        ("serving_size_unit", text, False, False),
        ("household_serving_fulltext", text, False, False),
    ], "fdc_id"),
}

# Stage table column names (food_nutrient.nutrient_id is staged as usda_nutrient_id).
STAGE_COLUMNS = {"nutrient_id": "usda_nutrient_id"}


def prepare(name, src, out_dir, keep, transform=None):
    """Stage one CSV. keep(record) returns None to keep the row, or the
    reason it's dropped. Returns (table, columns, out path, kept keys)."""
    table, cols, key = SPECS[name]
    names = [c for c, *_ in cols]
    out = out_dir / name
    seen = set()
    kept = 0
    reasons = {}
    samples = []
    with open(src, newline="", encoding="utf-8-sig", errors="replace") as fin, \
         open(out, "w", newline="", encoding="utf-8") as fout:
        reader = csv.reader(fin)
        header = [h.strip() for h in next(reader)]
        index = {h: i for i, h in enumerate(header)}
        missing = [c for c, _, _, must in cols if must and c not in index]
        if missing:
            sys.exit(f"{src}: missing column(s) {', '.join(missing)}")
        writer = csv.writer(fout)
        writer.writerow([STAGE_COLUMNS.get(c, c) for c in names])
        for row in reader:
            if len(samples) < 3:
                samples.append(row)
            record = {}
            reason = None
            for c, clean, required, _ in cols:
                i = index.get(c)
                v = clean(row[i]) if i is not None and i < len(row) else ""
                if required and v == "":
                    reason = f"blank or invalid {c}"
                    break
                record[c] = v
            if reason is None:
                if transform:
                    transform(record)
                reason = keep(record)
            if reason is None and key is not None:
                if record[key] in seen:
                    reason = f"duplicate {key}"
                else:
                    seen.add(record[key])
            if reason is None:
                writer.writerow([record[c] for c in names])
                kept += 1
            else:
                reasons[reason] = reasons.get(reason, 0) + 1
    dropped = sum(reasons.values())
    detail = "".join(f"\n      {n} {r}" for r, n in sorted(reasons.items(), key=lambda x: -x[1]))
    print(f"  {name}: {kept} rows staged, {dropped} dropped{detail}", file=sys.stderr)
    return table, ", ".join(STAGE_COLUMNS.get(c, c) for c in names), out, seen, kept, header, samples


def nutrient_numbers(csv_dir):
    """Map legacy nutrient numbers ("208") to FDC nutrient ids ("1008") from
    the release's nutrient.csv, for files that use the numbers."""
    path = csv_dir / "nutrient.csv"
    if not path.is_file():
        return {}
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        rows = list(csv.DictReader(f))
    ids = {integer(r.get("id", "")) for r in rows}
    return {n: i for r in rows
            if (n := integer(r.get("nutrient_nbr", ""))) and (i := integer(r.get("id", "")))
            and n not in ids}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("csv_dir", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--nutrients", required=True, help="comma-separated FDC nutrient ids to keep")
    args = ap.parse_args()

    nutrients = set(args.nutrients.split(","))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    if not (args.csv_dir / "food.csv").is_file():
        sys.exit(f"{args.csv_dir}: no food.csv")

    staged = []
    table, cols, path, foods, *_ = prepare(
        "food.csv", args.csv_dir / "food.csv", args.out_dir,
        lambda r: None if r["data_type"] in DATA_TYPES else "other data type")
    staged.append((table, cols, path))
    with open(path, newline="", encoding="utf-8") as f:
        branded = any(row[1] == "branded_food" for row in csv.reader(f))

    def food_known(r):
        return None if r["fdc_id"] in foods else "fdc_id not a staged food"

    def nutrient_kept(r):
        if r["fdc_id"] not in foods:
            return "fdc_id not a staged food"
        return None if r["nutrient_id"] in nutrients else "nutrient not used by the app"

    numbers = nutrient_numbers(args.csv_dir)

    def to_nutrient_id(r):
        r["nutrient_id"] = numbers.get(r["nutrient_id"], r["nutrient_id"])

    filters = {
        "food_nutrient.csv": (nutrient_kept, to_nutrient_id),
        "food_portion.csv": (food_known, None),
        "measure_unit.csv": (lambda r: None, None),
        "branded_food.csv": (food_known, None),
    }
    for name, (keep, transform) in filters.items():
        src = args.csv_dir / name
        if src.is_file():
            table, cols, path, _, kept, header, samples = prepare(name, src, args.out_dir, keep, transform)
            staged.append((table, cols, path))
            if name == "food_nutrient.csv" and foods and kept == 0:
                # Every food would be skipped for having no energy value.
                lines = "\n".join("    " + ",".join(row) for row in samples)
                sys.exit(f"{src}: no usable nutrient rows for {len(foods)} foods. "
                         f"The file's layout may have changed.\n  header: {','.join(header)}\n"
                         f"  first rows:\n{lines}")
        elif name == "food_nutrient.csv":
            sys.exit(f"{args.csv_dir}: no food_nutrient.csv")
        elif name == "branded_food.csv" and branded:
            # Without it the merge would clear brands, barcodes and servings.
            sys.exit(f"{args.csv_dir}: branded foods but no branded_food.csv")

    for table, cols, path in staged:
        print(f"{table}\t{cols}\t{path.resolve()}")


if __name__ == "__main__":
    main()
