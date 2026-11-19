"""Recover KOSPI200 price-index months; retain validated index history on outage.

KRX ETF *reference-index levels* are used, never ETF prices or total returns.
Credentials are used only in request headers and are never serialized.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import math
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

from scripts.audit_market_data import annotate_payload, expected_month_end, previous_month
from scripts.restore_index_months import extract_close, repaired_payload
from scripts.validate_market_data import validate_asset

KRX_ENDPOINT = "https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd"


def read_krx_key(env_file: Path | None) -> str | None:
    key = os.environ.get("KRX_AUTH_KEY")
    if key or env_file is None:
        return key
    # Read one named credential. No environment mutation, interpolation or exec.
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        match = re.match(r"\s*(?:export\s+)?KRX_AUTH_KEY\s*=\s*(.*)\s*$", line)
        if match:
            value = match.group(1).strip()
            return value[1:-1] if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'" else value
    return None


def retained_index(output_dir: Path, asset_id: str, as_of: dt.date) -> dict:
    catalog = json.loads((output_dir / "assets.json").read_text(encoding="utf-8"))
    record = next(row for row in catalog["assets"] if row["id"] == asset_id)
    path = output_dir / f"{asset_id}.json"
    if record.get("file") != f"data/{asset_id}.json":
        raise ValueError("Unexpected retained index file")
    errors = validate_asset(path, record)
    if errors:
        raise ValueError("Retained index contract invalid")
    payload = json.loads(path.read_text(encoding="utf-8"))
    expected_currency = "USD" if asset_id == "INDEX_SP500" else "KRW"
    if (payload["id"] != asset_id or payload["asset_type"] != "index"
            or payload["currency"] != expected_currency
            or payload["distribution"]["included"] is not False
            or payload["distribution"]["method"] != "price_index"
            or dt.date.fromisoformat(payload["data_as_of"]) > as_of):
        raise ValueError("Retained index identity, basis or period invalid")
    annotate_payload(payload, as_of)
    if not payload["month_end_quality"]["usable_month_count"]:
        raise ValueError("No eligible retained index months")
    return payload


def fetch_krx_point(date: str, key: str) -> dict:
    compact = date.replace("-", "")
    request = urllib.request.Request(
        f"{KRX_ENDPOINT}?basDd={compact}",
        headers={"AUTH_KEY": key, "Accept": "application/json", "User-Agent": "Backtest-K/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            raw = response.read()
        receipt = {"status": "ok", "requested_date": compact,
                   "rows": json.loads(raw.decode("utf-8"))["OutBlock_1"]}
        close = extract_close(receipt)
    except Exception as error:
        # No raw exception/URL/header/payload can carry a credential into logs.
        raise ValueError(f"KRX reference-index unavailable for {date} ({type(error).__name__})") from None
    return {"date": date, "close": close, "krx_response_sha256": hashlib.sha256(raw).hexdigest(),
            "cross_check": "two distinct KRX ETF reference-index fields"}


def extend_kospi200(payload: dict, as_of: dt.date, key: str, fetch_point=fetch_krx_point,
                    expected_levels: dict | None = None) -> dict:
    result = copy.deepcopy(payload)
    if (result["id"] != "INDEX_KOSPI200" or result["asset_type"] != "index"
            or result["currency"] != "KRW" or result["distribution"]["included"] is not False
            or result["distribution"]["method"] != "price_index"):
        raise ValueError("Official extension requires KOSPI200 KRW price index")
    last = result["month_end_quality"]["usable_last_month"]
    target = previous_month(as_of.strftime("%Y-%m"))
    if not last or last > target:
        raise ValueError("Invalid official extension period")
    months = [last]
    while months[-1] < target:
        month = dt.date.fromisoformat(months[-1] + "-01")
        months.append((month.replace(day=28) + dt.timedelta(days=4)).strftime("%Y-%m"))
        if len(months) > 13:
            raise ValueError("Official extension exceeds bounded 12-month recovery")
    points = []
    previous_points = {point["date"]: point for point in result.get("official_index_evidence", {}).get("points", [])}
    for month in months:
        date = expected_month_end("XKRX", month, as_of.year)
        point = fetch_point(date, key)
        if point.get("date") != date or not isinstance(point.get("close"), (int, float)) \
                or not math.isfinite(point["close"]) or point["close"] <= 0 \
                or not re.fullmatch(r"[0-9a-f]{64}", point.get("krx_response_sha256", "")):
            raise ValueError("Invalid dated official price evidence")
        points.append(point)
        if date in (expected_levels or {}) and expected_levels[date] != point["close"]:
            raise ValueError("Official index level conflicts with audited historical evidence")
        if date in previous_points and previous_points[date]["close"] != point["close"]:
            raise ValueError("Official index level revised; review required before replacing prior evidence")
    rows = {row["month"]: row for row in result["monthly_returns"]}
    for baseline, end in zip(points, points[1:]):
        month = end["date"][:7]
        # Both endpoints are official KRX levels from the same price index.
        rows[month] = {"month": month, "return": round(end["close"] / baseline["close"] - 1, 10),
                       "observation_date": end["date"], "previous_observation_date": baseline["date"],
                       "source_ref": "official_index_evidence"}
    result["monthly_returns"] = [rows[month] for month in sorted(rows)]
    result.update(first_month=min(rows), last_month=max(rows), monthly_return_count=len(rows),
                  data_as_of=max(result["data_as_of"], points[-1]["date"]))
    source = {"name": "KRX OPEN API ETF reference-index field", "url": KRX_ENDPOINT,
              "role": "KOSPI200 가격지수 월말값 (ETF 종가·총수익 아님)"}
    if source not in result["sources"]:
        result["sources"].append(source)
    result["official_index_evidence"] = {
        "id": "INDEX_KOSPI200", "currency": "KRW", "return_basis": "price_index",
        "field": "OBJ_STKPRC_IDX", "reference_etfs": ["069500", "102110"],
        "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "points": sorted({**previous_points, **{point["date"]: point for point in points}}.values(), key=lambda point: point["date"]),
        "note": "두 ETF의 코스피200 기초지수 값 일치 확인. ETF 종가 및 총수익으로 대체하지 않음.",
    }
    annotate_payload(result, as_of)
    return result


def index_fallback(output_dir: Path, asset_id: str, as_of: dt.date,
                   key: str | None, reason: str, repairs: Path | None = None) -> dict:
    payload = retained_index(output_dir, asset_id, as_of)
    expected_levels = {}
    if asset_id == "INDEX_KOSPI200" and repairs and repairs.is_file():
        evidence = json.loads(repairs.read_text(encoding="utf-8"))
        payload, _ = repaired_payload(payload, evidence, as_of)
        expected_levels = {point["date"]: point["close"] for point in evidence["points"].values()}
    status = "retained"
    official_error = None
    if asset_id == "INDEX_KOSPI200" and key:
        try:
            payload = extend_kospi200(payload, as_of, key, expected_levels=expected_levels)
            status = "official_month_end"
        except ValueError as error:
            official_error = str(error)
    elif asset_id == "INDEX_KOSPI200":
        official_error = "KRX credential not configured"
    payload["refresh"] = {
        "status": status, "attempted_as_of": as_of.isoformat(),
        "reason": reason, "official_error": official_error,
        "observation_as_of": payload["data_as_of"],
        "expected_complete_month": previous_month(as_of.strftime("%Y-%m")),
        "usable_last_month": payload["month_end_quality"]["usable_last_month"],
        "note": "관측일은 유지하며 생성일로 대체하지 않습니다. 이전 지수 보존 시 지연을 표시합니다.",
    }
    return payload
