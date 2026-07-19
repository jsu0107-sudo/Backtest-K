#!/usr/bin/env python3
"""Build the static Backtest-K market data mart.

The default provider is intentionally keyless so the first production-shaped
dataset can be generated in GitHub Actions without a server or database:

* Naver Finance's ETF list supplies the current Korean ETF universe and market
  value used for the top-N cut.
* Yahoo Finance chart data supplies daily adjusted closes.
* KSD SEIBro supplies the ETF inception/listing date when it is available.

The provider is marked ``provisional`` in every output file.  The generated
schema keeps source and distribution-adjustment metadata explicit so an
official licensed provider can replace this collector without changing the
frontend contract.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import dataclasses
import datetime as dt
import html
import json
import math
import os
import random
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo


SCHEMA_VERSION = "1.0"
USER_AGENT = "Backtest-K-Market-Data/1.0 (+https://github.com/jsu0107-sudo/Backtest-K)"
NAVER_ETF_LIST_URL = "https://finance.naver.com/api/sise/etfItemList.nhn"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
SEIBRO_DETAIL_URL = "https://m.seibro.or.kr/cnts/etf/selectKindDetailInfo.do"

REPRESENTATIVE_INDEXES = (
    {
        "id": "INDEX_KOSPI",
        "ticker": "KOSPI",
        "name": "KOSPI",
        "symbol": "^KS11",
        "category": "대표지수",
        "description": "한국 유가증권시장 종합주가지수(가격지수)",
        "history_start": "1990-01-01",
    },
    {
        "id": "INDEX_KOSPI200",
        "ticker": "KOSPI200",
        "name": "KOSPI 200",
        "symbol": "^KS200",
        "category": "대표지수",
        "description": "한국 유가증권시장 대표 200종목 가격지수",
        "history_start": "1994-01-01",
    },
    {
        "id": "INDEX_SP500",
        "ticker": "S&P500",
        "name": "S&P 500",
        "symbol": "^GSPC",
        "category": "대표지수",
        "description": "미국 대형주 대표 가격지수(미 달러 기준)",
        "history_start": "1970-01-01",
    },
)


@dataclasses.dataclass(frozen=True)
class AssetRequest:
    id: str
    ticker: str
    name: str
    symbol: str
    asset_type: str
    category: str
    description: str
    rank: int | None = None
    market_value_krw_100m: float | None = None
    history_start: dt.date | None = None


class CollectionError(RuntimeError):
    """Raised when a remote provider returns unusable data."""


def http_json(url: str, *, timeout: int = 45, attempts: int = 4) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"},
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                declared = response.headers.get_content_charset()
                encodings = [declared] if declared else []
                encodings.extend(["utf-8", "euc-kr"])
                for encoding in dict.fromkeys(item for item in encodings if item):
                    try:
                        return json.loads(raw.decode(encoding))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        continue
                raise json.JSONDecodeError("response is not decodable JSON", "", 0)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep((2**attempt) + random.random())
    raise CollectionError(f"JSON request failed after {attempts} attempts: {url}: {last_error}")


def http_text(url: str, *, timeout: int = 30, attempts: int = 3) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                charset = response.headers.get_content_charset() or "utf-8"
                return raw.decode(charset, errors="replace")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep((2**attempt) + random.random())
    raise CollectionError(f"HTML request failed after {attempts} attempts: {url}: {last_error}")


def categorize_etf(name: str) -> str:
    upper = name.upper()
    if any(token in upper for token in ("국채", "채권", "회사채", "통안채", "국고채", "종합채권")):
        return "채권"
    if any(token in upper for token in ("KOFR", "CD금리", "머니마켓", "단기금리", "단기채", "MMF")):
        return "현금성"
    if any(token in upper for token in ("골드", "금선물", "원유", "WTI", "구리", "은선물", "농산물")):
        return "원자재"
    if "리츠" in upper or "REIT" in upper:
        return "부동산"
    if any(
        token in upper
        for token in (
            "미국",
            "글로벌",
            "나스닥",
            "S&P",
            "CHINA",
            "차이나",
            "일본",
            "인도",
            "베트남",
            "유럽",
            "EURO",
            "WORLD",
        )
    ):
        return "해외주식"
    return "국내주식"


def fetch_etf_universe(limit: int) -> list[AssetRequest]:
    payload = http_json(NAVER_ETF_LIST_URL)
    items = payload.get("result", {}).get("etfItemList", [])
    if not isinstance(items, list) or not items:
        raise CollectionError("Naver ETF catalog returned no items")

    normalized: list[tuple[float, str, str]] = []
    for item in items:
        ticker = str(item.get("itemcode", "")).strip()
        name = str(item.get("itemname", "")).strip()
        try:
            market_value = float(item.get("marketSum") or 0)
        except (TypeError, ValueError):
            market_value = 0
        if re.fullmatch(r"\d{6}", ticker) and name and market_value > 0:
            normalized.append((market_value, ticker, name))

    normalized.sort(key=lambda row: (-row[0], row[1]))
    requests: list[AssetRequest] = []
    for rank, (market_value, ticker, name) in enumerate(normalized[:limit], start=1):
        requests.append(
            AssetRequest(
                id=ticker,
                ticker=ticker,
                name=name,
                symbol=f"{ticker}.KS",
                asset_type="etf",
                category=categorize_etf(name),
                description=f"순자산 상위 ETF #{rank} (수집 시점 시가총액 기준)",
                rank=rank,
                market_value_krw_100m=market_value,
            )
        )
    return requests


def _unix_seconds(value: dt.datetime) -> int:
    return int(value.replace(tzinfo=dt.timezone.utc).timestamp())


def fetch_yahoo_series(
    symbol: str, start_date: dt.date, end_date: dt.date
) -> tuple[list[tuple[dt.date, float]], dict[str, Any], int, dict[str, Any] | None]:
    params = urllib.parse.urlencode(
        {
            "period1": _unix_seconds(dt.datetime.combine(start_date, dt.time.min)),
            "period2": _unix_seconds(dt.datetime.combine(end_date + dt.timedelta(days=1), dt.time.min)),
            "interval": "1d",
            "events": "div,splits",
            "includeAdjustedClose": "true",
        }
    )
    url = f"{YAHOO_CHART_URL.format(symbol=urllib.parse.quote(symbol, safe=''))}?{params}"
    payload = http_json(url)
    chart = payload.get("chart", {})
    if chart.get("error"):
        raise CollectionError(f"Yahoo chart error for {symbol}: {chart['error']}")
    results = chart.get("result") or []
    if not results:
        raise CollectionError(f"Yahoo chart returned no result for {symbol}")

    result = results[0]
    timestamps = result.get("timestamp") or []
    adjclose_groups = result.get("indicators", {}).get("adjclose") or []
    quote_groups = result.get("indicators", {}).get("quote") or []
    adjusted = adjclose_groups[0].get("adjclose", []) if adjclose_groups else []
    closes = quote_groups[0].get("close", []) if quote_groups else []
    prices = adjusted if adjusted else closes
    points: list[tuple[dt.date, float]] = []
    for timestamp, price in zip(timestamps, prices):
        if price is None:
            continue
        number = float(price)
        if not math.isfinite(number) or number <= 0:
            continue
        date = dt.datetime.fromtimestamp(int(timestamp), tz=dt.timezone.utc).date()
        points.append((date, number))
    if len(points) < 3:
        raise CollectionError(f"Yahoo chart returned fewer than three usable prices for {symbol}")

    # 공식 공공데이터 대사용 원시(미조정) 종가. 수정종가와 달리 거래소 공표 종가와
    # 직접 비교할 수 있어 provisional 공급자의 시세 정확성을 검증하는 기준이 된다.
    latest_raw_close: dict[str, Any] | None = None
    for timestamp, price in zip(timestamps, closes):
        if price is None:
            continue
        number = float(price)
        if not math.isfinite(number) or number <= 0:
            continue
        date = dt.datetime.fromtimestamp(int(timestamp), tz=dt.timezone.utc).date().isoformat()
        if latest_raw_close is None or date > latest_raw_close["date"]:
            latest_raw_close = {"date": date, "close": round(number, 6)}

    events = result.get("events", {}).get("dividends", {}) or {}
    return points, result.get("meta", {}), len(events), latest_raw_close


def last_complete_month(today: dt.date) -> str:
    first_of_month = today.replace(day=1)
    previous = first_of_month - dt.timedelta(days=1)
    return previous.strftime("%Y-%m")


def _month_ordinal(month: str) -> int:
    year, mon = month.split("-")
    return int(year) * 12 + int(mon)


def split_contiguous_segments(
    ordered: list[tuple[str, tuple[dt.date, float]]],
) -> list[list[tuple[str, tuple[dt.date, float]]]]:
    segments: list[list[tuple[str, tuple[dt.date, float]]]] = [[ordered[0]]]
    for row in ordered[1:]:
        if _month_ordinal(row[0]) - _month_ordinal(segments[-1][-1][0]) == 1:
            segments[-1].append(row)
        else:
            segments.append([row])
    return segments


def monthly_returns_from_prices(
    points: Iterable[tuple[dt.date, float]], *, complete_through: str
) -> tuple[list[dict[str, Any]], str, str, list[str]]:
    month_ends: dict[str, tuple[dt.date, float]] = {}
    latest_observation: dt.date | None = None
    for date, price in sorted(points, key=lambda item: item[0]):
        latest_observation = date if latest_observation is None or date > latest_observation else latest_observation
        month = date.strftime("%Y-%m")
        if month <= complete_through:
            month_ends[month] = (date, price)
    ordered = sorted(month_ends.items())
    if len(ordered) < 3:
        raise CollectionError("Fewer than three complete month-end prices")

    # 원천에 월 갭이 있으면 갭을 건너뛴 누적 수익률이 "한 달"로 압축 기록된다.
    # 이를 막기 위해 가장 긴(동률이면 최신) 연속 구간만 사용한다.
    quality_notes: list[str] = []
    segments = split_contiguous_segments(ordered)
    if len(segments) > 1:
        best = max(segments, key=lambda segment: (len(segment), segment[-1][0]))
        dropped = len(ordered) - len(best)
        quality_notes.append(
            f"원천 데이터에 월 갭이 있어 비연속 {dropped}개월을 제외하고 연속 구간 {best[0][0]}~{best[-1][0]}만 사용했습니다."
        )
        ordered = best
    if len(ordered) < 3:
        raise CollectionError("Fewer than three contiguous month-end prices")

    returns: list[dict[str, Any]] = []
    for index in range(1, len(ordered)):
        month, (observation_date, current) = ordered[index]
        previous = ordered[index - 1][1][1]
        value = current / previous - 1
        if math.isfinite(value) and value > -1:
            returns.append(
                {
                    "month": month,
                    "return": round(value, 10),
                    "observation_date": observation_date.isoformat(),
                }
            )
    if len(returns) < 2:
        raise CollectionError("Fewer than two valid monthly returns")
    assert latest_observation is not None
    return returns, ordered[0][1][0].isoformat(), latest_observation.isoformat(), quality_notes


def trim_stale_trailing_returns(
    returns: list[dict[str, Any]], *, max_trim: int = 3
) -> tuple[list[dict[str, Any]], int]:
    """Drop trailing months whose return is exactly zero.

    지수가 소수점까지 정확히 0% 월 수익률을 내는 일은 사실상 없으므로, 말단의
    0% 행은 원천이 최신 시세를 채우지 못한 스테일 데이터로 간주하고 제거한다.
    """
    trimmed = 0
    end = len(returns)
    while end > 0 and trimmed < max_trim and abs(float(returns[end - 1]["return"])) < 1e-9:
        end -= 1
        trimmed += 1
    return returns[:end], trimmed


def fetch_seibro_listing_date(ticker: str, name: str) -> tuple[str | None, str]:
    params = urllib.parse.urlencode(
        {
            "InKindShort": "0",
            "InKinds": "0",
            "InMSect": "0",
            "shotnIsin": ticker,
            "txt_sch": name,
        }
    )
    url = f"{SEIBRO_DETAIL_URL}?{params}"
    try:
        page = http_text(url)
    except CollectionError:
        return None, url
    match = re.search(r"설정일\s*</th>\s*<td>\s*(\d{4})/(\d{2})/(\d{2})", html.unescape(page), re.I)
    if not match:
        return None, url
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}", url


def _date_from_first_trade(meta: dict[str, Any], fallback: str) -> str:
    value = meta.get("firstTradeDate")
    if value is not None:
        try:
            return dt.datetime.fromtimestamp(int(value), tz=dt.timezone.utc).date().isoformat()
        except (TypeError, ValueError, OSError):
            pass
    return fallback


def build_asset_payload(request: AssetRequest, start_date: dt.date, today: dt.date) -> dict[str, Any]:
    history_start = request.history_start or start_date
    points, meta, dividend_event_count, latest_raw_close = fetch_yahoo_series(request.symbol, history_start, today)
    monthly_returns, first_observation, data_as_of, quality_notes = monthly_returns_from_prices(
        points, complete_through=last_complete_month(today)
    )
    if request.asset_type == "index":
        monthly_returns, stale_trimmed = trim_stale_trailing_returns(monthly_returns)
        if stale_trimmed:
            quality_notes.append(
                f"지수 원천의 최근 {stale_trimmed}개월 수익률이 정확히 0%라 스테일 데이터로 판단해 제외했습니다."
            )
        if len(monthly_returns) < 2:
            raise CollectionError("Fewer than two valid monthly returns after stale trim")

    sources: list[dict[str, str]] = []
    if request.asset_type == "etf":
        listing_date, seibro_url = fetch_seibro_listing_date(request.ticker, request.name)
        listing_date = listing_date or _date_from_first_trade(meta, first_observation)
        listing_date_source = "한국예탁결제원 SEIBro" if listing_date and listing_date != _date_from_first_trade(meta, first_observation) else "Yahoo Finance 최초 거래일"
        distribution = {
            "included": True,
            "method": "adjusted_close",
            "verification_status": "provider_adjusted_not_independently_reconciled",
            "event_count": dividend_event_count,
            "note": "월말 수정종가 비율로 계산했습니다. 분배금 반영은 공급자의 조정계수에 의존합니다.",
        }
        sources.extend(
            [
                {
                    "name": "네이버페이 증권 ETF 목록",
                    "url": "https://finance.naver.com/sise/etf.naver",
                    "role": "ETF 종목 및 시가총액 순위",
                },
                {
                    "name": "Yahoo Finance chart",
                    "url": f"https://finance.yahoo.com/quote/{urllib.parse.quote(request.symbol, safe='')}/history/",
                    "role": "일별 수정종가 및 분배 이벤트",
                },
                {"name": "한국예탁결제원 SEIBro", "url": seibro_url, "role": "설정일"},
            ]
        )
        warnings = [
            "프로토타입 수집 경로이며 수정종가와 분배금은 별도 원장으로 독립 대사하지 않았습니다.",
            "상업적 서비스 전 데이터 제공자 이용조건과 재배포 권한을 다시 확인해야 합니다.",
        ]
    else:
        listing_date = _date_from_first_trade(meta, first_observation)
        listing_date_source = "Yahoo Finance 최초 거래일"
        distribution = {
            "included": False,
            "method": "price_index",
            "verification_status": "not_applicable_price_index",
            "event_count": 0,
            "note": "대표지수는 가격지수이며 배당을 포함하지 않습니다.",
        }
        sources.append(
            {
                "name": "Yahoo Finance chart",
                "url": f"https://finance.yahoo.com/quote/{urllib.parse.quote(request.symbol, safe='')}/history/",
                "role": "일별 지수 종가",
            }
        )
        warnings = ["가격지수이므로 배당을 포함한 총수익지수와 결과가 다릅니다."]

    warnings = [*quality_notes, *warnings]

    return {
        "schema_version": SCHEMA_VERSION,
        "id": request.id,
        "ticker": request.ticker,
        "name": request.name,
        "asset_type": request.asset_type,
        "category": request.category,
        "currency": "KRW" if request.id != "INDEX_SP500" else "USD",
        "description": request.description,
        "listing_date": listing_date,
        "listing_date_source": listing_date_source,
        "data_as_of": data_as_of,
        "first_month": monthly_returns[0]["month"],
        "last_month": monthly_returns[-1]["month"],
        "monthly_return_count": len(monthly_returns),
        "distribution": distribution,
        "provider_status": "provisional",
        "sources": sources,
        "data_quality": {"status": "provisional", "warnings": warnings},
        "universe_rank": request.rank,
        "market_value_krw_100m": request.market_value_krw_100m,
        "latest_raw_close": latest_raw_close if request.asset_type == "etf" else None,
        "monthly_returns": monthly_returns,
    }


def catalog_record(payload: dict[str, Any], filename: str) -> dict[str, Any]:
    return {
        "id": payload["id"],
        "ticker": payload["ticker"],
        "name": payload["name"],
        "asset_type": payload["asset_type"],
        "category": payload["category"],
        "currency": payload["currency"],
        "description": payload["description"],
        "file": f"data/{filename}",
        "listing_date": payload["listing_date"],
        "data_as_of": payload["data_as_of"],
        "first_month": payload["first_month"],
        "last_month": payload["last_month"],
        "monthly_return_count": payload["monthly_return_count"],
        "distribution_included": payload["distribution"]["included"],
        "distribution_method": payload["distribution"]["method"],
        "provider_status": payload["provider_status"],
        "source_label": "Yahoo 수정종가" if payload["asset_type"] == "etf" else "Yahoo 가격지수",
        "universe_rank": payload["universe_rank"],
        "market_value_krw_100m": payload["market_value_krw_100m"],
    }


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_payloads_before_publish(payloads: list[dict[str, Any]]) -> None:
    ids: set[str] = set()
    for payload in payloads:
        asset_id = str(payload.get("id", ""))
        if not asset_id or asset_id in ids:
            raise CollectionError(f"Duplicate or empty asset id before publish: {asset_id!r}")
        ids.add(asset_id)
        for field in ("ticker", "name", "listing_date", "data_as_of", "sources", "distribution", "monthly_returns"):
            if not payload.get(field):
                raise CollectionError(f"{asset_id}: required field is empty: {field}")
        rows = payload["monthly_returns"]
        months = [row.get("month") for row in rows]
        if len(rows) < 2 or months != sorted(months) or len(months) != len(set(months)):
            raise CollectionError(f"{asset_id}: monthly returns must contain sorted unique months")
        for row in rows:
            value = row.get("return")
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= -1:
                raise CollectionError(f"{asset_id}: invalid monthly return for {row.get('month')}: {value!r}")
        if payload["monthly_return_count"] != len(rows):
            raise CollectionError(f"{asset_id}: monthly_return_count mismatch")
        if not isinstance(payload["distribution"].get("included"), bool):
            raise CollectionError(f"{asset_id}: distribution.included must be boolean")


def publish_dataset(output_dir: Path, payloads: list[dict[str, Any]], *, requested_etfs: int) -> dict[str, Any]:
    validate_payloads_before_publish(payloads)
    generated_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    staging = Path(tempfile.mkdtemp(prefix="backtest-k-data-", dir=output_dir.parent))
    try:
        records: list[dict[str, Any]] = []
        for payload in sorted(payloads, key=lambda item: (item["asset_type"] != "index", item.get("universe_rank") or 9999, item["ticker"])):
            filename = f"{payload['id']}.json"
            _write_json(staging / filename, payload)
            records.append(catalog_record(payload, filename))

        etf_count = sum(record["asset_type"] == "etf" for record in records)
        index_count = sum(record["asset_type"] == "index" for record in records)
        catalog = {
            "schema_version": SCHEMA_VERSION,
            "generated_at": generated_at,
            "data_as_of": max(record["data_as_of"] for record in records),
            "provider_status": "provisional",
            "provider": "Naver ETF universe + Yahoo adjusted close + KSD listing date",
            "asset_count": len(records),
            "etf_count": etf_count,
            "index_count": index_count,
            "universe": {
                "target": "국내 상장 ETF 시가총액 상위 종목",
                "rank_basis": "네이버페이 증권 ETF 목록 marketSum",
                "requested_etf_count": requested_etfs,
                "published_etf_count": etf_count,
            },
            "distribution_note": "ETF는 수정종가 기반, 대표지수는 가격지수 기반입니다. 종목별 포함 여부를 확인하세요.",
            "assets": records,
        }
        _write_json(staging / "assets.json", catalog)

        old_files: set[str] = set()
        old_catalog = output_dir / "assets.json"
        if old_catalog.exists():
            try:
                previous = json.loads(old_catalog.read_text(encoding="utf-8"))
                old_files = {Path(str(row["file"])).name for row in previous.get("assets", []) if row.get("file")}
            except (OSError, json.JSONDecodeError, KeyError):
                old_files = set()

        output_dir.mkdir(parents=True, exist_ok=True)
        new_files = {path.name for path in staging.glob("*.json")}
        for path in staging.glob("*.json"):
            os.replace(path, output_dir / path.name)
        for stale_name in old_files - new_files:
            stale = output_dir / stale_name
            if stale.is_file():
                stale.unlink()
        return catalog
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def build_requests(limit: int) -> list[AssetRequest]:
    etfs = fetch_etf_universe(limit)
    indexes = [
        AssetRequest(
            id=row["id"],
            ticker=row["ticker"],
            name=row["name"],
            symbol=row["symbol"],
            asset_type="index",
            category=row["category"],
            description=row["description"],
            history_start=dt.date.fromisoformat(row["history_start"]),
        )
        for row in REPRESENTATIVE_INDEXES
    ]
    return etfs + indexes


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    parser.add_argument("--limit", type=int, default=150, help="Number of top Korean ETFs to request")
    parser.add_argument("--min-etfs", type=int, default=100, help="Abort before publishing if fewer ETFs succeed")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--start-date", type=dt.date.fromisoformat, default=dt.date(2000, 1, 1))
    parser.add_argument("--as-of", type=dt.date.fromisoformat, default=None, help="Override today's KST date for reproducible tests")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not 100 <= args.limit <= 200:
        raise SystemExit("--limit must be between 100 and 200")
    if not 1 <= args.workers <= 16:
        raise SystemExit("--workers must be between 1 and 16")
    today = args.as_of or dt.datetime.now(ZoneInfo("Asia/Seoul")).date()
    requests = build_requests(args.limit)
    payloads: list[dict[str, Any]] = []
    failures: list[tuple[str, str]] = []

    def collect(request: AssetRequest) -> tuple[AssetRequest, dict[str, Any]]:
        return request, build_asset_payload(request, args.start_date, today)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_map = {executor.submit(collect, request): request for request in requests}
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            request = future_map[future]
            completed += 1
            try:
                _, payload = future.result()
                payloads.append(payload)
                print(f"[{completed:03d}/{len(requests):03d}] ok {request.ticker} {request.name}", flush=True)
            except Exception as error:  # one bad remote symbol must not discard the full refresh
                failures.append((request.ticker, str(error)))
                print(f"[{completed:03d}/{len(requests):03d}] fail {request.ticker}: {error}", file=sys.stderr, flush=True)

    etf_count = sum(payload["asset_type"] == "etf" for payload in payloads)
    index_ids = {payload["id"] for payload in payloads if payload["asset_type"] == "index"}
    required_indexes = {row["id"] for row in REPRESENTATIVE_INDEXES}
    if etf_count < args.min_etfs:
        raise SystemExit(f"Refusing to publish: only {etf_count} ETFs succeeded (minimum {args.min_etfs})")
    if index_ids != required_indexes:
        missing = ", ".join(sorted(required_indexes - index_ids))
        raise SystemExit(f"Refusing to publish: representative indexes missing: {missing}")

    catalog = publish_dataset(args.output_dir.resolve(), payloads, requested_etfs=args.limit)
    print(
        json.dumps(
            {
                "published": catalog["asset_count"],
                "etfs": catalog["etf_count"],
                "indexes": catalog["index_count"],
                "data_as_of": catalog["data_as_of"],
                "failures": failures,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
