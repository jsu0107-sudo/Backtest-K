# 백테스트K 정적 실데이터 파이프라인

## 운영 계약

`data/assets.json`이 검색용 카탈로그이고, 각 `assets[*].file`이 종목별 월 수익률 파일을 가리킨다. 프런트는 최초 진입 때 카탈로그만 읽고 사용자가 선택한 자산과 벤치마크 파일만 지연 로드한다.

모든 종목 파일은 다음 항목을 반드시 포함한다.

- `monthly_returns`: 정렬된 `month`, `return`, `observation_date`
- `distribution.included`: 분배금 반영 여부
- `distribution.method`와 `verification_status`: 계산·검증 상태
- `data_as_of`: 원시 데이터 최신 관측일
- `listing_date`와 `listing_date_source`
- `sources`: 이름, URL, 용도

`scripts/validate_market_data.py`가 이 계약, ETF 100~200개 범위, KOSPI·KOSPI 200·S&P 500 존재 여부를 검사한다. 검증에 실패하면 수집기는 기존 `data/`를 덮어쓰지 않고 GitHub Actions도 커밋하지 않는다.

## 현재 공급자

현재 경로는 API 키 없이 초기 실서비스 형태를 검증하기 위한 `provisional` 공급자다.

| 역할 | 공급자 | 출력 사용 |
|---|---|---|
| ETF 유니버스·순위 | 네이버페이 증권 ETF 목록 | 시가총액 상위 150개 요청 |
| 일별 시계열 | Yahoo Finance chart | ETF 수정종가, 대표지수 가격지수 |
| 설정일 | 한국예탁결제원 SEIBro | `listing_date` |

ETF는 수정종가 비율을 사용해 `distribution.included=true`로 기록하지만 `verification_status=provider_adjusted_not_independently_reconciled`다. 이는 분배금 반영을 공급자 조정계수에 의존한다는 뜻이며 총수익 원장을 독립 검증했다는 뜻이 아니다. 대표지수는 가격지수이므로 `distribution.included=false`다.

## 갱신

`.github/workflows/update-market-data.yml`은 한국 장 마감 뒤인 평일 20:15 KST(11:15 UTC)에 실행된다.

1. Python 3.12로 상위 150개 ETF와 대표지수를 수집한다.
2. ETF 최소 100개와 대표지수 3개가 모두 있어야 게시한다.
3. 변환 단위 테스트와 전체 JSON 스키마 검증을 실행한다.
4. `data/` 변경이 있을 때만 기본 브랜치에 커밋·푸시한다.
5. GitHub와 연결된 Vercel 프로젝트가 새 정적 파일을 배포한다.

GitHub 예약 실행은 기본 브랜치에서만 동작하며 부하 상황에 따라 지연될 수 있다. 공개 저장소가 60일 동안 활동이 없으면 예약 워크플로가 비활성화될 수 있으므로 Actions 상태를 운영 체크리스트에 포함한다.

## 공식 공공 API 대사 (구현됨)

`scripts/verify_official_prices.py`가 공공데이터포털 `금융위원회_증권상품시세정보/getETFPriceInfo`의 공표 종가와, 수집기가 종목별 JSON에 기록한 최신 원시 종가(`latest_raw_close`)를 같은 날짜 기준으로 대조한다.

- 결과는 `data/official_verification.json`에 기록되며(일치·불일치·최대 괴리 bp), 프런트 데이터 화면이 이 파일을 읽어 대사 상태를 표시한다.
- 인증키는 환경변수 `DATA_GO_KR_API_KEY`로만 주입한다. GitHub 저장소 **Settings → Secrets and variables → Actions**에 같은 이름의 secret을 등록하면 매일 갱신 워크플로가 자동으로 대사를 수행한다. 키가 없으면 대사 단계는 조용히 건너뛴다.
- 로컬 실행: PowerShell에서 `$env:DATA_GO_KR_API_KEY = "발급키"; python scripts/verify_official_prices.py data`
- 이 대사는 "시세 원천이 거래소 공표값과 일치하는가"를 검증한다. 분배금이 반영된 수정종가 산식 자체의 검증은 아니며, 그건 아래 후속 작업이 필요하다.

## 공식 공공 API 전환 (후속)

상업화 전에 카탈로그와 시세 공급자 자체를 공공데이터포털 API로 교체한다. 인증키는 위와 동일하게 secret으로만 주입하고 브라우저나 JSON에 키를 기록하지 않는다.

공식 API의 원시 종가는 분배금을 포함하지 않으므로 다음 단계가 추가로 필요하다.

1. 예탁결제원 또는 계약 공급자의 분배금 원장을 수집한다.
2. 분배락일, 지급액, 분할·병합을 반영한 자체 총수익 계수를 계산한다.
3. 현재 JSON 계약을 그대로 출력하되 `distribution.method`를 산식 버전으로 교체한다.
4. 표본 ETF의 총수익을 외부 기준과 대사한 뒤 `provider_status=verified`로 올린다.

공급자 교체는 프런트 변경 없이 `data/` 생성기만 바꾸는 것이 원칙이다.
