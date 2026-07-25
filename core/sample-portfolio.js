// 첫 화면 샘플 포트폴리오의 단일 정의.
// app.js(기본 프리셋)와 scripts/precompute_default.mjs(사전 계산)가 함께 읽으므로,
// 여기만 고치면 양쪽이 자동으로 일치한다.
//
// 한국 60/40을 샘플로 쓰는 이유: 두 자산 모두 2009년부터 데이터가 있어 공통 구간이
// 15년 이상이고, 2011·2018·2020·2022 하락이 모두 포함된다.
// (균형 성장은 금 ETF 상장일(2022-01) 때문에 54개월로 잘린다 — 프리셋 버튼으로만 남긴다.)

export const SAMPLE_PORTFOLIO = {
  presetKey: "korea6040",
  name: "한국 60/40 포트폴리오",
  rows: [["069500", 60], ["114260", 40]],
  benchmarkId: "INDEX_KOSPI",
};

// index.html의 입력 기본값과 반드시 같아야 한다.
// (tests/sample-defaults.test.mjs가 불일치를 잡는다.)
export const SAMPLE_DEFAULTS = {
  initialAmount: 50000000,
  monthlyContribution: 1000000,
  contributionTiming: "start",
  rebalance: "annual",
  tradingCostBps: 1.5,
  inflationRate: 0.02,
  riskFreeRate: 0.03,
};

// 사전 계산과 앱이 같은 설정 객체를 만들도록 하는 헬퍼.
// startDate/endDate는 보유 데이터 공통 구간 전체(호출자가 주입)를 쓴다.
export function sampleSettings({ startDate, endDate }) {
  return {
    allocations: SAMPLE_PORTFOLIO.rows.map(([assetId, weight]) => ({ assetId, weight: weight / 100 })),
    startDate,
    endDate,
    ...SAMPLE_DEFAULTS,
    benchmarkId: SAMPLE_PORTFOLIO.benchmarkId,
    name: SAMPLE_PORTFOLIO.name,
  };
}
