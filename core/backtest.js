// 백테스트K 계산 코어. DOM·전역 상태 의존 없음 — 브라우저(ESM)와 Node에서 동일 결과.
//
// app.js에서 그대로 옮긴 산식이며, 유일한 변경은 자산 수익률 조회를
// `state.assets[id].returnMap` → 인자로 받은 `returnsById[id]`로 바꾼 것뿐이다.
//
// ⚠️ 산식을 수정하면 반드시 `npm test`(골든 검증)를 돌려라.
//    tests/fixtures/golden-backtest.json이 리팩터 이전 결과를 고정하고 있다.
//
// returnsById: { [assetId]: Map<"YYYY-MM", number> }

import { sum, mean, standardDeviation, variance, covariance, correlation } from "./stats.js";

export function commonMonths(returnsById, ids, startDate, endDate) {
  const uniqueIds = [...new Set(ids)];
  const dateCandidates = new Set();
  uniqueIds.forEach((id, index) => {
    const map = returnsById[id];
    if (!map) return;
    if (index === 0) {
      map.forEach((_, date) => dateCandidates.add(date));
    } else {
      [...dateCandidates].forEach((date) => {
        if (!map.has(date)) dateCandidates.delete(date);
      });
    }
  });
  return [...dateCandidates].filter((date) => date >= startDate && date <= endDate).sort();
}

export function isRebalanceMonth(mode, index) {
  if (index === 0 || mode === "none") return false;
  if (mode === "monthly") return true;
  if (mode === "quarterly") return index % 3 === 0;
  if (mode === "semiannual") return index % 6 === 0;
  if (mode === "annual") return index % 12 === 0;
  return false;
}

