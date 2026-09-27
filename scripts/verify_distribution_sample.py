"""Issuer amount spot-check only; never marks full total returns independently verified."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo


def reconcile_sample(raw, reference):
    result = raw['chart']['result'][0]
    if result['meta']['symbol'] != reference['asset_id']+'.KS':
        raise ValueError('Asset identity mismatch')
    if result['meta']['currency'] != reference['currency']:
        raise ValueError('Currency mismatch')
    zone = ZoneInfo(result['meta']['exchangeTimezoneName'])
    events = [{'provider_date':dt.datetime.fromtimestamp(e['date'],zone).date().isoformat(),'amount':e['amount']}
              for e in result.get('events',{}).get('dividends',{}).values()]
    rows = []
    for official in reference['records']:
        # Official record date is NOT an ex-date. Compare amounts in the same month only.
        candidates = [e for e in events if e['provider_date'][:7] == official['record_date'][:7]]
        match = len(candidates)==1 and abs(candidates[0]['amount']-official['amount'])<1e-6
        rows.append({**official,'provider_events':candidates,'amount_matches':match})
    return {'status':'amount_sample_match_only' if rows and all(r['amount_matches'] for r in rows) else 'sample_incomplete_or_mismatch',
            'asset_id':reference['asset_id'],'checked':len(rows),'matched':sum(r['amount_matches'] for r in rows),
            'total_return_verified':False,'source':reference['source'],'rows':rows,
            'limitations':['동일 월 지급액 표본 비교이며 분배락일 검증이 아닙니다.',
                          '전체 분배금/분할 원장, 재투자 가격, 수정종가 총수익은 검증하지 않았습니다.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw',type=Path,required=True)
    parser.add_argument('--reference',type=Path,default=Path('tests/fixtures/kodex-200-distribution-sample.json'))
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    if not args.output.resolve().is_relative_to(root/'artifacts'):
        raise SystemExit('Evidence output must be under artifacts; never data/')
    raw_bytes=args.raw.read_bytes()
    report=reconcile_sample(json.loads(raw_bytes),json.loads(args.reference.read_text(encoding='utf-8')))
    report['raw_sha256']=hashlib.sha256(raw_bytes).hexdigest()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf-8') as file:
        json.dump(report,file,ensure_ascii=False,indent=2)
    print(json.dumps({k:report[k] for k in ('status','checked','matched','total_return_verified')},ensure_ascii=False))


if __name__=='__main__':
    main()
