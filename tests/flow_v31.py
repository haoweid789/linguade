"""flow_v31 · 学习工作台、可恢复任务与计划一致性

覆盖：
  1. 390px 首屏任务与底栏不重叠；学练抽屉能到达词汇
  2. 词汇任务离开后继续上次进度
  3. 计划页默认本周、时间轴折叠；7/14/28 共用同一份基础排期
  4. 跨端合并：云端较新的勾选必须计入增量，首周计划也参与合并
  5. 口语同一句重复评分不增加任务进度
  6. 诊断只展示本次测到的能力
"""
import json

from conftest import SEED, goto


def _boot(pg):
    pg.wait_for_function(
        "() => window.LD && window.LD.FirstWeek && window.LD.Modules && window.LD.Modules.vocab && document.body.dataset.route",
        timeout=10000,
    )


def test_mobile_first_task_above_bottom_nav_and_learn_sheet(browser, site_url):
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script("localStorage.setItem('linguade.v1', %s)" % json.dumps(json.dumps(SEED)))
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    _boot(pg)
    pg.wait_for_timeout(250)

    task = pg.locator("#homeFirstWeek .fw-task").first.bounding_box()
    nav = pg.locator("#mobileTabs").bounding_box()
    start = pg.locator("#homeStart").bounding_box()
    assert task and nav and start
    assert task["y"] + task["height"] <= nav["y"], "首屏第一项任务不应被底栏遮挡"
    assert start["y"] + start["height"] < 844, "首屏应能看到主行动按钮"
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"), "不应出现横向滚动"

    pg.click('[data-mobile-route="learn"]')
    pg.wait_for_timeout(200)
    assert pg.locator("#learnSheet").is_visible()
    pg.click('[data-learn-route="vocab"]')
    pg.wait_for_timeout(300)
    assert pg.evaluate("() => window.LD.router.current()") == "vocab"
    assert "active" in (pg.locator('[data-mobile-route="learn"]').get_attribute("class") or "")
    ctx.close()


def test_vocab_task_resumes_after_leaving(page):
    page.wait_for_selector("#homeFirstWeek", timeout=5000)
    page.locator("#homeFirstWeek [data-fw-go]").first.click()
    page.wait_for_timeout(450)
    n = int(page.locator("#leftHint").inner_text().split("/")[1])
    assert n >= 3
    for _ in range(2):
        page.locator("#flipBtn").click()
        page.locator('.rate-btn[data-v="2"]').click()
        page.wait_for_timeout(60)
    assert "已学 2" in page.locator("#leftHint").inner_text()

    page.evaluate("() => window.LD.router.go('home')")
    page.wait_for_timeout(350)
    page.locator("#homeFirstWeek [data-fw-go]").first.click()
    page.wait_for_timeout(450)
    assert "已学 2" in page.locator("#leftHint").inner_text(), "离开后重进应恢复上次进度"
    run = page.evaluate("() => JSON.parse(localStorage.getItem('linguade.taskRun.v1') || '{}')")
    assert run and run["progress"] >= 2 and run["data"]["vocab"]["idx"] == 2
    page.locator("#exitTask").click()
    page.wait_for_timeout(200)


def test_plan_week_default_and_single_source(page):
    goto(page, "plan")
    assert page.locator("#schedulePane").is_visible(), "计划页默认应落到本周安排"
    assert not page.locator(".plan-timeline").evaluate("el => el.open"), "时间轴默认折叠"
    assert page.locator(".plan-summary").is_visible()
    page.locator(".plan-timeline summary").click()
    page.wait_for_timeout(150)
    assert page.locator(".tl-stage").count() == 5

    data = page.evaluate("""() => {
      const f7 = window.LD.Engine.planForDays(7);
      const f14 = window.LD.Engine.planForDays(14);
      const f28 = window.LD.Engine.planForDays(28);
      const fw = window.LD.Engine.firstWeekPlan();
      return {
        base: window.LD.Engine.planBase().plan.length,
        d7: f7.plan[0].tasks.map(t => t.id),
        d14: f14.plan[0].tasks.map(t => t.id),
        d28: f28.plan[0].tasks.map(t => t.id),
        fw: fw.plan[0].tasks.map(t => t.id)
      };
    }""")
    assert data["base"] == 28
    assert data["d7"] == data["d14"] == data["d28"] == data["fw"], "7/14/28 天必须共享同一批任务"


