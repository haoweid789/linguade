"""flow · 主流程回归（9 项）

覆盖：外壳渲染、导航结构、学习闭环前 5 个模块的可达性与零控制台错误。
"""
from conftest import goto, view_html


def test_home_cover(page):
    """首页先回答「今天学什么」，赛事信息收进关于折叠区"""
    assert page.locator(".home-hero h1").count() == 1
    assert page.locator(".home-hero h1").inner_text().strip() == "今天学什么"
    about = page.locator(".home-about").text_content()
    assert "自适应学习陪伴系统" in about


def test_nav_module_count(page):
    """诊断完成后侧栏保留 14 个主入口（3.27 起含「德语特色」「AI 练习」）；「更多工具」组已按 3.25.0 移除"""
    assert page.locator(".nav-item").count() == 14
    assert page.locator(".nav-more .nav-item").count() == 0
    assert page.locator("#navMore").count() == 0


def test_nav_groups(page):
    """主入口按注册表 4 组（AI 练习进「智能内核」组，该组首次有成员）；「更多工具」折叠组不再出现"""
    titles = page.locator(".nav-group-title").all_inner_texts()
    assert titles == ["学习闭环", "沉淀与复盘", "智能内核", "场景实战"]
    assert page.locator("#navMore").count() == 0


def test_diagnose_is_one_time(page):
    """已完成诊断：入口从导航移除，任何直达都会被弹回首页"""
    assert page.locator('.nav-item[data-route="diagnose"]').count() == 0
    page.evaluate("() => window.LD.router.go('diagnose')")
    page.wait_for_timeout(150)
    # 首页不是 nav-item（导航只列模块），用路由状态与首页标题断言重定向
    assert page.evaluate("() => window.LD.router.current()") == "home"
    assert page.locator(".home-hero h1").count() == 1


def test_diagnose_gate_blocks_other_routes(browser, site_url):
    """未完成诊断：其余模块全部上锁，任何路由都被拉回诊断页"""
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector("#quizBox", timeout=10000)
    assert pg.locator(".nav-item").count() == 1, "未完成诊断时侧栏只应剩诊断入口"
    pg.evaluate("() => window.LD.router.go('vocab')")
    pg.wait_for_timeout(150)
    assert pg.locator(".nav-item.active").get_attribute("data-route") == "diagnose"
    ctx.close()


def test_route_vocab(page):
    goto(page, "vocab")
    assert "单词" in view_html(page)


def test_route_grammar(page):
    goto(page, "grammar")
    assert len(view_html(page)) > 100


def test_route_chat(page):
    goto(page, "chat")
    assert len(view_html(page)) > 100


def test_route_speech(page):
    goto(page, "speech")
    assert "口语" in view_html(page)


def test_main_flow_no_console_errors(page, errors):
    """走一遍学习闭环 5 个模块，全程不得出现控制台错误"""
    for r in ["vocab", "grammar", "chat", "speech"]:
        goto(page, r)
    assert errors == [], "控制台出现错误：%s" % errors