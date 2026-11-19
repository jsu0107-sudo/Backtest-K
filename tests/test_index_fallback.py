import copy
import datetime as dt
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_market_data as builder
from scripts.audit_market_data import annotate_payload
from scripts.index_fallback import extend_kospi200, index_fallback, retained_index
from scripts.restore_index_months import extract_close
from scripts.validate_market_data import validate_asset

ROOT = Path(__file__).resolve().parents[1]
AS_OF = dt.date(2026, 10, 1)


def read(asset_id):
    payload = json.loads((ROOT / f"data/{asset_id}.json").read_text(encoding="utf-8"))
    if asset_id == "INDEX_KOSPI200":
        # Reproduce the incident even after live data recovers September.
        payload["monthly_returns"] = [row for row in payload["monthly_returns"] if row["month"] <= "2026-08"]
        payload.update(last_month="2026-08", data_as_of="2026-08-31", monthly_return_count=len(payload["monthly_returns"]))
        payload.pop("refresh", None)
        payload.pop("official_index_evidence", None)
        annotate_payload(payload, dt.date(2026, 9, 27))
    return payload


class IndexFallbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name) / "data"
        self.data.mkdir()
        for name in ("assets", "INDEX_KOSPI", "INDEX_KOSPI200", "INDEX_SP500"):
            shutil.copyfile(ROOT / f"data/{name}.json", self.data / f"{name}.json")
        payload = read("INDEX_KOSPI200")
        (self.data / "INDEX_KOSPI200.json").write_text(json.dumps(payload), encoding="utf-8")
        catalog = json.loads((self.data / "assets.json").read_text(encoding="utf-8"))
        record = next(row for row in catalog["assets"] if row["id"] == payload["id"])
        record.update(builder.catalog_record(payload, "INDEX_KOSPI200.json"))
        (self.data / "assets.json").write_text(json.dumps(catalog), encoding="utf-8")

    def test_outage_preserves_values_and_reports_actual_stale_date(self):
        previous = read("INDEX_KOSPI200")
        result = index_fallback(self.data, "INDEX_KOSPI200", AS_OF, None, "source unavailable")
        self.assertEqual(result["monthly_returns"], previous["monthly_returns"])
        self.assertEqual(result["data_as_of"], previous["data_as_of"])
        self.assertEqual(result["refresh"]["status"], "retained")
        self.assertEqual(result["month_end_quality"]["status"], "stale")
        self.assertEqual(result["refresh"]["expected_complete_month"], "2026-09")

    def test_bad_retained_currency_or_contract_is_rejected(self):
        payload = read("INDEX_KOSPI200")
        payload["currency"] = "USD"
        (self.data / "INDEX_KOSPI200.json").write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaises(ValueError):
            retained_index(self.data, "INDEX_KOSPI200", AS_OF)

    def test_two_references_cannot_be_different_index_kinds_or_dates(self):
        for field, value in (("IDX_IND_NM", "코스피200 TR"), ("BAS_DD", "20260929")):
            rows = [{"ISU_CD": ticker, "BAS_DD": "20260930", "IDX_IND_NM": "코스피 200",
                     "OBJ_STKPRC_IDX": "100", "TDD_CLSPRC": "90000"} for ticker in ("069500", "102110")]
            rows[1][field] = value
            with self.assertRaises(ValueError):
                extract_close({"status": "ok", "requested_date": "20260930", "rows": rows})

    def official_payload(self, fetch=None):
        payload = read("INDEX_KOSPI200")
        annotate_payload(payload, AS_OF)
        def points(date, key):
            self.assertEqual(key, "in-memory-test-key")
            return {"date": date, "close": {"2026-08-31": 100, "2026-09-30": 105}[date],
                    "krx_response_sha256": "a" * 64, "cross_check": "two KRX reference levels"}
        return extend_kospi200(payload, AS_OF, "in-memory-test-key", fetch or points)

    def test_extension_uses_same_provider_month_end_price_ratio_and_keeps_history(self):
        previous = read("INDEX_KOSPI200")
        result = self.official_payload()
        self.assertEqual(result["monthly_returns"][:-1], previous["monthly_returns"])
        self.assertEqual(result["monthly_returns"][-1]["return"], .05)
        self.assertEqual(result["monthly_returns"][-1]["previous_observation_date"], "2026-08-31")
        self.assertEqual(result["data_as_of"], "2026-09-30")
        self.assertEqual(result["month_end_quality"]["status"], "current")
        self.assertFalse(result["distribution"]["included"])

    def test_official_point_must_be_requested_month_end(self):
        with self.assertRaisesRegex(ValueError, "dated official"):
            self.official_payload(lambda date, key: {"date": "2026-09-29", "close": 100,
                                                      "krx_response_sha256": "a" * 64})

    def test_conflicting_audited_baseline_is_rejected(self):
        payload = read("INDEX_KOSPI200")
        annotate_payload(payload, AS_OF)
        with self.assertRaisesRegex(ValueError, "historical evidence"):
            extend_kospi200(payload, AS_OF, "test", lambda date, key: {
                "date": date, "close": 100, "krx_response_sha256": "a" * 64,
            }, expected_levels={"2026-08-31": 1071.85})

    def test_official_evidence_tampering_fails_contract(self):
        result = self.official_payload()
        result["monthly_returns"][-1]["return"] = .06
        path = self.data / "INDEX_KOSPI200.json"
        path.write_text(json.dumps(result), encoding="utf-8")
        record = builder.catalog_record(result, path.name)
        self.assertTrue(any("official index evidence" in error for error in validate_asset(path, record)))

    def test_official_failure_keeps_prior_index_without_leaking_key(self):
        with patch("scripts.index_fallback.fetch_krx_point", side_effect=AssertionError("unused")):
            # extend_kospi200 is the boundary; no credential-bearing exception is serialized.
            with patch("scripts.index_fallback.extend_kospi200", side_effect=ValueError("KRX unavailable")):
                result = index_fallback(self.data, "INDEX_KOSPI200", AS_OF, "secret", "Yahoo unavailable")
        self.assertEqual(result["refresh"]["status"], "retained")
        self.assertNotIn("secret", json.dumps(result))

    def requests(self):
        etf = builder.AssetRequest("069500", "069500", "KODEX 200", "069500.KS", "etf", "국내주식", "test")
        indexes = [builder.AssetRequest(row["id"], row["ticker"], row["name"], row["symbol"],
                                      "index", row["category"], row["description"])
                   for row in builder.REPRESENTATIVE_INDEXES]
        return [etf, *indexes]

    def test_full_refresh_succeeds_on_one_index_outage_and_publishes_dated_retention(self):
        def collect(request, start, today):
            if request.id == "INDEX_KOSPI200":
                raise builder.CollectionError("Yahoo chart returned fewer than three usable prices")
            return read(request.id)
        with patch.object(builder, "build_requests", return_value=self.requests()), \
                patch.object(builder, "build_asset_payload", side_effect=collect), \
                patch.object(builder, "read_krx_key", return_value=None):
            self.assertEqual(builder.main(["--output-dir", str(self.data), "--limit", "100",
                                           "--min-etfs", "1", "--as-of", AS_OF.isoformat()]), 0)
        catalog = json.loads((self.data / "assets.json").read_text(encoding="utf-8"))
        self.assertEqual(catalog["retained_index_ids"], ["INDEX_KOSPI200"])
        self.assertEqual(catalog["index_count"], 3)
        self.assertEqual(catalog["etf_count"], 1)
        self.assertEqual(catalog["observation_as_of_min"], "2026-08-31")

    def test_missing_validated_prior_index_still_blocks_publish(self):
        (self.data / "INDEX_KOSPI200.json").unlink()
        before = (self.data / "assets.json").read_bytes()
        def collect(request, start, today):
            if request.id == "INDEX_KOSPI200":
                raise builder.CollectionError("unavailable")
            return read(request.id)
        with patch.object(builder, "build_requests", return_value=self.requests()), \
                patch.object(builder, "build_asset_payload", side_effect=collect), \
                patch.object(builder, "read_krx_key", return_value=None):
            with self.assertRaisesRegex(SystemExit, "representative indexes missing"):
                builder.main(["--output-dir", str(self.data), "--limit", "100", "--min-etfs", "1", "--as-of", AS_OF.isoformat()])
        self.assertEqual(before, (self.data / "assets.json").read_bytes())


if __name__ == "__main__":
    unittest.main()