def test_merge_newer_cloud_plan_done_and_first_week(page):
    out = page.evaluate("""() => {
      const a = {
        planDone: { x: { done: false, at: 10, src: 'self' } },
        firstWeek: { generatedAt: 1, sig: 'a', plan: [{ date: '2026-11-06', tasks: [{ id: 'p1' }] }] }
      };
      const b = {
        planDone: { x: { done: true, at: 20, src: 'self' }, y: { done: true, at: 5, src: 'self' } },
        firstWeek: { generatedAt: 2, sig: 'a', plan: [{ date: '2026-11-06', tasks: [{ id: 'p2' }] }] }
      };
      const r = window.LD.Store.mergeStates(a, b);
      return { done: r.state.planDone.x.done, y: r.state.planDone.y.done,
               fw: r.state.firstWeek.generatedAt, updated: r.stats.updated };
    }""")
    assert out["done"] is True, "云端较新的同键勾选不能被本机旧值覆盖"
    assert out["y"] is True
    assert out["fw"] == 2, "首周计划应参与合并"
    assert out["updated"] >= 1, "计划变化必须计入同步增量"


def test_speech_duplicate_sentence_does_not_add_progress(page):
    page.evaluate("""() => {
      const day = window.LD.Engine.todayPlan().entry;
      sessionStorage.setItem('linguade.taskContext', JSON.stringify({
        taskId: 'test-speech-unique', date: day.date, route: 'speech',
        text: '跟读评分 2 句', min: 10, returnTo: 'home'
      }));
      window.LD.router.go('speech');
    }""")
    page.wait_for_timeout(450)
    ref = page.locator("#refLine").inner_text()
    for _ in range(2):
        page.fill("#manual", ref)
        page.locator("#useManual").click()
        page.wait_for_timeout(350)
    assert "1 / 2 句" in page.locator("#detail").inner_text(), "同一句重复评分不能累计任务进度"
    assert page.locator("[data-fw-confirm]").count() == 0
    page.locator("#spNext").click()
    page.wait_for_timeout(250)
    ref2 = page.locator("#refLine").inner_text()
    assert ref2 != ref, "再练一句应换到不同句子"
    page.fill("#manual", ref2)
    page.locator("#useManual").click()
    page.wait_for_timeout(400)
    assert page.locator("[data-fw-confirm]").count() == 1


def test_diagnosis_reports_only_tested_abilities(browser, site_url):
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector("#quizBox", timeout=10000)
    for _ in range(10):
        pg.locator("#opts .list-item").first.click()
        pg.wait_for_timeout(60)
        pg.locator("#nextBtn").click()
        pg.wait_for_timeout(90)
    pg.wait_for_selector("#diagBasis", timeout=5000)
    pg.locator("#diagBasis summary").first.click()
    pg.wait_for_timeout(250)
    radar = pg.locator("#rd").inner_text()
    assert "词汇" in radar and "语法" in radar and "阅读" in radar
    assert "听力" not in radar and "口语" not in radar and "写作" not in radar
    assert "未测" in pg.locator("#diagBasis").inner_text()
    ctx.close()


def test_chat_history_report_cannot_complete_current_task(page):
    page.evaluate("""() => {
      const s = window.LD.Store.s;
      s.chatReports = [{
        id: 'old-report', sid: 'old-session', scene: 'aps', sceneName: 'APS 面谈',
        t: Date.now() - 86400000, turns: 3, issues: 0, errorTypes: [], repeats: [],
        newWords: [], dims: { task: 60, grammar: 70, vocab: 60, fluency: 55 },
        total: 62, summary: '旧对话报告', next: [], source: 'local', advice: []
      }];
      window.LD.Store.save();
      const day = window.LD.Engine.todayPlan().entry;
      sessionStorage.setItem('linguade.taskContext', JSON.stringify({
        taskId: 'test-chat-history', date: day.date, route: 'chat',
        text: '德语对话室 1 次（至少 3 轮对话）', min: 8, returnTo: 'home'
      }));
      window.LD.router.go('chat');
    }""")
    page.wait_for_timeout(450)
    page.locator('[data-view-rep="old-report"]').click()
    page.wait_for_timeout(250)
    assert "旧对话报告" in page.locator("#chatReport").inner_text()
    assert page.locator("[data-fw-confirm]").count() == 0, "历史报告不能替当前任务确认"


