#!/usr/bin/env python3
"""Generate static SEO landing pages for preset portfolios under /portfolio/.

각 페이지는 크롤러가 JS 없이 읽을 수 있는 고유한 한국어 콘텐츠(전략 설명·구성
테이블·FAQ)를 정적으로 담고, 지표·차트는 portfolio.js가 데이터마트에서 실데이터를
불러와 렌더링한다. 콘텐츠를 수정하면 이 스크립트를 다시 실행해 재생성한다.

    python scripts/build_portfolio_pages.py
"""

from __future__ import annotations

import json
from pathlib import Path

SITE = "https://backtest-k.vercel.app"

PAGES = [
    {
        "slug": "korea-60-40",
        "name": "한국 60/40 포트폴리오",
        "title": "한국 60/40 포트폴리오 백테스트 — 구성·수익률·MDD",
        "description": "KODEX 200 60% + KODEX 국고채3년 40%로 구성한 한국형 60/40 포트폴리오의 실데이터 백테스트. 연환산 수익률, 최대 낙폭, 변동성을 확인하고 직접 수정해 보세요.",
        "alloc": [["069500", 60, "KODEX 200", "국내주식"], ["114260", 40, "KODEX 국고채3년", "채권"]],
        "benchmark": "INDEX_KOSPI",
        "intro": [
            "주식 60%와 채권 40%를 섞는 60/40은 자산배분의 출발점으로 불리는 가장 고전적인 조합입니다. 이 페이지는 그 한국판입니다 — 국내 대표 주식 ETF인 KODEX 200에 60%, 국채 ETF인 KODEX 국고채3년에 40%를 배분하고 연 1회 리밸런싱합니다.",
            "모든 자산이 원화 표시 국내 상장 ETF라 환율 변수가 없고, 주식이 크게 흔들리는 구간에서 국채가 완충 역할을 하는지를 가장 순수하게 관찰할 수 있는 조합입니다. 두 ETF 모두 2009년부터 데이터가 있어 국내 조합 중 가장 긴 백테스트가 가능합니다.",
        ],
        "commentary": [
            "60/40의 핵심은 수익률 극대화가 아니라 하락 방어와 심리적 지속 가능성입니다. 주식 100% 대비 최대 낙폭이 완만해지는 대신 강세장에서는 지수를 따라가지 못합니다. 아래 결과에서 KOSPI 대비 낙폭 차이를 먼저 확인해 보세요.",
            "국고채 3년은 듀레이션이 짧아 금리 상승기에 방어력이 좋은 대신, 금리 하락기의 채권 랠리는 장기채보다 작습니다. 장기채로 바꾸면 어떻게 달라지는지 '이 조합으로 백테스트 실행'에서 직접 바꿔볼 수 있습니다.",
        ],
        "faq": [
            ["왜 주식 60% 채권 40%인가요?", "특별한 최적화 결과라기보다, 주식의 성장과 채권의 방어를 균형 있게 섞는 관행적 기준점입니다. 투자자의 위험 성향에 따라 70/30, 50/50 등으로 조정하는 출발점으로 쓰입니다."],
            ["국내 자산만으로 충분한가요?", "환율 변수가 없다는 장점이 있지만 한국 시장 단일 국가 위험에 노출됩니다. 미국 주식을 섞은 균형 성장 포트폴리오와 비교해 보세요."],
        ],
    },
    {
        "slug": "all-weather",
        "name": "한국형 올웨더 포트폴리오",
        "title": "한국형 올웨더 포트폴리오 백테스트 — 구성·수익률·MDD",
        "description": "레이 달리오의 올웨더 개념을 국내 상장 ETF 4종(미국 S&P500·국고채·미국 장기국채·금)으로 구현한 포트폴리오의 실데이터 백테스트 결과.",
        "alloc": [
            ["360750", 30, "TIGER 미국S&P500", "해외주식"],
            ["114260", 35, "KODEX 국고채3년", "채권"],
            ["453850", 20, "ACE 미국30년국채액티브(H)", "채권"],
            ["411060", 15, "ACE KRX금현물", "원자재"],
        ],
        "benchmark": "INDEX_KOSPI",
        "intro": [
            "올웨더(All Weather)는 레이 달리오가 제안한 '어떤 경제 국면에서도 버티는' 자산배분 개념입니다. 성장과 물가라는 두 축이 만드는 네 가지 국면(성장 상승/하락 × 물가 상승/하락)에 각각 강한 자산을 섞어, 특정 국면에 대한 베팅을 피하는 것이 핵심입니다.",
            "이 페이지는 그 개념을 국내 상장 ETF 4종으로 구현합니다 — 성장 국면의 주식(TIGER 미국S&P500 30%), 침체 국면의 장·단기 채권(ACE 미국30년국채액티브 20% + KODEX 국고채3년 35%), 물가 국면의 금(ACE KRX금현물 15%)."
        ],
        "commentary": [
            "정통 올웨더(주식 30 · 장기채 40 · 중기채 15 · 원자재/금 15)와 달리 미국 장기국채 비중 일부를 한국 국고채로 대체했습니다. 미국 30년국채 ETF(453850)가 2023년 상장이라 백테스트 구간이 짧다는 점은 감안해야 합니다.",
            "미국 장기국채는 환헤지(H)형이라 금리 국면에 집중하고, S&P500은 환노출형이라 위기 시 원/달러 상승이 완충 역할을 겸합니다. 환헤지 여부를 바꿔 비교하는 것도 의미 있는 실험입니다.",
        ],
        "faq": [
            ["올웨더 포트폴리오란 무엇인가요?", "경제 성장과 물가의 상승·하락이 만드는 네 국면에 각각 유리한 자산(주식·장기채·금 등)을 위험 균형에 가깝게 배분해, 특정 국면 예측 없이 장기 보유하도록 설계한 자산배분 전략입니다."],
            ["환헤지는 어떻게 처리되나요?", "이 구성에서 미국 30년국채는 환헤지(H)형, TIGER 미국S&P500은 환노출형입니다. 환노출 주식은 위기 시 원/달러 상승이 낙폭을 줄여주는 경향이 있습니다."],
        ],
    },
    {
        "slug": "balanced-growth",
        "name": "균형 성장 포트폴리오",
        "title": "균형 성장 포트폴리오 백테스트 — 미국·한국 주식과 채권·금 분산",
        "description": "TIGER 미국S&P500 40% + KODEX 200 20% + KODEX 국고채3년 30% + 금 10%. 국내외 주식과 안전자산을 섞은 균형 성장 포트폴리오의 실데이터 백테스트.",
        "alloc": [
            ["360750", 40, "TIGER 미국S&P500", "해외주식"],
            ["069500", 20, "KODEX 200", "국내주식"],
            ["114260", 30, "KODEX 국고채3년", "채권"],
            ["411060", 10, "ACE KRX금현물", "원자재"],
        ],
        "benchmark": "INDEX_KOSPI",
        "intro": [
            "주식 60%(미국 40 + 한국 20)에 채권 30%와 금 10%를 더한, 백테스트K의 기본 프리셋이기도 한 조합입니다. 성장의 중심을 미국 대형주에 두되 한국 주식으로 원화 자산을 유지하고, 채권과 금이 하락 구간을 완충합니다.",
            "미국 주식은 환노출형이라 글로벌 위기 때 원/달러 환율 상승이 손실을 일부 상쇄하는 효과가 있습니다. 통화·국가·자산군 세 축의 분산을 한 번에 관찰할 수 있는 구성입니다.",
        ],
        "commentary": [
            "이 조합의 관전 포인트는 '한 자산의 승리'가 아니라 상관관계입니다. 국내 주식이 부진한 해에 미국 주식·금이 어떻게 메웠는지 연도별 수익률에서 확인해 보세요.",
            "금 10%는 수익 기여보다 위기 국면 상관관계 분산이 목적입니다. 금 비중을 0%로 바꿔 비교하면 분산 효과를 정량적으로 볼 수 있습니다.",
        ],
        "faq": [
            ["미국 주식 비중이 더 큰 이유는?", "글로벌 시가총액에서 미국 비중이 압도적이고, 한국 주식과의 상관관계가 낮았던 기간이 길어 분산 효과가 크기 때문입니다. 비중은 취향에 따라 조정 가능합니다."],
            ["환헤지형으로 바꾸면 어떻게 되나요?", "환헤지형은 환율 변동을 제거해 변동성이 낮아질 수 있지만, 위기 시 원/달러 상승의 완충 효과도 사라집니다. 백테스트에서 직접 비교해 보세요."],
        ],
    },
    {
        "slug": "global-growth",
        "name": "글로벌 성장 포트폴리오",
        "title": "글로벌 성장 포트폴리오 백테스트 — S&P500·나스닥100 중심 공격형",
        "description": "TIGER 미국S&P500 40% + 나스닥100 30% + KODEX 200 20% + 금 10%. 미국 성장주 중심 공격형 포트폴리오의 수익률과 최대 낙폭 실데이터 백테스트.",
        "alloc": [
            ["360750", 40, "TIGER 미국S&P500", "해외주식"],
            ["133690", 30, "TIGER 미국나스닥100", "해외주식"],
            ["069500", 20, "KODEX 200", "국내주식"],
            ["411060", 10, "ACE KRX금현물", "원자재"],
        ],
        "benchmark": "360750",
        "intro": [
            "주식 90%(미국 70 + 한국 20)에 금 10%만 곁들인 공격형 구성입니다. 채권 없이 성장 자산에 집중하므로 기대 수익과 함께 최대 낙폭도 큽니다. 벤치마크는 KOSPI가 아닌 TIGER 미국S&P500으로 두어 '미국 대형주만 사는 것 대비 나은가'를 직접 검증합니다.",
            "나스닥100 30%는 기술주 성장에 대한 명시적 베팅입니다. 2022년 같은 금리 급등기에 이 비중이 낙폭을 얼마나 키웠는지, 이후 회복이 얼마나 빨랐는지가 이 조합의 성격을 가장 잘 보여줍니다.",
        ],
        "commentary": [
            "공격형 조합일수록 '수익률'이 아니라 '버틸 수 있는 낙폭인가'가 판단 기준이 되어야 합니다. 최대 낙폭과 회복 기간을 먼저 보고, 월 적립 투자로 낙폭 구간이 매수 기회로 작동했는지 확인해 보세요.",
            "S&P500과 나스닥100은 상관관계가 매우 높아 분산 효과는 제한적입니다. 이 조합의 분산은 사실상 한국 주식 20%와 금 10%가 담당합니다.",
        ],
        "faq": [
            ["채권이 없는데 괜찮은가요?", "낙폭 방어를 포기하고 장기 성장에 베팅하는 구성입니다. 적립식으로 장기 투자할 수 있고 큰 낙폭을 견딜 수 있는 투자자에게 적합하며, 그렇지 않다면 균형 성장이나 올웨더가 맞습니다."],
            ["S&P500과 나스닥100을 둘 다 담는 이유는?", "나스닥100은 S&P500 안의 기술·성장주 비중을 의도적으로 키우는 오버레이입니다. 사실상 '미국 대형주 + 기술주 추가 베팅'으로 읽는 것이 정확합니다."],
        ],
    },
]

