// 첫 화면 샘플 백테스트를 미리 계산한다.
//
//   npm run precompute
//
// 산출물 2개:
//   1. data/precomputed/default-backtest.json — 전체 결과(디버깅·재사용, 앱이 지연 로드)
//   2. index.html의 PRECOMPUTED 마커 사이에 인라인되는 첫 화면용 압축 페이로드
//      (성과요약 지표 + 성장 곡선 시계열만 — 네트워크 왕복 0회로 첫 페인트에 렌더)
//
// 계산은 core/를 그대로 쓴다. 앱과 같은 코드·같은 설정이므로 숫자가 어긋날 수 없다.
// 데이터가 갱신되면 다시 실행해야 한다(GitHub Actions에서 자동 실행).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runBacktest, commonMonths } from "../core/backtest.js";
import { returnMapFromPayload } from "../core/data-loader.js";
import { SAMPLE_PORTFOLIO, sampleSettings } from "../core/sample-portfolio.js";
import { ENGINE_VERSION } from "../core/version.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), "utf8"));

const BEGIN = "<!-- BEGIN PRECOMPUTED";
const END = "<!-- END PRECOMPUTED -->";

const round = (value, digits) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function build() {
  const catalog = readJson("data/assets.json");
  const byId = new Map(catalog.assets.map((record) => [record.id, record]));

  const allocationIds = SAMPLE_PORTFOLIO.rows.map(([id]) => id);
  const ids = [...allocationIds, SAMPLE_PORTFOLIO.benchmarkId];
  const returnsById = {};
  const assets = {};
  for (const id of ids) {
    const record = byId.get(id);
    if (!record) throw new Error(`카탈로그에 없는 샘플 자산: ${id}`);
    returnsById[id] = returnMapFromPayload(readJson(record.file));
    assets[id] = {
      code: record.ticker,
      name: record.name,
      category: record.category,
      assetType: record.asset_type,
      distributionIncluded: record.distribution_included === true,
    };
  }

  // 보유 데이터 공통 구간 전체를 쓴다 (앱의 기본 기간 규칙과 동일).
  const fullRange = commonMonths(returnsById, ids, "0000-01", "9999-12");
  if (fullRange.length < 12) throw new Error(`샘플 공통 구간이 너무 짧다: ${fullRange.length}개월`);
  const settings = sampleSettings({ startDate: fullRange[0], endDate: fullRange.at(-1) });
  const result = runBacktest({ settings, dates: fullRange, returnsById });

  const meta = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    dataAsOf: catalog.data_as_of || null,
    dataRelease: catalog.generated_at || null,
    engineVersion: ENGINE_VERSION,
    presetKey: SAMPLE_PORTFOLIO.presetKey,
    note: "자동 생성물 — 수동 편집 금지. npm run precompute 로 재생성한다.",
  };

  return { meta, assets, result };
}

// 첫 화면에 필요한 것만: 지표 + 성장 곡선. 열 단위 배열로 담아 인라인 크기를 줄인다.
function firstScreenPayload({ meta, assets, result }) {
  const column = (key, digits) => result.series.map((point) => round(point[key], digits));
  return {
    ...meta,
    settings: result.settings,
    assets,
    dates: result.dates,
    metrics: result.metrics,
    series: {
      balance: column("balance", 0),
      principal: column("principal", 0),
      benchmarkBalance: column("benchmarkBalance", 0),
      realBalance: column("realBalance", 0),
      realBenchmarkBalance: column("realBenchmarkBalance", 0),
      realPrincipal: column("realPrincipal", 0),
      unitIndex: column("unitIndex", 6),
      benchmarkIndex: column("benchmarkIndex", 6),
    },
  };
}

function injectIntoIndex(payload) {
  const path = join(root, "index.html");
  const html = readFileSync(path, "utf8");
  const beginAt = html.indexOf(BEGIN);
  const endAt = html.indexOf(END);
  if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
    throw new Error("index.html에 PRECOMPUTED 마커가 없다. 마커를 복구한 뒤 다시 실행하라.");
  }
  const block = [
    `${BEGIN} — 자동 생성물, 수동 편집 금지 (npm run precompute) -->`,
    `  <script id="precomputedSample" type="application/json">${JSON.stringify(payload)}</script>`,
    `  ${END}`,
  ].join("\n");
  const next = html.slice(0, beginAt) + block + html.slice(endAt + END.length);
  writeFileSync(path, next);
  return block.length;
}

const built = build();
mkdirSync(join(root, "data/precomputed"), { recursive: true });
// 매일 재생성되는 산출물이라 압축 형식으로 저장한다(diff·전송량 최소화).
const fullJson = JSON.stringify({ ...built.meta, assets: built.assets, ...built.result }) + "\n";
writeFileSync(join(root, "data/precomputed/default-backtest.json"), fullJson);
const inlineBytes = injectIntoIndex(firstScreenPayload(built));

console.log(JSON.stringify({
  preset: built.meta.presetKey,
  period: [built.result.dates[0], built.result.dates.at(-1)],
  months: built.result.dates.length,
  cagr: `${(built.result.metrics.annualizedReturn * 100).toFixed(2)}%`,
  mdd: `${(built.result.metrics.maxDrawdown * 100).toFixed(2)}%`,
  dataAsOf: built.meta.dataAsOf,
  fullFileKB: Math.round(fullJson.length / 1024),
  inlineKB: Math.round(inlineBytes / 1024),
}, null, 2));
