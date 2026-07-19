# 백테스트K 변경 이력

작업 도구(Claude Code, Codex 등)와 무관하게 모든 에이전트·개발자가 공유하는 변경
추적 문서다. 기능 커밋을 만들면 이 파일에 항목을 추가한다. 데이터 자동 갱신
커밋(`chore(data)`)은 기록하지 않는다.

## 2026-07-20

### `c3b0e72` 전략 랜딩 페이지 5종 + 공용 엔진 분리

- **engine.js 신설**: 공유·랜딩 페이지 공용 계산/차트 모듈(`window.BacktestK`).
  포맷터, 공유 코덱(encode/decodeShareConfig), `runStaticBacktest`, `drawGrowthChart`.
  ⚠️ **산식은 app.js `runBacktest`와 동일해야 한다** — 본편 산식을 바꾸면 engine.js도
  함께 바꾸고 공유 페이지 수치가 본편과 일치하는지 확인할 것.
- **/portfolio/ 랜딩 페이지**: index + all-weather, korea-60-40, balanced-growth,
  global-growth. 크롤러용 정적 한국어 콘텐츠(소개·구성·해설·FAQ) + JSON-LD
  (FAQPage, BreadcrumbList) + portfolio.js가 실데이터 지표·차트를 렌더.
  ⚠️ **HTML을 직접 수정하지 말 것** — `scripts/build_portfolio_pages.py`의 PAGES
  콘텐츠를 수정하고 `python scripts/build_portfolio_pages.py`로 재생성한다.
- sitemap.xml에 5개 URL 추가, 메인 푸터에 전략 모음 링크.

### `be60515` 시뮬레이션 공유 기능 + SEO 기반

- **공유하기 버튼**(#shareButton, 결과 툴바): 마지막 백테스트 설정을 base64url로
  인코딩(`?c=` 파라미터, 코덱 버전 v:1)해 클립보드 복사 + share.html 열기.
- **share.html / share.js**: 구성·투자 조건·데이터 기준일·CAGR/MDD/변동성·성장
  차트(BACKTEST-K 워터마크)·계산 방법·"이 조합을 수정해 보기" CTA. `noindex`
  (파라미터 변형 중복 색인 방지).
- **본편 `?c=` 복원**: index.html이 공유 파라미터를 해독해 포트폴리오·조건을
  적용하고 자동 실행 (`applySharedConfig`, app.js).
- **SEO**: robots.txt(전체 허용 + Sitemap 위치), sitemap.xml, og-image.png(1200×630),
  index/share에 OG·트위터 메타태그. 배포 도메인 https://backtest-k.vercel.app 기준.

### `f7fa41c` 데이터 상태 배너 제거 (Codex)

### `bb7833b` 투자금 입력 원화 콤마 포맷 (Codex)

- `#initialAmount`/`#monthlyContribution`은 콤마 포맷 문자열 —
  값을 읽을 땐 `parseCurrencyInputValue`, 쓸 땐 `formatCurrencyInputValue` 사용.

### `0c9d784` 낙폭 벤치마크 비교 + 낙폭 이력 (Codex)

- 드로다운 차트에 벤치마크 라인, 낙폭 구간 이력 기능.

## 2026-07-19

### `d93bcd3` 공식 시세 대사를 최근 공통 날짜 기준으로 강화

- 공식 API 공표 지연으로 대사가 `no_overlap`이 되는 문제 수정: 수집기가 최근
  10영업일 원시 종가(`recent_raw_closes`)를 저장하고, verify 스크립트가 양쪽에
  존재하는 가장 최근 날짜로 비교. 진단용 `official_basdt_begin/end` 추가.

### `fa71bdb` 데이터 품질 방어 로직 + 지수/ETF 분리 + 히스토리 연장

- **월 갭 분리**: 원천 시계열에 월 갭이 있으면 가장 긴(동률이면 최신) 연속 구간만
  사용 — 갭 누적 수익률이 한 달로 압축되는 왜곡 차단 (`split_contiguous_segments`).
- **지수 스테일 트림**: 지수 말단 월 수익률이 정확히 0%면 최대 3개월 제거.
- **지수 히스토리 연장**: S&P500 1970-01, KOSPI 1990-01, KOSPI200 1994-01부터 수집.
- **가격지수 표시 분리**: 가격지수 포함 시 결과 화면 경고 배너(#priceIndexNotice),
  성과 요약 헤더에 "(가격지수)" 표기. HTML 날짜 입력 하드코딩 제한 제거.

### `b5fd195` 공공데이터 대사 계층 + PV 스타일 UI 개편

- **공식 시세 대사**: `scripts/verify_official_prices.py` — 공공데이터포털 금융위
  getETFPriceInfo 공식 종가와 수집 원시 종가 대조 → `data/official_verification.json`.
  인증키는 GitHub Actions secret `DATA_GO_KR_API_KEY`로만 주입(키 없으면 조용히 skip).
  프런트 데이터 화면에 대사 상태 칩 표시.
- **PV 스타일 UI**: 성과 요약 테이블(포트폴리오 vs 벤치마크 17개 지표), 성장 차트
  로그 스케일·물가 조정 토글, 연도별 수익률 그룹 막대차트, 히어로 지표 카드 4개.
- **폰트 스케일 전면 상향**: 7~15px → 10~16px (가독성).

### `353c264` 정적 실데이터 연결 (Codex)

- ETF 147 + 지수 3 데이터마트(data/*.json), 수집기·검증기·GitHub Actions 일일 갱신,
  티커 자동완성. 공급자: 네이버 유니버스 + Yahoo 수정종가 + SEIBro 설정일
  (`provisional`).

## 운영 메모 (에이전트 공통)

- 검증 루틴: `python -m unittest discover -s tests` + `node --check app.js engine.js
  share.js portfolio.js` + 로컬 서버(`python -m http.server 8123`)로 브라우저 확인.
- 데이터 갱신 워크플로: `.github/workflows/update-market-data.yml` (평일 20:15 KST).
  전체 파이프라인 문서는 `docs/DATA_PIPELINE.md`, 산식은 `docs/CALCULATION_METHODS.md`,
  로드맵은 `docs/DEVELOPMENT_PLAN.md` 참고.
- 미해결 후속 과제: 분배금 원장(SEIBro) 독립 대사, 시세 원천의 공공 API 전환,
  ETF 종목별 랜딩 페이지(`/etf/<ticker>`), 유료화 전 데이터 라이선스 검토.
