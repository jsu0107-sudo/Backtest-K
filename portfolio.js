// 백테스트K 전략 랜딩 페이지 글루 코드.
// 페이지가 window.PORTFOLIO_PAGE로 전략 구성을 선언하면, 데이터마트에서 실데이터를
// 불러와 사용 가능한 전체 기간으로 결과를 계산해 표시한다. engine.js 필요.
(() => {
  "use strict";

  const K = window.BacktestK;
  const $ = (selector) => document.querySelector(selector);
  const { fmtPct, fmtCompactKRW, fmtDate, escapeHtml } = K;

  K.applySavedTheme();

  const page = window.PORTFOLIO_PAGE;
  if (!page || !Array.isArray(page.alloc) || !page.alloc.length) return;
  const basePath = page.basePath || "./";
  const settings = { i: 10000000, m: 500000, t: "start", r: "annual", c: 1.5, ...page.settings };

  async function init() {
    try {
      const catalog = await K.fetchJson(`${basePath}data/assets.json`);
      const catalogById = new Map(catalog.assets.map((record) => [record.id, record]));
      const allocIds = page.alloc.map((pair) => pair[0]);
      const benchmarkId = page.benchmark && catalogById.has(page.benchmark) ? page.benchmark : allocIds[0];
      const neededIds = [...new Set([...allocIds, benchmarkId])];
      if (!allocIds.every((id) => catalogById.has(id))) throw new Error("전략 자산이 카탈로그에 없습니다.");

      const payloads = new Map();
      await Promise.all(neededIds.map(async (id) => {
        payloads.set(id, await K.fetchJson(`${basePath}${catalogById.get(id).file}`));
      }));

      const assets = page.alloc.map(([id, weight]) => ({
        id,
        weight: (Number(weight) || 0) / 100,
        record: catalogById.get(id),
        returnMap: K.returnMapFrom(payloads.get(id)),
      }));
      const benchmark = { id: benchmarkId, record: catalogById.get(benchmarkId), returnMap: K.returnMapFrom(payloads.get(benchmarkId)) };

      const result = K.runStaticBacktest({ ...settings }, assets, benchmark);
      if (!result) throw new Error("공통 데이터 구간이 부족합니다.");

      const metricsEl = $("#pfMetrics");
      if (metricsEl) {
        const metrics = [
          ["연환산 수익률 (CAGR)", fmtPct(result.cagr), `벤치마크 ${fmtPct(result.benchmarkCagr)}`, ""],
          ["최대 낙폭 (MDD)", fmtPct(result.mdd), `벤치마크 ${fmtPct(result.benchmarkMdd)}`, "red"],
          ["연환산 변동성", fmtPct(result.volatility), "월 수익률 표준편차 × √12", "orange"],
          ["최종 자산", fmtCompactKRW(result.finalBalance), `납입 원금 ${fmtCompactKRW(result.principal)}`, "blue"],
        ];
        metricsEl.innerHTML = metrics.map(([label, value, sub, tone]) => `<article class="metric-card card ${tone}">
          <div class="metric-label">${escapeHtml(label)}</div>
          <strong class="metric-value" title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
          <div class="metric-sub">${escapeHtml(sub)}</div>
        </article>`).join("");
      }

      const periodEl = $("#pfPeriod");
      if (periodEl) {
        periodEl.textContent = `분석 기간 ${fmtDate(result.months[0])} – ${fmtDate(result.months.at(-1))} (${result.months.length}개월) · 초기 ${fmtCompactKRW(settings.i)} + 월 ${fmtCompactKRW(settings.m)} 적립 · ${K.rebalanceLabel(settings.r)} 리밸런싱 · 데이터 기준일 ${catalog.data_as_of || "—"}`;
      }

      const cta = $("#pfCta");
      if (cta) {
        const payload = {
          v: 1,
          n: page.name,
          a: page.alloc,
          b: benchmarkId,
          s: result.months[0],
          e: result.months.at(-1),
          i: settings.i,
          m: settings.m,
          t: settings.t,
          r: settings.r,
          c: settings.c,
          f: 2,
          rf: 3,
        };
        cta.href = `${basePath}?c=${encodeURIComponent(K.encodeShareConfig(payload))}`;
      }

      const canvas = $("#pfChart");
      if (canvas) {
        const draw = () => K.drawGrowthChart(canvas, result, { benchmarkName: benchmark.record.name, legendEl: $("#pfLegend") });
        draw();
        let resizeTimer;
        window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 120); });
      }
    } catch (error) {
      console.warn("portfolio page failed", error);
      const metricsEl = $("#pfMetrics");
      if (metricsEl) metricsEl.innerHTML = `<p style="color:var(--muted);font-size:14px">실데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
