"""LinguaDE · flow_v30：阅读 / 听力 / 口语接入计划任务闭环

覆盖：
  1. 阅读：计划任务提示 → 完成一篇 → 结果页确认 → 首页标记
  2. 听力：任务题型映射（听写填空）→ 按任务数量限额 → 结果页确认
  3. 口语：跟读逐句累计，达到任务句数后确认；未达标前只提供继续/返回
"""
def _set_task(page, route, text, task_id):
    page.evaluate("""({route, text, taskId}) => {
      const day = window.LD.Engine.todayPlan().entry;
      sessionStorage.setItem('linguade.taskContext', JSON.stringify({
        taskId, date: day.date, route, text, min: 10, returnTo: 'home'
      }));
      window.LD.router.go(route);
    }""", {"route": route, "text": text, "taskId": task_id})
    page.wait_for_timeout(450)


def test_reading_task_round_returns_and_confirms(page):
    _set_task(page, "reading", "阅读理解 1 篇（限时）", "test-reading")
    assert "今日计划任务" in page.locator("#view").inner_text()
    page.locator("[data-p]").first.click()
    page.wait_for_timeout(350)
    page.locator("#submitBtn").click()
    page.wait_for_timeout(250)
    assert page.locator("[data-fw-confirm]").count() == 0, "空卷不能出现任务确认入口"
    assert "至少回答一题" in page.locator("#view").inner_text() or page.locator("#toastWrap").inner_text(), "空卷提交应给出明确提示"
    page.locator('[data-t="0"][data-v="richtig"]').first.click()
    page.wait_for_timeout(250)
    page.locator("#submitBtn").click()
    page.wait_for_timeout(350)
    assert page.locator("[data-fw-confirm]").count() == 1, "阅读交卷后应出现任务确认入口"
    page.locator("[data-fw-confirm]").click()
    page.wait_for_timeout(350)
    assert page.evaluate("() => window.LD.router.current()") == "home"
    assert page.evaluate("() => window.LD.Store.s.planDone['test-reading'].src") == "reading-round"


def test_listening_task_maps_mode_and_limits_stack(page):
    _set_task(page, "listening", "听写填空 1 题", "test-listening")
    assert "今日计划任务" in page.locator("#view").inner_text()
    assert "听写填空" in page.locator(".scene-chip.active").inner_text(), "任务应自动切到听写填空"
    assert "第 1 / 1" in page.locator("#stage").inner_text(), "本轮题量应按任务数量收敛"
    page.fill("#dIn", "x")
    page.locator("#dOk").click()
    page.wait_for_timeout(250)
    page.locator("#next").click()
    page.wait_for_timeout(350)
    assert page.locator("[data-fw-confirm]").count() == 1
    page.locator("[data-fw-confirm]").click()
    page.wait_for_timeout(350)
    assert page.evaluate("() => window.LD.Store.s.planDone['test-listening'].src") == "listening-round"


def test_dialogue_speaking_task_routes_to_chat(page):
    """口语槽里的“德语对话室 1 轮”必须落到 chat，不能误进跟读评分"""
    got = page.evaluate("""() => {
      const s = window.LD.Store.s;
      s.ability = { vocab: 99, grammar: 99, listening: 99, speaking: 5, reading: 99, writing: 99 };
      window.LD.Store.save();
      const fw = window.LD.Engine.firstWeekPlan(true);
      const t = fw.plan.flatMap(d => d.tasks).find(x => x.text.includes('对话室'));
      return t ? { route: window.LD.FirstWeek.route(t.mod, t), text: t.text } : null;
    }""")
    assert got and got["route"] == "chat", "对话任务路由错误：%r" % got


def test_speech_task_counts_sentences_before_confirm(page):
    _set_task(page, "speech", "跟读评分 2 句", "test-speech")
    assert "今日计划任务" in page.locator("#view").inner_text()
    for i in range(2):
        ref = page.locator("#refLine").inner_text()
        page.fill("#manual", ref)
        page.locator("#useManual").click()
        page.wait_for_timeout(400)
        if i == 0:
            assert page.locator("#spNext").count() == 1, "未达到任务句数时应继续练，而不是直接确认"
            assert page.locator("[data-fw-confirm]").count() == 0
            assert "1 / 2 句" in page.locator("#detail").inner_text()
            page.locator("#spNext").click()
            page.wait_for_timeout(250)
        else:
            assert page.locator("[data-fw-confirm]").count() == 1
            page.locator("[data-fw-confirm]").click()
            page.wait_for_timeout(350)
    assert page.evaluate("() => window.LD.router.current()") == "home"
    assert page.evaluate("() => window.LD.Store.s.planDone['test-speech'].src") == "speech-round"
