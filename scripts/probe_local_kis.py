"""Read only public prices/distribution schedules, using existing KIS config in memory."""
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
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    if not args.output.resolve().is_relative_to(root/'artifacts'):
        raise SystemExit('Only artifacts output allowed')
    args.output.mkdir(parents=True,exist_ok=False)
    env=dotenv_values(args.env_file)
    key,secret=env.get('KIS_APP_KEY'),env.get('KIS_APP_SECRET')
    if not key or not secret:
        raise SystemExit('Missing KIS credentials')
    base='https://openapi.koreainvestment.com:9443'
    if env.get('KIS_ENV','real') != 'real' or env.get('KIS_BASE_URL',base).rstrip('/') not in ('',base):
        raise SystemExit('Only the configured official production market-data host is supported')
    session=requests.Session(); session.trust_env=False
    cache=args.env_file.parent/'.kis_token_cache.json'
    token=None
    if cache.exists():
        stored=json.loads(cache.read_text(encoding='utf-8'))
        if stored.get('base_url')==base and dt.datetime.fromisoformat(stored.get('expires_at','1900-01-01')) > dt.datetime.now()+dt.timedelta(minutes=5):
            token=stored.get('access_token')
    if not token:
        response=session.post(base+'/oauth2/tokenP',json={'grant_type':'client_credentials','appkey':key,'appsecret':secret},timeout=20)
        if response.status_code!=200:
            raise SystemExit(f'Authentication unavailable: HTTP {response.status_code}')
        token=response.json().get('access_token')
        if not token:
            raise SystemExit('Authentication response missing token')
    jobs=[('index','/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice','FHKUP03500100',
           {'FID_COND_MRKT_DIV_CODE':'U','FID_INPUT_ISCD':'2001','FID_INPUT_DATE_1':'20260601','FID_INPUT_DATE_2':'20260831','FID_PERIOD_DIV_CODE':'D'})]
    for code in ('069500','114260'):
        jobs.append((code+'-dividends','/uapi/domestic-stock/v1/ksdinfo/dividend','HHKDB669102C0',
                     {'CTS':'','GB1':'0','F_DT':'20230701','T_DT':'20230831','SHT_CD':code,'HIGH_GB':''}))
    for label,path,tr,params in jobs:
        receipt={'source':'KIS OpenAPI','request':params,'endpoint':path,'retrieved_at':dt.datetime.now(dt.timezone.utc).isoformat()}
        try:
            response=session.get(base+path,params=params,headers={'authorization':'Bearer '+token,'appkey':key,'appsecret':secret,'tr_id':tr,'custtype':'P'},timeout=20)
            response.raise_for_status()
            data=response.json()
            receipt.update(status='ok' if data.get('rt_cd')=='0' else 'unavailable',code=data.get('msg_cd'),
                           continuation=response.headers.get('tr_cont',''),
                           data={k:v for k,v in data.items() if k.startswith('output')})
        except Exception as error:
            receipt.update(status='unavailable',error_type=type(error).__name__)
        (args.output/(label+'.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'label':label,'status':receipt['status'],'code':receipt.get('code')},ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
