"""Read-only recovery investigation. Saves raw receipts/candidates, never publishes data/."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from scripts.audit_market_data import annotate_payload, expected_month_end
from scripts.build_market_data import fetch_yahoo_payload, parse_yahoo_series, monthly_returns_from_prices, last_complete_month


def compare_returns(old, new):
    before = {r["month"]: r for r in old}
    after = {r["month"]: r for r in new}
    return {
        "added_months": sorted(after.keys() - before.keys()),
        "removed_months": sorted(before.keys() - after.keys()),
        "changed_months": [m for m in sorted(before.keys() & after.keys())
                           if before[m]["observation_date"] != after[m]["observation_date"]
                           or abs(before[m]["return"] - after[m]["return"]) > 1e-8],
        "max_absolute_return_revision": max((abs(before[m]["return"]-after[m]["return"]) for m in before.keys() & after.keys()),default=0),
        "material_revision_months": [m for m in sorted(before.keys() & after.keys())
                                     if abs(before[m]["return"]-after[m]["return"]) > 1e-5],
    }


def missing_month_ends(raw, calendar_name, start, through, year):
    result = raw["chart"]["result"][0]
    zone = ZoneInfo(result["meta"]["exchangeTimezoneName"])
    timestamps = result.get("timestamp", [])
    prices = result["indicators"].get("adjclose", [{}])[0].get("adjclose", [])
    if not prices:
        prices = result["indicators"]["quote"][0]["close"]
    by_date = {dt.datetime.fromtimestamp(t,zone).date().isoformat():p for t,p in zip(timestamps,prices)}
    missing = []
    month = start.strftime("%Y-%m")
    while month <= through:
        expected = expected_month_end(calendar_name,month,year)
        if expected not in by_date or by_date[expected] is None:
            missing.append({"month":month,"expected":expected,"reason":"timestamp_absent" if expected not in by_date else "price_null"})
        y,m = map(int,month.split("-"))
        month = f"{y + (m == 12):04d}-{m % 12 + 1:02d}"
    return missing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", nargs="+", default=["069500","114260","INDEX_KOSPI200"])
    parser.add_argument("--as-of", type=dt.date.fromisoformat, default=dt.datetime.now(ZoneInfo("Asia/Seoul")).date())
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if not output.is_relative_to(root / "artifacts"):
        raise SystemExit("Output must be a fresh directory under artifacts/; data/ is never modified")
    output.mkdir(parents=True,exist_ok=False)
    catalog = json.loads((root/"data/assets.json").read_text(encoding="utf-8"))
    records = {a["id"]:a for a in catalog["assets"]}
    unknown = set(args.ids)-records.keys()
    if unknown:
        raise SystemExit(f"Unknown asset ids: {sorted(unknown)}")
    results = []
    for asset_id in args.ids:
        record = records[asset_id]
        old = json.loads((root/record["file"]).read_text(encoding="utf-8"))
        symbol = {"INDEX_KOSPI":"^KS11","INDEX_KOSPI200":"^KS200","INDEX_SP500":"^GSPC"}.get(asset_id,asset_id+".KS")
        # Include the baseline month, without pretending to recover pre-listing history.
        start = dt.date.fromisoformat(old["first_month"]+"-01") - dt.timedelta(days=32)
        entry = {"id":asset_id,"status":"unavailable"}
        try:
            raw = fetch_yahoo_payload(symbol,start,args.as_of)
            encoded = json.dumps(raw,ensure_ascii=False,sort_keys=True).encode("utf-8")
            (output/f"{asset_id}-raw.json").write_bytes(encoded)
            entry.update({"raw_sha256":hashlib.sha256(encoded).hexdigest(),"symbol":symbol,
                          "retrieved_at":dt.datetime.now(dt.timezone.utc).isoformat()})
            points,meta,events,_ = parse_yahoo_series(raw,symbol)
            if meta.get("currency") != old["currency"]:
                raise ValueError("Provider currency differs from catalog")
            rows,_,as_of,notes = monthly_returns_from_prices(points,complete_through=last_complete_month(args.as_of))
            candidate = copy.deepcopy(old)
            candidate.update(monthly_returns=rows,first_month=rows[0]["month"],last_month=rows[-1]["month"],
                             monthly_return_count=len(rows),data_as_of=as_of)
            candidate["recovery_candidate"] = {"publishable":False,"reason":"Independent dividend/split ledger and source rights review required", "raw_sha256":entry["raw_sha256"]}
            quality = annotate_payload(candidate,args.as_of)
            entry.update(status="candidate_only", changes=compare_returns(old["monthly_returns"],rows),
                         usable_first=quality["usable_first_month"],usable_last=quality["usable_last_month"],
                         excluded_rows=len(quality["excluded_months"]),provider_dividend_events=events,
                         provider_notes=notes,missing_month_ends=missing_month_ends(raw,quality["calendar"],start,last_complete_month(args.as_of),args.as_of.year))
            (output/f"{asset_id}-candidate.json").write_text(json.dumps(candidate,ensure_ascii=False,indent=2),encoding="utf-8")
        except Exception as error:
            entry["error"] = str(error)
        results.append(entry)
        print(json.dumps({k:v for k,v in entry.items() if k not in ("changes","missing_month_ends")},ensure_ascii=False),flush=True)
    (output/"report.json").write_text(json.dumps({"as_of":str(args.as_of),"published":False,"assets":results},ensure_ascii=False,indent=2),encoding="utf-8")
    return 0 if all(r["status"]=="candidate_only" for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
