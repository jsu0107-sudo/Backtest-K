(() => {
  "use strict";

  const COLORS = ["#45e3b5", "#5ea9ff", "#ffb45e", "#a58bff", "#ff7f8c", "#ffd166", "#44c7dd", "#8bd17c", "#f28e6b", "#85a0ff"];
  const BUILTIN_DATES = makeMonthRange("2015-01", "2025-12");
  const state = {
    assets: {},
    assetOrder: [],
    portfolio: [],
    activePreset: "balanced",
    portfolioName: "균형 성장 포트폴리오",
    lastBacktest: null,
    monteCarlo: null,
    compareSelected: new Set(["US_EQ", "KR_EQ", "KR_BOND10", "GOLD_KRW"]),
    toastTimer: null,
    chartConfigs: new Map(),
  };

  const memoryStorage = new Map();
  const storage = {
    getItem(key) {
      try { return window.localStorage.getItem(key); }
      catch (_) { return memoryStorage.get(key) ?? null; }
    },
    setItem(key, value) {
      memoryStorage.set(key, String(value));
      try { window.localStorage.setItem(key, String(value)); return true; }
      catch (_) { return false; }
    },
    removeItem(key) {
      memoryStorage.delete(key);
      try { window.localStorage.removeItem(key); return true; }
      catch (_) { return false; }
    },
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const mean = (values) => values.length ? sum(values) / values.length : 0;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const fmtPct = (value, digits = 1) => Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
  const fmtPp = (value, digits = 1) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%p` : "—";
  const fmtNumber = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "—";
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
  const fmtDate = (date) => date ? date.replace("-", ".") : "";
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function makeMonthRange(start, end) {
    const [sy, sm] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    const result = [];
    let y = sy;
    let m = sm;
    while (y < ey || (y === ey && m <= em)) {
      result.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m === 13) { m = 1; y += 1; }
    }
    return result;
  }

  function mulberry32(seed) {
    return function random() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function normalRandom(random) {
    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function buildDemoAssets() {
    const random = mulberry32(20250719);
    const events = {
      "2015-08": { eq: -0.075, kr: -0.03, bond: 0.012, gold: 0.025, usd: 0.025, reit: -0.04 },
      "2016-01": { eq: -0.06, kr: -0.018, bond: 0.015, gold: 0.035, usd: 0.012, reit: -0.025 },
      "2016-02": { eq: -0.025, kr: -0.01, bond: 0.012, gold: 0.06, usd: -0.005, reit: 0.005 },
      "2018-02": { eq: -0.055, kr: -0.015, bond: -0.006, gold: -0.01, usd: 0.01, reit: -0.025 },
      "2018-10": { eq: -0.075, kr: -0.025, bond: 0.004, gold: 0.015, usd: 0.018, reit: -0.035 },
      "2018-12": { eq: -0.085, kr: -0.02, bond: 0.018, gold: 0.035, usd: 0.008, reit: -0.06 },
      "2019-01": { eq: 0.075, kr: 0.018, bond: 0.006, gold: -0.012, usd: -0.012, reit: 0.055 },
      "2020-02": { eq: -0.085, kr: -0.025, bond: 0.022, gold: -0.006, usd: 0.018, reit: -0.09 },
      "2020-03": { eq: -0.17, kr: -0.045, bond: 0.018, gold: -0.018, usd: 0.06, reit: -0.16 },
      "2020-04": { eq: 0.125, kr: 0.035, bond: 0.005, gold: 0.07, usd: -0.025, reit: 0.105 },
      "2020-11": { eq: 0.095, kr: 0.035, bond: -0.012, gold: -0.045, usd: -0.018, reit: 0.14 },
      "2021-01": { eq: 0.03, kr: 0.065, bond: -0.02, gold: -0.015, usd: -0.005, reit: 0.025 },
      "2022-01": { eq: -0.07, kr: -0.025, bond: -0.026, gold: -0.012, usd: 0.018, reit: -0.055 },
      "2022-04": { eq: -0.07, kr: -0.02, bond: -0.035, gold: -0.02, usd: 0.035, reit: -0.07 },
      "2022-06": { eq: -0.085, kr: -0.035, bond: -0.025, gold: -0.02, usd: 0.03, reit: -0.09 },
      "2022-09": { eq: -0.09, kr: -0.03, bond: -0.04, gold: -0.025, usd: 0.045, reit: -0.11 },
      "2022-10": { eq: 0.07, kr: 0.02, bond: 0.012, gold: 0.008, usd: -0.02, reit: 0.065 },
      "2023-01": { eq: 0.055, kr: 0.025, bond: 0.018, gold: 0.045, usd: -0.022, reit: 0.06 },
      "2023-11": { eq: 0.085, kr: 0.025, bond: 0.035, gold: 0.018, usd: -0.025, reit: 0.105 },
      "2024-02": { eq: 0.055, kr: 0.01, bond: -0.008, gold: -0.01, usd: 0.012, reit: 0.025 },
      "2024-04": { eq: -0.04, kr: -0.012, bond: -0.018, gold: 0.065, usd: 0.02, reit: -0.05 },
      "2024-08": { eq: -0.045, kr: -0.02, bond: 0.025, gold: 0.018, usd: 0.005, reit: -0.025 },
      "2024-11": { eq: 0.065, kr: 0.005, bond: -0.012, gold: -0.025, usd: 0.025, reit: 0.04 },
      "2025-03": { eq: -0.055, kr: -0.018, bond: 0.015, gold: 0.035, usd: 0.015, reit: -0.04 },
      "2025-05": { eq: 0.075, kr: 0.025, bond: -0.006, gold: -0.012, usd: -0.015, reit: 0.055 },
    };

    const returnSeries = {
      KR_EQ: [], US_EQ: [], NASDAQ_KRW: [], KR_BOND10: [], US_BOND_KRW: [], GOLD_KRW: [], REIT_KR: [], CASH_KRW: []
    };

    BUILTIN_DATES.forEach((date, i) => {
      const event = events[date] || {};
      const cyclical = Math.sin(i / 10) * 0.006 + Math.cos(i / 23) * 0.004;
      const globalShock = normalRandom(random) * 0.028 + (event.eq || 0);
      const koreaShock = normalRandom(random) * 0.024 + (event.kr || 0);
      const bondShock = normalRandom(random) * 0.009 + (event.bond || 0);
      const goldShock = normalRandom(random) * 0.022 + (event.gold || 0);
      const usdShock = normalRandom(random) * 0.012 + (event.usd || 0);
      const reitShock = normalRandom(random) * 0.02 + (event.reit || 0);

      const us = 0.082 / 12 + globalShock + cyclical * 0.35;
      const kr = 0.052 / 12 + 0.58 * globalShock + 0.70 * koreaShock + cyclical;
      const nasdaq = 0.105 / 12 + 1.27 * globalShock + normalRandom(random) * 0.018 + cyclical * 0.35;
      const krBond = 0.031 / 12 - 0.10 * globalShock + bondShock;
      const usBond = 0.034 / 12 - 0.12 * globalShock + 1.05 * bondShock + 0.55 * usdShock;
      const gold = 0.043 / 12 - 0.04 * globalShock + goldShock + 0.55 * usdShock;
      const reit = 0.057 / 12 + 0.62 * globalShock + reitShock - 0.35 * bondShock;
      const cashAnnual = i < 30 ? 0.015 : i < 78 ? 0.012 : i < 96 ? 0.021 : 0.032;
      const cash = cashAnnual / 12 + normalRandom(random) * 0.00025;

      returnSeries.US_EQ.push(clamp(us, -0.42, 0.34));
      returnSeries.KR_EQ.push(clamp(kr, -0.38, 0.30));
      returnSeries.NASDAQ_KRW.push(clamp(nasdaq, -0.48, 0.42));
      returnSeries.KR_BOND10.push(clamp(krBond, -0.12, 0.11));
      returnSeries.US_BOND_KRW.push(clamp(usBond, -0.16, 0.14));
      returnSeries.GOLD_KRW.push(clamp(gold, -0.19, 0.22));
      returnSeries.REIT_KR.push(clamp(reit, -0.35, 0.32));
      returnSeries.CASH_KRW.push(clamp(cash, -0.002, 0.009));
    });

    const definitions = [
      ["KR_EQ", "DEMO-KR200", "한국 대형주", "국내주식", COLORS[0], "KOSPI 200 계열을 가정한 합성 월 수익률"],
      ["US_EQ", "DEMO-US500", "미국 S&P 500 · 원화", "해외주식", COLORS[1], "미국 대형주와 원/달러 효과를 단순화한 합성 월 수익률"],
      ["NASDAQ_KRW", "DEMO-NDX", "미국 나스닥100 · 원화", "해외주식", COLORS[2], "미국 성장주와 원/달러 효과를 단순화한 합성 월 수익률"],
      ["KR_BOND10", "DEMO-KTB10", "국고채 10년", "국내채권", COLORS[3], "국고채 장기 듀레이션을 가정한 합성 월 수익률"],
      ["US_BOND_KRW", "DEMO-UST10", "미국 국채 10년 · 원화", "해외채권", COLORS[4], "미국 국채와 원/달러 효과를 단순화한 합성 월 수익률"],
      ["GOLD_KRW", "DEMO-GOLD", "금 · 원화", "대체자산", COLORS[5], "금 가격과 원/달러 효과를 단순화한 합성 월 수익률"],
      ["REIT_KR", "DEMO-REIT", "한국 리츠", "부동산", COLORS[6], "국내 상장 리츠를 가정한 합성 월 수익률"],
      ["CASH_KRW", "DEMO-CASH", "원화 단기자금", "현금성", COLORS[7], "단기금리 수준을 가정한 합성 월 수익률"],
    ];

    definitions.forEach(([id, code, name, category, color, description]) => {
      const map = new Map(BUILTIN_DATES.map((date, index) => [date, returnSeries[id][index]]));
      state.assets[id] = { id, code, name, category, color, description, source: "demo", returnMap: map };
      state.assetOrder.push(id);
    });
  }

  function restoreCustomAssets() {
    try {
      const raw = storage.getItem("backtestK.customAssets");
      if (!raw) return;
      const saved = JSON.parse(raw);
      saved.forEach((asset, index) => {
        const id = asset.id;
        state.assets[id] = {
          ...asset,
          color: asset.color || COLORS[(state.assetOrder.length + index) % COLORS.length],
          source: "custom",
          returnMap: new Map(asset.returns),
        };
        state.assetOrder.push(id);
      });
    } catch (error) {
      console.warn("사용자 데이터 복원 실패", error);
    }
  }

  function persistCustomAssets() {
    const saved = state.assetOrder
      .map((id) => state.assets[id])
      .filter((asset) => asset.source === "custom")
      .map((asset) => ({
        id: asset.id,
        code: asset.code,
        name: asset.name,
        category: asset.category,
        color: asset.color,
        description: asset.description,
        source: "custom",
        returns: [...asset.returnMap.entries()],
      }));
    try {
      storage.setItem("backtestK.customAssets", JSON.stringify(saved));
    } catch (error) {
      showToast("브라우저 저장 공간이 부족해 사용자 데이터를 저장하지 못했습니다.");
    }
  }

  function assetOptions(selectedId) {
    return state.assetOrder.map((id) => {
      const asset = state.assets[id];
      return `<option value="${escapeHtml(id)}" ${id === selectedId ? "selected" : ""}>${escapeHtml(asset.name)} · ${escapeHtml(asset.code)}</option>`;
    }).join("");
  }

  function renderAssetRows() {
    const container = $("#assetRows");
    container.innerHTML = state.portfolio.map((row, index) => {
      const asset = state.assets[row.assetId] || state.assets[state.assetOrder[0]];
      return `<div class="asset-row" data-index="${index}">
        <div class="asset-select-wrap">
          <span class="asset-dot" style="background:${asset.color}"></span>
          <select class="asset-select" aria-label="자산 ${index + 1}">${assetOptions(asset.id)}</select>
        </div>
        <div class="input-affix"><input class="weight-input" type="number" min="0" max="100" step="0.5" value="${row.weight}" aria-label="${escapeHtml(asset.name)} 비중"/><span>%</span></div>
        <button class="remove-asset" type="button" aria-label="자산 삭제">×</button>
      </div>`;
    }).join("");

    $$(".asset-row", container).forEach((rowElement) => {
      const index = Number(rowElement.dataset.index);
      $(".asset-select", rowElement).addEventListener("change", (event) => {
        state.portfolio[index].assetId = event.target.value;
        state.activePreset = null;
        renderAssetRows();
        renderPresetState();
        renderBenchmarkOptions();
        updateAllocationState();
      });
      $(".weight-input", rowElement).addEventListener("input", (event) => {
        state.portfolio[index].weight = Number(event.target.value) || 0;
        state.activePreset = null;
        renderPresetState();
        updateAllocationState();
      });
      $(".remove-asset", rowElement).addEventListener("click", () => {
        if (state.portfolio.length <= 1) {
          showToast("포트폴리오에는 최소 한 개의 자산이 필요합니다.");
          return;
        }
        state.portfolio.splice(index, 1);
        state.activePreset = null;
        renderAssetRows();
        renderPresetState();
        updateAllocationState();
      });
    });
    $("#addAsset").disabled = state.portfolio.length >= 8;
  }

  function renderBenchmarkOptions() {
    const select = $("#benchmark");
    const current = select.value || "KR_EQ";
    select.innerHTML = state.assetOrder.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(state.assets[id].name)}</option>`).join("");
    select.value = state.assets[current] ? current : "KR_EQ";
  }

  function updateAllocationState() {
    const total = sum(state.portfolio.map((row) => Number(row.weight) || 0));
    const valid = Math.abs(total - 100) < 0.01;
    $("#allocationTotal").textContent = `${total.toFixed(1)}%`;
    const stateBadge = $("#allocationState");
    stateBadge.textContent = valid ? "100%" : `${total.toFixed(1)}%`;
    stateBadge.className = `allocation-state ${valid ? "valid" : "invalid"}`;
    const meter = $("#allocationMeter");
    meter.style.width = `${clamp(total, 0, 100)}%`;
    meter.style.background = total > 100 ? "var(--red)" : "linear-gradient(90deg, var(--accent), var(--blue))";
    $("#runBacktest").disabled = !valid;
    $("#formError").textContent = valid ? "" : "자산 비중의 합계를 100%로 맞춰주세요.";
  }

  const PRESETS = {
    balanced: {
      name: "균형 성장 포트폴리오",
      rows: [["US_EQ", 40], ["KR_EQ", 20], ["KR_BOND10", 30], ["GOLD_KRW", 10]],
      benchmark: "KR_EQ",
    },
    growth: {
      name: "글로벌 성장 포트폴리오",
      rows: [["US_EQ", 40], ["NASDAQ_KRW", 30], ["KR_EQ", 20], ["GOLD_KRW", 10]],
      benchmark: "US_EQ",
    },
    allweather: {
      name: "한국형 올웨더 포트폴리오",
      rows: [["US_EQ", 30], ["KR_BOND10", 35], ["US_BOND_KRW", 20], ["GOLD_KRW", 15]],
      benchmark: "KR_EQ",
    },
    korea6040: {
      name: "한국 60/40 포트폴리오",
      rows: [["KR_EQ", 60], ["KR_BOND10", 40]],
      benchmark: "KR_EQ",
    },
  };

  function applyPreset(key, run = true) {
    const preset = PRESETS[key];
    if (!preset) return;
    state.activePreset = key;
    state.portfolioName = preset.name;
    state.portfolio = preset.rows.map(([assetId, weight]) => ({ assetId, weight }));
    renderAssetRows();
    renderPresetState();
    renderBenchmarkOptions();
    $("#benchmark").value = preset.benchmark;
    updateAllocationState();
    if (run) runBacktest();
  }

  function renderPresetState() {
    $$(".preset-chip").forEach((button) => button.classList.toggle("active", button.dataset.preset === state.activePreset));
  }

  function gatherBacktestSettings() {
    return {
      allocations: state.portfolio.map((row) => ({ assetId: row.assetId, weight: Number(row.weight) / 100 })),
      startDate: $("#startDate").value,
      endDate: $("#endDate").value,
      initialAmount: Number($("#initialAmount").value),
      monthlyContribution: Number($("#monthlyContribution").value),
      contributionTiming: $("#contributionTiming").value,
      rebalance: $("#rebalance").value,
      tradingCostBps: Number($("#tradingCost").value),
      inflationRate: Number($("#inflationRate").value) / 100,
      riskFreeRate: Number($("#riskFreeRate").value) / 100,
      benchmarkId: $("#benchmark").value,
      name: state.portfolioName,
    };
  }

  function commonDatesFor(ids, startDate, endDate) {
    const uniqueIds = [...new Set(ids)];
    const dateCandidates = new Set();
    uniqueIds.forEach((id, index) => {
      const asset = state.assets[id];
      if (!asset) return;
      if (index === 0) {
        asset.returnMap.forEach((_, date) => dateCandidates.add(date));
      } else {
        [...dateCandidates].forEach((date) => {
          if (!asset.returnMap.has(date)) dateCandidates.delete(date);
        });
      }
    });
    return [...dateCandidates].filter((date) => date >= startDate && date <= endDate).sort();
  }

  function isRebalanceMonth(mode, index) {
    if (index === 0 || mode === "none") return false;
    if (mode === "monthly") return true;
    if (mode === "quarterly") return index % 3 === 0;
    if (mode === "semiannual") return index % 6 === 0;
    if (mode === "annual") return index % 12 === 0;
    return false;
  }

  function runBacktest() {
    const settings = gatherBacktestSettings();
    const totalWeight = sum(settings.allocations.map((item) => item.weight));
    if (Math.abs(totalWeight - 1) > 0.0001) {
      $("#formError").textContent = "자산 비중의 합계를 100%로 맞춰주세요.";
      return;
    }
    if (!settings.startDate || !settings.endDate || settings.startDate >= settings.endDate) {
      $("#formError").textContent = "종료월은 시작월보다 뒤여야 합니다.";
      return;
    }
    if (settings.initialAmount < 0 || settings.monthlyContribution < 0) {
      $("#formError").textContent = "투자금은 0원 이상이어야 합니다.";
      return;
    }

    const ids = [...settings.allocations.map((item) => item.assetId), settings.benchmarkId];
    const dates = commonDatesFor(ids, settings.startDate, settings.endDate);
    if (dates.length < 12) {
      $("#formError").textContent = "선택한 자산들의 공통 데이터가 12개월 미만입니다.";
      return;
    }
    $("#formError").textContent = "";

    const costRate = settings.tradingCostBps / 10000;
    let holdings = settings.allocations.map((item) => settings.initialAmount * item.weight);
    let principal = settings.initialAmount;
    let benchmarkBalance = settings.initialAmount;
    let totalTradingCost = 0;
    let totalContributionCost = 0;
    let unitIndex = 100;
    let benchmarkIndex = 100;
    const monthlyReturns = [];
    const benchmarkReturns = [];
    const series = [];
    const cashflows = [{ t: 0, amount: -settings.initialAmount }];

    dates.forEach((date, index) => {
      const scheduledContribution = settings.monthlyContribution;
      if (settings.contributionTiming === "start" && scheduledContribution > 0) {
        const contributionCost = scheduledContribution * costRate;
        const net = scheduledContribution - contributionCost;
        holdings = holdings.map((value, i) => value + net * settings.allocations[i].weight);
        benchmarkBalance += scheduledContribution;
        principal += scheduledContribution;
        totalContributionCost += contributionCost;
        cashflows.push({ t: index, amount: -scheduledContribution });
      }

      const startBalance = sum(holdings);
      const benchmarkStart = benchmarkBalance;
      holdings = holdings.map((value, i) => value * (1 + state.assets[settings.allocations[i].assetId].returnMap.get(date)));
      benchmarkBalance *= 1 + state.assets[settings.benchmarkId].returnMap.get(date);

      if (isRebalanceMonth(settings.rebalance, index)) {
        const beforeRebalance = sum(holdings);
        const targets = settings.allocations.map((item) => beforeRebalance * item.weight);
        const turnover = sum(targets.map((target, i) => Math.abs(target - holdings[i]))) / 2;
        const rebalanceCost = turnover * costRate;
        totalTradingCost += rebalanceCost;
        const afterCost = Math.max(0, beforeRebalance - rebalanceCost);
        holdings = settings.allocations.map((item) => afterCost * item.weight);
      }

      const endBeforeContribution = sum(holdings);
      const monthReturn = startBalance > 0 ? endBeforeContribution / startBalance - 1 : 0;
      const benchmarkReturn = benchmarkStart > 0 ? benchmarkBalance / benchmarkStart - 1 : 0;
      monthlyReturns.push(monthReturn);
      benchmarkReturns.push(benchmarkReturn);
      unitIndex *= 1 + monthReturn;
      benchmarkIndex *= 1 + benchmarkReturn;

      if (settings.contributionTiming === "end" && scheduledContribution > 0) {
        const contributionCost = scheduledContribution * costRate;
        const net = scheduledContribution - contributionCost;
        holdings = holdings.map((value, i) => value + net * settings.allocations[i].weight);
        benchmarkBalance += scheduledContribution;
        principal += scheduledContribution;
        totalContributionCost += contributionCost;
        cashflows.push({ t: index + 1, amount: -scheduledContribution });
      }

      const balance = sum(holdings);
      const years = (index + 1) / 12;
      const realBalance = balance / Math.pow(1 + settings.inflationRate, years);
      series.push({
        date,
        balance,
        principal,
        benchmarkBalance,
        realBalance,
        unitIndex,
        benchmarkIndex,
      });
    });

    const finalBalance = series.at(-1).balance;
    cashflows.push({ t: dates.length, amount: finalBalance });
    const metrics = calculateMetrics(monthlyReturns, benchmarkReturns, settings.riskFreeRate, series, cashflows);
    metrics.finalBalance = finalBalance;
    metrics.principal = series.at(-1).principal;
    metrics.realFinalBalance = series.at(-1).realBalance;
    metrics.benchmarkFinal = series.at(-1).benchmarkBalance;
    metrics.totalTradingCost = totalTradingCost + totalContributionCost;
    metrics.rebalanceCost = totalTradingCost;
    metrics.contributionCost = totalContributionCost;

    const annualReturns = annualReturnRows(dates, monthlyReturns, benchmarkReturns);
    const drawdowns = drawdownSeries(series.map((point) => point.unitIndex));
    const riskContributions = calculateRiskContributions(settings.allocations, dates);
    const correlations = correlationMatrix(settings.allocations.map((item) => item.assetId), dates);

    state.lastBacktest = {
      settings,
      dates,
      series,
      monthlyReturns,
      benchmarkReturns,
      metrics,
      annualReturns,
      drawdowns,
      riskContributions,
      correlations,
    };

    renderBacktestResults();
    $("#mcInitial").value = Math.round(finalBalance);
    showToast(`${dates.length}개월 백테스트를 계산했습니다.`);
  }

  function calculateMetrics(returns, benchmarkReturns, riskFreeAnnual, series, cashflows) {
    const count = returns.length;
    const totalReturn = returns.reduce((acc, value) => acc * (1 + value), 1) - 1;
    const annualizedReturn = Math.pow(1 + totalReturn, 12 / count) - 1;
    const monthlyMean = mean(returns);
    const monthlyStd = standardDeviation(returns);
    const volatility = monthlyStd * Math.sqrt(12);
    const monthlyRf = Math.pow(1 + riskFreeAnnual, 1 / 12) - 1;
    const excess = returns.map((value) => value - monthlyRf);
    const sharpe = monthlyStd > 0 ? mean(excess) / monthlyStd * Math.sqrt(12) : NaN;
    const downsideValues = returns.map((value) => Math.min(0, value - monthlyRf));
    const downsideDeviation = Math.sqrt(mean(downsideValues.map((value) => value * value))) * Math.sqrt(12);
    const sortino = downsideDeviation > 0 ? (annualizedReturn - riskFreeAnnual) / downsideDeviation : NaN;
    const benchmarkTotal = benchmarkReturns.reduce((acc, value) => acc * (1 + value), 1) - 1;
    const benchmarkAnnualized = Math.pow(1 + benchmarkTotal, 12 / count) - 1;
    const maxDrawdownInfo = maxDrawdownDetails(series.map((point) => point.unitIndex));
    const mwrr = monthlyIrr(cashflows);
    const corrBenchmark = correlation(returns, benchmarkReturns);
    const beta = variance(benchmarkReturns) > 0 ? covariance(returns, benchmarkReturns) / variance(benchmarkReturns) : NaN;
    return {
      totalReturn,
      annualizedReturn,
      mwrr,
      volatility,
      sharpe,
      sortino,
      benchmarkAnnualized,
      maxDrawdown: maxDrawdownInfo.maxDrawdown,
      drawdownPeakIndex: maxDrawdownInfo.peakIndex,
      drawdownTroughIndex: maxDrawdownInfo.troughIndex,
      recoveryIndex: maxDrawdownInfo.recoveryIndex,
      recoveryMonths: maxDrawdownInfo.recoveryMonths,
      drawdownMonths: maxDrawdownInfo.drawdownMonths,
      correlationBenchmark: corrBenchmark,
      beta,
    };
  }

  function standardDeviation(values) {
    if (values.length < 2) return 0;
    const avg = mean(values);
    return Math.sqrt(values.reduce((acc, value) => acc + Math.pow(value - avg, 2), 0) / (values.length - 1));
  }

  function variance(values) {
    const std = standardDeviation(values);
    return std * std;
  }

  function covariance(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return 0;
    const ma = mean(a.slice(0, n));
    const mb = mean(b.slice(0, n));
    let total = 0;
    for (let i = 0; i < n; i += 1) total += (a[i] - ma) * (b[i] - mb);
    return total / (n - 1);
  }

  function correlation(a, b) {
    const denom = standardDeviation(a) * standardDeviation(b);
    return denom > 0 ? covariance(a, b) / denom : 0;
  }

  function monthlyIrr(cashflows) {
    const npv = (rate) => cashflows.reduce((total, flow) => total + flow.amount / Math.pow(1 + rate, flow.t), 0);
    let low = -0.5;
    let high = 0.1;
    let lowValue = npv(low);
    let highValue = npv(high);
    let attempts = 0;
    while (lowValue * highValue > 0 && attempts < 30) {
      high = high * 1.8 + 0.05;
      highValue = npv(high);
      attempts += 1;
    }
    if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return NaN;
    for (let i = 0; i < 120; i += 1) {
      const mid = (low + high) / 2;
      const midValue = npv(mid);
      if (Math.abs(midValue) < 0.01) return Math.pow(1 + mid, 12) - 1;
      if (lowValue * midValue <= 0) {
        high = mid;
        highValue = midValue;
      } else {
        low = mid;
        lowValue = midValue;
      }
    }
    const monthly = (low + high) / 2;
    return Math.pow(1 + monthly, 12) - 1;
  }

  function maxDrawdownDetails(indexValues) {
    let peakValue = indexValues[0] || 100;
    let peakIndex = 0;
    let maxDrawdown = 0;
    let maxPeakIndex = 0;
    let troughIndex = 0;
    for (let i = 0; i < indexValues.length; i += 1) {
      if (indexValues[i] > peakValue) {
        peakValue = indexValues[i];
        peakIndex = i;
      }
      const drawdown = peakValue > 0 ? indexValues[i] / peakValue - 1 : 0;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
        maxPeakIndex = peakIndex;
        troughIndex = i;
      }
    }
    const recoveryTarget = indexValues[maxPeakIndex];
    let recoveryIndex = null;
    for (let i = troughIndex + 1; i < indexValues.length; i += 1) {
      if (indexValues[i] >= recoveryTarget) { recoveryIndex = i; break; }
    }
    return {
      maxDrawdown,
      peakIndex: maxPeakIndex,
      troughIndex,
      recoveryIndex,
      drawdownMonths: troughIndex - maxPeakIndex,
      recoveryMonths: recoveryIndex === null ? null : recoveryIndex - troughIndex,
    };
  }

  function drawdownSeries(indexValues) {
    let peak = indexValues[0] || 100;
    return indexValues.map((value) => {
      peak = Math.max(peak, value);
      return peak > 0 ? value / peak - 1 : 0;
    });
  }

  function annualReturnRows(dates, returns, benchmarkReturns) {
    const groups = new Map();
    dates.forEach((date, index) => {
      const year = date.slice(0, 4);
      if (!groups.has(year)) groups.set(year, { portfolio: [], benchmark: [] });
      groups.get(year).portfolio.push(returns[index]);
      groups.get(year).benchmark.push(benchmarkReturns[index]);
    });
    return [...groups.entries()].map(([year, values]) => {
      const portfolio = values.portfolio.reduce((acc, value) => acc * (1 + value), 1) - 1;
      const benchmark = values.benchmark.reduce((acc, value) => acc * (1 + value), 1) - 1;
      return { year, portfolio, benchmark, spread: portfolio - benchmark };
    });
  }

  function calculateRiskContributions(allocations, dates) {
    const arrays = allocations.map((item) => dates.map((date) => state.assets[item.assetId].returnMap.get(date)));
    const n = allocations.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) matrix[i][j] = covariance(arrays[i], arrays[j]);
    }
    const weights = allocations.map((item) => item.weight);
    const sigmaW = matrix.map((row) => row.reduce((total, value, index) => total + value * weights[index], 0));
    const portfolioVariance = weights.reduce((total, weight, index) => total + weight * sigmaW[index], 0);
    return allocations.map((item, index) => ({
      assetId: item.assetId,
      weight: item.weight,
      contribution: portfolioVariance > 0 ? item.weight * sigmaW[index] / portfolioVariance : 0,
    }));
  }

  function correlationMatrix(ids, dates) {
    const arrays = ids.map((id) => dates.map((date) => state.assets[id].returnMap.get(date)));
    return ids.map((id, i) => ({
      id,
      values: ids.map((_, j) => correlation(arrays[i], arrays[j])),
    }));
  }

  function rebalanceLabel(value) {
    return ({ none: "리밸런싱 없음", monthly: "매월 리밸런싱", quarterly: "분기 리밸런싱", semiannual: "반기 리밸런싱", annual: "연 1회 리밸런싱" })[value] || value;
  }

  function renderBacktestResults() {
    const result = state.lastBacktest;
    if (!result) return;
    const { settings, dates, metrics, annualReturns } = result;
    $("#resultTitle").textContent = settings.name;
    $("#resultPeriod").textContent = `${fmtDate(dates[0])} – ${fmtDate(dates.at(-1))} · ${rebalanceLabel(settings.rebalance)}`;

    const gain = metrics.finalBalance - metrics.principal;
    const benchmarkGap = metrics.annualizedReturn - metrics.benchmarkAnnualized;
    const cards = [
      { label: "최종 자산", value: fmtCompactKRW(metrics.finalBalance), sub: `순수익 ${fmtCompactKRW(gain)}`, tone: "", help: "납입 원금과 투자 손익을 합친 명목 자산" },
      { label: "납입 원금", value: fmtCompactKRW(metrics.principal), sub: `거래비용 ${fmtCompactKRW(metrics.totalTradingCost)}`, tone: "blue", help: "초기 투자금과 월 적립금의 합계" },
      { label: "연환산 수익률 · TWRR", value: fmtPct(metrics.annualizedReturn, 2), sub: `벤치마크 대비 ${fmtPp(benchmarkGap, 2)}`, tone: "", help: "입출금 영향을 제거한 시간가중수익률" },
      { label: "투자자 수익률 · MWRR", value: fmtPct(metrics.mwrr, 2), sub: "실제 납입 시점을 반영", tone: "blue", help: "현금흐름을 반영한 내부수익률" },
      { label: "최대 낙폭 · MDD", value: fmtPct(metrics.maxDrawdown, 1), sub: `저점까지 ${metrics.drawdownMonths}개월`, tone: "red", help: "과거 고점에서 가장 크게 하락한 비율" },
      { label: "연환산 변동성", value: fmtPct(metrics.volatility, 1), sub: `베타 ${fmtNumber(metrics.beta, 2)}`, tone: "orange", help: "월 수익률 표준편차를 연율화" },
      { label: "샤프지수", value: fmtNumber(metrics.sharpe, 2), sub: `소르티노 ${fmtNumber(metrics.sortino, 2)}`, tone: "", help: "무위험수익률 대비 위험 보상" },
      { label: "실질 최종자산", value: fmtCompactKRW(metrics.realFinalBalance), sub: `물가 ${fmtPct(settings.inflationRate, 1)} 가정`, tone: "orange", help: "입력한 물가상승률로 할인한 현재가치" },
    ];
    $("#metricCards").innerHTML = cards.map((card) => `<article class="metric-card card ${card.tone}">
      <div class="metric-label">${escapeHtml(card.label)} <span class="metric-info" title="${escapeHtml(card.help)}">i</span></div>
      <strong class="metric-value" title="${escapeHtml(card.value)}">${escapeHtml(card.value)}</strong>
      <div class="metric-sub">${escapeHtml(card.sub)}</div>
    </article>`).join("");

    const benchmarkAsset = state.assets[settings.benchmarkId];
    $("#growthLegend").innerHTML = [
      ["포트폴리오", cssVar("--accent"), "line"],
      [benchmarkAsset.name, cssVar("--blue"), "line"],
      ["납입 원금", cssVar("--muted-2"), "dash"],
    ].map(([label, color, type]) => `<span class="legend-item"><i class="${type === "dash" ? "legend-dash" : "legend-line"}" style="${type === "dash" ? `color:${color}` : `background:${color}`}"></i>${escapeHtml(label)}</span>`).join("");

    setLineChart("growthChart", {
      labels: dates,
      data: result.series,
      series: [
        { key: "balance", label: "포트폴리오", color: cssVar("--accent"), width: 2.3, fill: true },
        { key: "benchmarkBalance", label: benchmarkAsset.name, color: cssVar("--blue"), width: 1.6 },
        { key: "principal", label: "납입 원금", color: cssVar("--muted-2"), width: 1.2, dash: [5, 5] },
      ],
      yFormatter: fmtCompactKRW,
      tooltipFormatter: fmtKRW,
      tooltipId: "growthTooltip",
      yMin: 0,
    });

    const peakDate = dates[metrics.drawdownPeakIndex];
    const troughDate = dates[metrics.drawdownTroughIndex];
    $("#drawdownSummary").textContent = `${fmtDate(peakDate)} → ${fmtDate(troughDate)} ${fmtPct(metrics.maxDrawdown, 1)}`;
    setLineChart("drawdownChart", {
      labels: dates,
      data: result.drawdowns.map((value, index) => ({ value, date: dates[index] })),
      series: [{ key: "value", label: "낙폭", color: cssVar("--red"), width: 1.7, fill: true }],
      yFormatter: (value) => fmtPct(value, 0),
      tooltipFormatter: (value) => fmtPct(value, 2),
      tooltipId: "drawdownTooltip",
      yMax: 0,
    });

    renderRiskSnapshot();
    $("#annualReturnsBody").innerHTML = annualReturns.slice().reverse().map((row) => {
      const label = row.spread > 0.02 ? ["우위", "good"] : row.spread < -0.02 ? ["열위", "bad"] : ["유사", "neutral"];
      return `<tr><td>${row.year}</td><td class="${row.portfolio >= 0 ? "return-positive" : "return-negative"}">${fmtPct(row.portfolio, 1)}</td><td class="${row.benchmark >= 0 ? "return-positive" : "return-negative"}">${fmtPct(row.benchmark, 1)}</td><td class="${row.spread >= 0 ? "return-positive" : "return-negative"}">${fmtPp(row.spread, 1)}</td><td><span class="eval-pill ${label[1]}">${label[0]}</span></td></tr>`;
    }).join("");

    renderAllocation();
    renderRiskContributions();
    renderCorrelationMatrix("#correlationMatrix", settings.allocations.map((item) => item.assetId), result.correlations);
    renderInsights();
    renderComparison();
    renderDataTable();
  }

  function iconSvg(type) {
    const icons = {
      down: '<svg viewBox="0 0 24 24"><path d="M4 7l6 6 4-4 6 6"/><path d="M15 15h5v-5"/></svg>',
      time: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>',
      wave: '<svg viewBox="0 0 24 24"><path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/></svg>',
      link: '<svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 0 0 5.7.1l2.2-2.2a4 4 0 0 0-5.7-5.7L11 6.4"/><path d="M14 11a4 4 0 0 0-5.7-.1l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.2-1.2"/></svg>',
      target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
      shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3z"/></svg>',
    };
    return icons[type] || icons.shield;
  }

  function renderRiskSnapshot() {
    const { metrics, dates } = state.lastBacktest;
    const recoveryText = metrics.recoveryMonths === null ? "아직 전고점 미회복" : `${metrics.recoveryMonths}개월`;
    const items = [
      { icon: "down", tone: "red", title: "최대 낙폭", desc: `${fmtDate(dates[metrics.drawdownPeakIndex])} 고점 이후`, value: fmtPct(metrics.maxDrawdown, 1) },
      { icon: "time", tone: "blue", title: "저점 후 회복", desc: metrics.recoveryMonths === null ? "분석 종료 시점 기준" : `저점 ${fmtDate(dates[metrics.drawdownTroughIndex])}`, value: recoveryText },
      { icon: "wave", tone: "", title: "연환산 변동성", desc: "월 수익률 표준편차 기준", value: fmtPct(metrics.volatility, 1) },
      { icon: "link", tone: "blue", title: "벤치마크 상관계수", desc: "1에 가까울수록 유사하게 움직임", value: fmtNumber(metrics.correlationBenchmark, 2) },
    ];
    $("#riskSnapshot").innerHTML = items.map((item) => `<div class="risk-item"><span class="risk-icon ${item.tone}">${iconSvg(item.icon)}</span><div class="risk-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.desc)}</span></div><strong class="risk-value">${escapeHtml(item.value)}</strong></div>`).join("");
  }

  function renderAllocation() {
    const allocations = state.lastBacktest.settings.allocations;
    let cursor = 0;
    const stops = [];
    allocations.forEach((item) => {
      const asset = state.assets[item.assetId];
      const start = cursor;
      cursor += item.weight * 100;
      stops.push(`${asset.color} ${start}% ${cursor}%`);
    });
    $("#allocationDonut").style.background = `conic-gradient(${stops.join(",")})`;
    $("#allocationLegend").innerHTML = allocations.map((item) => {
      const asset = state.assets[item.assetId];
      return `<div class="allocation-legend-item"><i style="background:${asset.color}"></i><span title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</span><strong>${(item.weight * 100).toFixed(1)}%</strong></div>`;
    }).join("");
  }

  function renderRiskContributions() {
    const items = state.lastBacktest.riskContributions;
    const maxAbs = Math.max(...items.map((item) => Math.abs(item.contribution)), 0.01);
    $("#riskContribution").innerHTML = items.map((item) => {
      const asset = state.assets[item.assetId];
      const width = Math.abs(item.contribution) / maxAbs * 100;
      return `<div class="bar-item"><div class="bar-label"><span>${escapeHtml(asset.name)}</span><strong>${fmtPct(item.contribution, 1)}</strong></div><div class="bar-track"><span style="width:${width}%;background:${asset.color}"></span></div></div>`;
    }).join("");
  }

  function correlationCellColor(value) {
    if (value >= 0) {
      const alpha = 0.08 + Math.abs(value) * 0.42;
      return `rgba(69, 227, 181, ${alpha.toFixed(2)})`;
    }
    const alpha = 0.08 + Math.abs(value) * 0.42;
    return `rgba(255, 127, 140, ${alpha.toFixed(2)})`;
  }

  function renderCorrelationMatrix(selector, ids, matrix) {
    const target = $(selector);
    if (!target) return;
    const header = ids.map((id) => `<th>${escapeHtml(state.assets[id].name)}</th>`).join("");
    const rows = matrix.map((row) => `<tr><th>${escapeHtml(state.assets[row.id].name)}</th>${row.values.map((value) => `<td style="background:${correlationCellColor(value)}">${value.toFixed(2)}</td>`).join("")}</tr>`).join("");
    target.innerHTML = `<table class="correlation-table"><thead><tr><th></th>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderInsights() {
    const result = state.lastBacktest;
    const { metrics, settings, riskContributions } = result;
    const topRisk = riskContributions.slice().sort((a, b) => b.contribution - a.contribution)[0];
    const gain = metrics.finalBalance - metrics.principal;
    const benchmarkGap = metrics.annualizedReturn - metrics.benchmarkAnnualized;
    const recovery = metrics.recoveryMonths === null ? "분석 종료일까지 전고점을 회복하지 못했습니다." : `저점 이후 ${metrics.recoveryMonths}개월 만에 전고점을 회복했습니다.`;
    const costRatio = metrics.principal > 0 ? metrics.totalTradingCost / metrics.principal : 0;
    const insights = [
      { title: "수익과 현금흐름을 분리해서 보세요", body: `입출금 영향을 제거한 TWRR은 ${fmtPct(metrics.annualizedReturn, 2)}, 실제 납입 시점을 반영한 MWRR은 ${fmtPct(metrics.mwrr, 2)}입니다. 두 값의 차이는 적립 시점과 시장 경로에서 발생합니다.` },
      { title: `${state.assets[topRisk.assetId].name}이 위험을 가장 많이 설명합니다`, body: `목표 비중은 ${fmtPct(topRisk.weight, 1)}지만 추정 위험 기여도는 ${fmtPct(topRisk.contribution, 1)}입니다. 비중과 위험 기여도는 같지 않습니다.` },
      { title: `최악의 구간은 ${fmtPct(metrics.maxDrawdown, 1)}였습니다`, body: `고점에서 저점까지 ${metrics.drawdownMonths}개월이 걸렸고, ${recovery} 실제 투자에서는 이 구간의 행동 가능성을 먼저 검토해야 합니다.` },
      { title: `누적 손익 ${fmtCompactKRW(gain)}, 비용 ${fmtCompactKRW(metrics.totalTradingCost)}`, body: `입력한 ${settings.tradingCostBps.toFixed(1)}bp 거래비용 기준이며 원금 대비 비용은 ${fmtPct(costRatio, 3)}입니다. 벤치마크 대비 연환산 차이는 ${fmtPp(benchmarkGap, 2)}입니다.` },
    ];
    $("#insightCards").innerHTML = insights.map((item, index) => `<article class="insight-card card"><span class="insight-number">INSIGHT ${String(index + 1).padStart(2, "0")}</span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.body)}</p></article>`).join("");
  }

  function setLineChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    config.hoverIndex = null;
    canvas.__chartConfig = config;
    state.chartConfigs.set(canvasId, { type: "line", config });
    bindLineChartInteractions(canvas);
    drawLineChart(canvas, config);
  }

  function bindLineChartInteractions(canvas) {
    if (canvas.__lineBound) return;
    canvas.__lineBound = true;
    canvas.addEventListener("mousemove", (event) => {
      const config = canvas.__chartConfig;
      if (!config || !config.data?.length) return;
      const rect = canvas.getBoundingClientRect();
      const margin = { left: 58, right: 15 };
      const plotWidth = rect.width - margin.left - margin.right;
      const x = clamp(event.clientX - rect.left - margin.left, 0, plotWidth);
      config.hoverIndex = Math.round(x / Math.max(1, plotWidth) * (config.data.length - 1));
      drawLineChart(canvas, config);
      showLineTooltip(canvas, config, event);
    });
    canvas.addEventListener("mouseleave", () => {
      const config = canvas.__chartConfig;
      if (!config) return;
      config.hoverIndex = null;
      drawLineChart(canvas, config);
      const tooltip = document.getElementById(config.tooltipId);
      if (tooltip) tooltip.style.display = "none";
    });
  }

  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(10, Math.floor(rect.width));
    const height = Math.max(10, Math.floor(rect.height));
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function drawLineChart(canvas, config) {
    const { ctx, width, height } = resizeCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    if (!config.data?.length) return;
    const margin = { left: 58, right: 15, top: 14, bottom: 30 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = config.series.flatMap((series) => config.data.map((row) => Number(row[series.key])).filter(Number.isFinite));
    let min = config.yMin ?? Math.min(...values);
    let max = config.yMax ?? Math.max(...values);
    if (config.yMin === undefined && min > 0) min = min * 0.92;
    if (config.yMax === undefined && max < 0) max = max * 0.92;
    if (Math.abs(max - min) < 1e-9) { max += 1; min -= 1; }
    const padding = (max - min) * 0.06;
    if (config.yMin === undefined) min -= padding;
    if (config.yMax === undefined) max += padding;
    const xFor = (index) => margin.left + (index / Math.max(1, config.data.length - 1)) * plotWidth;
    const yFor = (value) => margin.top + (max - value) / (max - min) * plotHeight;

    ctx.font = '9px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    const grid = cssVar("--grid-line");
    const muted = cssVar("--muted-2");
    for (let i = 0; i <= 4; i += 1) {
      const y = margin.top + plotHeight * i / 4;
      const value = max - (max - min) * i / 4;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width - margin.right, y); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.textAlign = "right";
      ctx.fillText(config.yFormatter ? config.yFormatter(value) : value.toFixed(1), margin.left - 8, y);
    }
    const labelCount = width < 520 ? 4 : 6;
    for (let i = 0; i < labelCount; i += 1) {
      const index = Math.round(i * (config.labels.length - 1) / Math.max(1, labelCount - 1));
      const x = xFor(index);
      ctx.fillStyle = muted;
      ctx.textAlign = i === 0 ? "left" : i === labelCount - 1 ? "right" : "center";
      ctx.fillText(config.labels[index].replace("-", "."), x, height - 11);
    }

    config.series.forEach((series, seriesIndex) => {
      const points = config.data.map((row, index) => [xFor(index), yFor(row[series.key])]);
      if (series.fill && points.length) {
        const gradient = ctx.createLinearGradient(0, margin.top, 0, margin.top + plotHeight);
        gradient.addColorStop(0, hexToRgba(series.color, seriesIndex === 0 ? 0.19 : 0.12));
        gradient.addColorStop(1, hexToRgba(series.color, 0));
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
      ctx.strokeStyle = series.color;
      ctx.lineWidth = series.width || 1.7;
      ctx.setLineDash(series.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if (config.hoverIndex !== null && config.hoverIndex >= 0) {
      const index = clamp(config.hoverIndex, 0, config.data.length - 1);
      const x = xFor(index);
      ctx.strokeStyle = cssVar("--border-strong");
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + plotHeight); ctx.stroke();
      ctx.setLineDash([]);
      config.series.forEach((series) => {
        const value = config.data[index][series.key];
        const y = yFor(value);
        ctx.fillStyle = series.color;
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = cssVar("--surface"); ctx.lineWidth = 2; ctx.stroke();
      });
    }
  }

  function showLineTooltip(canvas, config, event) {
    const tooltip = document.getElementById(config.tooltipId);
    if (!tooltip) return;
    const index = clamp(config.hoverIndex, 0, config.data.length - 1);
    const row = config.data[index];
    const date = config.labels[index];
    tooltip.innerHTML = `<strong>${escapeHtml(fmtDate(date))}</strong>${config.series.map((series) => `<div class="tip-row"><span><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${series.color};margin-right:5px"></i>${escapeHtml(series.label)}</span><b>${escapeHtml(config.tooltipFormatter ? config.tooltipFormatter(row[series.key]) : String(row[series.key]))}</b></div>`).join("")}`;
    tooltip.style.display = "block";
    const wrapRect = canvas.parentElement.getBoundingClientRect();
    const x = event.clientX - wrapRect.left;
    const y = event.clientY - wrapRect.top;
    const tooltipWidth = tooltip.offsetWidth || 160;
    tooltip.style.left = `${clamp(x + 12, 6, wrapRect.width - tooltipWidth - 6)}px`;
    tooltip.style.top = `${clamp(y - 20, 6, wrapRect.height - 100)}px`;
  }

  function hexToRgba(color, alpha) {
    if (!color?.startsWith("#")) return `rgba(69,227,181,${alpha})`;
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split("").map((char) => char + char).join("");
    const value = parseInt(hex, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function runMonteCarlo() {
    if (!state.lastBacktest) runBacktest();
    const sourceReturns = state.lastBacktest?.monthlyReturns || [];
    if (sourceReturns.length < 12) {
      showToast("먼저 12개월 이상의 백테스트를 실행하세요.");
      return;
    }
    const initial = Number($("#mcInitial").value);
    const contribution = Number($("#mcContribution").value);
    const withdrawal = Number($("#mcWithdrawal").value);
    const goal = Number($("#mcGoal").value);
    const years = Number($("#mcYears").value);
    const simulations = Number($("#mcSimulations").value);
    const method = $("#mcMethod").value;
    const months = years * 12;
    const random = mulberry32((Date.now() >>> 0) ^ 0xA53C9E1B);
    const avg = mean(sourceReturns);
    const std = standardDeviation(sourceReturns);
    const paths = [];
    let ruinCount = 0;

    for (let s = 0; s < simulations; s += 1) {
      let value = initial;
      let ruined = false;
      const path = [value];
      for (let m = 0; m < months; m += 1) {
        value += contribution;
        const sampledReturn = method === "normal"
          ? clamp(avg + normalRandom(random) * std, -0.75, 0.75)
          : sourceReturns[Math.floor(random() * sourceReturns.length)];
        value *= 1 + sampledReturn;
        value -= withdrawal;
        if (value <= 0) {
          value = 0;
          ruined = true;
        }
        path.push(value);
      }
      if (ruined) ruinCount += 1;
      paths.push(path);
    }

    const percentileSeries = [];
    for (let m = 0; m <= months; m += 1) {
      const values = paths.map((path) => path[m]).sort((a, b) => a - b);
      percentileSeries.push({
        month: m,
        p10: quantileSorted(values, 0.10),
        p25: quantileSorted(values, 0.25),
        p50: quantileSorted(values, 0.50),
        p75: quantileSorted(values, 0.75),
        p90: quantileSorted(values, 0.90),
      });
    }
    const finals = paths.map((path) => path.at(-1)).sort((a, b) => a - b);
    const goalProbability = finals.filter((value) => value >= goal).length / simulations;
    state.monteCarlo = {
      initial, contribution, withdrawal, goal, years, simulations, method,
      percentileSeries,
      goalProbability,
      ruinProbability: ruinCount / simulations,
      medianFinal: quantileSorted(finals, 0.5),
      p10Final: quantileSorted(finals, 0.1),
      p90Final: quantileSorted(finals, 0.9),
    };
    renderMonteCarlo();
    showToast(`${simulations.toLocaleString()}개 경로를 계산했습니다.`);
  }

  function quantileSorted(sortedValues, q) {
    if (!sortedValues.length) return NaN;
    const position = (sortedValues.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sortedValues[base + 1] !== undefined ? sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base]) : sortedValues[base];
  }

  function renderMonteCarlo() {
    const mc = state.monteCarlo;
    if (!mc) return;
    const cards = [
      { label: "목표 달성 확률", value: fmtPct(mc.goalProbability, 1), sub: `목표 ${fmtCompactKRW(mc.goal)}`, tone: mc.goalProbability >= 0.7 ? "" : "orange" },
      { label: "중앙값 최종자산", value: fmtCompactKRW(mc.medianFinal), sub: "50번째 백분위", tone: "blue" },
      { label: "하방 10% 자산", value: fmtCompactKRW(mc.p10Final), sub: "10번째 백분위", tone: "red" },
      { label: "자산 고갈 확률", value: fmtPct(mc.ruinProbability, 1), sub: mc.withdrawal > 0 ? "인출 시나리오" : "인출 없음", tone: "red" },
    ];
    $("#mcMetricCards").innerHTML = cards.map((card) => `<article class="metric-card card ${card.tone}"><div class="metric-label">${escapeHtml(card.label)}</div><strong class="metric-value">${escapeHtml(card.value)}</strong><div class="metric-sub">${escapeHtml(card.sub)}</div></article>`).join("");
    $("#mcLegend").innerHTML = [
      ["P10–P90", cssVar("--blue")], ["P25–P75", cssVar("--accent")], ["중앙값", cssVar("--accent")],
    ].map(([label, color], index) => `<span class="legend-item"><i class="${index === 2 ? "legend-line" : "legend-line"}" style="background:${color};opacity:${index === 0 ? .35 : index === 1 ? .6 : 1}"></i>${label}</span>`).join("");
    setFanChart("mcChart", mc);

    const requiredMonthly = mc.years > 0 ? Math.max(0, (mc.goal - mc.initial) / (mc.years * 12)) : 0;
    const items = [
      { icon: "target", tone: "", title: "목표 달성", desc: `${mc.years}년 뒤 ${fmtCompactKRW(mc.goal)} 이상`, value: fmtPct(mc.goalProbability, 1) },
      { icon: "shield", tone: "blue", title: "중앙 경로", desc: "절반의 경로가 이 값 이상", value: fmtCompactKRW(mc.medianFinal) },
      { icon: "down", tone: "red", title: "보수적 경로", desc: "10% 경로는 이 값 이하", value: fmtCompactKRW(mc.p10Final) },
      { icon: "time", tone: "blue", title: "단순 필요 적립", desc: "수익률을 무시한 참고치", value: `${fmtCompactKRW(requiredMonthly)}/월` },
    ];
    $("#mcInsights").innerHTML = items.map((item) => `<div class="risk-item"><span class="risk-icon ${item.tone}">${iconSvg(item.icon)}</span><div class="risk-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.desc)}</span></div><strong class="risk-value">${escapeHtml(item.value)}</strong></div>`).join("");
  }

  function setFanChart(canvasId, mc) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const config = { mc, hoverIndex: null, tooltipId: "mcTooltip" };
    canvas.__fanConfig = config;
    state.chartConfigs.set(canvasId, { type: "fan", config });
    if (!canvas.__fanBound) {
      canvas.__fanBound = true;
      canvas.addEventListener("mousemove", (event) => {
        const cfg = canvas.__fanConfig;
        if (!cfg) return;
        const rect = canvas.getBoundingClientRect();
        const margin = { left: 60, right: 15 };
        const plotWidth = rect.width - margin.left - margin.right;
        const x = clamp(event.clientX - rect.left - margin.left, 0, plotWidth);
        cfg.hoverIndex = Math.round(x / Math.max(1, plotWidth) * (cfg.mc.percentileSeries.length - 1));
        drawFanChart(canvas, cfg);
        showFanTooltip(canvas, cfg, event);
      });
      canvas.addEventListener("mouseleave", () => {
        const cfg = canvas.__fanConfig;
        if (!cfg) return;
        cfg.hoverIndex = null;
        drawFanChart(canvas, cfg);
        $("#mcTooltip").style.display = "none";
      });
    }
    drawFanChart(canvas, config);
  }

  function drawFanChart(canvas, config) {
    const { ctx, width, height } = resizeCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    const data = config.mc.percentileSeries;
    if (!data.length) return;
    const margin = { left: 60, right: 15, top: 16, bottom: 31 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const min = 0;
    const max = Math.max(...data.map((row) => row.p90), config.mc.goal) * 1.06;
    const xFor = (index) => margin.left + index / Math.max(1, data.length - 1) * plotWidth;
    const yFor = (value) => margin.top + (max - value) / Math.max(1, max - min) * plotHeight;
    const grid = cssVar("--grid-line");
    const muted = cssVar("--muted-2");
    ctx.font = '9px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const y = margin.top + plotHeight * i / 4;
      const value = max - max * i / 4;
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width - margin.right, y); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = "right"; ctx.fillText(fmtCompactKRW(value), margin.left - 8, y);
    }
    const yearSteps = width < 520 ? 4 : 6;
    for (let i = 0; i < yearSteps; i += 1) {
      const month = Math.round(i * (data.length - 1) / Math.max(1, yearSteps - 1));
      ctx.fillStyle = muted; ctx.textAlign = i === 0 ? "left" : i === yearSteps - 1 ? "right" : "center";
      ctx.fillText(`${Math.round(month / 12)}년`, xFor(month), height - 11);
    }

    drawBand(ctx, data, xFor, yFor, "p90", "p10", hexToRgba(cssVar("--blue"), 0.12));
    drawBand(ctx, data, xFor, yFor, "p75", "p25", hexToRgba(cssVar("--accent"), 0.20));

    ctx.strokeStyle = cssVar("--accent"); ctx.lineWidth = 2.2; ctx.beginPath();
    data.forEach((row, index) => index === 0 ? ctx.moveTo(xFor(index), yFor(row.p50)) : ctx.lineTo(xFor(index), yFor(row.p50)));
    ctx.stroke();

    if (config.mc.goal > 0) {
      const goalY = yFor(config.mc.goal);
      ctx.strokeStyle = cssVar("--orange"); ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(margin.left, goalY); ctx.lineTo(width - margin.right, goalY); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--orange"); ctx.textAlign = "right"; ctx.fillText("목표", width - margin.right, goalY - 8);
    }

    if (config.hoverIndex !== null) {
      const index = clamp(config.hoverIndex, 0, data.length - 1);
      const x = xFor(index);
      ctx.strokeStyle = cssVar("--border-strong"); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + plotHeight); ctx.stroke(); ctx.setLineDash([]);
      ["p10", "p25", "p50", "p75", "p90"].forEach((key) => {
        ctx.fillStyle = key === "p50" ? cssVar("--accent") : cssVar("--blue");
        ctx.beginPath(); ctx.arc(x, yFor(data[index][key]), key === "p50" ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  function drawBand(ctx, data, xFor, yFor, upperKey, lowerKey, fillStyle) {
    ctx.beginPath();
    data.forEach((row, index) => index === 0 ? ctx.moveTo(xFor(index), yFor(row[upperKey])) : ctx.lineTo(xFor(index), yFor(row[upperKey])));
    for (let index = data.length - 1; index >= 0; index -= 1) ctx.lineTo(xFor(index), yFor(data[index][lowerKey]));
    ctx.closePath(); ctx.fillStyle = fillStyle; ctx.fill();
  }

  function showFanTooltip(canvas, config, event) {
    const tooltip = $("#mcTooltip");
    const row = config.mc.percentileSeries[config.hoverIndex];
    const year = row.month / 12;
    tooltip.innerHTML = `<strong>${year.toFixed(year % 1 === 0 ? 0 : 1)}년 후</strong>${[["상위 10%", row.p90], ["상위 25%", row.p75], ["중앙값", row.p50], ["하위 25%", row.p25], ["하위 10%", row.p10]].map(([label, value]) => `<div class="tip-row"><span>${label}</span><b>${fmtCompactKRW(value)}</b></div>`).join("")}`;
    tooltip.style.display = "block";
    const wrapRect = canvas.parentElement.getBoundingClientRect();
    const x = event.clientX - wrapRect.left;
    const y = event.clientY - wrapRect.top;
    const tooltipWidth = tooltip.offsetWidth || 160;
    tooltip.style.left = `${clamp(x + 12, 6, wrapRect.width - tooltipWidth - 6)}px`;
    tooltip.style.top = `${clamp(y - 30, 6, wrapRect.height - 120)}px`;
  }

  function renderCompareSelector() {
    const container = $("#compareAssetSelector");
    container.innerHTML = state.assetOrder.map((id) => {
      const asset = state.assets[id];
      return `<label class="asset-check"><input type="checkbox" value="${escapeHtml(id)}" ${state.compareSelected.has(id) ? "checked" : ""}/><span class="asset-check-dot" style="background:${asset.color}"></span><span class="asset-check-copy"><strong>${escapeHtml(asset.name)}</strong><span>${escapeHtml(asset.code)} · ${escapeHtml(asset.category)}</span></span></label>`;
    }).join("");
    $$("input", container).forEach((input) => input.addEventListener("change", () => {
      const id = input.value;
      if (input.checked) {
        if (state.compareSelected.size >= 6) {
          input.checked = false;
          showToast("비교 자산은 최대 6개까지 선택할 수 있습니다.");
          return;
        }
        state.compareSelected.add(id);
      } else {
        if (state.compareSelected.size <= 2) {
          input.checked = true;
          showToast("비교 자산은 최소 2개가 필요합니다.");
          return;
        }
        state.compareSelected.delete(id);
      }
      renderComparison();
      $("#compareCount").textContent = `${state.compareSelected.size}개 선택`;
    }));
    $("#compareCount").textContent = `${state.compareSelected.size}개 선택`;
  }

  function assetMetrics(id, startDate) {
    const asset = state.assets[id];
    const dates = [...asset.returnMap.keys()].filter((date) => date >= startDate).sort();
    const returns = dates.map((date) => asset.returnMap.get(date));
    if (returns.length < 2) return null;
    let index = 100;
    const indexValues = returns.map((value) => (index *= 1 + value));
    const total = indexValues.at(-1) / 100 - 1;
    const annualized = Math.pow(1 + total, 12 / returns.length) - 1;
    const volatility = standardDeviation(returns) * Math.sqrt(12);
    const rfMonthly = Math.pow(1.03, 1 / 12) - 1;
    const sharpe = standardDeviation(returns) > 0 ? mean(returns.map((value) => value - rfMonthly)) / standardDeviation(returns) * Math.sqrt(12) : NaN;
    const mdd = maxDrawdownDetails(indexValues).maxDrawdown;
    const annual = annualReturnRows(dates, returns, returns);
    const worstYear = annual.length ? annual.slice().sort((a, b) => a.portfolio - b.portfolio)[0] : null;
    return { id, dates, returns, indexValues, annualized, volatility, sharpe, maxDrawdown: mdd, worstYear };
  }

  function renderComparison() {
    const cardsContainer = $("#comparisonCards");
    if (!cardsContainer) return;
    const startDate = $("#compareStart").value || "2016-01";
    const selected = [...state.compareSelected].filter((id) => state.assets[id]);
    const metrics = selected.map((id) => assetMetrics(id, startDate)).filter(Boolean);
    cardsContainer.innerHTML = metrics.map((metric) => {
      const asset = state.assets[metric.id];
      const path = sparklinePath(metric.indexValues, 240, 55);
      const fillPath = `${path} L 240 55 L 0 55 Z`;
      return `<article class="comparison-card card"><div class="comparison-card-head"><div><strong title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</strong><span>${escapeHtml(asset.code)} · ${metric.dates.length}개월</span></div><i class="comparison-card-dot" style="background:${asset.color}"></i></div><div class="sparkline"><svg viewBox="0 0 240 55" preserveAspectRatio="none"><path d="${fillPath}" fill="${hexToRgba(asset.color,.10)}" stroke="none"></path><path d="${path}" fill="none" stroke="${asset.color}" stroke-width="2" vector-effect="non-scaling-stroke"></path></svg></div><div class="comparison-stats"><div><span>연환산</span><strong class="${metric.annualized >= 0 ? "return-positive" : "return-negative"}">${fmtPct(metric.annualized, 1)}</strong></div><div><span>최대 낙폭</span><strong class="return-negative">${fmtPct(metric.maxDrawdown, 1)}</strong></div><div><span>변동성</span><strong>${fmtPct(metric.volatility, 1)}</strong></div><div><span>샤프</span><strong>${fmtNumber(metric.sharpe, 2)}</strong></div></div></article>`;
    }).join("");

    $("#comparisonTableBody").innerHTML = metrics.slice().sort((a, b) => b.sharpe - a.sharpe).map((metric) => {
      const asset = state.assets[metric.id];
      return `<tr><td><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${asset.color};margin-right:7px"></span>${escapeHtml(asset.name)}</td><td class="${metric.annualized >= 0 ? "return-positive" : "return-negative"}">${fmtPct(metric.annualized, 2)}</td><td>${fmtPct(metric.volatility, 2)}</td><td class="return-negative">${fmtPct(metric.maxDrawdown, 2)}</td><td>${fmtNumber(metric.sharpe, 2)}</td><td>${metric.worstYear ? `${metric.worstYear.year} · ${fmtPct(metric.worstYear.portfolio, 1)}` : "—"}</td></tr>`;
    }).join("");

    if (metrics.length >= 2) {
      const common = commonDatesFor(selected, startDate, "9999-12");
      renderCorrelationMatrix("#compareCorrelationMatrix", selected, correlationMatrix(selected, common));
    } else {
      $("#compareCorrelationMatrix").innerHTML = "";
    }
  }

  function sparklinePath(values, width, height) {
    if (!values.length) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    return values.map((value, index) => {
      const x = index / Math.max(1, values.length - 1) * width;
      const y = height - ((value - min) / Math.max(1e-9, max - min)) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && inQuotes && next === '"') { field += '"'; i += 1; }
      else if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) { row.push(field.trim()); field = ""; }
      else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(field.trim()); field = "";
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
      } else field += char;
    }
    if (field.length || row.length) { row.push(field.trim()); if (row.some((cell) => cell !== "")) rows.push(row); }
    if (rows.length < 2) throw new Error("CSV에 헤더와 데이터 행이 필요합니다.");
    const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim().toLowerCase());
    return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
  }

  function normalizeMonth(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4})[-/.]?(\d{1,2})/);
    if (!match) return null;
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return `${match[1]}-${String(month).padStart(2, "0")}`;
  }

  function sortableDateKey(value, fallbackOrder = 0) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4})[-/.]?(\d{1,2})(?:[-/.]?(\d{1,2}))?/);
    if (!match) return fallbackOrder;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3] || 1);
    return year * 10000 + month * 100 + day;
  }

  function importCsvText(text, filename = "CSV") {
    const rows = parseCsv(text);
    const hasReturn = rows.some((row) => row.return !== undefined && row.return !== "");
    const hasPrice = rows.some((row) => row.adjusted_close !== undefined || row.adj_close !== undefined || row.close !== undefined);
    if (!hasReturn && !hasPrice) throw new Error("return 또는 adjusted_close 열이 필요합니다.");
    const grouped = new Map();
    rows.forEach((row, rowIndex) => {
      const ticker = String(row.ticker || row.symbol || "").trim();
      const month = normalizeMonth(row.date);
      if (!ticker || !month) return;
      if (!grouped.has(ticker)) grouped.set(ticker, { name: row.name || ticker, values: new Map(), mode: hasReturn ? "return" : "price" });
      const group = grouped.get(ticker);
      group.name = row.name || group.name;
      const dateKey = sortableDateKey(row.date, rowIndex);
      if (group.mode === "return") {
        let value = Number(String(row.return).replace("%", ""));
        if (!Number.isFinite(value)) return;
        if (String(row.return).includes("%") || Math.abs(value) > 1) value /= 100;
        const existing = group.values.get(month);
        if (!existing || dateKey >= existing.dateKey) group.values.set(month, { value, dateKey });
      } else {
        const raw = row.adjusted_close ?? row.adj_close ?? row.close;
        const value = Number(String(raw).replaceAll(",", ""));
        if (!Number.isFinite(value) || value <= 0) return;
        const existing = group.values.get(month);
        if (!existing || dateKey >= existing.dateKey) group.values.set(month, { value, dateKey });
      }
    });
    if (!grouped.size) throw new Error("유효한 ticker·date 행을 찾지 못했습니다.");

    const importedIds = [];
    grouped.forEach((group, ticker) => {
      const sorted = [...group.values.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const returns = new Map();
      if (group.mode === "return") {
        sorted.forEach(([month, item]) => returns.set(month, item.value));
      } else {
        for (let i = 1; i < sorted.length; i += 1) {
          const previous = sorted[i - 1][1].value;
          const current = sorted[i][1].value;
          returns.set(sorted[i][0], current / previous - 1);
        }
      }
      if (returns.size < 2) return;
      const safeTicker = ticker.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").toUpperCase();
      const id = `CUSTOM_${safeTicker}`;
      const existingIndex = state.assetOrder.indexOf(id);
      const color = state.assets[id]?.color || COLORS[(state.assetOrder.length + importedIds.length) % COLORS.length];
      state.assets[id] = {
        id,
        code: ticker,
        name: group.name || ticker,
        category: "사용자 데이터",
        color,
        description: `${filename}에서 가져온 사용자 월 수익률`,
        source: "custom",
        returnMap: returns,
      };
      if (existingIndex === -1) state.assetOrder.push(id);
      importedIds.push(id);
    });
    if (!importedIds.length) throw new Error("종목별로 최소 3개의 가격 또는 2개의 수익률 관측치가 필요합니다.");
    persistCustomAssets();
    renderAllAssetDependentUi();
    $("#uploadStatus").className = "upload-status success";
    $("#uploadStatus").textContent = `${importedIds.length}개 종목을 불러왔습니다: ${importedIds.map((id) => state.assets[id].name).join(", ")}`;
    showToast(`${importedIds.length}개 사용자 자산을 추가했습니다.`);
  }

  function renderDataTable() {
    const body = $("#assetDataTableBody");
    if (!body) return;
    body.innerHTML = state.assetOrder.map((id) => {
      const asset = state.assets[id];
      const dates = [...asset.returnMap.keys()].sort();
      return `<tr><td>${escapeHtml(asset.code)}</td><td>${escapeHtml(asset.name)}</td><td>${escapeHtml(asset.category)}</td><td>${fmtDate(dates[0])} – ${fmtDate(dates.at(-1))}</td><td>${dates.length.toLocaleString()}개월</td><td><span class="source-pill ${asset.source}">${asset.source === "custom" ? "사용자 CSV" : "합성 데모"}</span></td></tr>`;
    }).join("");
    $("#assetDataCount").textContent = `총 ${state.assetOrder.length}개`;
  }

  function renderAllAssetDependentUi() {
    renderAssetRows();
    renderBenchmarkOptions();
    updateAllocationState();
    renderCompareSelector();
    renderComparison();
    renderDataTable();
  }

  function clearCustomData() {
    const customIds = state.assetOrder.filter((id) => state.assets[id].source === "custom");
    customIds.forEach((id) => delete state.assets[id]);
    state.assetOrder = state.assetOrder.filter((id) => !customIds.includes(id));
    state.portfolio = state.portfolio.filter((row) => state.assets[row.assetId]);
    if (!state.portfolio.length) applyPreset("balanced", false);
    customIds.forEach((id) => state.compareSelected.delete(id));
    state.assetOrder.forEach((id) => {
      if (state.compareSelected.size < 2) state.compareSelected.add(id);
    });
    storage.removeItem("backtestK.customAssets");
    renderAllAssetDependentUi();
    $("#uploadStatus").className = "upload-status";
    $("#uploadStatus").textContent = customIds.length ? `${customIds.length}개 사용자 자산을 삭제했습니다.` : "삭제할 사용자 데이터가 없습니다.";
    showToast("사용자 데이터를 삭제했습니다.");
  }

  function downloadBlob(filename, content, type = "text/csv;charset=utf-8") {
    const blob = new Blob(["\uFEFF", content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportBacktestCsv() {
    if (!state.lastBacktest) {
      showToast("먼저 백테스트를 실행하세요.");
      return;
    }
    const rows = ["date,balance,principal,benchmark_balance,twrr_index,benchmark_index,drawdown"];
    state.lastBacktest.series.forEach((point, index) => {
      rows.push([point.date, point.balance.toFixed(0), point.principal.toFixed(0), point.benchmarkBalance.toFixed(0), point.unitIndex.toFixed(6), point.benchmarkIndex.toFixed(6), state.lastBacktest.drawdowns[index].toFixed(8)].join(","));
    });
    downloadBlob(`backtestK_${state.lastBacktest.dates[0]}_${state.lastBacktest.dates.at(-1)}.csv`, rows.join("\n"));
    showToast("백테스트 결과 CSV를 저장했습니다.");
  }

  function downloadSampleCsv() {
    const content = `date,ticker,name,adjusted_close\n2024-01-31,SAMPLE_A,샘플 자산 A,10000\n2024-02-29,SAMPLE_A,샘플 자산 A,10350\n2024-03-29,SAMPLE_A,샘플 자산 A,10120\n2024-04-30,SAMPLE_A,샘플 자산 A,10680\n2024-05-31,SAMPLE_A,샘플 자산 A,10950\n2024-06-28,SAMPLE_A,샘플 자산 A,11110\n2024-01-31,SAMPLE_B,샘플 자산 B,10000\n2024-02-29,SAMPLE_B,샘플 자산 B,10080\n2024-03-29,SAMPLE_B,샘플 자산 B,10210\n2024-04-30,SAMPLE_B,샘플 자산 B,10190\n2024-05-31,SAMPLE_B,샘플 자산 B,10330\n2024-06-28,SAMPLE_B,샘플 자산 B,10420`;
    downloadBlob("backtestK_sample.csv", content);
  }

  function saveSettings() {
    const settings = gatherBacktestSettings();
    try {
      storage.setItem("backtestK.settings", JSON.stringify({ settings, portfolio: state.portfolio, name: state.portfolioName, preset: state.activePreset }));
      showToast("현재 설정을 브라우저에 저장했습니다.");
    } catch (error) {
      showToast("설정을 저장하지 못했습니다.");
    }
  }

  function restoreSettings() {
    try {
      const raw = storage.getItem("backtestK.settings");
      if (!raw) return false;
      const saved = JSON.parse(raw);
      const validRows = (saved.portfolio || []).filter((row) => state.assets[row.assetId]);
      if (validRows.length) state.portfolio = validRows;
      state.portfolioName = saved.name || "저장 포트폴리오";
      state.activePreset = saved.preset || null;
      const values = saved.settings || {};
      const map = {
        startDate: "#startDate", endDate: "#endDate", initialAmount: "#initialAmount", monthlyContribution: "#monthlyContribution",
        contributionTiming: "#contributionTiming", rebalance: "#rebalance", inflationRate: "#inflationRate", riskFreeRate: "#riskFreeRate", benchmarkId: "#benchmark",
      };
      Object.entries(map).forEach(([key, selector]) => {
        const element = $(selector);
        if (!element || values[key] === undefined) return;
        if (key === "inflationRate" || key === "riskFreeRate") element.value = values[key] * 100;
        else element.value = values[key];
      });
      if (values.tradingCostBps !== undefined) $("#tradingCost").value = values.tradingCostBps;
      return true;
    } catch (error) {
      return false;
    }
  }

  function switchView(viewName) {
    $$(".app-view").forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
    $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
    history.replaceState(null, "", `#${viewName}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (viewName === "montecarlo" && !state.monteCarlo) runMonteCarlo();
    if (viewName === "compare") renderComparison();
    setTimeout(redrawAllCharts, 80);
  }

  function switchResultTab(tabName) {
    $$(".analysis-tab").forEach((button) => button.classList.toggle("active", button.dataset.resultTab === tabName));
    $$(".result-tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `result-${tabName}`));
    setTimeout(redrawAllCharts, 50);
  }

  function redrawAllCharts() {
    state.chartConfigs.forEach(({ type, config }, id) => {
      const canvas = document.getElementById(id);
      if (!canvas || canvas.offsetParent === null) return;
      if (type === "line") drawLineChart(canvas, config);
      if (type === "fan") drawFanChart(canvas, config);
    });
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    storage.setItem("backtestK.theme", theme);
    if (state.lastBacktest) renderBacktestResults();
    if (state.monteCarlo) renderMonteCarlo();
    setTimeout(redrawAllCharts, 50);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function bindEvents() {
    $$(".nav-btn").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
    $$("[data-view-link]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewLink)));
    $$(".preset-chip").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
    $("#addAsset").addEventListener("click", () => {
      if (state.portfolio.length >= 8) { showToast("자산은 최대 8개까지 추가할 수 있습니다."); return; }
      const unused = state.assetOrder.find((id) => !state.portfolio.some((row) => row.assetId === id)) || state.assetOrder[0];
      state.portfolio.push({ assetId: unused, weight: 0 });
      state.activePreset = null;
      renderAssetRows(); renderPresetState(); updateAllocationState();
    });
    $("#runBacktest").addEventListener("click", runBacktest);
    $("#loadSample").addEventListener("click", () => applyPreset("balanced"));
    $("#saveSettings").addEventListener("click", saveSettings);
    $("#exportButton").addEventListener("click", exportBacktestCsv);
    $$(".analysis-tab").forEach((button) => button.addEventListener("click", () => switchResultTab(button.dataset.resultTab)));
    $("#runMonteCarlo").addEventListener("click", runMonteCarlo);
    $("#compareStart").addEventListener("change", renderComparison);
    $("#themeToggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

    const csvFile = $("#csvFile");
    csvFile.addEventListener("change", async () => {
      const file = csvFile.files?.[0];
      if (!file) return;
      try { importCsvText(await file.text(), file.name); }
      catch (error) { $("#uploadStatus").className = "upload-status error"; $("#uploadStatus").textContent = error.message; showToast(error.message); }
      csvFile.value = "";
    });
    const dropZone = $("#dropZone");
    ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragover"); }));
    dropZone.addEventListener("drop", async (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      try { importCsvText(await file.text(), file.name); }
      catch (error) { $("#uploadStatus").className = "upload-status error"; $("#uploadStatus").textContent = error.message; showToast(error.message); }
    });
    $("#downloadSampleCsv").addEventListener("click", downloadSampleCsv);
    $("#clearCustomData").addEventListener("click", clearCustomData);

    let resizeTimer;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redrawAllCharts, 120); });
    window.addEventListener("hashchange", () => {
      const view = location.hash.slice(1);
      if (["backtest", "montecarlo", "compare", "data"].includes(view)) switchView(view);
    });
  }

  function init() {
    const savedTheme = storage.getItem("backtestK.theme");
    if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;
    buildDemoAssets();
    restoreCustomAssets();
    state.portfolio = PRESETS.balanced.rows.map(([assetId, weight]) => ({ assetId, weight }));
    renderBenchmarkOptions();
    const restored = restoreSettings();
    renderAllAssetDependentUi();
    renderPresetState();
    updateAllocationState();
    bindEvents();
    runBacktest();
    renderCompareSelector();
    renderDataTable();
    const view = location.hash.slice(1);
    if (["backtest", "montecarlo", "compare", "data"].includes(view) && view !== "backtest") switchView(view);
    if (restored) showToast("저장된 포트폴리오 설정을 불러왔습니다.");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
