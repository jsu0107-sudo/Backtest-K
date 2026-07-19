#!/usr/bin/env python3
"""Validate Backtest-K's generated static market-data contract."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path
from typing import Any


REQUIRED_INDEX_IDS = {"INDEX_KOSPI", "INDEX_KOSPI200", "INDEX_SP500"}
REQUIRED_ASSET_FIELDS = {
    "schema_version",
    "id",
    "ticker",
    "name",
    "asset_type",
    "category",
    "currency",
    "listing_date",
    "data_as_of",
    "first_month",
    "last_month",
    "monthly_return_count",
    "distribution",
    "sources",
    "monthly_returns",
}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{path}: cannot read valid JSON: {error}") from error


def validate_asset(path: Path, record: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    payload = load_json(path)
    missing = REQUIRED_ASSET_FIELDS - payload.keys()
    if missing:
        errors.append(f"{path.name}: missing fields {sorted(missing)}")
        return errors
    if payload["id"] != record.get("id"):
        errors.append(f"{path.name}: id does not match catalog")
    if payload["ticker"] != record.get("ticker"):
        errors.append(f"{path.name}: ticker does not match catalog")
    try:
        dt.date.fromisoformat(payload["listing_date"])
        dt.date.fromisoformat(payload["data_as_of"])
    except (TypeError, ValueError):
        errors.append(f"{path.name}: listing_date/data_as_of must be ISO dates")
    distribution = payload.get("distribution")
    if not isinstance(distribution, dict) or not isinstance(distribution.get("included"), bool):
        errors.append(f"{path.name}: distribution.included must be boolean")
    if not isinstance(distribution, dict) or not distribution.get("method"):
        errors.append(f"{path.name}: distribution.method is required")
    sources = payload.get("sources")
    if not isinstance(sources, list) or not sources or any(not row.get("name") or not row.get("url") for row in sources if isinstance(row, dict)):
        errors.append(f"{path.name}: at least one named source URL is required")

    rows = payload.get("monthly_returns")
    if not isinstance(rows, list) or len(rows) < 2:
        errors.append(f"{path.name}: at least two monthly returns are required")
        return errors
    months: list[str] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(("month", "return")) - row.keys():
            errors.append(f"{path.name}: monthly_returns[{index}] is malformed")
            continue
        month = row["month"]
        value = row["return"]
        try:
            dt.date.fromisoformat(f"{month}-01")
        except (TypeError, ValueError):
            errors.append(f"{path.name}: invalid month {month!r}")
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= -1:
            errors.append(f"{path.name}: invalid return for {month}: {value!r}")
        months.append(month)
    if months != sorted(months) or len(months) != len(set(months)):
        errors.append(f"{path.name}: months must be sorted and unique")
    if payload["monthly_return_count"] != len(rows):
        errors.append(f"{path.name}: monthly_return_count mismatch")
    if payload["first_month"] != months[0] or payload["last_month"] != months[-1]:
        errors.append(f"{path.name}: first_month/last_month mismatch")
    return errors


def validate_dataset(data_dir: Path, min_etfs: int = 100, max_etfs: int = 200) -> dict[str, Any]:
    catalog_path = data_dir / "assets.json"
    catalog = load_json(catalog_path)
    errors: list[str] = []
    assets = catalog.get("assets")
    if not isinstance(assets, list):
        raise ValueError("assets.json: assets must be an array")
    ids = [record.get("id") for record in assets]
    files = [record.get("file") for record in assets]
    if len(ids) != len(set(ids)):
        errors.append("assets.json: duplicate asset ids")
    if len(files) != len(set(files)):
        errors.append("assets.json: duplicate files")
    if catalog.get("asset_count") != len(assets):
        errors.append("assets.json: asset_count mismatch")

    etfs = [record for record in assets if record.get("asset_type") == "etf"]
    indexes = [record for record in assets if record.get("asset_type") == "index"]
    if not min_etfs <= len(etfs) <= max_etfs:
        errors.append(f"assets.json: ETF count {len(etfs)} is outside {min_etfs}..{max_etfs}")
    index_ids = {record.get("id") for record in indexes}
    if not REQUIRED_INDEX_IDS.issubset(index_ids):
        errors.append(f"assets.json: missing representative indexes {sorted(REQUIRED_INDEX_IDS - index_ids)}")
    if catalog.get("etf_count") != len(etfs) or catalog.get("index_count") != len(indexes):
        errors.append("assets.json: ETF/index counts do not match")

    root = data_dir.resolve().parent
    for record in assets:
        relative = Path(str(record.get("file", "")))
        path = (root / relative).resolve()
        if data_dir.resolve() not in path.parents or not path.is_file():
            errors.append(f"assets.json: missing or unsafe file {relative}")
            continue
        errors.extend(validate_asset(path, record))
    if errors:
        raise ValueError("\n".join(errors))
    return {
        "ok": True,
        "asset_count": len(assets),
        "etf_count": len(etfs),
        "index_count": len(indexes),
        "data_as_of": catalog.get("data_as_of"),
        "distribution_included_etfs": sum(record.get("distribution_included") is True for record in etfs),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", nargs="?", type=Path, default=Path("data"))
    parser.add_argument("--min-etfs", type=int, default=100)
    parser.add_argument("--max-etfs", type=int, default=200)
    args = parser.parse_args()
    summary = validate_dataset(args.data_dir, args.min_etfs, args.max_etfs)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
