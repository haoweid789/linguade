"""flow_v23 · 长期使用报告 P0 整改回归（12 项）

覆盖：每日任务全完成不再抛错、队列预算随每日分钟伸缩、新词保底、积压可见与顺延、
首页文案说真话、坏记录被 migrate 清洗、错误边界可自救、真实页面 12px 下限、
手机触摸目标下限、首页导航入口与键盘可达、诊断选项可聚焦、本地日口径一致、
云端恢复保留 _snapAt、跨页面零控制台错误。
"""
import json

from conftest import goto

ROUTES = ["home", "vocab", "grammar", "chat", "speech", "listening", "drill", "notebook",
          "analytics", "plan", "writing", "reading", "mockexam"]


def _seed_backlog(page, cards=900):
    """注入一批已学卡 + 濒临遗忘状态，复现「长期使用」的队列压力"""
    page.evaluate("""(n) => {
        const S = LD.Store.s, DAY = 86400000, lex = (window.LD_LEX || []).filter(w => w[9] !== "vulgar");
        let sd = 20261103;
        const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
        S.hlr = {}; S.cards = {};
        const step = Math.max(1, Math.floor(lex.length / n));
        for (let i = 0; i < lex.length && Object.keys(S.cards).length < n; i += step) {
            const w = lex[i][0], reps = 1 + Math.floor(rnd() * 8);
            let h = 1;
            for (let c = 1; c <= reps; c++) h = Math.min(120, h * (c <= 2 ? 1.9 : 1.35));
            S.cards[w] = { ef: 2, iv: 3, due: Date.now() - Math.floor(rnd() * 5) * DAY, reps, lapses: 1, ok: reps, bad: 1, history: [] };
            S.hlr[w] = { h, correct: reps, wrong: 1, last: Date.now() - (1 + Math.floor(rnd() * 20)) * DAY };
        }
        LD.Store.save();
    }""", cards)


def _go(page, route, wait=260):
    """首页不是 .nav-item，goto() 走的是模块导航；统一用路由 API"""
    page.evaluate("r => window.LD.router.go(r)", route)
    page.wait_for_timeout(wait)


def test_quests_perfect_does_not_break_answering(page, errors):
    """三、每日任务全完成的那一刻：作答必须继续可用，且「任务大师」可解锁"""
    page.evaluate("""() => {
        const d = LD.Store.dayKey(new Date());
        LD.Store.s.quests = { date: d, items: [
            { id: 'q_vocab', nm: '词汇达人', ic: '▤', text: '练单词', target: 1, mod: 'vocab', xp: 60, progress: 0, done: false },
            { id: 'q_grammar', nm: '精益求精', ic: '✎', text: '句法纠错', target: 1, mod: 'grammar', xp: 40, progress: 0, done: false },
            { id: 'q_reading', nm: '阅读进阶', ic: '▣', text: '阅读理解', target: 1, mod: 'reading', xp: 40, progress: 0, done: false }] };
        LD.Store.save();
    }""")
    r = page.evaluate("""() => {
        const out = [];
        for (const type of ['vocab', 'grammar', 'reading', 'vocab']) {
            try { LD.Store.logAnswer({ type, ability: 'vocab', ok: true, ms: 900, item: 'Test', level: 'A1' }); out.push('ok'); }
            catch (e) { out.push('throw:' + e.message); }
        }
        return { out, perfect: LD.Store.s._questsPerfect || 0,
                 quizmaster: LD.Store.badgeList().filter(b => b.id === 'quizmaster')[0].got };
    }""")
    assert r["out"] == ["ok"] * 4, "每日任务完成后作答抛错：%s" % r["out"]
    assert r["perfect"] == 1, "单日完成全部任务应记入 _questsPerfect"
    assert r["quizmaster"] is True, "「任务大师」徽章应可解锁"
    assert errors == []