# trailingSlash:false 환경에서 /portfolio가 슬래시 없이 서빙되면 상대 링크의
# 기준 경로가 루트로 바뀌어 404가 난다. 내부 링크·자산은 모두 절대 경로를 쓴다.
HEAD_EXTRA = """  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    .pf-shell {{ width: min(880px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 60px; display: grid; gap: 16px; }}
    .pf-breadcrumb {{ color: var(--muted-2); font-size: 13px; }}
    .pf-breadcrumb a {{ color: var(--muted); }}
    .pf-breadcrumb a:hover {{ color: var(--accent); }}
    .pf-heading h1 {{ margin: 6px 0 10px; font-size: clamp(25px, 4vw, 36px); letter-spacing: -.04em; }}
    .pf-heading p {{ margin: 0 0 10px; color: var(--muted); font-size: 15px; line-height: 1.8; }}
    .pf-section {{ padding: 18px 20px; }}
    .pf-section h2 {{ margin: 0 0 12px; font-size: 17px; letter-spacing: -.02em; }}
    .pf-section p {{ margin: 0 0 10px; color: var(--muted); font-size: 14px; line-height: 1.8; }}
    .pf-metrics {{ display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }}
    .pf-period {{ color: var(--muted-2); font-size: 13px; line-height: 1.7; }}
    .pf-cta {{ display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; padding: 10px 0; }}
    .pf-cta .primary-btn {{ padding: 13px 26px; font-size: 15px; text-decoration: none; }}
    .pf-cta .secondary-btn {{ text-decoration: none; }}
    .pf-faq dt {{ font-weight: 800; font-size: 14.5px; margin-top: 14px; }}
    .pf-faq dd {{ margin: 6px 0 0; color: var(--muted); font-size: 14px; line-height: 1.8; }}
    .pf-footer {{ text-align: center; color: var(--muted-2); font-size: 12px; line-height: 1.7; padding-top: 10px; border-top: 1px solid var(--border); }}
    .pf-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; }}
    .pf-card {{ display: block; padding: 20px; }}
    .pf-card:hover {{ border-color: var(--border-strong); }}
    .pf-card h2 {{ margin: 0 0 8px; font-size: 18px; letter-spacing: -.02em; }}
    .pf-card p {{ margin: 0 0 12px; color: var(--muted); font-size: 13.5px; line-height: 1.7; }}
    .pf-card span {{ color: var(--accent); font-size: 13px; font-weight: 800; }}
    @media (max-width: 700px) {{ .pf-metrics {{ grid-template-columns: repeat(2, minmax(0,1fr)); }} .pf-grid {{ grid-template-columns: 1fr; }} }}
  </style>"""

