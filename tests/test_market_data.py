import datetime as dt
import unittest

from scripts.build_market_data import categorize_etf, last_complete_month, monthly_returns_from_prices, validate_payloads_before_publish


class MarketDataTransformTests(unittest.TestCase):
    def test_monthly_returns_use_last_observation_and_exclude_partial_month(self):
        rows, first_observation, data_as_of = monthly_returns_from_prices(
            [
                (dt.date(2024, 1, 2), 90.0),
                (dt.date(2024, 1, 31), 100.0),
                (dt.date(2024, 2, 29), 110.0),
                (dt.date(2024, 3, 28), 99.0),
                (dt.date(2024, 4, 1), 120.0),
            ],
            complete_through="2024-03",
        )
        self.assertEqual(first_observation, "2024-01-31")
        self.assertEqual(data_as_of, "2024-04-01")
        self.assertEqual([row["month"] for row in rows], ["2024-02", "2024-03"])
        self.assertAlmostEqual(rows[0]["return"], 0.1)
        self.assertAlmostEqual(rows[1]["return"], -0.1)

    def test_last_complete_month_handles_year_boundary(self):
        self.assertEqual(last_complete_month(dt.date(2026, 1, 3)), "2025-12")

    def test_etf_categories(self):
        self.assertEqual(categorize_etf("KODEX 국고채3년"), "채권")
        self.assertEqual(categorize_etf("TIGER 미국S&P500"), "해외주식")
        self.assertEqual(categorize_etf("KODEX 200"), "국내주식")
        self.assertEqual(categorize_etf("KODEX 골드선물(H)"), "원자재")

    def test_publish_validation_rejects_duplicate_months(self):
        payload = {
            "id": "069500",
            "ticker": "069500",
            "name": "KODEX 200",
            "listing_date": "2002-10-11",
            "data_as_of": "2026-07-17",
            "sources": [{"name": "source", "url": "https://example.com"}],
            "distribution": {"included": True},
            "monthly_return_count": 2,
            "monthly_returns": [
                {"month": "2026-06", "return": 0.01},
                {"month": "2026-06", "return": 0.02},
            ],
        }
        with self.assertRaises(RuntimeError):
            validate_payloads_before_publish([payload])


if __name__ == "__main__":
    unittest.main()
