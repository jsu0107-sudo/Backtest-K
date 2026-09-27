"""Recover selected price-index months from locally retrieved official receipts.

Tracked price evidence is replayed after collection; ETF total returns are never patched.
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import math
from pathlib import Path

from scripts.audit_market_data import annotate_payload, expected_month_end, previous_month

PAIRS=[('20130228','20130329'),('20130329','20130430'),('20260630','20260731'),('20260731','20260831')]


def extract_close(receipt):
    if receipt.get('status')!='ok':
        raise ValueError('KRX receipt unavailable')
    rows=[r for r in receipt['rows'] if r.get('ISU_CD') in ('069500','102110')]
    if len(rows)!=2 or {r['ISU_CD'] for r in rows}!={'069500','102110'}:
        raise ValueError('Two distinct KOSPI200 ETF references required')
    for row in rows:
        if row['BAS_DD']!=receipt['requested_date'] or row['IDX_IND_NM'].replace(' ','')!='코스피200':
            raise ValueError('Index identity or date mismatch')
    values=[float(r['OBJ_STKPRC_IDX'].replace(',','')) for r in rows]
    if values[0]!=values[1] or not 0<values[0]<1000000:
        raise ValueError('Conflicting or invalid index closes')
    return values[0]


def prepare_evidence(folder):
    points={}
    kis=json.loads((folder/'kis/index.json').read_text(encoding='utf-8'))
    if kis.get('status')!='ok' or kis['data']['output1'].get('bstp_cls_code')!='2001':
        raise ValueError('KIS index identity mismatch')
    kis_prices={r['stck_bsop_date']:float(r['bstp_nmix_prpr']) for r in kis['data']['output2'] if r.get('stck_bsop_date')}
    for date in sorted({d for pair in PAIRS for d in pair}):
        content=(folder/f'krx-etf-{date}.json').read_bytes()
        close=extract_close(json.loads(content))
        if date.startswith('2026') and abs(kis_prices.get(date,0)-close)>1e-8:
            raise ValueError('KIS/KRX month-end disagreement')
        points[date]={'close':close,'date':dt.datetime.strptime(date,'%Y%m%d').date().isoformat(),
                      'krx_response_sha256':hashlib.sha256(content).hexdigest(),
                      'cross_check':'KIS + two KRX ETF reference-index fields' if date.startswith('2026') else 'two KRX ETF reference-index fields'}
    return {'schema_version':1,'id':'INDEX_KOSPI200','currency':'KRW','return_basis':'price_index',
            'source':{'name':'KRX OPEN API ETF reference-index field',
                      'url':'https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd',
                      'field':'OBJ_STKPRC_IDX','reference_etfs':['069500','102110']},
            'pairs':PAIRS,'points':points}


def repaired_payload(payload,evidence,as_of):
    if payload['id']!=evidence['id'] or payload['asset_type']!='index' or payload['distribution']['included'] or payload['currency']!=evidence['currency']:
        raise ValueError('Price-index-only repair; ETF total returns forbidden')
    if evidence.get('schema_version')!=1 or evidence.get('return_basis')!='price_index':
        raise ValueError('Unknown repair contract')
    result=copy.deepcopy(payload)
    rows={r['month']:r for r in result['monthly_returns']}
    revisions=[]
    for before,after in evidence['pairs']:
        base=evidence['points'][before]; end=evidence['points'][after]
        if any(not isinstance(p['close'],(int,float)) or not math.isfinite(p['close']) or p['close']<=0 for p in (base,end)):
            raise ValueError('Invalid price in repair evidence')
        month=end['date'][:7]
        if month>=as_of.strftime('%Y-%m') or base['date'][:7]!=previous_month(month):
            raise ValueError('Incomplete or nonadjacent repair months')
        if any(p['date']!=expected_month_end('XKRX',p['date'][:7],as_of.year) for p in (base,end)):
            raise ValueError('Repair date is not a month-end session')
        row={'month':month,'return':round(end['close']/base['close']-1,10),
             'observation_date':end['date'],'previous_observation_date':base['date'],
             'source_ref':'repairs/kospi200-month-ends.json'}
        if rows.get(month)!=row:
            revisions.append({'month':month,'before':rows.get(month),'after':row})
        rows[month]=row
    result['monthly_returns']=[rows[m] for m in sorted(rows)]
    result.update(first_month=min(rows),last_month=max(rows),monthly_return_count=len(rows),
                  data_as_of=max(payload['data_as_of'],max(p['date'] for p in evidence['points'].values())))
    source={**evidence['source'],'role':'일부 결측 월의 공식 가격지수 복구 (전체 히스토리 검증 아님)'}
    if source not in result['sources']:
        result['sources'].append(source)
    result['recovery']={'method':'official_month_end_price_ratio_v1','months':[evidence['points'][b]['date'][:7] for _,b in evidence['pairs']],
                        'note':'부분 월 복구이며 나머지 Yahoo 히스토리와 ETF 총수익의 독립 검증을 뜻하지 않습니다.'}
    annotate_payload(result,as_of)
    return result,revisions


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipts',type=Path)
    parser.add_argument('--write',action='store_true')
    parser.add_argument('--as-of',type=dt.date.fromisoformat,default=dt.date.today())
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    manifest=root/'data/repairs/kospi200-month-ends.json'
    evidence=prepare_evidence(args.receipts) if args.receipts else json.loads(manifest.read_text(encoding='utf-8'))
    target=root/'data/INDEX_KOSPI200.json'
    new,revisions=repaired_payload(json.loads(target.read_text(encoding='utf-8')),evidence,args.as_of)
    catalog=json.loads((root/'data/assets.json').read_text(encoding='utf-8'))
    record=next(r for r in catalog['assets'] if r['id']==new['id'])
    for key in ('data_as_of','first_month','last_month','monthly_return_count','month_end_quality','return_currency','krw_comparable'):
        record[key]=new[key]
    record['source_label']='Yahoo 가격지수 + KRX 일부 월말 복구'
    catalog['data_as_of']=max(r['data_as_of'] for r in catalog['assets'])
    catalog['generated_at']=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
    if args.write:
        manifest.parent.mkdir(parents=True,exist_ok=True)
        manifest.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        # Preserve the old rows in a separate immutable-by-default local receipt.
        archive=root/'artifacts/local-api-recovery/applied-revisions.json'
        if revisions and not archive.exists():
            archive.parent.mkdir(parents=True,exist_ok=True)
            archive.write_text(json.dumps(revisions,ensure_ascii=False,indent=2),encoding='utf-8')
        target.write_text(json.dumps(new,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        (root/'data/assets.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'written':args.write,'revised_months':[r['month'] for r in revisions],
                     'usable_first':new['month_end_quality']['usable_first_month'],'usable_last':new['month_end_quality']['usable_last_month']},ensure_ascii=False))


if __name__=='__main__':
    main()
