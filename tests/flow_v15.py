"""flow_v15 · 第一波闭环回归（3 项）

覆盖：对话课后报告（离线 + 持久化 + 历史回看）、阅读划词与词形还原、
留德时间轴（计划页 + 首页下一步）。
"""
from conftest import goto


def test_chat_report_offline_and_persisted(page):
    page.evaluate("""() => {
        const s = window.LD.Store.s;
        s.chats = {}; s.chatActive = {}; s.chatReports = []; s.wordbank = [];
        window.LD.Store.save();
    }""")
    goto(page, "chat")
    for i, text in enumerate([
        "Ich habe gestern ins Kino gegangen.",
        "Ich bin gestern ins Kino gegangen.",
        "Gestern habe ich einen Film gesehen.",
    ]):
        page.fill("#cIn", text)
        page.click("#sendBtn")
        page.wait_for_function("(n) => document.querySelectorAll('.msg.me').length >= n", arg=i + 1)
        page.wait_for_function("() => !document.querySelector('#typing')")

    assert page.locator("#turnCount").inner_text() == "3"
    page.click("#finishChat")
    page.wait_for_timeout(400)
    report = page.locator("#chatReport")
    assert report.is_visible()
    txt = report.inner_text()
    assert "对话课后报告" in txt and "下一步" in txt and "总评" in txt
    assert page.evaluate("() => window.LD.Store.s.chatReports.length") == 1

    # 报告已落 localStorage；重新进入页面仍能从历史回看
    persisted = page.evaluate("() => JSON.parse(localStorage.getItem('linguade.v1')).chatReports.length")
    assert persisted == 1
    page.evaluate("() => window.LD.router.go('home')")
    page.wait_for_timeout(150)
    goto(page, "chat")
    assert page.locator("[data-view-rep]").count() >= 1
    page.locator("[data-view-rep]").first.click()
    page.wait_for_timeout(250)
    assert "对话课后报告" in page.locator("#chatReport").inner_text()


def test_word_lookup_popover_and_morphology(page):
    page.evaluate("() => { window.LD.Store.s.wordbank = []; window.LD.Store.save(); }")
    goto(page, "reading")
    page.locator("[data-p]").first.click()
    page.wait_for_timeout(250)
    assert page.locator(".wlink").count() > 20

    page.locator(".wlink", has_text="Universität").first.click()
    page.wait_for_timeout(250)
    pop = page.locator("#ldWordPop")
    assert pop.is_visible()
    assert "大学" in pop.inner_text()
    page.click("#ldWordAdd")
    page.wait_for_timeout(200)
    words = page.evaluate("() => window.LD.Store.s.wordbank.map(w => w.de)")
    assert "Universität" in words

    # 词形还原只接受词库命中：Häuser → Haus
    hit = page.evaluate("() => window.LD.Lex.lookup('Häuser')")
    assert hit and hit["de"] == "Haus"


def test_timeline_plan_and_home_next_step(page):
    goto(page, "plan")
    assert page.locator(".tl-stage").count() == 5
    page.locator(".plan-timeline summary").click()
    page.wait_for_timeout(150)
    page.locator("[data-tl-st]").first.click()
    page.wait_for_timeout(250)
    assert page.evaluate("() => Object.keys(window.LD.Store.s.timelineDone || {}).length") >= 1

    page.evaluate("() => window.LD.router.go('home')")
    page.wait_for_timeout(250)
    page.locator("#homeMore summary").click()
    page.wait_for_timeout(150)
    assert page.locator("#toTimeline").count() == 1
    assert "下一步" in page.locator("#homeMore").inner_text()
    page.click("#toTimeline")
    page.wait_for_timeout(250)
    assert page.locator(".tl-stage").count() == 5
