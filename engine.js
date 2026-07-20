// 백테스트K 공용 정적 엔진.
// share.js(공유 페이지)와 portfolio.js(전략 랜딩)가 함께 사용하는 순수 계산·차트 모듈.
// 산식은 app.js의 runBacktest와 동일하게 유지해야 한다 (본편 엔진 분리 전까지의 기준 사본).
(() => {
  "use strict";

  // 계산 산식이 바뀌면 반드시 올린다. 스냅숏 공유 링크에 기록되어
  // "어떤 엔진으로 계산된 결과인지"를 식별한다.
  const ENGINE_VERSION = "1.0";

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

  function applySavedTheme() {
    let saved = null;
    try { saved = window.localStorage.getItem("backtestK.theme"); } catch (_) { /* 무시 */ }
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  function base64UrlToBytes(raw) {
    let base64 = String(raw).replaceAll("-", "+").replaceAll("_", "/");
    while (base64.length % 4) base64 += "=";
    return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  }

  function encodeShareConfig(payload) {
    return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  }

  // 스냅숏(v2) 코덱: deflate 압축 + base64url. 접두사 "1"=deflate, "0"=무압축 폴백.
  async function encodeSnapshot(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (typeof CompressionStream === "undefined") return `0${bytesToBase64Url(bytes)}`;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return `1${bytesToBase64Url(compressed)}`;
  }

  async function decodeSnapshot(raw) {
    try {
      const text = String(raw);
      const bytes = base64UrlToBytes(text.slice(1));
      let jsonBytes = bytes;
      if (text[0] === "1") {
        if (typeof DecompressionStream === "undefined") return null;
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        jsonBytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } else if (text[0] !== "0") {
        return null;
      }
      const payload = JSON.parse(new TextDecoder().decode(jsonBytes));
      if (payload?.v !== 2 || !Array.isArray(payload.a) || !payload.a.length) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  function shortHash(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    return hash.toString(16).slice(0, 5).padStart(5, "0");
  }

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

  function rebalanceLabel(value) {
    return ({ none: "리밸런싱 없음", monthly: "매월", quarterly: "분기", semiannual: "반기", annual: "연 1회" })[value] || value;
  }

  // config: {s,e,i,m,t,r,c} — 공유 코덱과 동일한 축약 키.
  // assets: [{weight(비율 합 1로 정규화됨), returnMap}], benchmark: {returnMap}
  function runStaticBacktest(config, assets, benchmark) {
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
    let benchmarkIndex = 100;
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
      const benchmarkStart = benchmarkBalance;
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
      const benchmarkReturn = benchmarkStart > 0 ? benchmarkBalance / benchmarkStart - 1 : 0;
      monthlyReturns.push(monthReturn);
      unitIndex *= 1 + monthReturn;
      benchmarkIndex *= 1 + benchmarkReturn;
      if (timing === "end" && monthly > 0) {
        const net = monthly - monthly * costRate;
        holdings = holdings.map((value, i) => value + net * assets[i].weight);
        benchmarkBalance += monthly;
        principal += monthly;
      }
      series.push({ month, balance: sum(holdings), principal, benchmarkBalance, unitIndex, benchmarkIndex });
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
    let benchmarkPeak = series[0].benchmarkIndex;
    let benchmarkMdd = 0;
    series.forEach((point) => {
      benchmarkPeak = Math.max(benchmarkPeak, point.benchmarkIndex);
      benchmarkMdd = Math.min(benchmarkMdd, point.benchmarkIndex / benchmarkPeak - 1);
    });
    const benchmarkTotal = series.at(-1).benchmarkIndex / 100 - 1;
    const benchmarkCagr = Math.pow(1 + benchmarkTotal, 12 / count) - 1;

    return {
      months,
      series,
      cagr,
      volatility,
      mdd,
      benchmarkCagr,
      benchmarkMdd,
      finalBalance: series.at(-1).balance,
      principal: series.at(-1).principal,
    };
  }

  function drawGrowthChart(canvas, result, options = {}) {
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
    const yFormatter = options.yFormatter || fmtCompactKRW;
    const values = series.flatMap((point) => options.hidePrincipal
      ? [point.balance, point.benchmarkBalance]
      : [point.balance, point.benchmarkBalance, point.principal]);
    const max = Math.max(...values) * 1.05;
    const min = options.hidePrincipal ? Math.min(...values) * 0.95 : 0;
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
      ctx.fillText(yFormatter(max - (max - min) * i / 4), margin.left - 8, y);
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
      ...(options.hidePrincipal ? [] : [{ key: "principal", color: cssVar("--muted-2"), width: 1.2, dash: [5, 5] }]),
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

    if (options.legendEl) {
      options.legendEl.innerHTML = [
        ["포트폴리오", cssVar("--accent"), "line"],
        [options.benchmarkName || "벤치마크", cssVar("--blue"), "line"],
        ...(options.hidePrincipal ? [] : [["납입 원금", cssVar("--muted-2"), "dash"]]),
      ].map(([label, color, type]) => `<span class="legend-item"><i class="${type === "dash" ? "legend-dash" : "legend-line"}" style="${type === "dash" ? `color:${color}` : `background:${color}`}"></i>${escapeHtml(label)}</span>`).join("");
    }
  }

  window.BacktestK = {
    ENGINE_VERSION,
    cssVar, sum, fmtPct, fmtKRW, fmtCompactKRW, fmtDate, escapeHtml,
    applySavedTheme, encodeShareConfig, decodeShareConfig, fetchJson,
    encodeSnapshot, decodeSnapshot, shortHash,
    returnMapFrom, isRebalanceMonth, rebalanceLabel, runStaticBacktest, drawGrowthChart,
  };
})();
