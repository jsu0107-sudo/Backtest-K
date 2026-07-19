#!/usr/bin/env python3
"""Reconcile the published market data against the official public API.

금융위원회_증권상품시세정보(getETFPriceInfo, 공공데이터포털)의 공표 종가와
현재 provisional 공급자가 수집한 최신 원시 종가(latest_raw_close)를 종목별로
대조해 `data/official_verification.json`에 결과를 기록한다.

* 인증키는 환경변수 ``DATA_GO_KR_API_KEY``로만 주입한다.  키를 저장소, 브라우저
  코드, 생성된 JSON 어디에도 기록하지 않는다.
* 키가 없으면 기본적으로 검증을 건너뛰고 종료 코드 0을 반환한다.  GitHub
  Actions에서 secret이 아직 등록되지 않아도 파이프라인이 깨지지 않게 하기
  위해서다 (``--require-key``로 강제 실패 가능).
* 공식 API의 종가는 분배금 미조정 원시 종가이므로 수익률(수정종가) 자체가
  아니라 "시세 원천이 거래소 공표값과 일치하는가"를 검증한다.  분배금 원장
  독립 대사는 별도 후속 작업이다 (docs/DATA_PIPELINE.md 참고).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1.0"
API_ENDPOINT = "https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETFPriceInfo"
API_NAME = "금융위원회_증권상품시세정보 getETFPriceInfo (공공데이터포털)"
USER_AGENT = "Backtest-K-Official-Verify/1.0 (+https://github.com/jsu0107-sudo/Backtest-K)"
ENV_KEY = "DATA_GO_KR_API_KEY"
DEFAULT_TOLERANCE_BPS = 20.0
MAX_MISMATCH_DETAILS = 50


class VerificationError(RuntimeError):
    """Raised when the official API returns an unusable response."""


def build_request_url(service_key: str, *, page_no: int, num_of_rows: int, begin_bas_dt: str, end_bas_dt: str) -> str:
    params = {
        "pageNo": str(page_no),
        "numOfRows": str(num_of_rows),
        "resultType": "json",
        "beginBasDt": begin_bas_dt,
        "endBasDt": end_bas_dt,
    }
    query = urllib.parse.urlencode(params)
    # data.go.kr 발급 키는 인코딩/디코딩 두 형태가 있다. '%'가 포함되면 이미
    # 인코딩된 키로 보고 그대로 붙이고, 아니면 표준 인코딩을 적용한다.
    if "%" in service_key:
        key_part = service_key
    else:
        key_part = urllib.parse.quote(service_key, safe="")
    return f"{API_ENDPOINT}?serviceKey={key_part}&{query}"


def fetch_page(url: str, *, timeout: int = 30, attempts: int = 3) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                snippet = raw[:300].decode("utf-8", errors="replace")
                raise VerificationError(
                    f"official API did not return JSON (인증키 또는 트래픽 한도를 확인하세요): {snippet}"
                ) from error
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    raise VerificationError(f"official API request failed after {attempts} attempts: {last_error}")


def parse_price_items(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """Return (items, total_count) from a getETFPriceInfo JSON payload."""
    response = payload.get("response")
    if not isinstance(response, dict):
        raise VerificationError(f"unexpected official API payload: {str(payload)[:300]}")
    header = response.get("header", {})
    result_code = str(header.get("resultCode", ""))
    if result_code not in ("00", "0"):
        raise VerificationError(
            f"official API error resultCode={result_code} resultMsg={header.get('resultMsg')}"
        )
    body = response.get("body", {})
    total_count = int(body.get("totalCount") or 0)
    items = body.get("items") or {}
    rows = items.get("item") if isinstance(items, dict) else None
    if rows is None:
        rows = []
    if isinstance(rows, dict):
        rows = [rows]
    return [row for row in rows if isinstance(row, dict)], total_count


def collect_official_closes(
    service_key: str, *, begin_bas_dt: str, end_bas_dt: str, num_of_rows: int = 1000, max_pages: int = 60
) -> dict[str, dict[str, float]]:
    """Fetch official closes as {srtnCd: {basDt(YYYYMMDD): clpr}}."""
    closes: dict[str, dict[str, float]] = {}
    page_no = 1
    seen = 0
    total = None
    while page_no <= max_pages:
        url = build_request_url(
            service_key, page_no=page_no, num_of_rows=num_of_rows, begin_bas_dt=begin_bas_dt, end_bas_dt=end_bas_dt
        )
        payload = fetch_page(url)
        rows, total_count = parse_price_items(payload)
        total = total_count if total is None else total
        for row in rows:
            ticker = str(row.get("srtnCd", "")).strip()
            bas_dt = str(row.get("basDt", "")).strip()
            try:
                close = float(row.get("clpr"))
            except (TypeError, ValueError):
                continue
            if len(ticker) == 6 and len(bas_dt) == 8 and math.isfinite(close) and close > 0:
                closes.setdefault(ticker, {})[bas_dt] = close
        seen += len(rows)
        if not rows or (total is not None and seen >= total):
            break
        page_no += 1
    return closes


def _local_closes(record: dict[str, Any]) -> list[dict[str, Any]]:
    closes = record.get("recent_raw_closes")
    if not isinstance(closes, list) or not closes:
        latest = record.get("latest_raw_close")
        closes = [latest] if isinstance(latest, dict) else []
    return [
        row for row in closes
        if isinstance(row, dict) and row.get("date") and row.get("close")
    ]


def reconcile(
    etf_records: list[dict[str, Any]],
    official_closes: dict[str, dict[str, float]],
    *,
    tolerance_bps: float = DEFAULT_TOLERANCE_BPS,
) -> dict[str, Any]:
    """Compare each ETF's recent raw closes with official closes.

    공식 API의 공표 지연이나 수집 시차로 최신 날짜가 서로 어긋날 수 있으므로,
    종목별로 **양쪽에 모두 존재하는 가장 최근 날짜**를 찾아 그 날의 종가를
    비교한다.  비교 가능한 날짜가 하나도 없으면 missing_official로 집계한다.
    """
    matched = 0
    mismatched = 0
    missing_official = 0
    missing_local = 0
    max_diff_bps = 0.0
    mismatch_details: list[dict[str, Any]] = []

    for record in etf_records:
        ticker = str(record.get("ticker", ""))
        closes = _local_closes(record)
        if not closes:
            missing_local += 1
            continue
        official_by_date = official_closes.get(ticker, {})
        hit: tuple[str, float, float] | None = None
        for row in sorted(closes, key=lambda item: str(item["date"]), reverse=True):
            bas_dt = str(row["date"]).replace("-", "")
            official = official_by_date.get(bas_dt)
            if official is not None:
                hit = (str(row["date"]), float(row["close"]), official)
                break
        if hit is None:
            missing_official += 1
            continue
        local_date, local_close, official = hit
        diff_bps = abs(official / local_close - 1) * 10000 if local_close > 0 else float("inf")
        max_diff_bps = max(max_diff_bps, diff_bps)
        if diff_bps <= tolerance_bps:
            matched += 1
        else:
            mismatched += 1
            if len(mismatch_details) < MAX_MISMATCH_DETAILS:
                mismatch_details.append(
                    {
                        "ticker": ticker,
                        "name": record.get("name"),
                        "date": local_date,
                        "local_close": local_close,
                        "official_close": official,
                        "diff_bps": round(diff_bps, 2),
                    }
                )

    checked = matched + mismatched
    official_dates = sorted({bas_dt for by_date in official_closes.values() for bas_dt in by_date})
    return {
        "checked": checked,
        "matched": matched,
        "mismatched": mismatched,
        "missing_official": missing_official,
        "missing_local": missing_local,
        "max_diff_bps": round(max_diff_bps, 2),
        "tolerance_bps": tolerance_bps,
        "official_basdt_begin": official_dates[0] if official_dates else None,
        "official_basdt_end": official_dates[-1] if official_dates else None,
        "mismatches": mismatch_details,
        "status": "ok" if checked > 0 and mismatched == 0 else ("mismatch" if mismatched else "no_overlap"),
    }


def load_etf_records(data_dir: Path) -> list[dict[str, Any]]:
    catalog = json.loads((data_dir / "assets.json").read_text(encoding="utf-8"))
    records: list[dict[str, Any]] = []
    root = data_dir.resolve().parent
    for row in catalog.get("assets", []):
        if row.get("asset_type") != "etf":
            continue
        path = (root / str(row.get("file", ""))).resolve()
        if not path.is_file():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        records.append(
            {
                "ticker": payload.get("ticker"),
                "name": payload.get("name"),
                "latest_raw_close": payload.get("latest_raw_close"),
                "recent_raw_closes": payload.get("recent_raw_closes"),
            }
        )
    return records


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", nargs="?", type=Path, default=Path("data"))
    parser.add_argument("--output", type=Path, default=None, help="기본값: <data_dir>/official_verification.json")
    parser.add_argument("--tolerance-bps", type=float, default=DEFAULT_TOLERANCE_BPS)
    parser.add_argument("--lookback-days", type=int, default=21, help="공식 시세 조회 구간(일)")
    parser.add_argument("--require-key", action="store_true", help="인증키가 없으면 실패로 처리")
    args = parser.parse_args(argv)

    service_key = os.environ.get(ENV_KEY, "").strip()
    if not service_key:
        message = f"{ENV_KEY} is not set — skipping official price reconciliation."
        if args.require_key:
            print(message, file=sys.stderr)
            return 1
        print(message)
        return 0

    today = dt.date.today()
    begin = (today - dt.timedelta(days=args.lookback_days)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")

    records = load_etf_records(args.data_dir)
    if not records:
        print("no ETF records found in catalog — nothing to verify", file=sys.stderr)
        return 1

    official_closes = collect_official_closes(service_key, begin_bas_dt=begin, end_bas_dt=end)
    summary = reconcile(records, official_closes, tolerance_bps=args.tolerance_bps)

    output = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": {"name": API_NAME, "url": API_ENDPOINT},
        "coverage_begin": begin,
        "coverage_end": end,
        "official_tickers": len(official_closes),
        **summary,
    }
    output_path = args.output or (args.data_dir / "official_verification.json")
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: output[key] for key in ("checked", "matched", "mismatched", "missing_official", "missing_local", "max_diff_bps", "official_basdt_begin", "official_basdt_end", "status")}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
