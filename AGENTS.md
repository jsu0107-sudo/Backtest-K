# 백테스트K 에이전트 가이드

한국 투자자용 포트폴리오 백테스트 정적 웹앱. 빌드 없음(바닐라 JS + 정적 JSON
데이터마트), Vercel 배포(https://backtest-k.vercel.app), GitHub Actions가 평일마다
데이터 갱신.

## 변경 추적 (필수)

- **기능 변경 커밋을 만들면 `docs/CHANGELOG.md`에 항목을 추가한다.** 커밋 해시·요약·
  주의사항(불변 조건)을 기록한다. 여러 도구(Claude Code, Codex)가 같은 저장소에서
  작업하므로 이 파일이 공용 인수인계 문서다.
- 데이터 자동 갱신 커밋(`chore(data)`)은 기록하지 않는다.

## 불변 조건 (어기면 사용자 신뢰 훼손)

1. **계산은 `core/`에만 둔다**: 백테스트 산식의 유일한 소스는 `core/backtest.js` +
   `core/stats.js`(순수 ESM, DOM·전역 상태 의존 없음)다. `app.js`는 DOM 입출력과
   렌더링만 담당한다. 산식을 수정하면 **반드시 `npm test`**로 골든 회귀
   (`tests/fixtures/golden-backtest.json`)를 확인한다. 골든이 깨졌는데 의도한
   변경이 아니면 되돌린다.
   - 골든 픽스처는 입력 수익률까지 동결돼 있어 데이터 갱신에 영향받지 않는다.
     "라이브 data/와 동결 입력이 일치" 테스트만 깨졌다면 **코드가 아니라 데이터
     개정**이므로, 확인 후 픽스처를 갱신한다.
   - `engine.js`의 `runStaticBacktest`는 아직 공유·랜딩 페이지용 축약 사본이다
     (지표 일부 없음). **후속 과제**: `core/`로 통일. 그때까지 본편 산식을 바꾸면
     공유 페이지 수치와 어긋날 수 있음을 인지할 것.
2. **공유 코덱 v1/v2**: 레거시 `?c=`(v1, base64url JSON `{v:1,n,a,b,s,e,i,m,t,r,c,f,rf}`)와
   스냅숏 프래그먼트(v2, `/p/<slug>#<payload>`, deflate 압축, `engine.js
   encodeSnapshot/decodeSnapshot`) 모두 이미 배포된 링크가 있으므로 하위 호환을
   깨지 않는다. 필드 추가는 가능, 의미 변경·삭제는 금지. v2 스냅숏은 "데이터가
   갱신돼도 수치 불변"이 제품 약속이다 — 공유 페이지에서 스냅숏을 재계산으로
   대체하지 말 것.
3. **데이터 계약**: `data/*.json` 스키마는 `scripts/validate_market_data.py`가 검증하는
   계약이다. 필드 삭제 금지, 추가는 허용. 프런트 수정 없이 공급자를 교체할 수 있어야
   한다 (docs/DATA_PIPELINE.md).
4. **생성물은 직접 수정하지 않는다** (모두 `npm test`가 최신성을 감시한다):
   - `/portfolio/*.html` → `scripts/build_portfolio_pages.py`의 PAGES 수정 후 재생성
   - `backtestK_single.html` → `npm run build:single` (소스는 index/styles/engine/core/app 한 벌뿐)
   - `index.html`의 `<!-- BEGIN/END PRECOMPUTED -->` 블록, `data/precomputed/*`
     → `npm run precompute`. 첫 화면 샘플이므로 데이터 갱신 시 CI가 자동 재생성한다.
   - ⚠️ 생성 스크립트에서 파일 내용을 `String.replace`로 끼워 넣을 때는 **반드시 함수 치환**을
     쓴다. 문자열 치환은 `$$`·`$&`를 특수 패턴으로 해석해 코드를 조용히 망가뜨린다.
5. **인증키**: `DATA_GO_KR_API_KEY`는 GitHub Actions secret로만 주입. 저장소·프런트·
   생성 JSON에 키를 기록하지 않는다.
6. **통화 입력**: `#initialAmount`/`#monthlyContribution` 값은 콤마 포맷 문자열 —
   읽기 `parseCurrencyInputValue`, 쓰기 `formatCurrencyInputValue`.
7. **계측 이벤트는 3개로 고정**: `page_view`·`backtest_run`·`result_share`.
   추가 요청이 없으면 늘리지 않는다. `backtest_run`은 사용자가 직접 실행한 경우만
   (`userInitiated`) — 사전 계산 샘플 렌더·초기 자동 실행은 제외해야 완료율이 정확하다.

## 검증 루틴

```bash
python -m unittest discover -s tests
python scripts/validate_market_data.py data
node --check app.js && node --check engine.js && node --check share.js && node --check portfolio.js
python -m http.server 8123   # 브라우저에서 백테스트 실행·공유·랜딩 확인
```

## 문서 지도

| 문서 | 내용 |
|---|---|
| docs/CHANGELOG.md | 변경 이력·인수인계 (커밋마다 갱신) |
| docs/DEVELOPMENT_PLAN.md | 로드맵 M0~M4, 데이터 소스 전략 |
| docs/DATA_PIPELINE.md | 데이터마트 계약, 수집기, 공식 API 대사 |
| docs/CALCULATION_METHODS.md | 백테스트 산식 정의 |
| docs/PRODUCT_ROADMAP.md | 제품 단계·수익화 구상 |
