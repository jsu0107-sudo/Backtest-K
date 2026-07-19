import unittest

from scripts.verify_official_prices import VerificationError, build_request_url, parse_price_items, reconcile


def api_payload(rows, total_count=None):
    return {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
            "body": {"numOfRows": len(rows), "pageNo": 1, "totalCount": total_count or len(rows), "items": {"item": rows}},
        }
    }


class OfficialVerificationTests(unittest.TestCase):
    def test_parse_price_items_reads_rows_and_total(self):
        rows, total = parse_price_items(api_payload([
            {"basDt": "20260716", "srtnCd": "069500", "itmsNm": "KODEX 200", "clpr": "31500"},
        ], total_count=940))
        self.assertEqual(total, 940)
        self.assertEqual(rows[0]["srtnCd"], "069500")

    def test_parse_price_items_rejects_error_result_code(self):
        payload = {"response": {"header": {"resultCode": "30", "resultMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}}
        with self.assertRaises(VerificationError):
            parse_price_items(payload)

    def test_parse_price_items_handles_single_item_dict(self):
        payload = api_payload([])
        payload["response"]["body"]["items"] = {"item": {"basDt": "20260716", "srtnCd": "069500", "clpr": "31500"}}
        rows, _ = parse_price_items(payload)
        self.assertEqual(len(rows), 1)

    def test_reconcile_counts_matches_and_mismatches(self):
        records = [
            {"ticker": "069500", "name": "KODEX 200", "latest_raw_close": {"date": "2026-07-16", "close": 31500.0}},
            {"ticker": "360750", "name": "TIGER 미국S&P500", "latest_raw_close": {"date": "2026-07-16", "close": 20000.0}},
            {"ticker": "114260", "name": "KODEX 국고채3년", "latest_raw_close": {"date": "2026-07-16", "close": 60000.0}},
            {"ticker": "133690", "name": "TIGER 미국나스닥100", "latest_raw_close": None},
        ]
        official = {
            "069500": {"20260716": 31500.0},
            "360750": {"20260716": 20100.0},
        }
        summary = reconcile(records, official, tolerance_bps=20.0)
        self.assertEqual(summary["matched"], 1)
        self.assertEqual(summary["mismatched"], 1)
        self.assertEqual(summary["missing_official"], 1)
        self.assertEqual(summary["missing_local"], 1)
        self.assertEqual(summary["status"], "mismatch")
        self.assertEqual(summary["mismatches"][0]["ticker"], "360750")

    def test_reconcile_all_matched_is_ok(self):
        records = [{"ticker": "069500", "name": "KODEX 200", "latest_raw_close": {"date": "2026-07-16", "close": 31500.0}}]
        summary = reconcile(records, {"069500": {"20260716": 31500.4}}, tolerance_bps=20.0)
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["mismatched"], 0)

    def test_build_request_url_keeps_pre_encoded_key(self):
        url = build_request_url("abc%2Bdef", page_no=1, num_of_rows=10, begin_bas_dt="20260701", end_bas_dt="20260716")
        self.assertIn("serviceKey=abc%2Bdef", url)

    def test_build_request_url_encodes_raw_key(self):
        url = build_request_url("abc+def==", page_no=1, num_of_rows=10, begin_bas_dt="20260701", end_bas_dt="20260716")
        self.assertIn("serviceKey=abc%2Bdef%3D%3D", url)


if __name__ == "__main__":
    unittest.main()
