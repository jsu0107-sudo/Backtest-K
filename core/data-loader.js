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
  const returns = new Map();
  payload.monthly_returns.forEach((row) => {
    const month = normalizeMonth(row.month);
    const value = Number(row.return);
    if (!month || !Number.isFinite(value) || value <= -1) return;
    returns.set(month, value);
  });
  if (returns.size < 2) throw new Error("유효한 월 수익률이 2개월 미만입니다.");
  return new Map([...returns.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}
