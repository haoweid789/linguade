"""LinguaDE · flow_v29：3.22 学习闭环与计划一致性

覆盖：
  1. 每日任务分钟严格等于目标（复盘日不额外加时）
  2. 首页与计划页读取同一份任务，稳定 ID 一致
  3. 从今日任务进入词汇限额一轮，结果页显式确认后回到任务
  4. 计划勾选按最后操作时间合并，取消勾选可传播
  5. 旧版布尔镜像自动迁移进主档案
"""
import json
import re
from datetime import date, timedelta

from conftest import SEED, goto


def _today_task_id(page):
    return page.evaluate("""() => {
      const day = window.LD.Engine.todayPlan().entry;
      return day.tasks[0].id;
    }""")


def test_plan_minutes_match_budget_and_ids_unique(page):
    """30 / 35 分钟以及考前阶段：每日合计不超出目标，任务 ID 唯一"""
    exam_soon = (date.today() + timedelta(days=5)).isoformat()   # 动态日期，避免硬编码考期过期后用例失效
    for daily, exam in ((30, ""), (35, ""), (35, exam_soon)):
        plan = page.evaluate("""({daily, exam}) => {
          const s = window.LD.Store.s;
          s.profile.dailyMin = daily;
          s.profile.examDate = exam;
          window.LD.Store.save();
          const p = window.LD.Engine.makePlan(7);
          return p.plan.map(d => ({
            total: d.tasks.reduce((a, t) => a + t.min, 0),
            ids: d.tasks.map(t => t.id),
            reviewOnly: d.tasks[0].reviewOnly
          }));
        }""", {"daily": daily, "exam": exam})
        assert plan, "计划不应为空"
        for day in plan:
            assert day["total"] == daily, "每日任务合计 %s 分钟，应等于目标 %s" % (day["total"], daily)
            assert len(day["ids"]) == len(set(day["ids"])), "同一天任务 ID 不应重复"
        if daily == 35 and exam:
            assert plan[0]["reviewOnly"] is True, "考前 7 天词汇任务应停学新词"


def test_home_and_plan_share_the_same_tasks(page):
    """首页「今日任务」与计划页今日卡片使用同一批稳定 ID"""
    home_ids = page.evaluate("""() => [...document.querySelectorAll('#homeFirstWeek .fw-task')]
      .map(el => el.dataset.fwTask)""")
    assert home_ids, "首页应显示今日任务"
    page.locator("#homeFirstWeek [data-fw-plan]").click()
    page.wait_for_timeout(450)
    assert page.locator("#planGrid").is_visible(), "查看计划应直接落到日程"
    plan_ids = page.evaluate("""() => {
      const today = window.LD.Store.dayKey();
      const card = document.getElementById('planDay-' + today);
      return card ? [...card.querySelectorAll('.list-item')].map(el => el.dataset.k) : [];
    }""")
    assert set(home_ids) == set(plan_ids), "首页与计划页任务不一致：%s vs %s" % (home_ids, plan_ids)


def test_planned_vocab_round_returns_to_task(page):
    """今日任务 → 限额词汇一轮 → 结果页确认 → 首页任务已勾选"""
    task_id = _today_task_id(page)
    limit = page.evaluate("""() => {
      const day = window.LD.Engine.todayPlan().entry;
      return day.tasks[0].words;
    }""")
    page.locator('#homeFirstWeek [data-fw-go]').first.click()
    page.wait_for_timeout(500)
    assert page.locator("#exitTask").count() == 1, "计划进入词汇页应有退出计划入口"
    hint = page.locator("#leftHint").inner_text()
    n = int(re.search(r"/\s*(\d+)", hint).group(1))
    assert n <= limit, "计划任务本轮 %d 张，超过任务配额 %d" % (n, limit)

    for _ in range(n):
        page.locator("#flipBtn").click()
        page.locator('.rate-btn[data-v="2"]').click()
        page.wait_for_timeout(25)
    page.wait_for_selector("[data-fw-confirm]", timeout=5000)
    page.locator("[data-fw-confirm]").click()
    page.wait_for_timeout(450)
    assert page.evaluate("() => window.LD.router.current()") == "home"
    assert page.evaluate("(id) => window.LD.Store.s.planDone[id].done", task_id) is True
    assert page.evaluate("(id) => window.LD.Store.s.planDone[id].src", task_id) == "vocab-round"
    assert page.evaluate("(id) => JSON.parse(localStorage.getItem('linguade.planDone') || '{}')[id]", task_id) is True
    assert page.locator('[data-fw-task="%s"]' % task_id).first.get_attribute("class").find("done") >= 0
    assert page.evaluate("() => sessionStorage.getItem('linguade.taskContext')") is None, "确认后应清理任务上下文"


