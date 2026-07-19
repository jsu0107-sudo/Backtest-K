# 원화 금액 입력 Design QA

- source visual truth path: `C:\Users\jsu01\AppData\Local\Temp\codex-clipboard-3373af40-e4de-48bf-b151-d8343059374f.png`
- implementation screenshot path: `C:\Users\jsu01\OneDrive\바탕 화면\Codex\backtest-k\.codex-artifacts\currency-input-final-v3.png`
- viewport: mobile 390x844
- state: 다크 테마, 균형 성장 포트폴리오, 투자 조건 입력 화면

## Full-view comparison evidence

- 기준 이미지와 구현 화면을 같은 비교 입력에서 검토했다.
- 기존 투자 조건 카드의 색상, 테두리, 라벨, 입력 높이와 간격을 유지했다.
- 초기 투자금과 월 적립금에 원화 접두어 `₩`를 추가하고 값을 각각 `50,000,000`, `1,000,000`으로 표시했다.
- 390px 뷰포트에서 문서 가로 너비와 스크롤 너비가 모두 390px이며 가로 넘침이 없다.

## Focused region comparison evidence

- 두 금액 입력란의 `₩` 접두어가 숫자 앞에서 일정한 간격으로 정렬된다.
- 천 단위 쉼표가 자동 적용되고 숫자 폭이 바뀌어도 입력란 내부 정렬이 유지된다.
- 입력란 포커스 시 기존 강조색을 사용하며, 포커스를 벗어나면 기존 카드 스타일로 복귀한다.

## Required fidelity surfaces

- Fonts and typography: 기존 폰트, 라벨 크기, 입력 값 굵기와 숫자 정렬을 유지했다.
- Spacing and layout rhythm: 기존 입력 높이와 카드 간격을 유지하고 접두어 공간만 내부 패딩으로 확보했다.
- Colors and visual tokens: 기존 `--muted`, `--accent`, `--border` 토큰을 재사용했다.
- Image quality and asset fidelity: 이미지 자산이 없는 폼 기능으로 별도 이미지 품질 항목은 해당하지 않는다.
- Copy and content: 기존 한글 라벨을 유지하고 원화 단위를 `₩` 접두어로 명확히 표시했다.

## Primary interactions tested

- 숫자 직접 입력 시 천 단위 쉼표 자동 적용
- `₩2500000원` 붙여넣기 시 `2,500,000`으로 정규화
- 빈 값에서 포커스를 벗어나면 `0`으로 복구
- 설정 저장 시 쉼표 없는 숫자 값으로 저장
- 새로고침 후 저장된 숫자를 쉼표 형식으로 복원
- 백테스트 실행 시 표시용 쉼표를 제거한 숫자로 계산
- 브라우저 오류 오버레이 없음, 콘솔 오류 0건

## Findings

- P0/P1/P2 사용성 또는 시각 결함 없음.

final result: passed