def test_queue_budget_follows_daily_minutes(page):
    """队列容量必须由「每日分钟」推导，不再写死 20"""
    r = page.evaluate("""() => {
        const out = {};
        for (const m of [10, 30, 60, 120, 600]) { LD.Store.s.profile.dailyMin = m; out[m] = LD.Engine.dailyBudget(); }
        return out;
    }""")
    assert r["10"] == 20 and r["30"] == 25 and r["60"] == 50 and r["120"] == 100 and r["600"] == 120, r


def test_new_words_are_not_starved(page):
    """到期积压很大时，队列仍必须留出约 30% 的新词名额"""
    page.evaluate("() => { LD.Store.s.profile.dailyMin = 60; }")
    _seed_backlog(page, 900)
    r = page.evaluate("""() => {
        const q = LD.Engine.buildQueue(), b = LD.Engine.backlogStats();
        return { len: q.length, newWords: q.filter(x => !x.isDue).length, due: b.due, deferred: b.deferred, newSlots: b.newSlots };
    }""")
    assert r["due"] > 200, "前置条件：应造出大量到期积压，实际 %s" % r["due"]
    assert r["newWords"] >= 1, "积压下新词名额被挤成 0（回归）：%s" % r
    assert r["deferred"] > 0 and r["newSlots"] > 0, r


def test_vocab_page_shows_backlog_and_defers(page):
    """积压要可见，并给出一键顺延的自救入口"""
    page.evaluate("() => { LD.Store.s.profile.dailyMin = 30; }")
    _seed_backlog(page, 600)
    goto(page, "vocab", 320)
    view = page.locator("#view").inner_text()
    assert "今天排不下" in view, "积压提示缺失：%s" % view[:160]
    before = page.evaluate("() => LD.Engine.backlogStats().due")
    page.locator("#deferBacklog").click()
    page.wait_for_timeout(400)
    after = page.evaluate("() => LD.Engine.backlogStats().due")
    assert after < before, "顺延后到期数应下降：%d → %d" % (before, after)


def test_home_copy_is_honest(page):
    """首页不得再出现写死的「约 5–10 分钟」、内部函数名与做不到的承诺"""
    _seed_backlog(page, 500)
    _go(page, "home", 320)
    view = page.locator("#view").inner_text()
    for banned in ["约 5–10 分钟", "fitToExam", "确保考前完成全部词条过一遍", "正在滑向遗忘"]:
        assert banned not in view, "首页仍含「%s」" % banned
    assert "分钟" in view


def test_migrate_scrubs_broken_records(page, errors):
    """旧快照/手工改过的坏记录必须在载入时被清掉，而不是让模块白屏"""
    page.evaluate("""() => {
        const dirty = { diagnosed: true, profile: { name: 't', exam: 'TestDaF', level: 'B1', dailyMin: 30 },
            cfg: { theme: 'light', retention: 0.9, gamify: true }, ability: { vocab: 60 },
            cards: { gut: null, Tag: { ef: 2, due: Date.now() - 86400000, reps: 2, ok: 1, bad: 0, lapses: 0, iv: 1, history: [] } },
            log: [null, { t: 'abc', type: 'vocab' }, { t: Date.now(), type: 'vocab', ok: true, ability: 'vocab' }],
            daily: { '2026-11-01': null, '2026-11-02': 'x', '2026-11-03': 12 },
            wrong: [null], wordbank: [null], mockexams: [{ t: Date.now(), score: 15, dims: {} }],
            interviews: [{ t: Date.now(), score: 70 }], favorites: [null, 'vocab', 7], badges: [null, 'first'] };
        LD.Store.restoreSnapshot(dirty);
    }""")
    r = page.evaluate("""() => { const s = LD.Store.s;
        return { cards: Object.keys(s.cards), log: s.log.length, wrong: s.wrong.length, wordbank: s.wordbank.length,
                 daily: s.daily, pct: s.mockexams[0] && s.mockexams[0].pct, fav: s.favorites, badges: s.badges,
                 best: s.bestStreak };
    }""")
    assert r["cards"] == ["Tag"], r["cards"]
    assert r["log"] == 1 and r["wrong"] == 0 and r["wordbank"] == 0, r
    assert r["daily"]["2026-11-03"] == 12 and r["daily"]["2026-11-02"] == 0, r["daily"]
    assert r["pct"]["lesen"] == 0, "缺 pct 的模考记录应被补默认值而不是让页面崩"
    assert r["fav"] == ["vocab"] and r["badges"] == ["first"], r
    for route in ["home", "vocab", "analytics", "mockexam", "interview", "plan", "notebook"]:
        page.evaluate("r => LD.Store.load() || LD.router.go(r)", route)
        page.wait_for_timeout(120)
    assert "模块渲染失败" not in page.evaluate("() => document.body.innerText")
    assert "这个页面没能打开" not in page.evaluate("() => document.body.innerText")