def test_plan_task_return_restores_today_focus(page):
    today = page.evaluate("() => window.LD.Store.dayKey()")
    page.evaluate("""() => {
      const s = window.LD.Store.s;
      s.ability = { vocab: 95, grammar: 95, listening: 95, speaking: 95, reading: 5, writing: 95 };
      window.LD.Store.save();
      window.LD.Engine.planForDays(7, true);
      window.LD.router.go('plan');
    }""")
    page.wait_for_timeout(450)
    go_read = page.locator('#planDay-%s [data-go="reading"]' % today).first
    assert go_read.count() == 1, "阅读应出现在今日计划"
    go_read.click()
    page.wait_for_timeout(400)
    page.locator(".reading-card").first.click()
    page.wait_for_timeout(350)
    page.locator('[data-t="0"][data-v="richtig"]').first.click()
    page.wait_for_timeout(200)
    page.locator("#submitBtn").click()
    page.wait_for_timeout(350)
    # 3.24：达到任务目标即自动记入，返回按钮就是主按钮
    page.locator("[data-fw-confirm]").click()
    page.wait_for_timeout(500)
    assert page.evaluate("() => window.LD.router.current()") == "plan"
    assert page.locator("#schedulePane").is_visible()
    box = page.locator("#planDay-" + today).bounding_box()
    assert box and -10 <= box["y"] <= 260, "返回计划应恢复到今日任务位置"


def test_listening_task_locks_mode_and_caps_items(page):
    page.evaluate("""() => {
      const day = window.LD.Engine.todayPlan().entry;
      sessionStorage.setItem('linguade.taskContext', JSON.stringify({
        taskId: 'test-listening-lock', date: day.date, route: 'listening',
        text: '影子跟读 1 组（10 句）', min: 10, returnTo: 'home'
      }));
      window.LD.router.go('listening');
    }""")
    page.wait_for_timeout(500)
    assert "影子跟读" in page.locator(".scene-chip.active[data-m]").inner_text()
    assert "第 1 / 10" in page.locator("#stage").inner_text(), "任务题量应被限制在 10 句"
    page.locator('[data-m="choice"]').click()
    page.wait_for_timeout(250)
    assert "影子跟读" in page.locator(".scene-chip.active[data-m]").inner_text(), "任务模式不能被切换"
    assert "锁定" in page.locator("#toastWrap").inner_text()


def test_writing_task_shows_receipt_after_submit(page):
    page.evaluate("""() => {
      const day = window.LD.Engine.todayPlan().entry;
      sessionStorage.setItem('linguade.taskContext', JSON.stringify({
        taskId: 'test-writing', date: day.date, route: 'writing',
        text: '主题写作 150 词', min: 12, returnTo: 'home'
      }));
      window.LD.router.go('writing');
    }""")
    page.wait_for_timeout(400)
    text = ("Liebe Freunde, ich schreibe diesen Brief, weil ich mich für den Deutschkurs "
            "interessiere und mehr über den Alltag in Deutschland lernen möchte. "
            "Ich habe schon einige Bücher gelesen und jeden Tag Vokabeln geübt. "
            "Im nächsten Monat möchte ich mich an der Universität bewerben. "
            "Viele Grüße")
    page.fill("#wIn", text)
    page.locator("#wSubmit").click()
    page.wait_for_timeout(800)
    assert page.locator("[data-fw-confirm]").count() == 1
    assert "写作提交" in page.locator("#wOut").inner_text()


def test_grammar_task_reaches_receipt_after_eight_sentences(page):
    page.evaluate("""() => {
      const day = window.LD.Engine.todayPlan().entry;
      sessionStorage.setItem('linguade.taskContext', JSON.stringify({
        taskId: 'test-grammar', date: day.date, route: 'grammar',
        text: '句法纠错 8 句', min: 8, returnTo: 'home'
      }));
      window.LD.router.go('grammar');
    }""")
    page.wait_for_timeout(400)
    rows = page.locator("#libList .list-item")
    assert rows.count() >= 8
    for i in range(8):
        rows.nth(i).click()
        page.wait_for_timeout(180)
    assert page.locator("[data-fw-confirm]").count() == 1
    assert "8/8" in page.locator("#gOut").inner_text()