export function monthlyIrr(cashflows) {
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

export function maxDrawdownDetails(indexValues) {
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

export function drawdownSeries(indexValues) {
  let peak = indexValues[0] || 100;
  return indexValues.map((value) => {
    peak = Math.max(peak, value);
    return peak > 0 ? value / peak - 1 : 0;
  });
}

export function drawdownEpisodes(indexValues, dates) {
  if (!indexValues.length || indexValues.length !== dates.length) return [];
  let peakValue = indexValues[0] || 100;
  let peakIndex = 0;
  let active = null;
  const episodes = [];

  const finishEpisode = (episode, recoveryIndex = null) => {
    const periodEndIndex = recoveryIndex === null ? indexValues.length - 1 : recoveryIndex;
    episodes.push({
      ...episode,
      recoveryIndex,
      lengthMonths: episode.troughIndex - episode.startIndex + 1,
      recoveryMonths: recoveryIndex === null ? null : recoveryIndex - episode.troughIndex,
      underwaterMonths: periodEndIndex - episode.startIndex + 1,
    });
  };

  for (let index = 1; index < indexValues.length; index += 1) {
    const value = indexValues[index];
    const tolerance = Math.abs(peakValue) * 1e-10;
    const recovered = value + tolerance >= peakValue;

    if (recovered) {
      if (active) {
        finishEpisode(active, index);
        active = null;
      }
      if (value > peakValue) {
        peakValue = value;
        peakIndex = index;
      }
      continue;
    }

    const drawdown = peakValue > 0 ? value / peakValue - 1 : 0;
    if (!active) {
      active = {
        peakIndex,
        startIndex: index,
        troughIndex: index,
        drawdown,
      };
    } else if (drawdown < active.drawdown) {
      active.troughIndex = index;
      active.drawdown = drawdown;
    }
  }

  if (active) finishEpisode(active);
  return episodes
    .sort((a, b) => a.drawdown - b.drawdown)
    .map((episode, index) => ({ ...episode, rank: index + 1 }));
}

export function annualReturnRows(dates, returns, benchmarkReturns) {
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

export function calculateRiskContributions(allocations, dates, returnsById) {
  const arrays = allocations.map((item) => dates.map((date) => returnsById[item.assetId].get(date)));
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

export function correlationMatrix(ids, dates, returnsById) {
  const arrays = ids.map((id) => dates.map((date) => returnsById[id].get(date)));
  return ids.map((id, i) => ({
    id,
    values: ids.map((_, j) => correlation(arrays[i], arrays[j])),
  }));
}

export function calculateMetrics(returns, benchmarkReturns, riskFreeAnnual, series, cashflows) {
  const count = returns.length;
  const totalReturn = returns.reduce((acc, value) => acc * (1 + value), 1) - 1;
  const annualizedReturn = Math.pow(1 + totalReturn, 12 / count) - 1;
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
  const benchmarkStd = standardDeviation(benchmarkReturns);
  const benchmarkVolatility = benchmarkStd * Math.sqrt(12);
  const benchmarkExcess = benchmarkReturns.map((value) => value - monthlyRf);
  const benchmarkSharpe = benchmarkStd > 0 ? mean(benchmarkExcess) / benchmarkStd * Math.sqrt(12) : NaN;
  const benchmarkDownside = Math.sqrt(mean(benchmarkReturns.map((value) => Math.min(0, value - monthlyRf) ** 2))) * Math.sqrt(12);
  const benchmarkSortino = benchmarkDownside > 0 ? (benchmarkAnnualized - riskFreeAnnual) / benchmarkDownside : NaN;
  const benchmarkDrawdownInfo = maxDrawdownDetails(series.map((point) => point.benchmarkIndex));
  const activeMonthly = returns.map((value, index) => value - benchmarkReturns[index]);
  const activeReturn = annualizedReturn - benchmarkAnnualized;
  const trackingError = standardDeviation(activeMonthly) * Math.sqrt(12);
  const informationRatio = trackingError > 0 ? activeReturn / trackingError : NaN;
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
    benchmarkVolatility,
    benchmarkSharpe,
    benchmarkSortino,
    benchmarkMaxDrawdown: benchmarkDrawdownInfo.maxDrawdown,
    activeReturn,
    trackingError,
    informationRatio,
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

// 백테스트 1회 실행. 반환 형태는 기존 `state.lastBacktest`와 동일하다.
export function runBacktest({ settings, dates, returnsById }) {
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
    holdings = holdings.map((value, i) => value * (1 + returnsById[settings.allocations[i].assetId].get(date)));
    benchmarkBalance *= 1 + returnsById[settings.benchmarkId].get(date);

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
    const deflator = Math.pow(1 + settings.inflationRate, years);
    series.push({
      date,
      balance,
      principal,
      benchmarkBalance,
      realBalance: balance / deflator,
      realBenchmarkBalance: benchmarkBalance / deflator,
      realPrincipal: principal / deflator,
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
  metrics.realBenchmarkFinal = series.at(-1).realBenchmarkBalance;
  metrics.initialAmount = settings.initialAmount;
  metrics.totalTradingCost = totalTradingCost + totalContributionCost;
  metrics.rebalanceCost = totalTradingCost;
  metrics.contributionCost = totalContributionCost;
  const benchmarkCashflows = cashflows.slice(0, -1).concat({ t: dates.length, amount: metrics.benchmarkFinal });
  metrics.benchmarkMwrr = monthlyIrr(benchmarkCashflows);

  const annualReturns = annualReturnRows(dates, monthlyReturns, benchmarkReturns);
  if (annualReturns.length) {
    const byPortfolio = [...annualReturns].sort((a, b) => a.portfolio - b.portfolio);
    const byBenchmark = [...annualReturns].sort((a, b) => a.benchmark - b.benchmark);
    metrics.worstYear = byPortfolio[0];
    metrics.bestYear = byPortfolio.at(-1);
    metrics.benchmarkWorstYear = byBenchmark[0];
    metrics.benchmarkBestYear = byBenchmark.at(-1);
  }
  const portfolioIndexValues = series.map((point) => point.unitIndex);
  const benchmarkIndexValues = series.map((point) => point.benchmarkIndex);
  const drawdowns = drawdownSeries(portfolioIndexValues);
  const benchmarkDrawdowns = drawdownSeries(benchmarkIndexValues);
  const drawdownHistory = drawdownEpisodes(portfolioIndexValues, dates);
  const riskContributions = calculateRiskContributions(settings.allocations, dates, returnsById);
  const correlations = correlationMatrix(settings.allocations.map((item) => item.assetId), dates, returnsById);

  return {
    settings,
    dates,
    series,
    monthlyReturns,
    benchmarkReturns,
    metrics,
    annualReturns,
    drawdowns,
    benchmarkDrawdowns,
    drawdownHistory,
    riskContributions,
    correlations,
  };
}
