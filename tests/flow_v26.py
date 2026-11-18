"""LinguaDE · flow_v26：3.20 升级回归

覆盖：
  1. 诊断完成后生成 7 天首周计划，任务可勾选并落盘
  2. 首页展示首周计划「今日切片」，勾选后刷新仍保留
  3. 机器词条标注「AI 辅助释义 · 未人工审校」，并提供首屏直达报错
  4. 自动复核词条标注「自动结构校验 · 未人工审校」
  5. BKT 无知识点时不再画 5 根 0 值柱，改为可执行 CTA
"""
from conftest import goto


def test_first_week_generated_after_diagnosis(browser, site_url):
    """10 题诊断完成 → 结果页出现 7 天首周计划，勾选生效"""
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector("#quizBox", timeout=10000)
    for _ in range(10):
        pg.locator("#opts .list-item").first.click()
        pg.wait_for_timeout(70)
        pg.locator("#nextBtn").click()
        pg.wait_for_timeout(110)
    pg.wait_for_selector("#diagFirstWeek", timeout=5000)
    assert pg.locator("#diagFirstWeek .fw-day-card").count() == 7, "首周计划应覆盖 7 天"
    assert pg.locator("#diagFirstWeek .fw-task").count() >= 1, "首周计划应至少有一项任务"
    pg.evaluate("() => { document.getElementById('diagFirstWeek').open = true; }")
    pg.wait_for_timeout(120)
    pg.locator("#diagFirstWeek .fw-task").first.click()
    pg.wait_for_timeout(250)
    assert pg.locator("#diagFirstWeek .fw-task.done").count() >= 1, "勾选后任务应标记完成"
    ctx.close()


def test_first_week_plan_on_home_persists(page):
    """首页显示今日切片；勾选后刷新仍保留（localStorage planDone）"""
    page.wait_for_selector("#homeFirstWeek", timeout=5000)
    assert page.locator("#homeFirstWeek .fw-day").count() == 7
    rows = page.locator("#homeFirstWeek .fw-task")
    assert rows.count() >= 1
    key = rows.first.get_attribute("data-fw-task")
    rows.first.click()
    page.wait_for_timeout(250)
    assert page.locator("#homeFirstWeek .fw-task.done").count() >= 1
    saved = page.evaluate("() => JSON.parse(localStorage.getItem('linguade.planDone') || '{}')")
    assert saved.get(key) is True, "勾选状态应写入 linguade.planDone"
    page.reload()
    page.wait_for_selector("#homeFirstWeek", timeout=5000)
    assert page.evaluate(
        "(k) => { const el = document.querySelector('[data-fw-task=\"' + k + '\"]'); return !!el && el.classList.contains('done'); }",
        key
    ), "刷新后勾选状态应保留"


def test_machine_word_label_and_feedback_entry(page):
    """未人工审校词条：标注清楚 + 首屏一键展开报错（不必先找到折叠区）"""
    page.evaluate("""() => {
      const w = [...window.LD_LEX_MACHINE].find(x => !(window.LD_LEX_AI_REVIEWED && window.LD_LEX_AI_REVIEWED.has(x)));
      const hit = window.LD_LEX.find(x => x[0].toLowerCase() === w);
      const S = window.LD.Store.s;
      S.cards = {};
      S.cards[hit[0]] = { due: Date.now() - 86400000, reps: 1, ok: 0, bad: 1, lapses: 0, ef: 2.5, iv: 1, history: [] };
      window.LD.Store.save();
      window.LD.router.go('vocab');
    }""")
    page.wait_for_timeout(450)
    stage = page.locator("#stage")
    assert "AI 辅助释义 · 未人工审校" in stage.inner_text(), "机器词条应显示未人工审校标注"
    open_btn = stage.locator("[data-report-open]").first
    assert open_btn.inner_text() == "欢迎纠错"
    open_btn.click()
    page.wait_for_timeout(150)
    assert page.evaluate("() => !document.getElementById('reportBox').hidden") is True, "欢迎纠错应直达报错区"
    stage.locator("[data-report]").first.click()
    page.wait_for_timeout(200)
    assert page.evaluate("() => (window.LD.Store.s.contentReports || []).length") >= 1, "报错应落盘"


def test_ai_reviewed_word_label(page):
    """自动复核词条单独标注，不冒充人工校订"""
    page.evaluate("""() => {
      const w = [...window.LD_LEX_AI_REVIEWED][0];
      const hit = window.LD_LEX.find(x => x[0].toLowerCase() === w);
      const S = window.LD.Store.s;
      S.cards = {};
      S.cards[hit[0]] = { due: Date.now() - 86400000, reps: 1, ok: 0, bad: 1, lapses: 0, ef: 2.5, iv: 1, history: [] };
      window.LD.Store.save();
      window.LD.router.go('vocab');
    }""")
    page.wait_for_timeout(450)
    assert "自动结构校验 · 未人工审校" in page.locator("#stage").inner_text()
    assert "人工校订" not in page.locator("#stage").inner_text()


def test_bkt_empty_state_has_cta(page):
    """没有知识点记录：不画零值柱，给出「去句法纠错」按钮"""
    goto(page, "analytics")
    mastery = page.locator("#mastery")
    assert "还没有知识点记录" in mastery.inner_text()
    assert mastery.locator("svg").count() == 0, "空态不应渲染 5 根零值柱"
    page.locator("#toSyntax").click()
    page.wait_for_timeout(250)
    assert page.evaluate("() => window.LD.router.current()") == "syntax"
