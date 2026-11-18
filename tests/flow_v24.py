"""LinguaDE · flow_v24：设计系统 v5（3.19.0）渲染结果断言

对应 docs/ui-upgrade-plan-v5.md 的验收标准。3.17 报告的教训：测 CSS 声明的测试守不住承诺，
这里全部量「渲染后的真实页面」——computed style、document.fonts、SVG computed fill。

覆盖：
  1. 排印三栈真实上屏（Inter / Source Serif 4 / JetBrains Mono 三支都加载并命中）
  2. hash 深链：URL 反映路由、直达路由、点击后同步
  3. 全站交互元素零 emoji 图标（v5 已换线性 SVG）
  4. 深浅两套主题的关键文字对比度 ≥ 4.5:1
  5. 图表色带来自 --chart-* token（学情分析柱图 computed fill）
  6. 阅读衬线实验开关：开 → 阅读页德语正文命中 Source Serif 4
  7. dist 单文件体积红线 ≤ 2.6MB 且字体已内联（对构建产物，需先跑 tools/build.py）
"""
import json
import pathlib

import pytest

from conftest import goto, ROUTES

DIST = pathlib.Path(__file__).resolve().parent.parent / "dist" / "index.html"
# 3.24.1 起 2.6MB 改为构建警告（SW 外壳缓存后回访不重复下载）；
# 这里保留一个更宽的硬上限，只防体积失控，不再把 2.6MB 当硬失败。
SIZE_CAP = 3.0 * 1024 * 1024

FORBIDDEN_ICONS = list("🎙📷🎯🔥🏆✅📊⏰📦💾🔊💪🏅🌱📅💎📚🧭🎓🌙🌅🧹🔒⟳✦📒🔍🔁📝👥♪⚔⚗☷✎✍📖🎧🐢❓✍️")

CHECK_JS = """
() => document.fonts.ready.then(() => ({
  inter: document.fonts.check('400 14px "Inter"'),
  sserif: document.fonts.check('600 16px "Source Serif 4"'),
  jbmono: document.fonts.check('400 12px "JetBrains Mono"'),
}))
"""


def test_font_triad_loads_and_applies(page):
    """词卡页：三支字体都真实加载；词卡大词命中 Source Serif 4，音标命中 JetBrains Mono"""
    goto(page, "vocab", wait=400)
    got = page.evaluate(CHECK_JS)
    assert got["inter"], "Inter 未加载（全站声明了 Inter 却从未上屏的 v4 遗留问题）"
    assert got["sserif"], "Source Serif 4 未加载"
    assert got["jbmono"], "JetBrains Mono 未加载"
    stacks = page.evaluate("""
      () => ({
        word: getComputedStyle(document.querySelector('.vocab-word')).fontFamily,
        phon: getComputedStyle(document.querySelector('.vocab-phon')).fontFamily,
        body: getComputedStyle(document.body).fontFamily,
      })
    """)
    assert "Source Serif 4" in stacks["word"], "词卡大词应为衬线展示栈"
    assert "JetBrains Mono" in stacks["phon"], "音标应为数据栈"
    assert stacks["body"].startswith("Inter"), "UI 栈应以 Inter 开头"


def test_hash_deep_link(page):
    """hash 深链：直达 #notebook 正确落页；点击导航后 hash 跟随路由"""
    page.goto(page.url.split("#")[0] + "#notebook")
    page.wait_for_selector(".nav-item", timeout=10000)
    page.wait_for_timeout(300)
    assert page.evaluate("() => document.body.dataset.route") == "notebook"
    goto(page, "vocab", wait=300)
    assert page.evaluate("() => location.hash") == "#vocab"
    assert page.evaluate("() => document.body.dataset.route") == "vocab"


def test_no_emoji_icons_on_any_route(page, errors):
    """v5 整改：全部常驻路由的按钮/标签/横幅图标里不允许再出现 emoji 字符"""
    bad = []
    for route in ROUTES:
        goto(page, route, wait=150)
        found = page.evaluate("""
          (forbidden) => {
            const hits = [];
            const sel = 'button, a, .btn, .tag, .banner-ic, .nav-item, .nav-home, .mic-btn, .fin-ico, .badge-ic, .topbar, .streak-chip, h2, h3, .divider, .empty, .report-sec, .list-item, .mx-ic, .scene-chip, .module-tab';
            document.querySelectorAll(sel).forEach(el => {
              const t = el.textContent || "";
              for (const ch of forbidden) {
                if (t.indexOf(ch) >= 0) { hits.push(el.tagName + "." + (el.className || "").split(" ").slice(0,2).join(".") + ":" + ch); break; }
              }
            });
            return hits;
          }
        """, FORBIDDEN_ICONS)
        for h in found:
            bad.append(route + " -> " + h)
    assert not bad, "仍存在 emoji 图标：" + "; ".join(bad[:12])


