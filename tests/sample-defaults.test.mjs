// 사전 계산 샘플과 앱 기본값이 어긋나면 첫 화면 숫자와 실제 계산 결과가 달라진다.
// index.html의 입력 기본값이 core/sample-portfolio.js의 정의와 같은지 감시한다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { SAMPLE_DEFAULTS, SAMPLE_PORTFOLIO } from "../core/sample-portfolio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

const inputValue = (id) => {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
  assert.ok(tag, `index.html에 #${id} 입력이 없다`);
  const value = tag.match(/value="([^"]*)"/)?.[1];
  assert.ok(value !== undefined, `#${id}에 value 속성이 없다`);
  return value;
};

const selectedOption = (id) => {
  const block = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>[\\s\\S]*?</select>`))?.[0];
  assert.ok(block, `index.html에 #${id} 셀렉트가 없다`);
  const selected = block.match(/<option value="([^"]*)"[^>]*selected/)?.[1];
  return selected ?? block.match(/<option value="([^"]*)"/)?.[1];
};

test("index.html 투자금 기본값이 샘플 정의와 일치", () => {
  assert.equal(Number(inputValue("initialAmount").replaceAll(",", "")), SAMPLE_DEFAULTS.initialAmount);
  assert.equal(Number(inputValue("monthlyContribution").replaceAll(",", "")), SAMPLE_DEFAULTS.monthlyContribution);
});

test("index.html 비용·가정 기본값이 샘플 정의와 일치", () => {
  assert.equal(Number(inputValue("tradingCost")), SAMPLE_DEFAULTS.tradingCostBps);
  assert.equal(Number(inputValue("inflationRate")) / 100, SAMPLE_DEFAULTS.inflationRate);
  assert.equal(Number(inputValue("riskFreeRate")) / 100, SAMPLE_DEFAULTS.riskFreeRate);
});

test("index.html 리밸런싱·적립시점 기본값이 샘플 정의와 일치", () => {
  assert.equal(selectedOption("rebalance"), SAMPLE_DEFAULTS.rebalance);
  assert.equal(selectedOption("contributionTiming"), SAMPLE_DEFAULTS.contributionTiming);
});

test("사전 계산 산출물이 샘플 정의와 같은 구성으로 생성됨", () => {
  const precomputed = JSON.parse(readFileSync(join(root, "data/precomputed/default-backtest.json"), "utf8"));
  assert.equal(precomputed.presetKey, SAMPLE_PORTFOLIO.presetKey);
  assert.equal(precomputed.settings.name, SAMPLE_PORTFOLIO.name);
  assert.equal(precomputed.settings.benchmarkId, SAMPLE_PORTFOLIO.benchmarkId);
  assert.deepEqual(
    precomputed.settings.allocations,
    SAMPLE_PORTFOLIO.rows.map(([assetId, weight]) => ({ assetId, weight: weight / 100 })),
  );
  for (const [key, want] of Object.entries(SAMPLE_DEFAULTS)) {
    assert.equal(precomputed.settings[key], want, `사전 계산 settings.${key} 불일치`);
  }
});

test("index.html 인라인 페이로드가 사전 계산 산출물과 같은 결과", () => {
  const inline = JSON.parse(html.match(/<script id="precomputedSample" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const full = JSON.parse(readFileSync(join(root, "data/precomputed/default-backtest.json"), "utf8"));
  assert.equal(inline.schemaVersion, 1);
  assert.equal(inline.dates.length, full.dates.length, "인라인/전체 산출물 개월 수 불일치");
  assert.equal(inline.metrics.annualizedReturn, full.metrics.annualizedReturn, "CAGR 불일치");
  assert.equal(inline.metrics.maxDrawdown, full.metrics.maxDrawdown, "MDD 불일치");
  assert.equal(inline.dataAsOf, full.dataAsOf, "데이터 기준일 불일치 — precompute를 다시 실행하라");
});