TOPBAR = """  <header class="topbar" style="justify-content:center">
    <a class="brand" href="/" aria-label="백테스트K 홈">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="img"><path d="M6 23.5 12.2 17l4.4 4.2L26 10.8"/><path d="M20.5 10.8H26v5.5"/></svg>
      </span>
      <span class="brand-copy"><strong>백테스트<span>K</span></strong><small>PORTFOLIO ANALYTICS</small></span>
    </a>
  </header>"""

FOOTER = """      <footer class="pf-footer">
        <strong>BACKTEST-K</strong> · backtest-k.vercel.app<br />
        교육·연구용 시뮬레이션이며 투자 권유 또는 개인화된 투자자문이 아닙니다. 과거 성과는 미래 성과를 보장하지 않습니다. 프리셋은 예시 구성입니다.
      </footer>"""


def faq_jsonld(page: dict) -> str:
    payload = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": question,
                "acceptedAnswer": {"@type": "Answer", "text": answer},
            }
            for question, answer in page["faq"]
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


def breadcrumb_jsonld(page: dict) -> str:
    payload = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "백테스트K", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "전략 모음", "item": f"{SITE}/portfolio/"},
            {"@type": "ListItem", "position": 3, "name": page["name"], "item": f"{SITE}/portfolio/{page['slug']}"},
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