def test_contrast_light_and_dark(page):
    """关键文字对在深浅两套主题下对比度 ≥ 4.5:1（WCAG 1.4.3）"""
    def contrast_js():
        return page.evaluate("""
          () => {
            const cs = getComputedStyle(document.documentElement);
            const lum = hex => {
              const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
              if (!m) return null;
              const [r, g, b] = [0, 2, 4].map(i => {
                let v = parseInt(m[1].slice(i, i + 2), 16) / 255;
                return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
              });
              return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const get = t => t.startsWith('#') ? t : cs.getPropertyValue(t);
            const ratio = (a, b) => {
              const la = lum(get(a)), lb = lum(get(b));
              if (la === null || lb === null) return null;
              return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
            };
            return {
              text_bg: ratio('--text', '--bg'),
              text2_panel: ratio('--text-2', '--panel'),
              text3_panel2: ratio('--text-3', '--panel-2'),
              btn_white: ratio('--brand-fill', '#ffffff'),
            };
          }
        """)
    light = contrast_js()
    page.evaluate("() => document.documentElement.classList.add('dark')")
    dark = contrast_js()
    page.evaluate("() => document.documentElement.classList.remove('dark')")
    for theme, pairs in (("light", light), ("dark", dark)):
        for name, val in pairs.items():
            assert val is not None, "%s 主题下 %s 不是可解析的 hex token" % (theme, name)
            assert val >= 4.5, "%s 主题 %s 对比度 %.2f < 4.5" % (theme, name, val)


def test_chart_colors_come_from_tokens(page):
    """学情分析 BKT 分布柱图的填充色必须落在 --chart-1..8 token 色集内"""
    # 3.20 起没有知识点时显示空态而非零值柱；此用例注入两条 BKT 记录以验证有数据时的图表配色
    page.evaluate("""() => {
      const S = window.LD.Store.s;
      S.bkt = { "v:Test": 0.42, "g:weil": 0.71 };
      window.LD.Store.save();
    }""")
    goto(page, "analytics", wait=400)
    ok = page.evaluate("""
      () => {
        const tokenSet = new Set();
        const cs = getComputedStyle(document.documentElement);
        for (let i = 1; i <= 8; i++) tokenSet.add(cs.getPropertyValue('--chart-' + i).trim().toLowerCase());
        const rects = [...document.querySelectorAll('#mastery svg rect')];
        if (!rects.length) return { none: true };
        const off = rects.filter(r => {
          const fill = (getComputedStyle(r).fill || "").toLowerCase();
          return !fill.startsWith('rgb') || ![...tokenSet].some(t => {
            const m = t.match(/^#([0-9a-f]{6})$/);
            if (!m) return false;
            const rgb = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
            return fill.replace(/\\s/g, '') === 'rgb(' + rgb.join(',') + ')';
          });
        });
        return { none: false, off: off.length, total: rects.length };
      }
    """)
    assert not ok.get("none"), "学情分析没有渲染出 BKT 分布柱图"
    assert ok["off"] == 0, "%d/%d 根柱子的填充色不在 --chart-* token 色集内" % (ok["off"], ok["total"])


def test_reading_serif_toggle(page):
    """阅读衬线实验开关：勾选后阅读页德语正文命中 Source Serif 4，取消后恢复"""
    page.click("#settingsBtn")
    page.wait_for_timeout(200)
    box = page.locator("#cfgSerif")
    box.check()
    page.wait_for_timeout(150)
    page.click("#closeDrawer")
    goto(page, "reading", wait=400)
    ff = page.evaluate("""
      () => {
        const de = document.querySelector('#view .de');
        return de ? getComputedStyle(de).fontFamily : "";
      }
    """)
    assert "Source Serif 4" in ff, "开启后阅读页 .de 正文应为衬线栈"
    page.click("#settingsBtn")
    page.wait_for_timeout(200)
    page.locator("#cfgSerif").uncheck()
    page.wait_for_timeout(150)
    page.click("#closeDrawer")
    goto(page, "reading", wait=300)
    ff2 = page.evaluate("() => getComputedStyle(document.querySelector('#view .de')).fontFamily")
    assert "Source Serif 4" not in ff2, "关闭后应恢复默认栈"


def test_dist_size_cap_and_inline_fonts():
    """构建产物：体积不失控（≤3.0MB 硬上限）且字体已内联为 data:（无外链 woff2）；dist 未构建时跳过"""
    if not DIST.exists():
        pytest.skip("dist/index.html 不存在（先跑 python tools/build.py）")
    size = DIST.stat().st_size
    assert size <= SIZE_CAP, "单文件 %.2f MB 超过 %.1f MB 硬上限" % (size / 1048576, SIZE_CAP / 1048576)
    txt = DIST.read_text(encoding="utf-8", errors="ignore")
    assert "data:font/woff2;base64," in txt, "构建产物应内联字体"
    assert "assets/fonts/" not in txt, "构建产物不应残留外链字体引用"
