# 백테스트K MVP

한국 투자자가 원화 기준으로 포트폴리오 백테스트, 적립식 투자, 리밸런싱, 자산 비교, 몬테카를로 시뮬레이션을 실행할 수 있는 정적 웹앱입니다. 국내 상장 ETF 상위권과 대표지수의 월 수익률을 정적 JSON으로 제공하므로 별도 서버나 DB가 필요 없습니다.

## 바로 실행

### 방법 1 — 단일 파일

`backtestK_single.html`을 더블클릭하면 브라우저에서 바로 실행됩니다.

> 단일 파일판은 오프라인 UI 확인용 합성 데모입니다. 자동 갱신 실데이터는 HTTP로 실행하는 프로젝트판과 Vercel 배포판에서만 로드됩니다.

### 방법 2 — 프로젝트 폴더

```bash
cd backtest-k-mvp
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다.

## 구현 기능

- 티커·ETF명 자동완성으로 최대 8개 자산 구성
- 국내 상장 ETF 시가총액 상위권 147개 + KOSPI·KOSPI 200·S&P 500
- 종목별 JSON 지연 로딩과 공통 분석기간 자동 조정
- 초기 투자금과 월 적립금 반영
- 월초/월말 적립 시점 선택
- 리밸런싱 없음·월·분기·반기·연 단위 선택
- 거래비용(bp), 물가상승률, 무위험수익률 입력
- 벤치마크 비교
- TWRR, MWRR, 최대낙폭, 변동성, 샤프, 소르티노, 베타
- 자산 성장·납입 원금·벤치마크 차트
- 드로다운, 연도별 수익률, 목표 비중, 위험기여도, 상관관계
- 과거 월 수익률 부트스트랩 또는 정규분포 몬테카를로
- 목표 달성 확률, 하방 10%, 중앙값, 자산 고갈 확률
- 2~6개 자산 핵심 지표 비교
- 가격 또는 수익률 CSV 업로드
- 결과 CSV 내보내기
- 다크·라이트 테마, 모바일 반응형 UI

## 실데이터의 성격과 한계

현재 `data/`는 다음 프로토타입 수집 경로로 생성됩니다.

- 네이버페이 증권 ETF 목록: 국내 ETF 종목과 시가총액 순위
- Yahoo Finance chart: 일별 수정종가, 분배 이벤트, 대표지수 종가
- 한국예탁결제원 SEIBro: ETF 설정일

ETF 월 수익률은 월말 **수정종가**의 변화율이라 공급자가 제공하는 분배금 조정계수를 반영합니다. 다만 분배금 원장과 조정계수를 독립적으로 대사하지 않았으므로 모든 JSON의 `provider_status`와 `data_quality.status`를 `provisional`로 표시합니다. KOSPI·KOSPI 200·S&P 500은 배당을 포함하지 않는 가격지수입니다.

추가 CSV는 서버로 전송되지 않고 현재 브라우저에서 파싱되며 사용자 자산은 `localStorage`에 저장됩니다.

## 정적 데이터 파이프라인

```text
Python 수집기
  → 종목별 월 수익률 JSON + data/assets.json
  → 스키마·범위 검증
  → GitHub Actions 평일 1회 실행 및 변경 커밋
  → Vercel이 같은 정적 사이트/CDN으로 자동 배포
  → 브라우저가 카탈로그와 선택 종목만 fetch
