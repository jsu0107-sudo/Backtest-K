// 정적 데이터마트 JSON → 코어가 쓰는 `returnsById` 변환.
// app.js의 `normalizeMonth`/`validateMonthlyReturns`와 동일한 규칙이어야 한다.
// (계산이 아니라 로딩 규칙이므로 코어와 분리해 둔다.)

export function normalizeMonth(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/.]?(\d{1,2})/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}`;
}

export function returnMapFromPayload(payload) {
  if (!payload || !Array.isArray(payload.monthly_returns)) throw new Error("월 수익률 배열이 없습니다.");
  // CSV/demo payloads have no market identity; they remain user-supplied inputs.
  if (payload.asset_type) {
    if (payload.currency !== "KRW") throw new Error(`${payload.name || payload.id}: ${payload.currency || '통화 미상'} 수익률은 원화 환산이 검증되지 않아 분석할 수 없습니다. 국내 상장 원화 ETF를 선택하세요.`);
    if (payload.month_end_quality?.version !== 1) throw new Error(`${payload.name || payload.id}: 월말 검사가 없는 데이터입니다. 데이터 갱신이 필요합니다.`);
  }
  const quality = payload.month_end_quality;
  const excluded = new Set((quality?.excluded_months || []).map(row => row.month));
  const returns = new Map();
  payload.monthly_returns.forEach((row) => {
    const month = normalizeMonth(row.month);
    const value = Number(row.return);
    if (!month || !Number.isFinite(value) || value <= -1) return;
    if (quality && (excluded.has(month) || !quality.usable_first_month || !quality.usable_last_month
      || month < quality.usable_first_month || month > quality.usable_last_month)) return;
    returns.set(month, value);
  });
  if (returns.size < 2) throw new Error("유효한 월 수익률이 2개월 미만입니다.");
  const sorted = [...returns.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (payload.asset_type) {
    const ordinal = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5));
    if (sorted.length !== quality.usable_month_count || sorted.some(([month], i) => i && ordinal(month) !== ordinal(sorted[i - 1][0]) + 1)) {
      throw new Error('월말 검사와 수익률 연속성이 일치하지 않습니다. 데이터 갱신이 필요합니다.');
    }
  }
  return new Map(sorted);
}

export function dataQualityMessages(payload, now = new Date()) {
  const messages = [];
  const quality = payload.month_end_quality;
  if (quality?.outside_usable_window_count) messages.push(`월말 불일치·연속성 제한으로 ${quality.outside_usable_window_count}개월 제외; 사용 ${quality.usable_first_month}~${quality.usable_last_month}`);
  const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 7);
  if (quality?.usable_last_month && quality.usable_last_month < expected) messages.push(`최신 완료월 ${expected} 대비 지연: 사용 가능 ${quality.usable_last_month}`);
  if (quality?.baseline_verification === 'legacy_first_baseline_unavailable') messages.push('기존 데이터의 첫 기준가격 관측일은 미확인');
  if (payload.distribution?.included && payload.distribution.verification_status !== 'independently_reconciled') messages.push('분배금: 공급자 수정종가 반영 · 독립 총수익 대사 미완료');
  if (payload.distribution?.included === false) messages.push('가격수익률: 분배금/배당 제외');
  return messages;
}