def test_home_all_done_state_does_not_keep_pushing(page):
    """今日任务全部标记完成后，首页改为休息/自由练习语义，不继续催开始"""
    page.evaluate("""() => {
      const entry = window.LD.Engine.todayPlan().entry;
      entry.tasks.forEach(t => window.LD.Store.setPlanTaskDone(t.id, true, 'self'));
      window.LD.router.go('home');
    }""")
    page.wait_for_timeout(350)
    text = page.locator("#view").inner_text()
    assert "都完成了" in text, "全部完成后应给出完成态文案"
    assert page.locator("#homeStart").inner_text() == "复习今日内容"
    assert page.locator("#homeFirstWeek .fw-task.done").count() == page.locator("#homeFirstWeek .fw-task").count()


def test_plan_done_merge_uses_latest_action(page):
    """较早的已完成不能覆盖较新的取消勾选；不同任务取并集"""
    merged = page.evaluate("""() => {
      const a = { planDone: { x: { done: false, at: 20 } } };
      const b = { planDone: { x: { done: true, at: 10 }, y: { done: true, at: 5 } } };
      return window.LD.Store.mergeStates(a, b);
    }""")
    out = merged["state"]["planDone"]
    assert out["x"]["done"] is False, "较新的取消勾选应保留"
    assert out["y"]["done"] is True, "另一台设备的完成记录应保留"
    assert merged["stats"]["updated"] >= 1, "计划勾选变化必须计入合并增量，启动同步才会落盘"


def test_mobile_quick_tabs_route_and_mark_active(browser, site_url):
    """390px：四个快捷入口可达，当前页高亮；桌面侧栏与旧链接不受影响"""
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script("localStorage.setItem('linguade.v1', %s)" % json.dumps(json.dumps(SEED, ensure_ascii=False)))
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector("#mobileTabs .mobile-tab", timeout=10000)
    pg.wait_for_function("() => window.LD && window.LD.FirstWeek && window.LD.Modules && window.LD.Modules.vocab && document.body.dataset.route === 'home'", timeout=10000)
    tabs = pg.locator("#mobileTabs .mobile-tab")
    assert tabs.count() == 4
    assert tabs.first.is_visible()
    box = tabs.first.bounding_box()
    assert box and box["y"] + box["height"] <= 844, "快捷导航应在视口内"
    for route in ("plan", "notebook", "home"):
        pg.click('[data-mobile-route="%s"]' % route)
        pg.wait_for_timeout(280)
        assert pg.evaluate("() => window.LD.router.current()") == route
        active = pg.locator('[data-mobile-route="%s"]' % route)
        assert active.get_attribute("class").find("active") >= 0
        assert active.get_attribute("aria-current") == "page"
    pg.click('[data-mobile-route="learn"]')
    pg.wait_for_timeout(200)
    assert pg.locator("#learnSheet").is_visible(), "学练入口应打开模块抽屉"
    pg.click('[data-learn-route="vocab"]')
    pg.wait_for_timeout(280)
    assert pg.evaluate("() => window.LD.router.current()") == "vocab"
    assert pg.locator('[data-mobile-route="learn"]').get_attribute("class").find("active") >= 0
    ctx.close()


def test_legacy_plan_done_migrates_into_state(page):
    """旧版 linguade.planDone 布尔镜像在刷新后并入主档案"""
    page.evaluate("""() => {
      localStorage.setItem('linguade.planDone', JSON.stringify({ legacyTask: true }));
    }""")
    page.reload()
    page.wait_for_selector(".nav-item", timeout=10000)
    assert page.evaluate("() => window.LD.Store.s.planDone.legacyTask.done") is True
