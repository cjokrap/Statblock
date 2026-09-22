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
INTEGER = re.compile(r"\d{1,9}")
ISO_DATE = re.compile(r"(\d{4}-\d{2}-\d{2})")
US_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def number(v):
    v = v.strip()
    return v if NUMBER.fullmatch(v) else ""


def integer(v):
    v = v.strip()
    return v if INTEGER.fullmatch(v) else ""


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


def prepare(name, src, out_dir, keep):
    table, cols, key = SPECS[name]
    out = out_dir / name
    seen = set()
    kept = dropped = 0
    with open(src, newline="", encoding="utf-8-sig", errors="replace") as fin, \
         open(out, "w", newline="", encoding="utf-8") as fout:
        reader = csv.reader(fin)
        header = [h.strip() for h in next(reader)]
        index = {h: i for i, h in enumerate(header)}
        missing = [c for c, _, _, must in cols if must and c not in index]
        if missing:
            sys.exit(f"{src}: missing column(s) {', '.join(missing)}")
        writer = csv.writer(fout)
        writer.writerow([STAGE_COLUMNS.get(c, c) for c, *_ in cols])
        for row in reader:
            values = []
            for c, clean, required, _ in cols:
                i = index.get(c)
                v = clean(row[i]) if i is not None and i < len(row) else ""
                if required and v == "":
                    break
                values.append(v)
            else:
                record = dict(zip((c for c, *_ in cols), values))
                if keep(record) and (key is None or record[key] not in seen):
                    if key is not None:
                        seen.add(record[key])
                    writer.writerow(values)
                    kept += 1
                    continue
            dropped += 1
    print(f"  {name}: {kept} rows staged, {dropped} dropped", file=sys.stderr)
    return table, ", ".join(STAGE_COLUMNS.get(c, c) for c, *_ in cols), out, seen


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
    table, cols, path, foods = prepare(
        "food.csv", args.csv_dir / "food.csv", args.out_dir,
        lambda r: r["data_type"] in DATA_TYPES)
    staged.append((table, cols, path))
    with open(path, newline="", encoding="utf-8") as f:
        branded = any(row[1] == "branded_food" for row in csv.reader(f))

    filters = {
        "food_nutrient.csv": lambda r: r["fdc_id"] in foods and r["nutrient_id"] in nutrients,
        "food_portion.csv": lambda r: r["fdc_id"] in foods,
        "measure_unit.csv": lambda r: True,
        "branded_food.csv": lambda r: r["fdc_id"] in foods,
    }
    for name, keep in filters.items():
        src = args.csv_dir / name
        if src.is_file():
            table, cols, path, _ = prepare(name, src, args.out_dir, keep)
            staged.append((table, cols, path))
        elif name == "food_nutrient.csv":
            sys.exit(f"{args.csv_dir}: no food_nutrient.csv")
        elif name == "branded_food.csv" and branded:
            # Without it the merge would clear brands, barcodes and servings.
            sys.exit(f"{args.csv_dir}: branded foods but no branded_food.csv")

    for table, cols, path in staged:
        print(f"{table}\t{cols}\t{path.resolve()}")


if __name__ == "__main__":
    main()
