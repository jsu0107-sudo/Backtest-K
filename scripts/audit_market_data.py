"""Annotate (never rewrite) returns with reproducible month-end eligibility.

This checks session dates, NOT prices or dividend accuracy. Existing rows are
retained for audit. Clients consume only the most recent contiguous eligible window.
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
from functools import lru_cache
from pathlib import Path

import exchange_calendars as xcals


@lru_cache(maxsize=8)
def trading_calendar(name: str, year: int):
    return xcals.get_calendar(name, start="1970-01-01", end=f"{year + 1}-12-31")


def month_ordinal(month: str) -> int:
    year, number = map(int, month.split("-"))
    return year * 12 + number


def previous_month(month: str) -> str:
    return (dt.date.fromisoformat(month + "-01") - dt.timedelta(days=1)).strftime("%Y-%m")


@lru_cache(maxsize=4096)
def expected_month_end(name: str, month: str, year: int) -> str:
    y, m = map(int, month.split("-"))
    end = f"{month}-{calendar.monthrange(y, m)[1]:02d}"
    sessions = trading_calendar(name, year).sessions_in_range(month + "-01", end)
    if not len(sessions):
        raise ValueError(f"No calendar sessions for {name} {month}")
    return sessions[-1].date().isoformat()


def annotate_payload(payload: dict, as_of: dt.date) -> dict:
    name = "XNYS" if payload["id"] == "INDEX_SP500" else "XKRX"
    rows = payload["monthly_returns"]
    excluded = []
    eligible = []
    previous = None
    for row in rows:
        month = row["month"]
        expected = expected_month_end(name, month, as_of.year)
        reason = None
        if month >= as_of.strftime("%Y-%m"):
            reason = "open_or_future_month"
        elif row.get("observation_date") != expected:
            reason = "month_end_observation_mismatch"
        # A return following an incomplete baseline is also unsafe.
        baseline = row.get("previous_observation_date")
        if baseline is None and previous is not None:
            baseline = previous.get("observation_date")
        if baseline is not None:
            expected_baseline = expected_month_end(name, previous_month(month), as_of.year)
            if baseline != expected_baseline:
                reason = reason or "baseline_observation_mismatch"
        if reason:
            excluded.append({"month": month, "observation_date": row.get("observation_date"),
                             "expected_observation_date": expected, "reason": reason})
        else:
            eligible.append(month)
        previous = row

    segments = []
    for month in eligible:
        if not segments or month_ordinal(month) != month_ordinal(segments[-1][-1]) + 1:
            segments.append([])
        segments[-1].append(month)
    usable = segments[-1] if segments else []
    expected_last = previous_month(as_of.strftime("%Y-%m"))
    quality = {
        "version": 1, "checked_as_of": as_of.isoformat(), "calendar": name,
        "calendar_source": f"exchange_calendars {xcals.__version__}",
        "expected_complete_month": expected_last,
        "last_complete_month": eligible[-1] if eligible else None,
        "usable_first_month": usable[0] if usable else None,
        "usable_last_month": usable[-1] if usable else None,
        "usable_month_count": len(usable),
        "excluded_months": excluded,
        "outside_usable_window_count": len(rows) - len(usable),
        "status": "current" if usable and usable[-1] == expected_last else "stale",
        "baseline_verification": "available" if rows[0].get("previous_observation_date") else "legacy_first_baseline_unavailable",
        "note": "거래일 달력 대조이며 시세·분배금 독립 검증이 아닙니다. 제외된 원본 수익률은 보존합니다.",
    }
    payload["month_end_quality"] = quality
    payload["return_currency"] = payload["currency"]
    payload["krw_comparable"] = payload["currency"] == "KRW"
    return quality


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--as-of", type=dt.date.fromisoformat, default=dt.date.today())
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    catalog_path = args.data_dir / "assets.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    changed = []
    summary = []
    # Resolve and audit all inputs before any writes. Never change return values.
    for record in catalog["assets"]:
        path = (args.data_dir.parent / record["file"]).resolve()
        if args.data_dir.resolve() not in path.parents:
            raise ValueError("Unsafe asset path")
        payload = json.loads(path.read_text(encoding="utf-8"))
        quality = annotate_payload(payload, args.as_of)
        for key in ("month_end_quality", "return_currency", "krw_comparable"):
            record[key] = payload[key]
        record["distribution_verification_status"] = payload["distribution"].get("verification_status", "unknown")
        changed.append((path, payload))
        summary.append({"id": payload["id"], "excluded": len(quality["excluded_months"]),
                        "usable_first": quality["usable_first_month"], "usable_last": quality["usable_last_month"],
                        "status": quality["status"]})
    if args.write:
        for path, payload in changed:
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"assets": len(summary), "excluded_rows": sum(s["excluded"] for s in summary),
                      "affected_assets": sum(bool(s["excluded"]) for s in summary),
                      "representatives": summary[:6]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
