import copy
import datetime as dt
import unittest
from scripts.audit_market_data import annotate_payload, expected_month_end


class MonthEndQualityTests(unittest.TestCase):
    def payload(self, rows):
        return {"id": "069500", "currency": "KRW", "monthly_returns": rows}

    def test_midmonth_and_following_baseline_are_quarantined(self):
        rows = [
            {"month": "2026-06", "observation_date": "2026-06-30", "return": 0.0},
            {"month": "2026-07", "observation_date": "2026-07-16", "return": -0.2},
            {"month": "2026-08", "observation_date": "2026-08-31", "return": 0.2},
            {"month": "2026-09", "observation_date": "2026-09-30", "return": 0.0},
        ]
        payload = self.payload(copy.deepcopy(rows))
        quality = annotate_payload(payload, dt.date(2026, 10, 1))
        self.assertEqual([r["month"] for r in quality["excluded_months"]], ["2026-07", "2026-08"])
        self.assertEqual(quality["usable_first_month"], "2026-09")
        self.assertEqual(payload["monthly_returns"], rows)

    def test_krx_year_end_and_us_good_friday(self):
        self.assertEqual(expected_month_end("XKRX", "2024-12", 2026), "2024-12-30")
        self.assertEqual(expected_month_end("XNYS", "2024-03", 2026), "2024-03-28")

    def test_current_month_never_eligible(self):
        p = self.payload([{"month": "2026-09", "observation_date": "2026-09-30", "return": 0.0}])
        self.assertIsNone(annotate_payload(p, dt.date(2026, 9, 30))["usable_last_month"])

    def test_explicit_first_baseline_is_checked(self):
        p = self.payload([{"month": "2026-08", "observation_date": "2026-08-31",
                           "previous_observation_date": "2026-07-16", "return": 0.2}])
        self.assertEqual(annotate_payload(p, dt.date(2026, 9, 1))["excluded_months"][0]["reason"],
                         "baseline_observation_mismatch")
