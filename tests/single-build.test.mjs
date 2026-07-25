// backtestK_single.html은 생성 산출물이다.
// 소스(index.html, styles.css, engine.js, core/*.js, app.js)를 고치고 재생성을 잊으면
// 예전처럼 계산 코드가 이중화된다. 그 상태를 여기서 잡는다.
//
// 실패하면: npm run build:single

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildSingleHtml } from "../scripts/build_single.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// 줄바꿈은 체크아웃 설정(core.autocrlf)에 따라 달라지므로 비교 전에 정규화한다.
const onDisk = readFileSync(join(root, "backtestK_single.html"), "utf8").replace(/\r\n/g, "\n");

test("backtestK_single.html이 현재 소스와 일치 (재생성 누락 감시)", () => {
  assert.equal(
    buildSingleHtml(),
    onDisk,
    "단일 파일이 소스와 다르다 — `npm run build:single`로 재생성하라",
  );
});

test("단일 파일에 모듈 구문이 남아 있지 않다", () => {
  assert.equal(/^\s*import\s+[\w{*]/m.test(onDisk), false, "import 문이 남아 있다");
  assert.equal(/^\s*export\s+(const|let|var|function|class|async)/m.test(onDisk), false, "export 문이 남아 있다");
});

test("단일 파일이 외부 리소스에 의존하지 않는다", () => {
  const externals = [...onDisk.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((match) => match[1]);
  // 전략 모음(./portfolio/)은 온라인 전용 링크라 예외로 둔다.
  const blocking = externals.filter((path) => path !== "./portfolio/");
  assert.deepEqual(blocking, [], `인라인되지 않은 외부 참조: ${blocking.join(", ")}`);
});

test("단일 파일에 최신 기능이 포함돼 있다", () => {
  for (const marker of ["modeQuick", "shareButton", "drawdownHistory", "precomputedSample", "periodNotice"]) {
    assert.ok(onDisk.includes(marker), `단일 파일에 ${marker}가 없다 — 낙후된 사본이다`);
  }
});
