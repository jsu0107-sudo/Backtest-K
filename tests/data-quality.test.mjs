import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { returnMapFromPayload, dataQualityMessages } from '../core/data-loader.js';

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url),'utf8'));

test('USD S&P500 is blocked, KRW-listed overseas ETFs are not converted twice', () => {
  assert.throws(() => returnMapFromPayload(read('INDEX_SP500')), /원화 환산/);
  assert.ok(returnMapFromPayload(read('360750')).size >= 12);
});
test('KOSPI200 mid-July is not used as a July month end', () => {
  const p = { asset_type: 'index', currency: 'KRW', monthly_returns: [
    {month:'2026-05',return:0.01}, {month:'2026-06',return:0.02}, {month:'2026-07',return:0.03}
  ], month_end_quality: {version:1,usable_first_month:'2026-05',usable_last_month:'2026-06',usable_month_count:2,
    excluded_months:[{month:'2026-07'}]} };
  assert.ok(p.monthly_returns.some(r => r.month === '2026-07')); // raw evidence preserved
  assert.equal(returnMapFromPayload(p).has('2026-07'),false);
});
test('all eligible KRW series are contiguous and exclude quarantined months', () => {
  for (const a of read('assets').assets.filter(a => a.currency === 'KRW')) {
    const p = read(a.id);
    const months = [...returnMapFromPayload(p).keys()];
    const ordinal = m => Number(m.slice(0,4))*12+Number(m.slice(5));
    assert.equal(months.length,p.month_end_quality.usable_month_count);
    for (let i=1;i<months.length;i++) assert.equal(ordinal(months[i])-ordinal(months[i-1]),1,a.id);
    for (const r of p.month_end_quality.excluded_months) assert.ok(!months.includes(r.month));
  }
});
test('missing quality metadata fails closed and warnings distinguish total-return verification', () => {
  const p = read('069500');
  assert.ok(dataQualityMessages(p,new Date('2026-09-27')).some(m=>m.includes('독립 총수익 대사 미완료')));
  delete p.month_end_quality;
  assert.throws(()=>returnMapFromPayload(p),/월말 검사/);
});
