// 코어 계산 회귀 테스트.
// tests/fixtures/golden-backtest.json은 코어 분리 이전 app.js 실행 결과를 고정한 것이다.
// 이 테스트가 깨지면 산식이 바뀐 것이므로, 의도한 변경이 아니면 되돌려야 한다.
//
//   node --test tests/golden-backtest.test.mjs
//   (또는 npm test)

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runBacktest, commonMonths } from "../core/backtest.js";
import { returnMapFromPayload } from "../core/data-loader.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), "utf8"));

// 브라우저 캡처와 동일한 정규화: 키 정렬 + 비유한수 치환.
// 장기 누적 시계열은 V8 버전에 따라 15번째 유효숫자부터 달라질 수 있으므로,
// 전체 결과 해시는 14자리로 맞춘다. 핵심 지표는 아래에서 원래 값 그대로 비교한다.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "__NF__";
    return Number(value.toPrecision(14));
  }
  return value;
}

const hashResult = (result) => createHash("sha256").update(JSON.stringify(canonicalize(result))).digest("hex");

const golden = readJson("tests/fixtures/golden-backtest.json");

// 픽스처에 동결된 입력. 데이터가 갱신돼도 이 테스트는 코드 변경만 잡는다.
function frozenReturns(ids) {
  const returnsById = {};
  for (const id of new Set(ids)) {
    const table = golden.inputReturns[id];
    assert.ok(table, `픽스처에 동결되지 않은 자산: ${id}`);
    returnsById[id] = new Map(Object.entries(table));
  }
  return returnsById;
}

// 라이브 data/에서 읽는 경로. 로딩 규칙(normalizeMonth 등) 회귀를 잡는 용도.
function liveReturns(ids) {
  const catalog = readJson("data/assets.json");
  const byId = new Map(catalog.assets.map((record) => [record.id, record]));
  const returnsById = {};
  for (const id of new Set(ids)) {
    const record = byId.get(id);
    assert.ok(record, `카탈로그에 없는 자산: ${id}`);
    returnsById[id] = returnMapFromPayload(readJson(record.file));
  }
  return returnsById;
}

for (const scenario of golden.scenarios) {
  test(`골든 일치: ${scenario.label}`, () => {
    const { settings, expect } = scenario;
    const ids = [...settings.allocations.map((item) => item.assetId), settings.benchmarkId];
    const returnsById = frozenReturns(ids);
    const dates = commonMonths(returnsById, ids, settings.startDate, settings.endDate);
    const result = runBacktest({ settings, dates, returnsById });

    // 사람이 원인을 짚을 수 있도록 지표를 먼저 비교하고, 마지막에 전체 해시를 확인한다.
    assert.equal(result.dates.length, expect.months, "개월 수 불일치");
    assert.deepEqual([result.dates[0], result.dates.at(-1)], expect.period, "구간 불일치");
    for (const [key, want] of Object.entries(expect.metrics)) {
      assert.equal(result.metrics[key], want, `metrics.${key} 불일치`);
    }
    for (const [key, want] of Object.entries(expect.counts)) {
      assert.equal(result[key].length, want, `${key} 길이 불일치`);
    }
    assert.equal(hashResult(result), expect.hash, "결과 전체 해시 불일치 (지표는 같아도 시계열이 달라졌을 수 있음)");
  });
}

// 로딩 규칙·데이터 연속성 감시: 동결 입력의 모든 달이 라이브 data/에도 있어야 하고
// 값이 실질적으로 같아야 한다.
//
// 공급자(수정종가)는 조정계수를 재계산하면서 과거 수익률을 미세하게 다시 쓴다.
// 관측된 노이즈는 절대편차 최대 1e-6(0.0001%p) 수준이므로 1e-5까지 허용한다.
//
// 척도는 반드시 **절대**편차를 쓴다. 수익률은 이미 비율이라 0 근처에서 상대오차가
// 폭발한다(실제로 -0.0003 수익률의 1e-6 변화가 상대오차 3.5e-3로 잡혔다).
// 배당 누락 같은 실제 개정은 1e-3 이상이라 이 문턱으로 충분히 걸린다.
const REVISION_TOLERANCE = 1e-5;

test("라이브 data/와 동결 입력이 일치 (데이터 개정·결측 감시)", () => {
  let maxDrift = 0;
  let driftAt = null;
  for (const [id, table] of Object.entries(golden.inputReturns)) {
    const live = liveReturns([id])[id];
    for (const [month, value] of Object.entries(table)) {
      const current = live.get(month);
      assert.ok(current !== undefined, `${id} ${month} 데이터가 사라졌다 (결측)`);
      const drift = Math.abs(current - value);
      if (drift > maxDrift) { maxDrift = drift; driftAt = `${id} ${month}`; }
    }
  }
  assert.ok(
    maxDrift <= REVISION_TOLERANCE,
    `과거 수익률이 실질적으로 개정됐다 (${driftAt}, 절대편차 ${maxDrift.toExponential(2)}). `
    + "공급자 데이터를 확인한 뒤 픽스처를 갱신하라 — 코드 문제가 아니다.",
  );
});