```

로컬 갱신과 검증:

```bash
python scripts/build_market_data.py --limit 150 --min-etfs 100 --workers 8
python -m unittest discover -s tests -v
python scripts/validate_market_data.py data --min-etfs 100 --max-etfs 200
```

GitHub Actions 워크플로는 `.github/workflows/update-market-data.yml`에 있으며 `workflow_dispatch`로도 실행할 수 있습니다. 정적 데이터 계약과 공급자 교체 지침은 `docs/DATA_PIPELINE.md`를 참고하세요.

종목 JSON의 핵심 필드:

```json
{
  "ticker": "069500",
  "listing_date": "2002-10-11",
  "data_as_of": "2026-07-16",
  "distribution": {
    "included": true,
    "method": "adjusted_close",
    "verification_status": "provider_adjusted_not_independently_reconciled"
  },
  "sources": [],
  "monthly_returns": [
    { "month": "2026-06", "return": 0.1234, "observation_date": "2026-06-30" }
  ]
}
```

## CSV 형식

### 수정주가 방식

```csv
date,ticker,name,adjusted_close
2024-01-31,069500,KODEX 200,31542.18
2024-02-29,069500,KODEX 200,32211.05
2024-03-29,069500,KODEX 200,31980.24
```

- `adjusted_close`, `adj_close`, `close` 중 하나를 사용할 수 있습니다.
- 일별 행이 여러 개면 각 월의 가장 늦은 날짜 값을 월말 가격으로 사용합니다.
- 가격에서 월간 수익률을 계산하므로 종목별 가격 관측치가 최소 3개 필요합니다.
- 배당·분배금·분할을 포함하는 수정주가 또는 총수익지수 사용을 권장합니다.

### 월 수익률 방식

```csv
date,ticker,name,return
2024-01,MYETF,나의 ETF,0.031
2024-02,MYETF,나의 ETF,-0.018
2024-03,MYETF,나의 ETF,2.1%
```

- 소수 또는 `%` 표기 모두 지원합니다.
- 월별 수익률 관측치가 최소 2개 필요합니다.
- 한 파일에 여러 ticker를 함께 넣을 수 있습니다.

예제 파일: `sample-data.csv`

## 계산 원칙 요약

- 포트폴리오 월 수익률은 월초 보유금액의 실제 자산별 수익률을 합산해 계산합니다.
- 리밸런싱 회전율은 목표금액과 현재금액 차이 절댓값 합계의 1/2입니다.
- 거래비용은 적립금 매수와 리밸런싱 회전율에 동일한 bp를 적용합니다.
- TWRR은 현금흐름 영향을 제거한 월간 단위지수의 기하수익률입니다.
- MWRR은 초기금·적립금·최종자산의 월 IRR을 연율화합니다.
- 최대낙폭은 적립금의 영향을 받지 않도록 TWRR 단위지수에서 계산합니다.
- 연환산 변동성은 월 수익률 표준편차에 `sqrt(12)`를 곱합니다.
- 몬테카를로 부트스트랩은 과거 월 수익률을 복원추출합니다. 정규모형은 과거 평균·표준편차를 사용합니다.

세부 산식은 `docs/CALCULATION_METHODS.md`를 참고하세요.

## 정적 배포

### Vercel CLI

```bash
cd backtest-k-mvp
npx vercel --prod
```

### 다른 정적 호스팅

`index.html`, `styles.css`, `app.js`, `favicon.svg`, `data/`를 동일한 디렉터리에 업로드하면 됩니다. GitHub Pages, Cloudflare Pages, Netlify 등에서도 별도 빌드 없이 배포할 수 있습니다.

## 상용화 전 필수 작업

1. 공공데이터포털 금융위원회 ETF 시세 API 키 기반 원시 종가 수집으로 교체
2. ETF 분배금 원장, 분할, 합병, 상장폐지, 생존편향 처리와 독립 대사
3. 수정주가와 총수익지수 산식·버전·출처의 외부 검증
4. 국내/해외 ETF의 환율 기준과 환헤지 처리 명문화
5. ISA·연금저축·IRP·일반계좌별 세금 로직을 검증 가능한 규칙 엔진으로 분리
6. 데이터 재배포, 지수 사용, 상표·라이선스 권한 검토
7. 계산 API 회귀 테스트와 기준 포트폴리오 골든 데이터 구축
8. 이용약관, 개인정보처리방침, 투자 위험 고지 작성

제품 확장 순서는 `docs/PRODUCT_ROADMAP.md`에 정리했습니다.

## 파일 구조

```text
backtest-k-mvp/
├── .github/workflows/update-market-data.yml
├── data/
│   ├── assets.json
│   ├── 069500.json
│   └── INDEX_KOSPI.json
├── scripts/
│   ├── build_market_data.py
│   └── validate_market_data.py
├── tests/test_market_data.py
├── index.html
├── styles.css
├── app.js
├── favicon.svg
├── backtestK_single.html
├── sample-data.csv
├── vercel.json
├── README.md
└── docs/
    ├── CALCULATION_METHODS.md
    ├── DATA_PIPELINE.md
    └── PRODUCT_ROADMAP.md
```

## 범위 제한

이 MVP는 교육·연구 및 제품 검증용입니다. 데이터 정확성, 세금, 매매 가능성, 시장충격, 슬리피지, 환전비용, 추적오차, 분배금 과세를 완전하게 재현하지 않습니다. 투자 권유 또는 개인화된 투자자문을 제공하지 않습니다.
