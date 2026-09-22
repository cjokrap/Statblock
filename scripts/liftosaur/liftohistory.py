"""Parse Liftosaur's text formats.

History records ("Liftoscript Workouts") come from GET /api/v1/history:

    2026-03-01 10:00:00 +00:00 / program: "GZCLP" / dayName: "Day 1" / week: 1 / dayInWeek: 1 / duration: 3600s / exercises: {
      // exercise notes
      Squat / 4x3 225lb, 1x5 225lb @8 / warmup: 1x5 135lb / target: 5x3+ 225lb 180s
    }

Grammar: src/liftohistory/liftohistory.grammar in github.com/astashov/liftosaur.

History records don't say which GZCL tier a lift was. Programs do (see
"Programs" below), so tiers come from the program text
(GET /api/v1/programs/:id) matched by week and day.
"""
import re
from datetime import datetime

LB_TO_KG = 0.45359237

DATE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?\s?(Z|[+-]\d{2}:\d{2})")
FIELD = re.compile(r'(\w+):\s*("[^"\n]*"|\d+s|\d+)')
SET_PART = re.compile(r"(\d+)x(\d+)(?:\|(\d+))?(?:-(\d+))?(\+)?")
WEIGHT = re.compile(r"(?<![\w.])([+-]?\d+(?:\.\d+)?)(lb|kg)\b")
LABEL = re.compile(r"\(([^)]*)\)")
SECTION = re.compile(r"^([A-Za-z_]\w*):\s*(.*)$")


class ParseError(ValueError):
    pass


def to_kg(value, unit):
    return round(value * LB_TO_KG, 2) if unit == "lb" else round(value, 2)


def parse_sets(text):
    """'3x5 185lb @8, 1x3 185lb' -> one dict per set, groups expanded."""
    sets = []
    for group in (g.strip() for g in text.split(",")):
        if not group:
            continue
        part = SET_PART.search(LABEL.sub("", group))
        if not part:
            raise ParseError(f"no NxM in set group {group!r}")
        count = int(part.group(1))
        if part.group(4):  # target range "3x8-12": min-max
            reps = int(part.group(4))
        else:
            reps = int(part.group(2))
        weight = WEIGHT.search(LABEL.sub("", group))
        kg = to_kg(abs(float(weight.group(1))), weight.group(2)) if weight else 0.0
        sets.extend({"reps": reps, "weight_kg": kg} for _ in range(count))
    return sets


def parse_date(text):
    m = DATE.match(text)
    if not m:
        raise ParseError(f"record doesn't start with a date: {text[:40]!r}")
    day, clock, frac, tz = m.groups()
    tz = "+00:00" if tz == "Z" else tz
    return datetime.fromisoformat(f"{day}T{clock}{frac or ''}{tz}"), m.end()


def parse_record(text):
    """Parse one history record's text into a session dict."""
    lines = text.replace("\r\n", "\n").split("\n")
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith("//")):
        lines.pop(0)  # workout notes come first as // comments
    if not lines:
        raise ParseError("empty record")
    header = lines[0]
    if "exercises:" not in header or not header.rstrip().endswith("{"):
        raise ParseError(f"header has no 'exercises: {{': {header[:80]!r}")
    occurred_at, end = parse_date(header)
    fields = {}
    for key, value in FIELD.findall(header[end:header.index("exercises:")]):
        if value.startswith('"'):
            fields[key] = value[1:-1]
        elif value.endswith("s"):
            fields[key] = int(value[:-1])
        else:
            fields[key] = int(value)

    exercises = []
    for line in lines[1:]:
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        if line == "}":
            break
        parts = [p.strip() for p in line.split("/")]
        name, completed, warmup, target = parts[0], [], [], []
        for part in parts[1:]:
            m = SECTION.match(part)
            if m and m.group(1) == "warmup":
                warmup = parse_sets(m.group(2))
            elif m and m.group(1) == "target":
                target = parse_sets(m.group(2))
            elif m:
                continue  # an unknown section; skip rather than fail
            else:
                completed = parse_sets(part)
        exercises.append({"name": name, "sets": completed, "warmup": warmup, "target": target})
    else:
        raise ParseError("record has no closing '}'")

    return {
        "occurred_at": occurred_at,
        "program": fields.get("program"),
        "day_name": fields.get("dayName"),
        "week": fields.get("week"),
        "day_in_week": fields.get("dayInWeek"),
        "day": fields.get("day"),
        "duration_s": fields.get("duration"),
        "exercises": exercises,
    }


