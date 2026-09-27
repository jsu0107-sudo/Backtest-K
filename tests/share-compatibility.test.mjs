import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
await import('../engine.js');
const K = window.BacktestK;

test('legacy v1 config round-trips without changing fields', () => {
  const p = {v:1,n:'기존 공유',a:[['069500',100]],b:'INDEX_KOSPI',s:'2010-01',e:'2026-07',i:10000000,m:500000,t:'start',r:'annual',c:1.5,f:2,rf:3};
  assert.deepEqual(K.decodeShareConfig(K.encodeShareConfig(p)),p);
});

test('v2 snapshot preserves frozen metrics and optional quality notes', async () => {
  for (const extra of [{},{dq:['독립 총수익 대사 미완료']}]) {
    const p = {v:2,a:[['069500',100,'KODEX 200']],mx:{cagr:0.1234,mdd:-0.2},sr:{m:['2020-01'],p:[100],b:[90]},...extra};
    assert.deepEqual(await K.decodeSnapshot(await K.encodeSnapshot(p)),p);
  }
});

test('shared engine applies the same currency and month-end gate', () => {
  const p = JSON.parse(readFileSync(new URL('../data/INDEX_SP500.json',import.meta.url),'utf8'));
  assert.throws(()=>K.returnMapFrom(p),/원화 환산/);
});
