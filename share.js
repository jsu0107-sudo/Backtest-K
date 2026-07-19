// 백테스트K 공유 페이지.
// 공유 링크의 설정(c 파라미터)을 해독해 본편과 동일한 산식으로 결과를 재계산한다.
// 산식은 app.js의 runBacktest와 동일하게 유지해야 하며, 차이가 생기면 공유 결과의
// 신뢰가 깨진다 (엔진 모듈 분리 전까지의 임시 중복 구현).
(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const fmtPct = (value, digits = 2) => Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
  const fmtKRW = (value) => Number.isFinite(value) ? new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value) : "—";
  const fmtCompactKRW = (value) => {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(abs >= 1e13 ? 0 : 1)}조원`;
    if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}억원`;
    if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(abs >= 1e5 ? 0 : 1)}만원`;
    return `${sign}${Math.round(abs).toLocaleString("ko-KR")}원`;
  };
  const fmtDate = (month) => month ? month.replace("-", ".") : "";
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const savedTheme = (() => { try { return window.localStorage.getItem("backtestK.theme"); } catch (_) { return null; } })();
  if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;

  function decodeShareConfig(raw) {
    try {
      let base64 = String(raw).replaceAll("-", "+").replaceAll("_", "/");
      while (base64.length % 4) base64 += "=";
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (payload?.v !== 1 || !Array.isArray(payload.a) || !payload.a.length) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  function fail() {
    $("#shareError").hidden = false;
    $("#shareContent").hidden = true;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }

  function returnMapFrom(payload) {
    const map = new Map();
    (payload.monthly_returns || []).forEach((row) => {
      const value = Number(row.return);
      if (row.month && Number.isFinite(value) && value > -1) map.set(row.month, value);
    });
    return map;
  }

  function isRebalanceMonth(mode, index) {
    if (index === 0 || mode === "none") return false;
    if (mode === "monthly") return true;
    if (mode === "quarterly") return index % 3 === 0;
    if (mode === "semiannual") return index % 6 === 0;
    if (mode === "annual") return index % 12 === 0;
    return false;
  }

  function runShareBacktest(config, assets, benchmark) {
    const totalWeight = sum(assets.map((asset) => asset.weight));
    if (totalWeight <= 0) return null;
    assets.forEach((asset) => { asset.weight /= totalWeight; });

    let dates = null;
    [...assets.map((asset) => asset.returnMap), benchmark.returnMap].forEach((map) => {
      const months = new Set(map.keys());
      dates = dates === null ? months : new Set([...dates].filter((month) => months.has(month)));
    });
    const start = config.s || "0000-01";
    const end = config.e || "9999-12";
    const months = [...dates].filter((month) => month >= start && month <= end).sort();
    if (months.length < 12) return null;

    const initial = Number(config.i) || 0;
    const monthly = Number(config.m) || 0;
    const timing = config.t === "end" ? "end" : "start";
    const costRate = (Number(config.c) || 0) / 10000;
    let holdings = assets.map((asset) => initial * asset.weight);
    let principal = initial;
    let benchmarkBalance = initial;
    let unitIndex = 100;
    const monthlyReturns = [];
    const series = [];

    months.forEach((month, index) => {
      if (timing === "start" && monthly > 0) {
        const net = monthly - monthly * costRate;
        holdings = holdings.map((value, i) => value + net * assets[i].weight);
        benchmarkBalance += monthly;
        principal += monthly;
      }
      const startBalance = sum(holdings);
      holdings = holdings.map((value, i) => value * (1 + assets[i].returnMap.get(month)));
      benchmarkBalance *= 1 + benchmark.returnMap.get(month);
      if (isRebalanceMonth(config.r, index)) {
        const before = sum(holdings);
        const targets = assets.map((asset) => before * asset.weight);
        const turnover = sum(targets.map((target, i) => Math.abs(target - holdings[i]))) / 2;
        const afterCost = Math.max(0, before - turnover * costRate);
        holdings = assets.map((asset) => afterCost * asset.weight);
      }
      const endBalance = sum(holdings);
      const monthReturn = startBalance > 0 ? endBalance / startBalance - 1 : 0;
      monthlyReturns.push(monthReturn);
      unitIndex *= 1 + monthReturn;
      if (timing === "end" && monthly > 0) {
        const net = monthly - monthly * costRate;
        holdings = holdings.map((value, i) => value + net * assets[i].weight);
        benchmarkBalance += monthly;
        principal += monthly;
      }
      series.push({ month, balance: sum(holdings), principal, benchmarkBalance, unitIndex });
    });

    const count = monthlyReturns.length;
    const totalReturn = monthlyReturns.reduce((acc, value) => acc * (1 + value), 1) - 1;
    const cagr = Math.pow(1 + totalReturn, 12 / count) - 1;
    const meanReturn = sum(monthlyReturns) / count;
    const variance = monthlyReturns.reduce((acc, value) => acc + (value - meanReturn) ** 2, 0) / (count - 1);
    const volatility = Math.sqrt(variance) * Math.sqrt(12);
    let peak = series[0].unitIndex;
    let mdd = 0;
    series.forEach((point) => {
      peak = Math.max(peak, point.unitIndex);
      mdd = Math.min(mdd, point.unitIndex / peak - 1);
    });

    return { months, series, cagr, volatility, mdd, finalBalance: series.at(-1).balance, principal: series.at(-1).principal };
  }

  function drawShareChart(result, benchmarkName) {
    const canvas = $("#shareChart");
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);

    const margin = { left: 70, right: 15, top: 14, bottom: 32 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const { series, months } = result;
    const values = series.flatMap((point) => [point.balance, point.benchmarkBalance, point.principal]);
    const max = Math.max(...values) * 1.05;
    const min = 0;
    const xFor = (index) => margin.left + index / Math.max(1, series.length - 1) * plotWidth;
    const yFor = (value) => margin.top + (max - value) / (max - min) * plotHeight;

    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const y = margin.top + plotHeight * i / 4;
      ctx.strokeStyle = cssVar("--grid-line");
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width - margin.right, y); ctx.stroke();
      ctx.fillStyle = cssVar("--muted-2");
      ctx.textAlign = "right";
      ctx.fillText(fmtCompactKRW(max - (max - min) * i / 4), margin.left - 8, y);
    }
    const labelCount = width < 520 ? 4 : 6;
    for (let i = 0; i < labelCount; i += 1) {
      const index = Math.round(i * (months.length - 1) / Math.max(1, labelCount - 1));
      ctx.fillStyle = cssVar("--muted-2");
      ctx.textAlign = i === 0 ? "left" : i === labelCount - 1 ? "right" : "center";
      ctx.fillText(fmtDate(months[index]), xFor(index), height - 11);
    }

    const lines = [
      { key: "balance", color: cssVar("--accent"), width: 2.3, fill: true },
      { key: "benchmarkBalance", color: cssVar("--blue"), width: 1.6 },
      { key: "principal", color: cssVar("--muted-2"), width: 1.2, dash: [5, 5] },
    ];
    lines.forEach((line) => {
      const points = series.map((point, index) => [xFor(index), yFor(point[line.key])]);
      if (line.fill) {
        const gradient = ctx.createLinearGradient(0, margin.top, 0, margin.top + plotHeight);
        gradient.addColorStop(0, "rgba(69,227,181,.18)");
        gradient.addColorStop(1, "rgba(69,227,181,0)");
        ctx.beginPath();
        ctx.moveTo(points[0][0], margin.top + plotHeight);
        points.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.lineTo(points.at(-1)[0], margin.top + plotHeight);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      ctx.beginPath();
      points.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width;
      ctx.setLineDash(line.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Backtest-K 워터마크
    ctx.font = '700 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = "right";
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = cssVar("--muted");
    ctx.fillText("BACKTEST-K · backtest-k.vercel.app", width - margin.right - 4, margin.top + 10);
    ctx.globalAlpha = 1;

    $("#shareLegend").innerHTML = [
      ["포트폴리오", cssVar("--accent"), "line"],
      [benchmarkName, cssVar("--blue"), "line"],
      ["납입 원금", cssVar("--muted-2"), "dash"],
    ].map(([label, color, type]) => `<span class="legend-item"><i class="${type === "dash" ? "legend-dash" : "legend-line"}" style="${type === "dash" ? `color:${color}` : `background:${color}`}"></i>${escapeHtml(label)}</span>`).join("");
  }

  function rebalanceLabel(value) {
    return ({ none: "리밸런싱 없음", monthly: "매월", quarterly: "분기", semiannual: "반기", annual: "연 1회" })[value] || value;
  }

  async function init() {
    const raw = new URLSearchParams(window.location.search).get("c");
    const config = raw ? decodeShareConfig(raw) : null;
    if (!config) { fail(); return; }
    try {
      const catalog = await fetchJson("data/assets.json");
      const catalogById = new Map(catalog.assets.map((record) => [record.id, record]));
      const allocIds = config.a.map((pair) => pair[0]);
      const benchmarkId = config.b && catalogById.has(config.b) ? config.b : allocIds[0];
      const neededIds = [...new Set([...allocIds, benchmarkId])].filter((id) => catalogById.has(id));
      if (!neededIds.length || !allocIds.every((id) => catalogById.has(id))) { fail(); return; }

      const payloads = new Map();
      await Promise.all(neededIds.map(async (id) => {
        payloads.set(id, await fetchJson(catalogById.get(id).file));
      }));

      const assets = config.a.map(([id, weight]) => ({
        id,
        weight: (Number(weight) || 0) / 100,
        record: catalogById.get(id),
        returnMap: returnMapFrom(payloads.get(id)),
      }));
      const benchmark = { id: benchmarkId, record: catalogById.get(benchmarkId), returnMap: returnMapFrom(payloads.get(benchmarkId)) };

      const result = runShareBacktest(config, assets, benchmark);
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

      drawShareChart(result, benchmark.record.name);
      let resizeTimer;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => drawShareChart(result, benchmark.record.name), 120);
      });
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