# ---------------------------------------------------------------------------
# Programs: GZCL tiers from exercise labels and templates
# ---------------------------------------------------------------------------
# Liftosaur's GZCL programs mark tiers three ways:
#   t1: Squat / ...t1                  a tier label (GZCLP, VDIP)
#   t1: Bench Press[1-12] / ...t1      a label plus [order,weeks] (The Rippler)
#   Squat[1,1-12] / ...t1              no label; the reused template's name
#                                      carries the tier (Jacked & Tan)
# Template definitions ("t1 / used: none / ...") and {~ ~} script blocks
# aren't exercises and are skipped.
TIER_NAME = re.compile(r"^t([123])(?![0-9])[a-z0-9_]*$", re.I)
TEMPLATE_TIER = re.compile(r"\.\.\.\s*t([123])(?![0-9])", re.I)
EXERCISE_LINE = re.compile(r"^(?:([A-Za-z_]\w*)\s*:\s*)?([^/:{}]+?)\s*/")
BRACKETS = re.compile(r"\[[^\]]*\]")


def norm(name):
    return " ".join(BRACKETS.sub("", name).lower().split())


def line_tier(line):
    """(exercise name, tier or None) for a program exercise line, or None."""
    m = EXERCISE_LINE.match(line)
    if not m or "used: none" in line:
        return None
    label, name = m.group(1), norm(m.group(2))
    if not name:
        return None
    if label and TIER_NAME.match(label):
        return name, "T" + TIER_NAME.match(label).group(1)
    t = TEMPLATE_TIER.search(line)
    return name, ("T" + t.group(1)) if t else None


def program_tiers(text):
    """Map each program day to {exercise name: tier}.

    Returns a list of weeks; each week is a list of (day name, {name: tier}).
    """
    weeks = []
    in_script = False
    for raw in text.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if in_script:
            in_script = "~}" not in line
            continue
        if "{~" in line and "~}" not in line.split("{~", 1)[1]:
            in_script = True  # the exercise line itself still counts
        if line.startswith("## "):
            if not weeks:
                weeks.append([])
            weeks[-1].append((line[3:].strip(), {}))
        elif line.startswith("# "):
            weeks.append([])
        elif line and not line.startswith("//") and weeks and weeks[-1]:
            found = line_tier(line)
            if found and found[1]:
                weeks[-1][-1][1].setdefault(found[0], found[1])
    return weeks


def day_tiers(weeks, session):
    """Tiers for the program day a session came from; {} if it can't be found.

    Multi-week programs often list a lift once, in week 1, with a week range
    ("Squat[1-12]"), so the same day in other weeks fills in whatever the
    session's own week doesn't mention.
    """
    if not weeks:
        return {}

    def find(week, day_name, day_in_week):
        for name, tiers in week:  # a day's name is the surest match
            if day_name and name == day_name:
                return tiers
        return week[day_in_week - 1][1] if day_in_week and day_in_week <= len(week) else None

    if session.get("week") and session.get("day_in_week"):
        w, d, name = session["week"], session["day_in_week"], session.get("day_name")
    elif session.get("day"):
        # Single-week programs number days straight through.
        days = [(wi, di) for wi, week in enumerate(weeks) for di in range(len(week))]
        if session["day"] > len(days):
            return {}
        wi, di = days[session["day"] - 1]
        w, d, name = wi + 1, di + 1, weeks[wi][di][0]
    else:
        return {}

    merged = {}
    others = [weeks[i] for i in range(len(weeks)) if i != w - 1]
    for week in others:
        merged.update({k: v for k, v in (find(week, name, d) or {}).items() if k not in merged})
    if w <= len(weeks):
        merged.update(find(weeks[w - 1], name, d) or {})
    return merged


def tier_for(tiers, exercise):
    """'Squat' in the program matches 'Squat' or 'Squat, Barbell' in history."""
    name = norm(exercise)
    if name in tiers:
        return tiers[name]
    base = name.split(",")[0].strip()
    return tiers.get(base) or next(
        (t for n, t in tiers.items() if n.split(",")[0].strip() == base), None)


def session_sets(session, tiers):
    """Flatten a parsed session into workout_sets rows (warmups first)."""
    rows = []
    for ex in session["exercises"]:
        tier = tier_for(tiers, ex["name"])
        for s in ex["warmup"]:
            rows.append({"exercise": ex["name"], "tier": tier, "reps": s["reps"],
                         "weight_kg": s["weight_kg"], "is_warmup": True,
                         "target_reps": None, "target_weight_kg": None})
        for i, s in enumerate(ex["sets"]):
            t = ex["target"][i] if i < len(ex["target"]) else None
            rows.append({"exercise": ex["name"], "tier": tier, "reps": s["reps"],
                         "weight_kg": s["weight_kg"], "is_warmup": False,
                         "target_reps": t["reps"] if t else None,
                         "target_weight_kg": t["weight_kg"] if t else None})
    for i, row in enumerate(rows):
        row["set_index"] = i
    return rows
