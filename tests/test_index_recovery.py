import copy
import datetime as dt
import json
from pathlib import Path
import unittest
from scripts.restore_index_months import repaired_payload,extract_close

ROOT=Path(__file__).resolve().parents[1]


class IndexRecoveryTests(unittest.TestCase):
    def test_independent_etf_reference_values_must_agree(self):
        receipt={'status':'ok','requested_date':'20260731','rows':[
            {'ISU_CD':c,'BAS_DD':'20260731','IDX_IND_NM':'코스피 200','OBJ_STKPRC_IDX':'100'} for c in ('069500','102110')]}
        self.assertEqual(extract_close(receipt),100)
        receipt['rows'][1]['OBJ_STKPRC_IDX']='99'
        with self.assertRaisesRegex(ValueError,'Conflicting'):
            extract_close(receipt)

    def test_repair_is_replayable_and_cannot_touch_etf_total_returns(self):
        evidence=json.loads((ROOT/'data/repairs/kospi200-month-ends.json').read_text(encoding='utf-8'))
        p=json.loads((ROOT/'data/INDEX_KOSPI200.json').read_text(encoding='utf-8'))
        p['monthly_returns']=[r for r in p['monthly_returns'] if r['month']<='2026-08']
        fixed,_=repaired_payload(p,evidence,dt.date(2026,9,27))
        again,revisions=repaired_payload(fixed,evidence,dt.date(2026,9,27))
        self.assertEqual(fixed,again)
        self.assertEqual(revisions,[])
        self.assertEqual(fixed['month_end_quality']['usable_last_month'],'2026-08')
        bad=copy.deepcopy(p); bad['asset_type']='etf'
        with self.assertRaises(ValueError):
            repaired_payload(bad,evidence,dt.date(2026,9,27))
