import datetime as dt
import unittest

from scripts.build_market_data import (
    categorize_etf,
    last_complete_month,
    monthly_returns_from_prices,
    trim_stale_trailing_returns,
    validate_payloads_before_publish,
)


class MarketDataTransformTests(unittest.TestCase):
    def test_monthly_returns_use_last_observation_and_exclude_partial_month(self):
        rows, first_observation, data_as_of, notes = monthly_returns_from_prices(
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
        self.assertEqual(notes, [])

    def test_month_gap_keeps_longest_contiguous_segment(self):
        # 2023-01~02 뒤 갭, 2023-06~12 연속: 뒤쪽 긴 구간만 사용해야 하고
        # 갭을 건너뛴 수익률이 한 달로 기록되면 안 된다.
        points = [(dt.date(2023, 1, 31), 100.0), (dt.date(2023, 2, 28), 105.0)]
        price = 200.0
        for month in range(6, 13):
            points.append((dt.date(2023, month, 25), price))
            price *= 1.01
        rows, first_observation, _, notes = monthly_returns_from_prices(points, complete_through="2023-12")
        months = [row["month"] for row in rows]
        self.assertEqual(months[0], "2023-07")
        self.assertEqual(months[-1], "2023-12")
        self.assertNotIn("2023-06", months)  # 세그먼트 첫 달은 기준가로만 사용
        self.assertTrue(all(abs(row["return"] - 0.01) < 1e-9 for row in rows))
        self.assertEqual(first_observation, "2023-06-25")
        self.assertEqual(len(notes), 1)
        self.assertIn("월 갭", notes[0])

    def test_trim_stale_trailing_returns_drops_exact_zero_tail(self):
        rows = [
            {"month": "2026-04", "return": 0.02},
            {"month": "2026-05", "return": 0.0},
            {"month": "2026-06", "return": 0.0},
        ]
        trimmed, count = trim_stale_trailing_returns(rows)
        self.assertEqual(count, 2)
        self.assertEqual([row["month"] for row in trimmed], ["2026-04"])
        untouched, count2 = trim_stale_trailing_returns([{"month": "2026-06", "return": 0.001}])
        self.assertEqual(count2, 0)
        self.assertEqual(len(untouched), 1)

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
