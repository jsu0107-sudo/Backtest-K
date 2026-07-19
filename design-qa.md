# Drawdown 비교 차트 및 과거 낙폭 표 Design QA

- source visual truth path:
  - `C:\Users\jsu01\AppData\Local\Temp\codex-clipboard-d19a672c-d7cc-4ec8-9df5-826dfaa0ed26.png`
  - `C:\Users\jsu01\AppData\Local\Temp\codex-clipboard-4ecf6edb-6ccd-42ab-a4be-92c9ce24f5cb.png`
- implementation screenshot path:
  - `C:\Users\jsu01\OneDrive\바탕 화면\Codex\backtest-k\.codex-artifacts\drawdown-desktop-viewport.png`
  - `C:\Users\jsu01\OneDrive\바탕 화면\Codex\backtest-k\.codex-artifacts\drawdown-mobile-fixed.png`
  - `C:\Users\jsu01\OneDrive\바탕 화면\Codex\backtest-k\.codex-artifacts\drawdown-table-mobile.png`
- viewport: desktop 1440×1000, mobile 390×844
- state: 다크 테마, 균형 성장 포트폴리오, 벤치마크 KOSPI, 2022.01–2026.06

## Full-view comparison evidence

- 기준 이미지 1의 핵심 구조인 0% 기준선 아래 포트폴리오·벤치마크 이중 낙폭선을 재현했다. 구현 화면은 기존 백테스트K 디자인 시스템에 맞춰 포트폴리오 민트, 벤치마크 블루 토큰을 사용한다.
- 기준 이미지 2의 8개 열 구조를 `순위 / 시작 / 저점 / 하락 기간 / 전고점 회복 / 회복 기간 / 수중 기간 / 낙폭`으로 한국어화했다. 행은 최악 낙폭부터 내림차순으로 최대 10개가 표시된다.
- 기준 이미지의 흰 배경·영문 타이포그래피는 독립 화면의 시각 스타일이며, 구현은 기존 제품의 다크 카드, 한글 UI 글꼴, 간격, 테두리, 색상 토큰을 의도적으로 유지했다.

## Focused region comparison evidence

- 차트: 범례, 0% 상단 축, 두 계열 선, 월 툴팁을 확대 확인했다. 툴팁에는 같은 월의 `포트폴리오`와 `KOSPI` 낙폭이 함께 표시된다.
- 표: 날짜, 기간, 회복 여부, 낙폭 정렬을 확대 확인했다. 분석 종료월을 2022.12로 바꾼 상태에서 `미회복`, `—`, `9개월 · 진행 중` 표시를 확인했다.
- 모바일: 390px에서 페이지 전체 가로 넘침 없이 차트가 332px로 축소되고, 820px 표만 카드 안에서 좌우 스크롤되는 것을 확인했다.

## Required fidelity surfaces

- Fonts and typography: 기존 시스템 글꼴, 헤딩/eyebrow/표 헤더의 크기와 굵기 체계를 유지했다. 모바일에서도 제목과 범례가 겹치지 않는다.
- Spacing and layout rhythm: 기존 14px 카드 간격과 카드 패딩을 유지했다. 차트·위험 요약 다음에 전체 폭 표를 배치해 정보 흐름을 보존했다.
- Colors and visual tokens: 기존 `--accent`, `--blue`, `--red`, `--orange`, `--border` 토큰만 사용했다. 낙폭 값과 미회복 상태의 의미 색상이 구분된다.
- Image quality and asset fidelity: 이번 기능은 Canvas 차트와 데이터 표로 구성되어 별도 이미지·로고·아이콘 자산이 없다. 소스 이미지를 화면 자산으로 재사용하지 않았다.
- Copy and content: 모든 열 이름과 상태 문구를 한국어로 제공하고, 수중 기간 계산 기준을 표 하단에 명시했다.

## Findings

- 현재 남아 있는 P0/P1/P2 시각 또는 사용성 이슈 없음.
- P3 허용 사항: 8개 열을 모바일 한 화면에 축약하면 정보 의미가 훼손되므로, 표 내부 좌우 스크롤을 의도적으로 유지했다.

## Comparison history

1. 초기 비교에서 390px 모바일 화면의 결과 그리드가 표의 최소 콘텐츠 너비에 밀려 868px까지 확장되는 P2 가로 넘침을 확인했다.
2. 결과 패널의 직접 자식에 `min-width: 0`, 표 스크롤 영역에 `max-width: 100%`를 적용했다.
3. 수정 후 브라우저 측정값은 `documentElement clientWidth=390`, `scrollWidth=390`, 차트 너비 332px, 표 뷰포트 332px, 표 콘텐츠 820px였다. 수정 후 증거는 `drawdown-mobile-fixed.png`와 `drawdown-table-mobile.png`다.

## Primary interactions tested

- 기본 백테스트 결과 로드와 위험 분석 탭 렌더링
- Drawdown Canvas의 두 계열 범례 및 hover 툴팁
- 과거 낙폭 행의 최악 순 정렬
- 미회복 구간의 상태와 기간 표시
- 데스크톱·모바일 반응형 및 표 내부 가로 스크롤
- 오류 오버레이 없음, 브라우저 오류 0건

## Implementation checklist

- [x] 포트폴리오·BM 낙폭 비교선
- [x] 한국어 과거 낙폭 순위표
- [x] 미회복 구간 처리
- [x] 모바일 레이아웃
- [x] 브라우저 기능·시각 검증

final result: passed
