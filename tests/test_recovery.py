import unittest
from scripts.build_market_data import parse_yahoo_series, CollectionError
from scripts.investigate_market_data import compare_returns
from scripts.verify_distribution_sample import reconcile_sample


class RecoveryTests(unittest.TestCase):
    def payload(self, adjusted=True):
        result = {"meta":{"exchangeTimezoneName":"Asia/Seoul"},
                  "timestamp":[1706716800,1706803200,1706889600],
                  "indicators":{"quote":[{"close":[100,101,102]}]}}
        if adjusted:
            result["indicators"]["adjclose"]=[{"adjclose":[98,99,100]}]
        return {"chart":{"result":[result]}}

    def test_etf_cannot_fall_back_to_raw_close(self):
        with self.assertRaisesRegex(CollectionError,"Missing adjusted"):
            parse_yahoo_series(self.payload(False),'069500.KS')

    def test_index_can_use_raw_close(self):
        self.assertEqual(parse_yahoo_series(self.payload(False),'^KS200')[0][0][1],100)

    def test_array_mismatch_fails(self):
        p=self.payload()
        p['chart']['result'][0]['indicators']['adjclose'][0]['adjclose'].pop()
        with self.assertRaisesRegex(CollectionError,'length mismatch'):
            parse_yahoo_series(p,'069500.KS')

    def test_diff_distinguishes_revisions_and_missing_months(self):
        a=[{'month':'2023-07','return':.1,'observation_date':'2023-07-28'}]
        b=[{'month':'2023-07','return':.11,'observation_date':'2023-07-31'},
           {'month':'2023-08','return':.01,'observation_date':'2023-08-31'}]
        result=compare_returns(a,b)
        self.assertEqual(result['added_months'],['2023-08'])
        self.assertEqual(result['removed_months'],[])
        self.assertEqual(result['changed_months'],['2023-07'])
        self.assertEqual(result['material_revision_months'],['2023-07'])
        self.assertAlmostEqual(result['max_absolute_return_revision'],.01)

    def test_amount_match_is_never_full_total_return_verification(self):
        p=self.payload()
        result=p['chart']['result'][0]
        result['meta'].update(symbol='069500.KS',currency='KRW')
        result['events']={'dividends':{'1':{'date':1706716800,'amount':50}}}
        ref={'asset_id':'069500','currency':'KRW','source':{'date_basis':'record_date'},
             'records':[{'record_date':'2024-02-29','amount':50}]}
        report=reconcile_sample(p,ref)
        self.assertEqual(report['matched'],1)
        self.assertFalse(report['total_return_verified'])
        result['events']['dividends']['2']={'date':1706803200,'amount':50}
        self.assertEqual(reconcile_sample(p,ref)['matched'],0)
