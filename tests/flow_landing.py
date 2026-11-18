"""flow_landing · 落地页 dist/landing.html（5 项）

验证：零外部请求与零控制台错误、找错互动（答错 / 答对 / 换句）、遗忘曲线滑杆联动、
移动端无横向溢出且吸底 CTA 在滚过首屏后出现、所有主 CTA 指向应用入口、
回访用户（已诊断）看到“继续学习”、页脚不再出现比赛字样。
"""
import pytest

PATH = "/dist/landing.html"


@pytest.fixture
def lp(browser, site_url, errors):
    reqs = []
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    pg = ctx.new_page()
    pg.on("request", lambda r: reqs.append(r.url))
    pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
    pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text)) if m.type == "error" else None)
    pg.goto(site_url + PATH)
    pg.wait_for_selector("#sent .tok")
    pg.reqs = reqs
    yield pg
    ctx.close()


def test_no_external_requests_or_errors(lp, site_url, errors):
    lp.wait_for_timeout(300)
    external = [u for u in lp.reqs if not (u.startswith(site_url) or u.startswith("data:"))]
    assert external == [], "落地页不应有外部请求：%s" % external
    assert errors == [], "控制台错误：%s" % errors


def test_error_hunt_wrong_then_right(lp):
    # 第 1 句：正确答案是 ich(1) / habe(2)，Gestern(0) 是无辜的
    lp.locator("#sent .tok").nth(0).click()
    assert "没问题" in lp.locator("#fb").inner_text()
    assert lp.locator("#fb.good").count() == 0
    lp.locator("#sent .tok").nth(2).click()
    fb = lp.locator("#fb.good")
    assert fb.count() == 1
    txt = fb.inner_text()
    assert "Gestern habe ich einen Test geschrieben." in txt and "第二位" in txt
    assert lp.locator("#sent .tok.bad").count() == 2
    assert lp.locator("#sent .tok").first.is_disabled()


def test_error_hunt_next_cycles(lp):
    seen = {lp.locator("#sent").inner_text()}
    for _ in range(4):
        lp.locator("#next").click()
        seen.add(lp.locator("#sent").inner_text())
    assert len(seen) == 4, "4 句循环，回到第一句"
    assert lp.locator("#demo-count").inner_text() == "1 / 4"


def test_retention_slider_changes_review_load(lp):
    def reviews(v):
        lp.locator("#ret").evaluate("(el, v) => { el.value = v; el.dispatchEvent(new Event('input')); }", v)
        return int(lp.locator("#nRev").inner_text())
    low, high = reviews(70), reviews(97)
    assert high > low, "保持率越高复习越密：70%%=%d 次, 97%%=%d 次" % (low, high)
    assert lp.locator("#retOut").inner_text() == "97%"
    assert lp.locator("#curve path").count() == 1


def test_returning_learner_sees_continue_and_no_contest_branding(browser, site_url):
    ctx = browser.new_context()
    ctx.add_init_script("localStorage.setItem('linguade.v1', JSON.stringify({diagnosed: true}))")
    pg = ctx.new_page()
    pg.goto(site_url + PATH)
    pg.wait_for_selector("#sent .tok")
    labels = pg.eval_on_selector_all("a.btn-primary", "els => els.map(e => e.textContent.trim())")
    assert labels and all(t.startswith("继续学习") for t in labels), labels
    assert "华为" not in pg.inner_text("body") and "ICT" not in pg.inner_text("body")
    ctx.close()


def test_first_visit_sees_diagnosis_cta(lp):
    labels = lp.eval_on_selector_all("a.btn-primary", "els => els.map(e => e.textContent.trim())")
    assert any("10 题" in t for t in labels) and not any(t.startswith("继续") for t in labels), labels


def test_mobile_layout_and_sticky_cta(browser, site_url):
    ctx = browser.new_context(viewport={"width": 375, "height": 740}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.goto(site_url + PATH)
    pg.wait_for_selector("#sent .tok")
    assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "移动端出现横向滚动"
    # 触控目标 ≥ 44px
    small = pg.evaluate("""() => [...document.querySelectorAll('.btn, .tok, .linkbtn, summary')]
        .filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).map(e => e.className || e.tagName)""")
    assert small == [], "触控目标过小：%s" % small
    assert "on" not in pg.locator("#sticky").get_attribute("class")
    pg.evaluate("window.scrollTo(0, document.querySelector('#why').offsetTop)")
    pg.wait_for_timeout(400)
    assert "on" in pg.locator("#sticky").get_attribute("class")
    hrefs = pg.eval_on_selector_all("a.btn-primary", "els => els.map(e => e.getAttribute('href'))")
    assert hrefs and set(hrefs) == {"index.html"}
    ctx.close()