def test_reading_and_listening_task_resume(page):
    page.evaluate("""() => {
      const day = window.LD.Engine.todayPlan().entry;
      sessionStorage.setItem('linguade.taskContext', JSON.stringify({
        taskId: 'test-reading-resume', date: day.date, route: 'reading',
        text: '阅读理解 1 篇（限时）', min: 10, returnTo: 'home'
      }));
      window.LD.router.go('reading');
    }""")
    page.wait_for_timeout(400)
    page.locator(".reading-card").first.click()
    page.wait_for_timeout(300)
    page.locator('[data-t="0"][data-v="richtig"]').first.click()
    page.wait_for_timeout(200)
    page.evaluate("() => window.LD.router.go('home')")
    page.wait_for_timeout(250)
    page.evaluate("() => window.LD.router.go('reading')")
    page.wait_for_timeout(350)
    assert "已答 1 / 12" in page.locator("#view").inner_text(), "阅读返回后应恢复已答题目"

    page.evaluate("""() => {
      const day = window.LD.Engine.todayPlan().entry;
      sessionStorage.setItem('linguade.taskContext', JSON.stringify({
        taskId: 'test-listening-resume', date: day.date, route: 'listening',
        text: '听音选义 2 题', min: 8, returnTo: 'home'
      }));
      window.LD.router.go('listening');
    }""")
    page.wait_for_timeout(450)
    page.locator("#opts .list-item").first.click()
    page.wait_for_timeout(200)
    page.locator("#next").click()
    page.wait_for_timeout(250)
    assert "1 / 2" in page.locator("#board").inner_text()
    page.evaluate("() => window.LD.router.go('home')")
    page.wait_for_timeout(250)
    page.evaluate("() => window.LD.router.go('listening')")
    page.wait_for_timeout(450)
    assert "第 2 / 2" in page.locator("#stage").inner_text(), "听力返回后应恢复当前题号"
    assert "1 / 2" in page.locator("#board").inner_text()


def test_chat_current_report_can_confirm_but_old_one_cannot(page):
    page.evaluate("""() => {
      const rep = {
        id: 'rep-current', sid: 'sess-current', scene: 'aps', sceneName: 'APS 面谈',
        t: Date.now(), turns: 3, issues: 0, errorTypes: [], repeats: [], newWords: [],
        dims: { task: 60, grammar: 70, vocab: 60, fluency: 55 }, total: 62,
        summary: '当前对话报告', next: [], source: 'local', advice: []
      };
      const s = window.LD.Store.s;
      s.chatReports = [rep];
      window.LD.Store.save();
      const day = window.LD.Engine.todayPlan().entry;
      localStorage.setItem('linguade.taskRun.v1', JSON.stringify({
        taskId: 'test-chat-current', date: day.date, route: 'chat',
        text: '德语对话室 1 次（至少 3 轮对话）', min: 8, returnTo: 'home',
        attemptId: 'a-chat', target: 3, progress: 3, evidence: ['对话报告'],
        status: 'active', data: { chat: { sessionId: 'sess-current', reportId: 'rep-current' } }
      }));
      sessionStorage.removeItem('linguade.taskContext');
      window.LD.router.go('chat');
    }""")
    page.wait_for_timeout(400)
    page.locator('[data-view-rep="rep-current"]').click()
    page.wait_for_timeout(250)
    assert page.locator("[data-fw-confirm]").count() == 1, "当前会话报告应能确认任务"
    page.evaluate("""() => {
      const run = JSON.parse(localStorage.getItem('linguade.taskRun.v1'));
      run.data.chat.reportId = 'another-report';
      localStorage.setItem('linguade.taskRun.v1', JSON.stringify(run));
    }""")
    page.locator('[data-view-rep="rep-current"]').click()
    page.wait_for_timeout(250)
    assert page.locator("[data-fw-confirm]").count() == 0, "报告不属于当前 attempt 时不能确认"
