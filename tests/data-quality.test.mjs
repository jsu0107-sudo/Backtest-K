import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { returnMapFromPayload, dataQualityMessages, expectedCompleteMonth, catalogFreshness, sampleQualityMessages } from '../core/data-loader.js';

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

test('month freshness uses Korean date and never trusts a stored current flag', () => {
  const now = new Date('2026-09-30T15:00:00Z'); // Oct 1 KST, still Sep 30 UTC.
  assert.equal(expectedCompleteMonth(now), '2026-09');
  const payload = {month_end_quality:{status:'current',checked_as_of:'2026-09-27',usable_last_month:'2026-08'}};
  assert.ok(dataQualityMessages(payload, now).some(message => message.includes('2026-09 대비 지연')));
  assert.equal(expectedCompleteMonth(new Date('2026-12-31T15:00:00Z')), '2026-12');
});

test('sample warnings are recomputed after build date and for legacy inline payloads', () => {
  const info = {qualityMessages:['최신 완료월 2026-07 대비 지연: 사용 가능 2026-06', '가격수익률: 분배금/배당 제외']};
  const messages = sampleQualityMessages(info, '2026-08', new Date('2026-10-01T00:00:00Z'));
  assert.ok(messages.some(message => message.includes('2026-09 대비 지연')));
  assert.ok(!messages.some(message => message.includes('2026-07 대비')));
  assert.ok(messages.includes('가격수익률: 분배금/배당 제외'));
});

test('catalog freshness separates generated date, observation dates, and retained indices', () => {
  const catalog = {generated_at:'2026-10-01T12:00:00Z',assets:[
    {data_as_of:'2026-10-01',month_end_quality:{usable_last_month:'2026-09'}},
    {data_as_of:'2026-08-31',month_end_quality:{status:'current',usable_last_month:'2026-08'},refresh:{status:'retained'}},
  ]};
  assert.deepEqual(catalogFreshness(catalog,new Date('2026-10-01')),{
    observationMin:'2026-08-31',observationMax:'2026-10-01',usableCompleteMonth:'2026-08',
    expectedCompleteMonth:'2026-09',delayedCount:1,retainedCount:1,
  });
  assert.ok(dataQualityMessages({...catalog.assets[1],refresh:{...catalog.assets[1].refresh,attempted_as_of:'2026-10-01'}}, new Date('2026-10-01')).some(message => message.includes('이전 데이터 유지: 관측 2026-08-31')));
});
