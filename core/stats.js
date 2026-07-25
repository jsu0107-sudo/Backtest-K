// 백테스트K 순수 통계 유틸. DOM·전역 상태 의존 없음.
// 브라우저(ESM)와 Node에서 동일하게 동작한다.
// ⚠️ 산식을 바꾸면 tests/fixtures/golden-backtest.json 골든 검증이 깨진다.
// (몬테카를로용 난수·분위수 함수는 아직 app.js에 있다 — MC 추출 시 함께 옮긴다.)

export const sum = (values) => values.reduce((a, b) => a + b, 0);
export const mean = (values) => values.length ? sum(values) / values.length : 0;

export function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((acc, value) => acc + Math.pow(value - avg, 2), 0) / (values.length - 1));
}

export function variance(values) {
  const std = standardDeviation(values);
  return std * std;
}

export function covariance(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let total = 0;
  for (let i = 0; i < n; i += 1) total += (a[i] - ma) * (b[i] - mb);
  return total / (n - 1);
}

export function correlation(a, b) {
  const denom = standardDeviation(a) * standardDeviation(b);
  return denom > 0 ? covariance(a, b) / denom : 0;
}
