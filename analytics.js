// 최소 계측. 이벤트는 딱 3개만 둔다 — 늘리지 말 것.
//   page_view     : 이 스크립트가 자동 집계 (GoatCounter 기본 동작)
//   backtest_run  : 사용자가 직접 백테스트를 실행한 경우만 (사전 계산 샘플 렌더는 제외)
//   result_share  : 공유하기 클릭
//
// GoatCounter를 쓰는 이유: 쿠키를 심지 않고, 무료이며, 커스텀 이벤트를 제한 없이 보낼 수 있다.
// (Vercel Web Analytics는 커스텀 이벤트가 유료라 실행 완료율을 볼 수 없다.)
//
// ── 설정 방법 ────────────────────────────────────────────────
// 1) https://www.goatcounter.com 에서 사이트를 만든다 (예: 코드 "backtest-k")
// 2) 아래 SITE_CODE에 그 코드를 넣는다. 비워두면 계측은 완전히 비활성이다.
(() => {
  "use strict";

  const SITE_CODE = "sw17"; // https://sw17.goatcounter.com

  const disabled =
    !SITE_CODE ||
    // 로컬 개발·미리보기 트래픽은 집계하지 않는다.
    ["localhost", "127.0.0.1", ""].includes(location.hostname) ||
    location.protocol === "file:" ||
    // 사용자가 추적 거부를 켰으면 존중한다. (이 줄을 지우면 모든 방문을 집계한다.)
    navigator.doNotTrack === "1" || window.doNotTrack === "1";

  // 계측이 꺼져 있어도 호출부가 분기하지 않도록 항상 같은 함수를 노출한다.
  if (disabled) {
    window.trackEvent = () => {};
    return;
  }

  const endpoint = `https://${SITE_CODE}.goatcounter.com/count`;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = endpoint;
  document.head.appendChild(script);

  // 스크립트 로드 전에 발생한 이벤트도 잃지 않도록 큐에 담아 둔다.
  const queue = [];
  const flush = () => {
    if (!window.goatcounter?.count) return;
    while (queue.length) {
      const path = queue.shift();
      window.goatcounter.count({ path, title: path, event: true });
    }
  };
  script.addEventListener("load", flush);

  window.trackEvent = (name) => {
    if (!name) return;
    queue.push(name);
    flush();
  };
})();
