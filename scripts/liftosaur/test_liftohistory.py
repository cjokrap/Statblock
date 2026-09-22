"""Unit tests for liftohistory.py. Run: python3 -m unittest discover scripts/liftosaur"""
import unittest
from datetime import datetime, timezone

import liftohistory as lh


class ParseRecord(unittest.TestCase):
    def test_example_from_api_docs(self):
        s = lh.parse_record(
            '2026-03-01T10:00:00Z / program: "5/3/1" / dayName: "Squat Day" / week: 1 / '
            'dayInWeek: 1 / duration: 3600s / exercises: {\n'
            "  Squat, Barbell / 3x5 185lb / warmup: 1x5 95lb, 1x3 135lb / target: 3x5 185lb 120s\n"
            "  Leg Press / 3x10 200lb / target: 3x10 200lb 90s\n}")
        self.assertEqual(s["occurred_at"], datetime(2026, 3, 1, 10, tzinfo=timezone.utc))
        self.assertEqual((s["program"], s["day_name"], s["week"], s["day_in_week"], s["duration_s"]),
                         ("5/3/1", "Squat Day", 1, 1, 3600))
        squat = s["exercises"][0]
        self.assertEqual(squat["name"], "Squat, Barbell")
        self.assertEqual([x["reps"] for x in squat["sets"]], [5, 5, 5])
        self.assertEqual(squat["sets"][0]["weight_kg"], 83.91)
        self.assertEqual(len(squat["warmup"]), 2)

    def test_offset_date_notes_rpe_labels_unilateral(self):
        s = lh.parse_record(
            "// workout note\n2026-03-01 05:00:00 -05:00 / exercises: {\n"
            "  // exercise note\n"
            "  Lunge / 2x8|7 20kg @8 (left short)\n"
            "  Push Up / 3x20\n}")
        self.assertEqual(s["occurred_at"], datetime(2026, 3, 1, 10, tzinfo=timezone.utc))
        self.assertIsNone(s["program"])
        lunge, push = s["exercises"]
        self.assertEqual([(x["reps"], x["weight_kg"]) for x in lunge["sets"]], [(8, 20.0), (8, 20.0)])
        self.assertEqual(push["sets"][0]["weight_kg"], 0.0)

    def test_targets_ranges_amrap_and_signed_weights(self):
        s = lh.parse_record(
            "2026-03-01 10:00:00 +00:00 / exercises: {\n"
            "  Dip / 3x10 +25lb / target: 3x8-12+ +25lb+ @8+ 90s\n"
            "  Assisted Pull Up / 3x8 -40lb\n}")
        dip, pull = s["exercises"]
        self.assertEqual(dip["target"][0], {"reps": 12, "weight_kg": 11.34})
        self.assertEqual(dip["sets"][0]["weight_kg"], 11.34)
        self.assertEqual(pull["sets"][0]["weight_kg"], 18.14)  # stored as load; never negative

    def test_errors(self):
        with self.assertRaises(lh.ParseError):
            lh.parse_record("not a date / exercises: {\n}")
        with self.assertRaises(lh.ParseError):
            lh.parse_record("2026-03-01 10:00:00 +00:00 / exercises: {\n  Squat / 3x5 100lb\n")


class Tiers(unittest.TestCase):
    PROGRAM = (
        "# Week 1\n## Heavy\nt1: Squat / 5x3\nt2: Bench Press / 3x10\nt3a: Lat Pulldown / 3x15\n"
        "Face Pull / 3x20\n\n## Light\nt1: Bench Press / 5x3\nt2: Squat, Dumbbell / 3x10\n"
        "# Week 2\n## Heavy\nt1: Deadlift / 5x3\n")

    def test_multi_week_by_day_name_and_index(self):
        weeks = lh.program_tiers(self.PROGRAM)
        heavy = lh.day_tiers(weeks, {"week": 1, "day_in_week": 1, "day_name": "Heavy"})
        self.assertEqual(lh.tier_for(heavy, "Squat, Barbell"), "T1")
        self.assertEqual(lh.tier_for(heavy, "Lat Pulldown"), "T3")
        self.assertIsNone(lh.tier_for(heavy, "Face Pull"))
        light = lh.day_tiers(weeks, {"week": 1, "day_in_week": 2, "day_name": "renamed"})
        self.assertEqual(lh.tier_for(light, "Bench Press"), "T1")
        self.assertEqual(lh.tier_for(light, "Squat, Dumbbell"), "T2")
        wk2 = lh.day_tiers(weeks, {"week": 2, "day_in_week": 1, "day_name": "Heavy"})
        self.assertEqual(lh.tier_for(wk2, "Deadlift"), "T1")

    def test_single_week_day_number_and_unknowns(self):
        weeks = lh.program_tiers(self.PROGRAM)
        self.assertEqual(lh.tier_for(lh.day_tiers(weeks, {"day": 2}), "Bench Press"), "T1")
        self.assertEqual(lh.day_tiers(weeks, {"day": 9}), {})
        self.assertEqual(lh.day_tiers([], {"day": 1}), {})
        self.assertEqual(lh.day_tiers(weeks, {}), {})

    def test_session_sets(self):
        s = lh.parse_record(
            "2026-03-01 10:00:00 +00:00 / exercises: {\n"
            "  Squat / 2x3 100kg, 1x5 100kg / warmup: 1x5 60kg / target: 3x3+ 100kg\n}")
        rows = lh.session_sets(s, {"squat": "T1"})
        self.assertEqual([r["set_index"] for r in rows], [0, 1, 2, 3])
        self.assertTrue(rows[0]["is_warmup"])
        self.assertIsNone(rows[0]["target_reps"])
        self.assertEqual([r["reps"] for r in rows[1:]], [3, 3, 5])
        self.assertEqual({r["tier"] for r in rows}, {"T1"})
        self.assertEqual(rows[3]["target_reps"], 3)


if __name__ == "__main__":
    unittest.main()
