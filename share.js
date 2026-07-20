// 백테스트K 공유 페이지.
// - 스냅숏 모드(v2, URL 프래그먼트): 공유 시점의 지표·시계열이 링크에 내장되어
//   데이터가 갱신돼도 수치가 절대 변하지 않는다. /p/<slug>#<payload>.
// - 레거시 모드(v1, ?c= 파라미터): 설정만 담긴 과거 링크. 최신 데이터로 재계산한다.
// 계산·차트·코덱은 engine.js(window.BacktestK)를 사용한다.
(() => {
  "use strict";

  const K = window.BacktestK;
  const $ = (selector) => document.querySelector(selector);
  const { fmtPct, fmtKRW, fmtDate, escapeHtml, rebalanceLabel } = K;

  K.applySavedTheme();

  const PALETTE = ["#45e3b5", "#5ea9ff", "#ffb45e", "#a58bff", "#ff7f8c", "#ffd166", "#44c7dd", "#8bd17c"];

  function fail() {
    $("#shareError").hidden = false;
    $("#shareContent").hidden = true;
  }

  function shiftMonth(month, offset) {
    const [year, monthNumber] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function fmtMonths(count) {
    if (!Number.isFinite(count) || count === null) return "미회복";
    if (count < 12) return `${count}개월`;
    const years = Math.floor(count / 12);
    const rest = count % 12;
    return rest ? `${years}년 ${rest}개월` : `${years}년`;
  }

  function recoveryFromIndex(values) {
    let peak = values[0];
    let peakIndex = 0;
    let maxDd = 0;
    let troughIndex = 0;
    let maxPeakIndex = 0;
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] > peak) { peak = values[i]; peakIndex = i; }
      const dd = values[i] / peak - 1;
      if (dd < maxDd) { maxDd = dd; troughIndex = i; maxPeakIndex = peakIndex; }
    }
    for (let i = troughIndex + 1; i < values.length; i += 1) {
      if (values[i] >= values[maxPeakIndex]) return i - troughIndex;
    }
    return null;
  }

  // ---------- 뷰 모델 ----------

  function viewModelFromSnapshot(payload) {
    const step = payload.sr?.step || 1;
    const points = payload.sr?.p || [];
    const months = points.map((_, index) => index === points.length - 1 ? payload.e : shiftMonth(payload.s, index * step));
    return {
      mode: "snapshot",
      name: payload.n || "포트폴리오 시뮬레이션 결과",
      benchmarkName: payload.bn || payload.b,
      startMonth: payload.s,
      endMonth: payload.e,
      alloc: payload.a.map(([id, weight, name]) => [id, Number(weight) || 0, name || id]),
      cond: { i: payload.i, m: payload.m, t: payload.t, r: payload.r, c: payload.c, f: payload.f, rf: payload.rf },
      dataAsOf: payload.d,
      releaseId: payload.rel,
      engine: payload.eng,
      seed: payload.seed,
      verify: payload.ver,
      metrics: payload.mx || {},
      chart: { months, portfolio: points, benchmark: payload.sr?.b || [] },
      clonePayload: {
        v: 1, n: payload.n, a: payload.a.map(([id, weight]) => [id, weight]), b: payload.b,
        s: payload.s, e: payload.e, i: payload.i, m: payload.m, t: payload.t, r: payload.r,
        c: payload.c, f: payload.f, rf: payload.rf,
      },
    };
  }

  async function viewModelFromLegacyConfig(raw) {
    const config = K.decodeShareConfig(raw);
    if (!config) return null;
    const catalog = await K.fetchJson("/data/assets.json");
    const catalogById = new Map(catalog.assets.map((record) => [record.id, record]));
    const allocIds = config.a.map((pair) => pair[0]);
    const benchmarkId = config.b && catalogById.has(config.b) ? config.b : allocIds[0];
    if (!allocIds.every((id) => catalogById.has(id))) return null;
    const neededIds = [...new Set([...allocIds, benchmarkId])];
    const payloads = new Map();
    await Promise.all(neededIds.map(async (id) => {
      payloads.set(id, await K.fetchJson(`/${catalogById.get(id).file}`));
    }));
    const assets = config.a.map(([id, weight]) => ({
      id, weight: (Number(weight) || 0) / 100,
      record: catalogById.get(id),
      returnMap: K.returnMapFrom(payloads.get(id)),
    }));
    const benchmark = { id: benchmarkId, record: catalogById.get(benchmarkId), returnMap: K.returnMapFrom(payloads.get(benchmarkId)) };
    const result = K.runStaticBacktest(config, assets, benchmark);
    if (!result) return null;
    const unitIndexes = result.series.map((point) => point.unitIndex);
    return {
      mode: "live",
      name: config.n || "포트폴리오 시뮬레이션 결과",
      benchmarkName: benchmark.record.name,
      startMonth: result.months[0],
      endMonth: result.months.at(-1),
      alloc: assets.map((asset) => [asset.id, asset.weight * 100, asset.record.name]),
      cond: { i: config.i, m: config.m, t: config.t, r: config.r, c: config.c, f: config.f, rf: config.rf },
      dataAsOf: catalog.data_as_of,
      releaseId: catalog.generated_at,
      engine: K.ENGINE_VERSION,
      seed: null,
      verify: catalog.provider_status === "provisional" ? "프로토타입 데이터 (독립 대사 진행 중)" : String(catalog.provider_status),
      metrics: {
        cagr: result.cagr, vol: result.volatility, mdd: result.mdd,
        bCagr: result.benchmarkCagr, bMdd: result.benchmarkMdd,
        alpha: result.cagr - result.benchmarkCagr,
        rec: recoveryFromIndex(unitIndexes),
        best: null, worst: null, mwrr: null, sharpe: null,
      },
      chart: { months: result.months, portfolio: unitIndexes, benchmark: result.series.map((point) => point.benchmarkIndex) },
      clonePayload: config,
    };
  }

  // ---------- 렌더 ----------

  function renderShared(vm) {
    $("#shareContent").hidden = false;
    $("#shareTitle").textContent = vm.name;
    $("#sharePeriod").textContent = `${fmtDate(vm.startMonth)} – ${fmtDate(vm.endMonth)} · ${rebalanceLabel(vm.cond.r)} 리밸런싱 · 벤치마크 ${vm.benchmarkName}`;

    const note = $("#snapshotNote");
    if (vm.dataAsOf) {
      note.hidden = false;
      note.textContent = `데이터 기준일 ${vm.dataAsOf}`;
    } else {
      note.hidden = true;
    }

    const m = vm.metrics;
    const metricCards = [
      ["연환산 수익률 (CAGR)", fmtPct(m.cagr), "TWRR 기준", ""],
      ["최대 낙폭 (MDD)", fmtPct(m.mdd), `벤치마크 ${fmtPct(m.bMdd)}`, "red"],
      ["낙폭 회복기간", fmtMonths(m.rec), "최대 낙폭 저점 → 전고점", "blue"],
      ["연환산 변동성", fmtPct(m.vol), "월 수익률 표준편차 × √12", "orange"],
    ];
    $("#shareMetrics").innerHTML = metricCards.map(([label, value, sub, tone]) => `<article class="metric-card card ${tone}">
      <div class="metric-label">${escapeHtml(label)}</div>
      <strong class="metric-value" title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
      <div class="metric-sub">${escapeHtml(sub)}</div>
    </article>`).join("");

    $("#shareAllocBody").innerHTML = vm.alloc.map(([id, weight, name]) => `<tr>
      <td>${escapeHtml(id)}</td>
      <td style="text-align:left">${escapeHtml(name)}</td>
      <td>${Number(weight).toFixed(1)}%</td>
    </tr>`).join("");

    const conditions = [
      ["분석 기간", `${fmtDate(vm.startMonth)} – ${fmtDate(vm.endMonth)}`],
      ["초기 투자금", fmtKRW(Number(vm.cond.i) || 0)],
      ["월 적립금", `${fmtKRW(Number(vm.cond.m) || 0)} · ${vm.cond.t === "end" ? "월말" : "월초"} 납입`],
      ["리밸런싱", rebalanceLabel(vm.cond.r)],
      ["거래비용", `${Number(vm.cond.c) || 0}bp`],
      ["물가상승률 가정", `${Number(vm.cond.f) || 0}%`],
      ["무위험수익률 가정", `${Number(vm.cond.rf) || 0}%`],
      ["벤치마크", vm.benchmarkName],
    ];
    $("#shareConditions").innerHTML = conditions.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

    const dataInfo = [
      ["데이터 기준일", vm.dataAsOf || "—"],
      ["데이터 릴리스", vm.releaseId || "—"],
      ["계산 엔진 버전", vm.engine || "—"],
      ["몬테카를로 시드", vm.seed === null || vm.seed === undefined ? "— (백테스트만 공유됨)" : String(vm.seed)],
      ["데이터 검증 상태", vm.verify || "—"],
      ["결과 보존", vm.mode === "snapshot" ? "스냅숏 (불변)" : "실시간 재계산"],
    ];
    $("#shareDataInfo").innerHTML = dataInfo.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

    $("#cloneLink").href = `/?c=${encodeURIComponent(K.encodeShareConfig(vm.clonePayload))}`;
    $("#copyLinkButton").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast("공유 링크를 복사했습니다.");
      } catch (_) {
        showToast("주소창의 링크를 직접 복사해주세요.");
      }
    });

    $("#chartEyebrow").textContent = "GROWTH OF 100";
    $("#chartTitle").textContent = "성장 지수 (시작 = 100)";
    const chartResult = {
      months: vm.chart.months,
      series: vm.chart.months.map((_, index) => ({
        balance: vm.chart.portfolio[index],
        benchmarkBalance: vm.chart.benchmark[index] ?? vm.chart.portfolio[index],
      })),
    };
    const draw = () => K.drawGrowthChart($("#shareChart"), chartResult, {
      benchmarkName: vm.benchmarkName,
      legendEl: $("#shareLegend"),
      hidePrincipal: true,
      yFormatter: (value) => value.toFixed(0),
    });
    draw();
    let resizeTimer;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 120); });

    bindPassport(vm);
  }

  // ---------- 포트폴리오 패스포트 ----------

  const PASSPORT_FORMATS = {
    wide: { width: 1200, height: 630, label: "wide" },
    insta: { width: 1080, height: 1350, label: "insta" },
    square: { width: 1080, height: 1080, label: "square" },
  };

  function renderPassport(canvas, vm, formatKey) {
    const { width, height } = PASSPORT_FORMATS[formatKey];
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const tall = height >= width; // 세로형(인스타)·정사각(카카오)은 여유 레이아웃, 가로형은 컴팩트
    const S = width / 1080; // 스케일 기준
    // 세로 예산이 빠듯한 가로형(1200×630)은 컴팩트 치수를 쓴다.
    const M = tall ? {
      headerGap: 64, titleFont: 58, titleGap: 78, periodFont: 26, periodGap: 58,
      boxH: 200, boxLabel: 24, boxLabelY: 52, boxValue: 46, boxValueBottom: 76, afterTrio: 40,
      secLabel: 22, secValue: 30, secValueY: 42, afterSec: 92,
      allocLabel: 22, barH: 26, afterBar: 34, legendFont: 22, afterLegend: 44,
    } : {
      headerGap: 46, titleFont: 40, titleGap: 54, periodFont: 20, periodGap: 40,
      boxH: 112, boxLabel: 18, boxLabelY: 36, boxValue: 34, boxValueBottom: 26, afterTrio: 24,
      secLabel: 16, secValue: 23, secValueY: 32, afterSec: 58,
      allocLabel: 16, barH: 16, afterBar: 26, legendFont: 16, afterLegend: 30,
    };
    const PAD = (tall ? 64 : 48) * S;
    const font = (weight, size) => `${weight} ${Math.round(size * S)}px Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;

    // 배경
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#07111f");
    bg.addColorStop(1, "#0d2036");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * 0.85, 0, 0, width * 0.85, 0, width * 0.6);
    glow.addColorStop(0, "rgba(69,227,181,0.10)");
    glow.addColorStop(1, "rgba(69,227,181,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    let y = PAD;
    ctx.textBaseline = "alphabetic";

    // 헤더: 브랜드
    ctx.fillStyle = "#45e3b5";
    ctx.font = font(800, tall ? 30 : 24);
    ctx.textAlign = "left";
    ctx.fillText("BACKTEST-K", PAD, y + 8 * S);
    y += M.headerGap * S;

    // 제목 + 기간
    ctx.fillStyle = "#edf5fb";
    ctx.font = font(800, M.titleFont);
    ctx.textAlign = "left";
    const title = vm.name.length > 18 ? `${vm.name.slice(0, 18)}…` : vm.name;
    ctx.fillText(title, PAD, y + 30 * S);
    y += M.titleGap * S;
    ctx.fillStyle = "#91a6b8";
    ctx.font = font(500, M.periodFont);
    ctx.fillText(`${fmtDate(vm.startMonth)} – ${fmtDate(vm.endMonth)} · ${rebalanceLabel(vm.cond.r)} 리밸런싱 · 벤치마크 ${vm.benchmarkName}`, PAD, y + 10 * S);
    y += M.periodGap * S;

    // 핵심 3지표 — 반드시 같은 크기
    const trio = [
      ["연환산 수익률", fmtPct(vm.metrics.cagr, 1), "#45e3b5"],
      ["최대 낙폭", fmtPct(vm.metrics.mdd, 1), "#ff7f8c"],
      ["낙폭 회복기간", fmtMonths(vm.metrics.rec), "#5ea9ff"],
    ];
    const boxGap = 20 * S;
    const boxWidth = (width - PAD * 2 - boxGap * 2) / 3;
    const boxHeight = M.boxH * S;
    trio.forEach(([label, value, color], index) => {
      const x = PAD + index * (boxWidth + boxGap);
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.beginPath(); ctx.roundRect(x, y, boxWidth, boxHeight, 18 * S); ctx.fill();
      ctx.strokeStyle = "rgba(151,177,204,0.18)";
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath(); ctx.roundRect(x, y, boxWidth, boxHeight, 18 * S); ctx.stroke();
      ctx.fillStyle = "#91a6b8";
      ctx.font = font(700, M.boxLabel);
      ctx.textAlign = "center";
      ctx.fillText(label, x + boxWidth / 2, y + M.boxLabelY * S);
      ctx.fillStyle = color;
      ctx.font = font(800, M.boxValue);
      ctx.fillText(value, x + boxWidth / 2, y + boxHeight - M.boxValueBottom * S);
    });
    y += boxHeight + M.afterTrio * S;

    // 보조 지표 한 줄
    ctx.textAlign = "left";
    const secondary = [
      ["연 변동성", fmtPct(vm.metrics.vol, 1)],
      ["최악의 1년", vm.metrics.worst ? `${fmtPct(vm.metrics.worst[1], 1)} (${vm.metrics.worst[0]})` : "—"],
      ["벤치마크 대비", Number.isFinite(vm.metrics.alpha) ? `${vm.metrics.alpha >= 0 ? "+" : ""}${(vm.metrics.alpha * 100).toFixed(1)}%p` : "—"],
    ];
    const colWidth = (width - PAD * 2) / 3;
    secondary.forEach(([label, value], index) => {
      const x = PAD + index * colWidth;
      ctx.fillStyle = "#7f96aa";
      ctx.font = font(600, M.secLabel);
      ctx.fillText(label, x, y);
      ctx.fillStyle = "#dbe7f1";
      ctx.font = font(800, M.secValue);
      ctx.fillText(value, x, y + M.secValueY * S);
    });
    y += M.afterSec * S;

    // 구성 스택 바 + 범례
    ctx.fillStyle = "#7f96aa";
    ctx.font = font(600, M.allocLabel);
    ctx.fillText("포트폴리오 구성", PAD, y);
    y += (M.allocLabel * 0.9) * S;
    const barHeight = M.barH * S;
    const barWidth = width - PAD * 2;
    let cursor = PAD;
    const total = vm.alloc.reduce((acc, [, weight]) => acc + weight, 0) || 100;
    vm.alloc.forEach(([, weight], index) => {
      const w = barWidth * (weight / total);
      ctx.fillStyle = PALETTE[index % PALETTE.length];
      ctx.fillRect(cursor, y, Math.max(2, w - 2 * S), barHeight);
      cursor += w;
    });
    y += barHeight + M.afterBar * S;
    ctx.font = font(600, M.legendFont);
    let lx = PAD;
    vm.alloc.slice(0, 6).forEach(([, weight, name], index) => {
      const label = `${name.length > 14 ? `${name.slice(0, 14)}…` : name} ${Number(weight).toFixed(0)}%`;
      const chipWidth = ctx.measureText(label).width + 30 * S;
      if (lx + chipWidth > width - PAD) { lx = PAD; y += (M.legendFont + 12) * S; }
      ctx.fillStyle = PALETTE[index % PALETTE.length];
      ctx.beginPath(); ctx.arc(lx + 7 * S, y - 6 * S, 6 * S, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#b9c9d8";
      ctx.fillText(label, lx + 21 * S, y);
      lx += chipWidth + 14 * S;
    });
    y += M.afterLegend * S;

    // 성장 지수 스파크라인 (세로형에서만 크게)
    const sparkBottom = height - 108 * S;
    if (sparkBottom - y > 90 * S && vm.chart.portfolio.length > 2) {
      const sy = y;
      const sh = sparkBottom - y;
      const values = vm.chart.portfolio;
      const bvalues = vm.chart.benchmark;
      const all = [...values, ...bvalues].filter(Number.isFinite);
      const vmin = Math.min(...all);
      const vmax = Math.max(...all);
      const xAt = (i) => PAD + (i / (values.length - 1)) * (width - PAD * 2);
      const yAt = (v) => sy + (vmax - v) / Math.max(1e-9, vmax - vmin) * sh;
      ctx.strokeStyle = "rgba(147,170,194,0.15)";
      ctx.lineWidth = 1 * S;
      ctx.beginPath(); ctx.moveTo(PAD, sy + sh); ctx.lineTo(width - PAD, sy + sh); ctx.stroke();
      if (bvalues.length === values.length) {
        ctx.strokeStyle = "rgba(94,169,255,0.75)";
        ctx.lineWidth = 3 * S;
        ctx.beginPath();
        bvalues.forEach((v, i) => i === 0 ? ctx.moveTo(xAt(i), yAt(v)) : ctx.lineTo(xAt(i), yAt(v)));
        ctx.stroke();
      }
      ctx.strokeStyle = "#45e3b5";
      ctx.lineWidth = 4.5 * S;
      ctx.lineJoin = "round";
      ctx.beginPath();
      values.forEach((v, i) => i === 0 ? ctx.moveTo(xAt(i), yAt(v)) : ctx.lineTo(xAt(i), yAt(v)));
      ctx.stroke();
      ctx.fillStyle = "#7f96aa";
      ctx.font = font(600, 20);
      ctx.textAlign = "left";
      ctx.fillText("성장 지수 (시작 = 100)", PAD, sy + 26 * S);
    }

    // 푸터
    ctx.fillStyle = "#63788c";
    ctx.font = font(600, 20);
    ctx.textAlign = "left";
    ctx.fillText(`100 지수 기준 · 데이터 기준일 ${vm.dataAsOf || "—"} · 투자 권유 아님`, PAD, height - 44 * S);
    ctx.fillStyle = "#45e3b5";
    ctx.font = font(800, 22);
    ctx.textAlign = "right";
    ctx.fillText("backtest-k.vercel.app", width - PAD, height - 44 * S);
  }

  function bindPassport(vm) {
    const canvas = $("#passportCanvas");
    if (!canvas) return;
    const menu = $("#ppMenu");
    const toggle = $("#ppToggle");
    const preview = canvas.closest(".passport-preview");

    const download = (formatKey) => {
      renderPassport(canvas, vm, formatKey);
      canvas.toBlob((blob) => {
        if (!blob) { showToast("이미지 생성에 실패했습니다."); return; }
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `backtest-k-${PASSPORT_FORMATS[formatKey].label}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
        showToast("이미지를 저장했습니다.");
      }, "image/png");
    };

    const closeMenu = () => {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    };
    const openMenu = () => {
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      if (preview) { preview.hidden = false; renderPassport(canvas, vm, "wide"); }
    };

    // 미리보기·드롭다운은 "이미지 저장하기"를 누르기 전까지 숨긴다.
    if (preview) preview.hidden = true;
    toggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.hidden ? openMenu() : closeMenu();
    });
    // 드롭다운 바깥 클릭·Esc로 닫기.
    document.addEventListener("click", (event) => {
      if (!menu.hidden && !menu.contains(event.target) && event.target !== toggle) closeMenu();
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });

    const pick = (formatKey) => { download(formatKey); closeMenu(); };
    $("#ppWide")?.addEventListener("click", () => pick("wide"));
    $("#ppInsta")?.addEventListener("click", () => pick("insta"));
    $("#ppSquare")?.addEventListener("click", () => pick("square"));
  }

  // ---------- 초기화 ----------

  async function init() {
    try {
      const fragment = window.location.hash.slice(1);
      if (fragment) {
        const snapshot = await K.decodeSnapshot(fragment);
        if (snapshot) { renderShared(viewModelFromSnapshot(snapshot)); return; }
      }
      const raw = new URLSearchParams(window.location.search).get("c");
      if (raw) {
        const vm = await viewModelFromLegacyConfig(raw);
        if (vm) { renderShared(vm); return; }
      }
      fail();
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