def render_page(page: dict) -> str:
    alloc_rows = "\n".join(
        f"            <tr><td>{ticker}</td><td style=\"text-align:left\">{name}</td><td>{category}</td><td>{weight}%</td></tr>"
        for ticker, weight, name, category in page["alloc"]
    )
    intro = "\n".join(f"        <p>{text}</p>" for text in page["intro"])
    commentary = "\n".join(f"        <p>{text}</p>" for text in page["commentary"])
    faq_items = "\n".join(
        f"          <dt>{question}</dt>\n          <dd>{answer}</dd>" for question, answer in page["faq"]
    )
    alloc_js = json.dumps([[ticker, weight] for ticker, weight, _, _ in page["alloc"]], ensure_ascii=False)
    head_extra = HEAD_EXTRA.replace("{{", "{").replace("}}", "}")
    return f"""<!doctype html>
<html lang=\"ko\" data-theme=\"dark\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <meta name=\"description\" content=\"{page['description']}\" />
  <meta name=\"theme-color\" content=\"#07111f\" />
  <title>{page['title']} | 백테스트K</title>
  <link rel=\"canonical\" href=\"{SITE}/portfolio/{page['slug']}\" />
  <meta property=\"og:type\" content=\"article\" />
  <meta property=\"og:site_name\" content=\"백테스트K\" />
  <meta property=\"og:title\" content=\"{page['title']}\" />
  <meta property=\"og:description\" content=\"{page['description']}\" />
  <meta property=\"og:url\" content=\"{SITE}/portfolio/{page['slug']}\" />
  <meta property=\"og:image\" content=\"{SITE}/og-image.png\" />
  <meta name=\"twitter:card\" content=\"summary_large_image\" />
  <script type=\"application/ld+json\">{faq_jsonld(page)}</script>
  <script type=\"application/ld+json\">{breadcrumb_jsonld(page)}</script>
{head_extra}
</head>
<body>
{TOPBAR}

  <main class=\"pf-shell\">
    <nav class=\"pf-breadcrumb\" aria-label=\"현재 위치\"><a href=\"/\">백테스트K</a> › <a href=\"/portfolio/\">전략 모음</a> › {page['name']}</nav>

    <div class=\"pf-heading\">
      <p class=\"eyebrow\">PORTFOLIO STRATEGY</p>
      <h1>{page['name']}</h1>
{intro}
    </div>

    <div class=\"card pf-section\">
      <h2>포트폴리오 구성</h2>
      <div class=\"table-scroll\"><table><thead><tr><th>코드</th><th>자산명</th><th>분류</th><th>비중</th></tr></thead><tbody>
{alloc_rows}
      </tbody></table></div>
    </div>

    <p id=\"pfPeriod\" class=\"pf-period\">실데이터를 불러오는 중입니다…</p>
    <div id=\"pfMetrics\" class=\"pf-metrics\"></div>

    <div class=\"card chart-card pf-section\">
      <div class=\"card-header\"><div><p class=\"eyebrow\">GROWTH</p><h3>자산 성장</h3></div><div class=\"chart-legend\" id=\"pfLegend\"></div></div>
      <div class=\"chart-wrap large\"><canvas id=\"pfChart\"></canvas></div>
    </div>

    <div class=\"card pf-section\">
      <h2>전략 해설</h2>
{commentary}
    </div>

    <div class=\"card pf-section pf-faq\">
      <h2>자주 묻는 질문</h2>
      <dl>
{faq_items}
      </dl>
    </div>

    <div class=\"pf-cta\">
      <a id=\"pfCta\" class=\"primary-btn\" href=\"/\">이 조합으로 백테스트 실행 →</a>
      <a class=\"secondary-btn\" href=\"/portfolio/\">다른 전략 보기</a>
    </div>

{FOOTER}
  </main>

  <script>
    window.PORTFOLIO_PAGE = {{
      name: {json.dumps(page['name'], ensure_ascii=False)},
      alloc: {alloc_js},
      benchmark: {json.dumps(page['benchmark'], ensure_ascii=False)},
      basePath: "/",
      settings: {{ i: 10000000, m: 500000, t: "start", r: "annual", c: 1.5 }},
    }};
  </script>
  <script src=\"/engine.js\"></script>
  <script src=\"/portfolio.js\"></script>
</body>
</html>
"""


