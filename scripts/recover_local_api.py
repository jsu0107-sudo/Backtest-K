"""Scoped KRX read-only retrieval using an existing local credential file.

No orders, balances, external workspace writes, or credential persistence.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import requests
from dotenv import dotenv_values


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--dates',nargs='+',required=True)
    parser.add_argument('--kind',choices=['etf','index'],required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    output=args.output.resolve()
    if not output.is_relative_to(root/'artifacts'):
        raise SystemExit('Output must be under artifacts/')
    for date in args.dates:
        dt.datetime.strptime(date,'%Y%m%d')
    key=dotenv_values(args.env_file).get('KRX_AUTH_KEY')
    if not key:
        raise SystemExit('KRX credential not configured')
    output.mkdir(parents=True,exist_ok=True)
    session=requests.Session()
    session.trust_env=False
    endpoint={'etf':'etp/etf_bydd_trd','index':'idx/kospi_dd_trd'}[args.kind]
    failed=False
    for date in args.dates:
        target=output/f'krx-{args.kind}-{date}.json'
        if target.exists():
            raise SystemExit('Evidence already exists; choose a fresh output directory')
        result={'source':'KRX OPEN API','endpoint':endpoint,'requested_date':date,
                'retrieved_at':dt.datetime.now(dt.timezone.utc).isoformat()}
        try:
            response=session.get('https://data-dbg.krx.co.kr/svc/apis/'+endpoint,
                                 params={'basDd':date},headers={'AUTH_KEY':key},timeout=25)
            result['http_status']=response.status_code
            response.raise_for_status()
            payload=response.json()
            rows=payload.get('OutBlock_1')
            if not isinstance(rows,list) or not rows:
                raise ValueError('Empty or invalid market response')
            result.update(status='ok',rows=rows)
        except Exception as error:
            # Never serialize requests, headers, exception payloads or secrets.
            result.update(status='unavailable',error_type=type(error).__name__)
            failed=True
        target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({k:result[k] for k in ('requested_date','status')},ensure_ascii=False),flush=True)
    return int(failed)


if __name__=='__main__':
    raise SystemExit(main())
