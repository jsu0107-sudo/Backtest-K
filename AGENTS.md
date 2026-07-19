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

1. **산식 동기화**: `engine.js`의 `runStaticBacktest`는 `app.js`의 `runBacktest`와
   동일한 산식이어야 한다. 본편 산식을 바꾸면 engine.js도 같이 바꾸고, 공유
   페이지(share.html) 수치가 본편 결과와 일치하는지 확인한다.
2. **공유 코덱 v1**: `?c=` 파라미터(base64url JSON, `{v:1,n,a,b,s,e,i,m,t,r,c,f,rf}`)는
   이미 배포된 공유 링크가 있으므로 하위 호환을 깨지 않는다. 필드 추가는 가능,
   의미 변경·삭제는 금지.
3. **데이터 계약**: `data/*.json` 스키마는 `scripts/validate_market_data.py`가 검증하는
   계약이다. 필드 삭제 금지, 추가는 허용. 프런트 수정 없이 공급자를 교체할 수 있어야
   한다 (docs/DATA_PIPELINE.md).
4. **/portfolio/*.html은 생성물**: 직접 수정하지 말고
   `scripts/build_portfolio_pages.py`의 PAGES를 고친 뒤 재생성한다.
5. **인증키**: `DATA_GO_KR_API_KEY`는 GitHub Actions secret로만 주입. 저장소·프런트·
   생성 JSON에 키를 기록하지 않는다.
6. **통화 입력**: `#initialAmount`/`#monthlyContribution` 값은 콤마 포맷 문자열 —
   읽기 `parseCurrencyInputValue`, 쓰기 `formatCurrencyInputValue`.

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
