# 실데이터 안내 배너 제거 Design QA

- source visual truth path:
  - `C:\Users\jsu01\AppData\Local\Temp\codex-clipboard-b731fd3b-490e-47d5-a540-5cf4194cb083.png`
  - `C:\Users\jsu01\AppData\Local\Temp\codex-clipboard-f5685520-824e-4837-afc1-7eac5a445049.png`
- implementation screenshot path:
  - `C:\Users\jsu01\OneDrive\바탕 화면\Codex\backtest-k\.codex-artifacts\banner-removed-desktop.png`
  - `C:\Users\jsu01\OneDrive\바탕 화면\Codex\backtest-k\.codex-artifacts\data-tab-banner-removed.png`
  - `C:\Users\jsu01\OneDrive\바탕 화면\Codex\backtest-k\.codex-artifacts\data-tab-banner-removed-mobile.png`
- viewport: desktop 1887x891, mobile 390x844
- state: 다크 테마, 백테스트 및 데이터 탭

## Full-view comparison evidence

- 기준 화면과 수정 화면을 같은 비교 입력에서 확인했다.
- 상단 내비게이션 아래의 `실데이터 150개 · 기준일 · 데이터 안내` 배너가 완전히 제거됐다.
- 배너가 차지하던 38px 영역과 하단 테두리가 함께 없어져 상단 내비게이션 다음에 본문이 바로 이어진다.
- 데이터 탭 본문의 카탈로그 상태 카드와 CSV 업로드 기능은 유지된다.

## Focused region comparison evidence

- 데스크톱 측정값은 상단 바 하단과 본문 시작점이 모두 72px로 일치하며 빈 공간이 없다.
- 모바일 390px에서 문서 너비와 스크롤 너비가 모두 390px이고 가로 넘침이 없다.

## Required fidelity surfaces

- Fonts and typography: 기존 내비게이션과 본문 타이포그래피를 변경하지 않았다.
- Spacing and layout rhythm: 배너 높이만 제거하고 기존 본문 패딩과 카드 간격을 유지했다.
- Colors and visual tokens: 배너 전용 색상 규칙만 제거하고 기존 토큰은 유지했다.
- Image quality and asset fidelity: 이미지 자산 변경 없음.
- Copy and content: 요청된 실데이터 안내 문구만 제거했으며 데이터 탭 내부 정보는 유지했다.

## Primary interactions tested

- 백테스트 초기 화면 로드
- 데이터 탭 전환과 `#data` 상태
- 실데이터 카탈로그 상태 카드 렌더링
- 데스크톱·모바일 반응형
- 브라우저 오류 오버레이 없음, 콘솔 오류 0건

## Findings

- P0/P1/P2 시각 또는 사용성 결함 없음.

final result: passed
