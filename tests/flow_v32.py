"""LinguaDE · flow_v32：3.23.2 UI 小项回归（计划 A1–A5）

A1 考试倒排 tag 在 0 词被提前时隐藏
A2 备份横幅在最近云同步 7 天内时豁免显示
A3 近 8 周全 0 分钟时显示空态而非 8 根空气柱
A4 任务勾选后计数更新（打钩动画在 CSS 层，用状态断言）
A5 任务文案使用 text-wrap:balance

（3.20 的首周计划回归用例在 flow_v26，本文件从 v32 起号。）
"""
import datetime as dt


def test_exam_tag_hidden_when_zero(page):
    """A1：0 词被提前时不显示考试倒排 tag；>0 时显示"""
    page.evaluate("""() => {
      window.LD.Store.s.profile.examDate = new Date(Date.now() + 30*86400000).toISOString().slice(0,10);
      window.LD.Store.save();
      window.LD.router.go('vocab');
    }""")
    page.wait_for_timeout(500)
    txt = page.evaluate("() => document.querySelector('.page-head').innerText")
    assert "被提前" not in txt, "0 词被提前时空转 tag 仍在显示：%r" % txt[:200]
    # 造出到期词后，>0 时仍应出现
    page.evaluate("""() => {
      const S = window.LD.Store.s, lex = window.LD_LEX, now = Date.now();
      for (let i = 0; i < 30; i++) {
        S.cards[lex[i][0]] = { due: now - 86400000, reps: 1, ok: 0, bad: 1, lapses: 0, ef: 2.5, iv: 1, history: [] };
      }
      window.LD.Store.save();
      window.LD.router.go('vocab');
    }""")
    page.wait_for_timeout(500)
    txt2 = page.evaluate("() => document.querySelector('.page-head').innerText")
    assert "被提前" in txt2, "到期词 >0 时考试倒排 tag 应出现（实际：%r）" % txt2[:200]


def test_backup_banner_sync_exempt(page):
    """A2：最近云同步 7 天内时备份横幅豁免；同步过期后恢复"""
    page.evaluate("""() => {
      const S = window.LD.Store.s;
      S.updatedAt = Date.now();
      S.lastExportAt = 0;
      // 先满足横幅的早期门槛（学 >=3 天、作答 >=50 条），这条豁免才测得到
      const now = Date.now();
      S.daily = {}; S.log = [];
      for (let i = 0; i < 5; i++) S.daily[window.LD.Store.dayKey(new Date(now - i*86400000))] = 30;
      for (let i = 0; i < 60; i++) S.log.push({ t: now - i*60000, type: "vocab", ability: "vocab", ok: true, ms: 9000, item: "x" });
      window.LD.Store.save();
      try { localStorage.setItem('linguade.lastSyncAt', String(Date.now())); } catch (e) {}
      window.LD.router.go('home');
    }""")
    page.wait_for_timeout(450)
    has = page.evaluate("() => !!document.getElementById('backupBanner')")
    assert not has, "7 天内云同步后备份横幅仍出现"
    page.evaluate("""() => {
      try { localStorage.setItem('linguade.lastSyncAt', String(Date.now() - 10*86400000)); } catch (e) {}
      window.LD.router.go('home');
    }""")
    page.wait_for_timeout(450)
    has2 = page.evaluate("() => !!document.getElementById('backupBanner')")
    assert has2, "同步过期 10 天后备份横幅应恢复显示"


def test_week_bars_empty_state(page):
    """A3：近 8 周全 0 分钟时显示空态引导，不再悬空 8 根空气柱"""
    page.evaluate("""() => { window.LD.Store.s.daily = {}; window.LD.router.go('analytics'); }""")
    page.wait_for_timeout(600)
    html = page.evaluate("() => (document.getElementById('weekBars') || {}).innerHTML || ''")
    assert "暂无时长记录" in html, "全 0 时应为空态（实际：%r）" % html[:160]
    bar_count = page.evaluate("() => document.querySelectorAll('#weekBars svg rect').length")
    assert bar_count == 0, "空态时不应再画柱子（%d 根）" % bar_count
    # 有记录时恢复柱图
    page.evaluate("""() => { window.LD.Store.s.daily[window.LD.Store.dayKey()] = 25; window.LD.router.go('analytics'); }""")
    page.wait_for_timeout(500)
    bar_count2 = page.evaluate("() => document.querySelectorAll('#weekBars svg rect').length")
    assert bar_count2 > 0, "有记录时柱图应恢复"


def test_task_check_updates_with_mark(page):
    """A4：勾选任务后本周计数随之更新（动画为 CSS 层，用状态断言）"""
    page.evaluate("""() => { window.LD.router.go('home'); }""")
    page.wait_for_timeout(500)
    before = page.evaluate("() => { const p = document.querySelector('[data-fw-progress]'); return p ? p.textContent : ''; }")
    assert before and "/" in before, "找不到本周计数"
    first_row = page.evaluate("() => { const r = document.querySelector('[data-fw-task]'); return r ? r.dataset.fwTask : null; }")
    assert first_row, "首页没有任务行"
    page.evaluate("""(id) => {
      window.LD.FirstWeek.setDone(id, true);
      window.LD.router.go('home');
    }""", first_row)
    page.wait_for_timeout(500)
    after = page.evaluate("() => { const p = document.querySelector('[data-fw-progress]'); return p ? p.textContent : ''; }")
    assert after != before, "勾选后本周计数应更新 (%r -> %r)" % (before, after)
    page.evaluate("""(id) => {
      window.LD.FirstWeek.setDone(id, false);
      window.LD.router.go('home');
    }""", first_row)
    page.wait_for_timeout(400)
    after2 = page.evaluate("() => { const p = document.querySelector('[data-fw-progress]'); return p ? p.textContent : ''; }")
    assert after2 == before, "取消后计数应回原值"


def test_task_text_balance_wrap(page):
    """A5：任务文案使用 text-wrap:balance（长括注不再逐字折行）"""
    page.evaluate("""() => { window.LD.router.go('home'); }""")
    page.wait_for_timeout(400)
    val = page.evaluate("() => { const t = document.querySelector('.fw-task-text'); return t ? getComputedStyle(t).textWrap : ''; }")
    assert val == "balance", ".fw-task-text 应为 text-wrap:balance（实际：%r）" % val
