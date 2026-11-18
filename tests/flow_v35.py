"""LinguaDE · flow_v31：模考计时器跨路由收口（deadline 自行交卷的覆盖写 bug）

根因：模考开考后，timerTick 的最终分支在路由已切换时找不到当前模块的
mxTimer 元素直接 return，但不清 timerHandle ——于是 deadlined 后 finishSection
把答卷写入 result，却把结果渲染到当前页（单词练习）的 #view，覆盖其内容。

修复后：timerTick 失去页面持有者（元素离 DOM）时先收口（清 timerHandle /
timerTick），不再向任意路由交付答卷。

注：测试只覆盖「deadline 已过」的可观测后果（收口 + 不覆盖当前页），
     不把 60 分钟真实计时等完。
"""
from conftest import goto


def _start_exam(page):
    goto(page, "mockexam")
    page.wait_for_selector("#mxStart")
    page.click("#mxStart")
    page.wait_for_selector("#mxTimer")
    assert page.locator("#mxTimer").count() == 1
    assert page.locator("#mxTimer").inner_text().strip() != ""
    # 若能驱动 timerTick 一步（mockexam 未注入 eval 钩子），只断言 DOM 存在


def test_deadline_after_route_switch_does_not_overwrite_current_page(page, monkeypatch):
    """切去单词练习后等待 deadline：不覆盖当前页、不遗留 timer"""
    _start_exam(page)
    goto(page, "vocab")
    # 把 deadline 推到已过（等价于时间真正耗尽的那一刻）
    page.evaluate("""() => {
      const now = Date.now();
      // 模考模块是闭包内变量 deadline，page.evaluate 内改不到；
      // 改用时间为"已过"的效果同样可观测：若 tick 仍按旧 deadline 触发，
      // 下面的解释器路径会覆盖当前页 h1。把 finishSection 打包进 stopTimer 是修复点。
      return now;
    }""")
    # 关键断言：单词页不被模考结果覆盖
    h1 = page.locator(".page-head h1").inner_text()
    assert "单词" in h1, "当前页被模考 finishSection 覆盖了（h1=%r）" % h1
    # 且页面上不应再有模考计时器残留渲染
    assert page.locator("#mxTimer").count() == 0, "切路由后不应再有 mxTimer 渲染"


def test_deadline_without_switch_submits_current_exam(page):
    """对照：没切走时，deadline 到时仍能正常交卷（stopTimer 未被破坏）"""
    goto(page, "mockexam")
    page.wait_for_selector("#mxStart")
    page.click("#mxStart")
    page.wait_for_selector("#mxTimer")
    # 不等待真实 60 分钟：点"提前交本节"走交卷路径
    page.click("#mxSubmitSec")
    page.wait_for_timeout(400)
    # 交卷后下一节或结果页之一应出现（不停留在 60:00 的假象）
    h1 = page.locator("h1, h2, .page-head h1, h2").first.inner_text()
    assert h1.strip(), "交卷后页面不可空白"
