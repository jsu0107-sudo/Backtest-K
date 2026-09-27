import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('몬테카를로 설명 카드 두 개는 전용 내부 여백을 갖는다', () => {
  assert.equal((html.match(/class="card mc-context-card"/g) || []).length, 2);
  assert.match(css, /\.mc-context-card\s*\{\s*padding:\s*24px;/);
  assert.match(css, /@media\s*\(max-width:\s*620px\)\s*\{\s*\.mc-context-card\s*\{\s*padding:\s*20px;/);
});

test('백테스트가 아닌 화면에서는 모바일 백테스트 고정 버튼을 숨긴다', () => {
  assert.match(css, /body:not\(:has\(#view-backtest\.active\)\)\s+\.sticky-run\s*\{\s*display:\s*none;/);
});
