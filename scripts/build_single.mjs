// backtestK_single.html을 소스에서 생성한다.
//
//   npm run build:single
//
// 예전에는 이 파일을 손으로 관리해서 계산 코드가 이중화돼 있었다(최초 커밋 이후
// 8일간 갱신 누락). 이제는 index.html + styles.css + engine.js + core/*.js + app.js를
// 인라인해 만드는 산출물이며, 소스는 한 벌만 둔다.
//
// ESM(import/export)을 클래식 스크립트 한 덩어리로 바꾸는 방식:
//   1) `export ` 접두사 제거 → 모듈의 선언이 그대로 최상위 선언이 된다
//   2) `import ... from "..."` 문 제거. 단 `A as B` 별칭은 `const B = A;`로 보존
//   3) 의존 순서대로 이어 붙인다 (core → engine → app)
//
// 단일 파일은 file://로 열리므로 data/*.json을 fetch할 수 없다.
// 따라서 실데이터 대신 합성 데모로 자동 폴백된다 (오프라인 UI 확인용).

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

// core는 의존 순서대로. backtest.js가 stats.js를 쓰므로 stats가 먼저다.
const CORE_MODULES = [
  "core/version.js",
  "core/stats.js",
  "core/data-loader.js",
  "core/sample-portfolio.js",
  "core/backtest.js",
];

const IMPORT_STATEMENT = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|([\w$*]+))\s+from\s+["'][^"']+["'];?/g;

// import 문을 제거하되, `A as B` 별칭은 동등한 선언으로 남긴다.
function stripModuleSyntax(source, label) {
  const aliases = [];
  const withoutImports = source.replace(IMPORT_STATEMENT, (_match, _def, named) => {
    if (named) {
      named.split(",").forEach((entry) => {
        const [original, alias] = entry.split(/\s+as\s+/).map((token) => token.trim());
        if (alias && original && alias !== original) aliases.push(`const ${alias} = ${original};`);
      });
    }
    return "";
  });
  const withoutExports = withoutImports.replace(/^export\s+(?=(const|let|var|function|async|class)\b)/gm, "");
  if (/^\s*export\s/m.test(withoutExports)) {
    throw new Error(`${label}: 처리하지 못한 export 문이 있다. build_single.mjs를 확장하라.`);
  }
  return `${aliases.join("\n")}\n${withoutExports}`.trim();
}

export function buildSingleHtml() {
  let html = read("index.html");

  // 1) 외부 스타일시트 → 인라인
  // ⚠️ 치환값에 파일 내용이 들어갈 때는 반드시 함수 치환을 쓴다.
  //    문자열 치환은 `$$`·`$&`·`$1`을 특수 패턴으로 해석해 코드를 조용히 망가뜨린다
  //    (실제로 app.js의 `$$` 헬퍼가 `$`로 뭉개져 번들이 통째로 죽은 적이 있다).
  const css = read("styles.css");
  html = html.replace(
    /\s*<link rel="stylesheet" href="\.\/styles\.css" \/>/,
    () => `\n  <style>\n${css}\n  </style>`,
  );
  if (html.includes('href="./styles.css"')) throw new Error("styles.css 링크를 인라인하지 못했다.");

  // 2) 파비콘 → data URI (완전한 단일 파일로)
  const favicon = read("favicon.svg");
  html = html.replace(
    /href="\.\/favicon\.svg"/,
    () => `href="data:image/svg+xml;base64,${Buffer.from(favicon, "utf8").toString("base64")}"`,
  );

  // 3) 스크립트 3종(engine + core + app) → 클래식 스크립트 한 덩어리
  const bundle = [
    "// ⚠️ 이 파일은 자동 생성물이다. 직접 수정하지 마라 — npm run build:single 로 재생성한다.",
    "// 소스: index.html, styles.css, engine.js, core/*.js, app.js",
    read("engine.js"),
    ...CORE_MODULES.map((path) => stripModuleSyntax(read(path), path)),
    stripModuleSyntax(read("app.js"), "app.js"),
  ].join("\n\n");

  html = html.replace(
    /\s*<script src="\.\/engine\.js"><\/script>\s*<script type="module" src="\.\/app\.js"><\/script>/,
    () => `\n  <script>\n${bundle}\n  </script>`,
  );
  if (html.includes('src="./app.js"')) throw new Error("app.js 스크립트 태그를 인라인하지 못했다.");

  // 4) 생성물 표기 + 오프라인 안내
  html = html.replace(
    /<title>([^<]*)<\/title>/,
    (_match, title) => `<title>${title} (단일 파일)</title>\n  <!-- 자동 생성물 — 수동 편집 금지. npm run build:single 로 재생성한다. -->`,
  );

  // Windows 체크아웃(core.autocrlf)에서 소스가 CRLF로 내려와도 산출물은 항상 LF로 고정한다.
  // 그래야 "재생성 누락 감시" 테스트가 OS에 따라 오탐하지 않는다.
  return html.replace(/\r\n/g, "\n");
}

function regenerateChecksums(extraFiles) {
  const path = join(root, "SHA256SUMS.txt");
  const previous = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[1])
    .filter(Boolean);
  const files = [...new Set([...previous, ...extraFiles])].sort();
  const lines = files.map((file) => {
    const digest = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
    return `${digest}  ${file}`;
  });
  writeFileSync(path, lines.join("\n") + "\n");
  return files.length;
}

// 테스트에서 import할 수 있도록, 직접 실행했을 때만 파일을 쓴다.
const executedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (executedDirectly) {
  const single = buildSingleHtml();
  writeFileSync(join(root, "backtestK_single.html"), single);
  const checksumCount = regenerateChecksums([
    ...CORE_MODULES,
    "package.json",
    "engine.js",
    "share.html",
    "share.js",
    "portfolio.js",
  ]);

  console.log(JSON.stringify({
    output: "backtestK_single.html",
    sizeKB: Math.round(single.length / 1024),
    inlinedModules: CORE_MODULES.length + 2,
    checksums: checksumCount,
  }, null, 2));
}
