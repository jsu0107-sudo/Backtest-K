// 백테스트K 공유 페이지 글루 코드. 계산·차트는 engine.js(window.BacktestK)를 사용한다.
(() => {
  "use strict";

  const K = window.BacktestK;
  const $ = (selector) => document.querySelector(selector);
  const { fmtPct, fmtKRW, fmtCompactKRW, fmtDate, escapeHtml, rebalanceLabel } = K;

  K.applySavedTheme();

  function fail() {
    $("#shareError").hidden = false;
    $("#shareContent").hidden = true;
  }

  async function init() {
    const raw = new URLSearchParams(window.location.search).get("c");
    const config = raw ? K.decodeShareConfig(raw) : null;
    if (!config) { fail(); return; }
    try {
      const catalog = await K.fetchJson("data/assets.json");
      const catalogById = new Map(catalog.assets.map((record) => [record.id, record]));
      const allocIds = config.a.map((pair) => pair[0]);
      const benchmarkId = config.b && catalogById.has(config.b) ? config.b : allocIds[0];
      const neededIds = [...new Set([...allocIds, benchmarkId])].filter((id) => catalogById.has(id));
      if (!neededIds.length || !allocIds.every((id) => catalogById.has(id))) { fail(); return; }

      const payloads = new Map();
      await Promise.all(neededIds.map(async (id) => {
        payloads.set(id, await K.fetchJson(catalogById.get(id).file));
      }));

      const assets = config.a.map(([id, weight]) => ({
        id,
        weight: (Number(weight) || 0) / 100,
        record: catalogById.get(id),
        returnMap: K.returnMapFrom(payloads.get(id)),
      }));
      const benchmark = { id: benchmarkId, record: catalogById.get(benchmarkId), returnMap: K.returnMapFrom(payloads.get(benchmarkId)) };

      const result = K.runStaticBacktest(config, assets, benchmark);
      if (!result) { fail(); return; }

      $("#shareContent").hidden = false;
      $("#shareTitle").textContent = config.n || "포트폴리오 시뮬레이션 결과";
      $("#sharePeriod").textContent = `${fmtDate(result.months[0])} – ${fmtDate(result.months.at(-1))} · ${rebalanceLabel(config.r)} 리밸런싱 · 벤치마크 ${benchmark.record.name}`;

      const metrics = [
        ["최종 자산", fmtCompactKRW(result.finalBalance), `납입 원금 ${fmtCompactKRW(result.principal)}`, ""],
        ["연환산 수익률 (CAGR)", fmtPct(result.cagr), "TWRR 기준", "blue"],
        ["최대 낙폭 (MDD)", fmtPct(result.mdd), "TWRR 단위지수 기준", "red"],
        ["연환산 변동성", fmtPct(result.volatility), "월 수익률 표준편차 × √12", "orange"],
      ];
      $("#shareMetrics").innerHTML = metrics.map(([label, value, sub, tone]) => `<article class="metric-card card ${tone}">
        <div class="metric-label">${escapeHtml(label)}</div>
        <strong class="metric-value" title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
        <div class="metric-sub">${escapeHtml(sub)}</div>
      </article>`).join("");

      $("#shareAllocBody").innerHTML = assets.map((asset) => `<tr>
        <td>${escapeHtml(asset.record.ticker)}</td>
        <td style="text-align:left">${escapeHtml(asset.record.name)}</td>
        <td>${escapeHtml(asset.record.category || "")}</td>
        <td>${(asset.weight * 100).toFixed(1)}%</td>
      </tr>`).join("");

      const conditions = [
        ["분석 기간", `${fmtDate(result.months[0])} – ${fmtDate(result.months.at(-1))} (${result.months.length}개월)`],
        ["초기 투자금", fmtKRW(Number(config.i) || 0)],
        ["월 적립금", `${fmtKRW(Number(config.m) || 0)} · ${config.t === "end" ? "월말" : "월초"} 납입`],
        ["리밸런싱", rebalanceLabel(config.r)],
        ["거래비용", `${Number(config.c) || 0}bp`],
        ["물가상승률 가정", `${Number(config.f) || 0}%`],
        ["무위험수익률 가정", `${Number(config.rf) || 0}%`],
        ["벤치마크", benchmark.record.name],
      ];
      $("#shareConditions").innerHTML = conditions.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

      const priceIndexes = [...assets.map((asset) => asset.record), benchmark.record]
        .filter((record) => record.asset_type === "index" && record.distribution_included !== true)
        .map((record) => record.name);
      const dataInfo = [
        ["데이터 기준일", catalog.data_as_of || "—"],
        ["자산 데이터", "월말 수정종가 기반 월 수익률 (분배금 반영)"],
        ["데이터 상태", catalog.provider_status === "provisional" ? "프로토타입 (독립 대사 진행 중)" : String(catalog.provider_status || "—")],
        ["유의", priceIndexes.length ? `${[...new Set(priceIndexes)].join(", ")}는 배당 제외 가격지수` : "과거 성과는 미래를 보장하지 않음"],
      ];
      $("#shareDataInfo").innerHTML = dataInfo.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

      $("#editLink").href = `./?c=${encodeURIComponent(raw)}`;
      $("#copyLinkButton").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          showToast("공유 링크를 복사했습니다.");
        } catch (_) {
          showToast("주소창의 링크를 직접 복사해주세요.");
        }
      });

      const draw = () => K.drawGrowthChart($("#shareChart"), result, { benchmarkName: benchmark.record.name, legendEl: $("#shareLegend") });
      draw();
      let resizeTimer;
      window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 120); });
    } catch (error) {
      console.warn("share page failed", error);
      fail();
    }
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