def test_error_boundary_offers_recovery(page):
    """渲染异常要能自救，不能只把 JS 报错甩给用户"""
    page.evaluate("""() => {
        LD.Modules['v23boom'] = Object.assign({ title: 'x', render() { throw new Error('模拟故障'); } },
            { route: 'v23boom', label: 'x', group: 'x', order: 999, priority: 'P2' });
    }""")
    page.evaluate("() => LD.router.go('v23boom')")
    page.wait_for_timeout(200)
    view = page.locator("#view").inner_text()
    assert "这个页面没能打开" in view, view[:200]
    assert page.locator("#retryRender").count() == 1 and page.locator("#gotoHome").count() == 1
    page.evaluate("() => delete LD.Modules['v23boom']")


def test_small_text_floor_on_rendered_pages(page):
    """字号下限必须量真实渲染的页面，而不是量插进 body 的假元素"""
    small = []
    for route in ROUTES:
        _go(page, route, 260)
        found = page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('#view *').forEach(e => {
                if (e.children.length || !e.textContent.trim()) return;
                const fs = parseFloat(getComputedStyle(e).fontSize), r = e.getBoundingClientRect();
                if (r.width && r.height && fs < 12) out.push(e.tagName + '.' + String(e.className).split(' ')[0] + '=' + fs);
            });
            return [...new Set(out)];
        }""")
        if found:
            small.append("%s: %s" % (route, found[:4]))
    assert not small, "渲染页面仍有低于 12px 的文字 → %s" % small


def test_phone_touch_targets(page, browser, site_url):
    """手机形态下主要操作的可点面积不低于 40px"""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    ctx.add_init_script("localStorage.setItem('linguade.v1', %s)" % json.dumps(json.dumps(
        {"diagnosed": True, "profile": {"name": "t", "exam": "TestDaF", "level": "B1", "dailyMin": 30, "lang": "bilingual", "examDate": ""},
         "cfg": {"theme": "light", "retention": 0.9, "gamify": True}, "ability": {"vocab": 60}}, ensure_ascii=False)))
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=10000)
    bad = {}
    for route in ["vocab", "reading", "notebook"]:
        pg.evaluate("r => LD.router.go(r)", route)
        pg.wait_for_timeout(320)
        small = pg.evaluate("""() => [...document.querySelectorAll('#view .btn, #view .banner-dismiss, #view .module-tab')]
            .filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && r.height < 40; })
            .map(e => String(e.className).split(' ')[0] + ':' + Math.round(e.getBoundingClientRect().height));
        """)
        if small:
            bad[route] = list(dict.fromkeys(small))[:5]
    ctx.close()
    assert not bad, "手机上仍有 <40px 的按钮 → %s" % bad


def test_home_entry_in_nav_and_brand_focusable(page):
    """回「今天学什么」必须有导航入口，且键盘可达"""
    goto(page, "vocab", 240)
    assert page.locator(".nav-home").count() == 1, "侧栏缺少首页入口"
    page.locator(".nav-home").click()
    page.wait_for_timeout(240)
    assert page.evaluate("() => window.LD.router.current()") == "home"
    assert page.evaluate("() => document.querySelector('.nav-home').classList.contains('active')") is True
    brand = page.evaluate("""() => { const b = document.querySelector('.brand');
        return { tabindex: b.getAttribute('tabindex'), role: b.getAttribute('role'), label: b.getAttribute('aria-label') }; }""")
    assert brand["tabindex"] == "0" and brand["role"] == "link", brand


def test_diagnose_options_are_keyboard_reachable(browser, site_url):
    """诊断选项必须是可聚焦控件，纯键盘也能答完题"""
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector("#opts .list-item", timeout=10000)
    tag = pg.evaluate("() => document.querySelector('#opts .list-item').tagName")
    assert tag == "BUTTON", "诊断选项应为 button，实际 %s" % tag
    pg.evaluate("() => document.querySelector('#opts .list-item').focus()")
    focused = pg.evaluate("() => document.activeElement.className")
    assert "list-item" in focused, focused
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(200)
    assert pg.locator("#fb").inner_text().strip() != "", "回车应能作答"
    ctx.close()


def test_local_day_keys_are_consistent(page):
    """打卡与报表必须用同一套本地日键（凌晨学习不再记到前一天）"""
    key = page.evaluate("() => LD.Store.dayKey(new Date())")
    page.evaluate("k => { LD.Store.s.daily = {}; LD.Store.s.daily[k] = 12; LD.Store.save(); }", key)
    _go(page, "home", 300)
    if page.locator("#homeMoreBtn").count():
        page.locator("#homeMoreBtn").click()
        page.wait_for_timeout(260)
    view = page.locator("#view").inner_text()
    assert "12′" in view, "周日历未显示今天的 12 分钟（打卡与报表日键口径不一致）key=%s" % key


def test_restore_keeps_snap_at(page):
    """从云端恢复后必须保留时间戳，否则下一次的冲突提示永久失效"""
    r = page.evaluate("""() => {
        LD.Store.restoreSnapshot({ diagnosed: true, profile: {}, cfg: {}, ability: {}, _snapAt: 1700000000000 });
        return { at: LD.Store.s._snapAt, snapHas: !!LD.Store.snapshot()._snapAt };
    }""")
    assert r["at"] == 1700000000000, r
    assert r["snapHas"] is True, "上行快照应自带 _snapAt"


def test_zero_console_errors_across_routes(page, errors):
    """跨页面巡检：装配层与渲染不得产生控制台错误"""
    for route in ROUTES + ["weak", "syntax", "phonetics", "sandbox", "interview", "ocrgrade"]:
        page.evaluate("r => LD.router.go(r)", route)
        page.wait_for_timeout(140)
    assert errors == [], errors[:4]


def test_sync_merge_takes_union(page):
    """同步改为字段级合并：两边各学过的记录取并集，不再整档覆盖"""
    r = page.evaluate("""() => {
        const A = { diagnosed: true, updatedAt: 1000, xp: 100, profile: { name: 'A' },
            cards: { Tag: { ef: 2, iv: 1, due: 1000, reps: 1, ok: 1, bad: 0, lapses: 0, history: [{ t: 1000, q: 3 }] } },
            hlr: { Tag: { h: 5, correct: 2, wrong: 0, last: 5000 } },
            log: [{ t: 1000, type: 'vocab', item: 'Tag', ok: true }],
            wrong: [{ module: '单词', type: 'vocab', wrong: 'Tag', t: 1000 }],
            wordbank: [{ id: 'w1', de: 'Haus', zh: '房子', t: 1000 }],
            daily: { '2026-11-01': 10 }, favorites: ['vocab'], badges: ['first'],
            visited: { vocab: 3 }, mockexams: [], interviews: [], sessions: [] };
        const B = { diagnosed: true, updatedAt: 2000, xp: 50, profile: { name: 'B' },
            cards: { Tag: { ef: 2, iv: 2, due: 9000, reps: 2, ok: 2, bad: 0, lapses: 0, history: [{ t: 9000, q: 3 }] },
                     Haus: { ef: 2, iv: 1, due: 9000, reps: 1, ok: 1, bad: 0, lapses: 0, history: [{ t: 9000, q: 3 }] } },
            hlr: { Haus: { h: 4, correct: 1, wrong: 0, last: 8000 } },
            log: [{ t: 2000, type: 'vocab', item: 'Haus', ok: false }],
            wrong: [{ module: '单词', type: 'vocab', wrong: 'Haus', t: 2000 }],
            wordbank: [{ id: 'w2', de: 'Baum', zh: '树', t: 2000 }],
            daily: { '2026-11-01': 20, '2026-11-02': 5 }, favorites: ['reading'], badges: ['s3'],
            visited: { reading: 2 }, mockexams: [{ t: 3000, pct: { lesen: 50 } }], interviews: [], sessions: [] };
        const { state, stats } = LD.Store.mergeStates(A, B);
        return { cards: Object.keys(state.cards).sort(), tagDue: state.cards.Tag.due,
                 hlr: Object.keys(state.hlr).sort(), log: state.log.length, wrong: state.wrong.length,
                 bank: state.wordbank.map(w => w.de).sort(), daily: state.daily, xp: state.xp,
                 favs: state.favorites.slice().sort(), badges: state.badges.slice().sort(),
                 visits: state.visited, exams: state.mockexams.length, added: stats.added };
    }""")
    assert r["cards"] == ["Haus", "Tag"], r["cards"]
    assert r["tagDue"] == 9000, "同一词卡应取更晚练习的那份"
    assert r["hlr"] == ["Haus", "Tag"]
    assert r["log"] == 2 and r["wrong"] == 2 and r["bank"] == ["Baum", "Haus"]
    assert r["daily"]["2026-11-01"] == 20 and r["daily"]["2026-11-02"] == 5
    assert r["xp"] == 100, "XP 取较大值而不是相加"
    assert r["favs"] == ["reading", "vocab"] and r["badges"] == ["first", "s3"]
    assert r["visits"]["vocab"] == 3 and r["visits"]["reading"] == 2
    assert r["exams"] == 1 and r["added"] >= 2


def test_notebook_paginates_and_searches(page):
    """错题本分页：160 条不再渲染成 3.7 万像素长页"""
    page.evaluate("""() => { const S = LD.Store.s; S.wrong = [];
        for (let i = 0; i < 45; i++) S.wrong.push({ module: '单词', type: 'vocab', wrong: 'Wort' + i,
            right: '词' + i, why: '测试', t: Date.now() - i * 1000, mastered: false });
        LD.Store.save(); }""")
    goto(page, "notebook", 380)
    assert page.locator("#list .list-item").count() == 20, "每页应为 20 条"
    assert "第 1 / 3 页" in page.locator("#list").inner_text()
    page.locator("[data-page='next']").click()
    page.wait_for_timeout(220)
    assert "第 2 / 3 页" in page.locator("#list").inner_text()
    page.fill("#nbSearch", "Wort44")
    page.wait_for_timeout(260)
    assert page.locator("#list .list-item").count() == 1, "搜索应只剩 1 条"
    assert "Wort44" in page.locator("#list").inner_text()


def test_health_probe_skips_loopback(page, errors):
    """同源本地回环（e2e / 本地静态托管）没有 /api：探测必须直接判否，不发请求、不产生 404 噪音"""
    errors.clear()
    ok = page.evaluate("() => window.LD.Backend.probeHealth(500)")
    page.wait_for_timeout(300)
    assert ok is False, "本地回环不应被判为后端可用"
    assert errors == [], "本地回环探测不应产生控制台错误：%s" % errors[:2]