def render_index(pages: list[dict]) -> str:
    head_extra = HEAD_EXTRA.replace("{{", "{").replace("}}", "}")
    cards = "\n".join(
        f"""      <a class=\"card pf-card\" href=\"/portfolio/{page['slug']}\">
        <h2>{page['name']}</h2>
        <p>{page['description']}</p>
        <span>백테스트 결과 보기 →</span>
      </a>"""
        for page in pages
    )
    description = "올웨더, 한국 60/40, 균형 성장, 글로벌 성장 — 국내 상장 ETF로 구성한 대표 자산배분 전략들의 실데이터 백테스트 결과 모음."
    return f"""<!doctype html>
<html lang=\"ko\" data-theme=\"dark\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <meta name=\"description\" content=\"{description}\" />
  <meta name=\"theme-color\" content=\"#07111f\" />
  <title>포트폴리오 전략 모음 — 올웨더·60/40·글로벌 성장 백테스트 | 백테스트K</title>
  <link rel=\"canonical\" href=\"{SITE}/portfolio/\" />
  <meta property=\"og:type\" content=\"website\" />
  <meta property=\"og:site_name\" content=\"백테스트K\" />
  <meta property=\"og:title\" content=\"포트폴리오 전략 모음 | 백테스트K\" />
  <meta property=\"og:description\" content=\"{description}\" />
  <meta property=\"og:url\" content=\"{SITE}/portfolio/\" />
  <meta property=\"og:image\" content=\"{SITE}/og-image.png\" />
  <meta name=\"twitter:card\" content=\"summary_large_image\" />
{head_extra}
</head>
<body>
{TOPBAR}

  <main class=\"pf-shell\">
    <nav class=\"pf-breadcrumb\" aria-label=\"현재 위치\"><a href=\"/\">백테스트K</a> › 전략 모음</nav>
    <div class=\"pf-heading\">
      <p class=\"eyebrow\">PORTFOLIO STRATEGIES</p>
      <h1>대표 자산배분 전략 백테스트</h1>
      <p>국내 상장 ETF만으로 구성한 대표 전략들을 실데이터로 검증했습니다. 각 전략 페이지에서 수익률·최대 낙폭·변동성을 확인하고, 버튼 한 번으로 구성을 직접 수정해 백테스트할 수 있습니다.</p>
    </div>

    <div class=\"pf-grid\">
{cards}
    </div>

{FOOTER}
  </main>
</body>
</html>
"""


def main() -> int:
    output_dir = Path(__file__).resolve().parent.parent / "portfolio"
    output_dir.mkdir(exist_ok=True)
    for page in PAGES:
        (output_dir / f"{page['slug']}.html").write_text(render_page(page), encoding="utf-8")
        print(f"portfolio/{page['slug']}.html")
    (output_dir / "index.html").write_text(render_index(PAGES), encoding="utf-8")
    print("portfolio/index.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
