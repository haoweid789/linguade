"""LinguaDE · flow_v27：3.20.1 巡检修复回归

覆盖：
  1. 320px 全路由无横向溢出（弱点页 .g2 的 1fr min-content 曾撑破 10px）
  2. 德语长复合词在手机上缩到卡片内（不再从单词中间硬断）
  3. 诊断选项答完即禁用（pointer-events 拦不住键盘 Enter，重复计分会把 10 题算成 24 题）
  4. 健康检查报告 TTS 未启用时不再发出 /api/tts 请求（避免 501 控制台噪音）
  5. 首周计划「去」按钮在手机上达到 40px 宽
"""
import json

from conftest import SEED, ROUTES


def _context(browser, viewport, backend=""):
    ctx = browser.new_context(viewport=viewport)
    seed = json.loads(json.dumps(SEED))
    if backend:
        seed["cfg"]["backend"] = backend
    ctx.add_init_script("localStorage.setItem('linguade.v1', %s)" % json.dumps(json.dumps(seed, ensure_ascii=False)))
    return ctx


def test_mobile_320_no_horizontal_overflow(browser, site_url):
    ctx = _context(browser, {"width": 320, "height": 700})
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=10000)
    for route in ["home"] + ROUTES:
        pg.evaluate("(r) => { location.hash = '#' + r; }", route)
        pg.wait_for_timeout(380)
        overflow = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, "%s 在 320px 下横向溢出 %spx" % (route, overflow)
    ctx.close()


def test_long_german_word_scales_to_fit_mobile(browser, site_url):
    ctx = _context(browser, {"width": 320, "height": 700})
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=10000)
    word = pg.evaluate("""() => {
      const hit = [...window.LD_LEX]
        .filter(x => !/\\s/.test(x[0]))
        .sort((a, b) => b[0].length - a[0].length)[0][0];
      const S = window.LD.Store.s;
      S.cards = {};
      S.cards[hit] = { due: Date.now() - 86400000, reps: 1, ok: 0, bad: 1, lapses: 0, ef: 2.5, iv: 1, history: [] };
      window.LD.Store.save();
      window.LD.router.go('vocab');
      return hit;
    }""")
    pg.wait_for_timeout(600)
    got = pg.evaluate("""() => {
      const el = document.querySelector('.vocab-word');
      return { text: el.textContent, fs: parseFloat(getComputedStyle(el).fontSize),
               sw: el.scrollWidth, cw: el.clientWidth };
    }""")
    assert word in got["text"]
    assert got["sw"] <= got["cw"] + 2, "长词仍超出卡片：scrollWidth=%s clientWidth=%s" % (got["sw"], got["cw"])
    assert got["fs"] < 38, "长词应缩到基础字号 38px 以下，实际 %spx" % got["fs"]
    ctx.close()


def test_diagnose_options_disable_after_answer(browser, site_url):
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector("#quizBox", timeout=10000)
    pg.locator("#opts .list-item").first.click()
    pg.wait_for_timeout(150)
    assert pg.evaluate("() => [...document.querySelectorAll('#opts .list-item')].every(b => b.disabled)"), \
        "答完后选项应立即禁用，避免键盘 Enter 重复计分"
    # 再点其它选项不应改变反馈（仍然只有第一次的选择生效）
    pg.evaluate("() => document.querySelectorAll('#opts .list-item')[1].click()")
    pg.wait_for_timeout(100)
    assert "回答正确" in pg.locator("#fb").inner_text()
    ctx.close()


def test_tts_skipped_when_health_reports_off(browser, site_url):
    ctx = _context(browser, {"width": 1280, "height": 800}, backend=site_url)
    pg = ctx.new_page()
    tts_calls = []
    pg.route("**/api/health", lambda route: route.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"ok": True, "llm": False, "asr": False, "tts": {"channel": "off", "ready": False}})))
    pg.route("**/api/tts", lambda route: tts_calls.append(1) or route.fulfill(
        status=501, content_type="application/json", body='{"detail": "TTS off"}'))
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=10000)
    assert pg.evaluate("() => window.LD.Backend.probeHealth(2000)") is True
    got = pg.evaluate("async () => await window.LD.Backend.tts('Guten Tag')")
    assert got is None
    assert tts_calls == [], "健康检查已说明 TTS 未启用，不应再请求 /api/tts"
    ctx.close()


def test_home_first_task_visible_above_mobile_nav_at_320(browser, site_url):
    ctx = _context(browser, {"width": 320, "height": 700})
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector("#homeFirstWeek", timeout=10000)
    pg.wait_for_timeout(400)
    boxes = pg.evaluate("""() => {
      const t = document.querySelector('#homeFirstWeek .fw-task').getBoundingClientRect();
      const n = document.getElementById('mobileTabs').getBoundingClientRect();
      return { taskBottom: Math.round(t.bottom), navTop: Math.round(n.top) };
    }""")
    assert boxes["taskBottom"] <= boxes["navTop"], \
        "320px 首屏第一项任务被底栏遮挡：task=%s nav=%s" % (boxes["taskBottom"], boxes["navTop"])
    ctx.close()


def test_all_module_routes_no_overflow_at_320(browser, site_url):
    """320px 下所有注册模块路由都不应横向溢出（aipractice 曾用内联 1fr 1fr 撑破 19px）"""
    ctx = _context(browser, {"width": 320, "height": 700})
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=10000)
    routes = pg.evaluate("() => ['home', ...Object.keys(window.LD.Modules)]")
    for route in routes:
        pg.evaluate("(r) => { location.hash = '#' + r; }", route)
        pg.wait_for_timeout(380)
        overflow = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, "%s 在 320px 下横向溢出 %spx" % (route, overflow)
    ctx.close()


def test_first_week_go_button_min_width(browser, site_url):
    ctx = _context(browser, {"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector("#homeFirstWeek", timeout=10000)
    width = pg.evaluate("() => document.querySelector('#homeFirstWeek .fw-task .btn').getBoundingClientRect().width")
    assert width >= 40, "首周计划「去」按钮宽 %spx，低于 40px 触摸目标" % width
    ctx.close()
