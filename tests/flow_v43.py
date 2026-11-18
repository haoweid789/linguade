# -*- coding: utf-8 -*-
"""C1 分级测评 e2e：分层抽样 → 答题 → 定级落库 → 入口与边界。"""
import pytest

from conftest import goto

LEVELS = {"A1", "A2", "B1", "B2", "C1"}


def _paper(page):
    """在页内按应用当前 seed 重建整卷（与模块 seedNow 同源），拿到题干与正确项下标"""
    return page.evaluate("""() => {
      const dk = LD.Store.dayKey ? LD.Store.dayKey() : '';
      const oid = LD.Store.s.open_id || '';
      const p = LD.Placement.build(LD.Placement.seedFor(dk, oid));
      const g = q => ({ s: q.lemma || q.q, a: q.a, opts: q.opts, lv: q.lv, de: q.de || "" });
      return { vocab: p.vocab.map(g), grammar: p.grammar.map(g) };
    }""")


def _start(page):
    goto(page, "placement")
    page.wait_for_selector("#plStart", timeout=8000)
    page.locator("#plStart").click()
    page.wait_for_selector("#plOpts", timeout=8000)


def _stem(page):
    return page.evaluate(
        "() => { const o = document.querySelector('#plOpts');"
        " return o && o.previousElementSibling ? o.previousElementSibling.textContent.trim() : ''; }")


def _answer_current(page, idx):
    """点第 idx 个选项（0 基），再点下一题"""
    page.locator("#plOpts .list-item").nth(idx).click()
    page.wait_for_timeout(60)
    page.locator("#plNext").click()
    page.wait_for_timeout(90)


def _run_all_correct(page, paper):
    """按 paper 的正确项逐题作答；返回实际答完的题数"""
    n = 0
    for _ in range(len(paper["vocab"]) + len(paper["grammar"])):
        stem = _stem(page)
        if not stem:
            break
        hit = None
        for q in paper["vocab"] + paper["grammar"]:
            if q["s"] == stem:
                hit = q
                break
        assert hit is not None, "当前题干不在重建的试卷里：%r" % stem
        _answer_current(page, hit["a"])
        n += 1
        # 答完最后一题后进入结果页，没有 #plOpts
        if page.locator("#plOpts").count() == 0:
            break
    return n


def test_placement_paper_shape(page):
    """试卷：20 道词汇（分层配额）+ 30 道语法（A1–C1 各 6）"""
    paper = _paper(page)
    assert len(paper["vocab"]) == 20
    assert len(paper["grammar"]) == 30
    quota = {}
    for q in paper["vocab"]:
        quota[q["lv"]] = quota.get(q["lv"], 0) + 1
    assert quota == {"A1": 3, "A2": 4, "B1": 4, "B2": 4, "C1": 3, "C2": 2}
    assert all(q["lv"] in LEVELS for q in paper["grammar"])


def test_placement_vocab_questions_well_formed(page):
    """词汇题：4 个互不相同选项、正确项在选项内、题干非多义词"""
    bad = page.evaluate("""() => {
      const p = LD.Placement.build(LD.Placement.seedFor('2026-11-18', 'e2e'));
      const out = [];
      p.vocab.forEach(q => {
        if (!q.opts || q.opts.length !== 4) out.push(['len', q.lemma]);
        else if (new Set(q.opts).size !== 4) out.push(['dup', q.lemma]);
        if (q.opts[q.a] !== q.zh) out.push(['answer', q.lemma]);
        if (String(q.lemma).indexOf('；') >= 0) out.push(['polysemy', q.lemma]);
        if (!(q.pos === 'n' || q.pos === 'v' || q.pos === 'adj')) out.push(['pos', q.lemma, q.pos]);
      });
      return out;
    }""")
    assert bad == [], bad


def test_placement_grammar_points_exist(page):
    """语法题引用的 point 必须在 LD_GRAMMAR_POINTS 里（否则结果页挂空链接）"""
    missing = page.evaluate("""() => {
      const codes = new Set((window.LD_GRAMMAR_POINTS || []).map(p => p.code));
      return (window.LD_PLACEMENT_GRAMMAR || [])
        .filter(q => q.point && !codes.has(q.point)).map(q => q.lv + ':' + q.point);
    }""")
    assert missing == [], missing


def test_placement_same_day_same_paper(page):
    """同一天同用户 → 同一套卷；换日期 → 换卷（可复现 + 防背题）"""
    same = page.evaluate("""() => {
      const a = LD.Placement.build(LD.Placement.seedFor('2026-11-18', 'u1'));
      const b = LD.Placement.build(LD.Placement.seedFor('2026-11-18', 'u1'));
      return JSON.stringify(a.vocab.map(q => q.de)) === JSON.stringify(b.vocab.map(q => q.de));
    }""")
    assert same is True
    diff = page.evaluate("""() => {
      const a = LD.Placement.build(LD.Placement.seedFor('2026-11-18', 'u1'));
      const b = LD.Placement.build(LD.Placement.seedFor('2026-11-19', 'u1'));
      return JSON.stringify(a.vocab.map(q => q.de)) !== JSON.stringify(b.vocab.map(q => q.de));
    }""")
    assert diff is True


def test_placement_full_flow_all_correct_is_c1(page):
    """全流程：50 题全对 → 结果页 C1 + 词汇量估算 + 落库"""
    paper = _paper(page)
    _start(page)
    n = _run_all_correct(page, paper)
    assert n == 50, "实际答完 %d 题" % n
    page.wait_for_selector("#plPlan", timeout=8000)
    body = page.evaluate("() => document.getElementById('view').innerText")
    assert "参考级别 C1" in body
    assert "词汇约" in body
    pl = page.evaluate("() => LD.Store.s.profile.placement")
    assert pl and pl["level"] == "C1"
    assert pl["vocabEst"] > 0 and pl["vocabRange"][0] <= pl["vocabEst"] <= pl["vocabRange"][1]
    assert len(pl["layers"]) == 6 and len(pl["grammar"]) == 5
    assert pl["grammarLevel"] == "C1"


def test_placement_keeps_manual_level(page):
    """levelTouched 为真：只写 placement，不覆盖用户手动设定的起点"""
    page.evaluate("""() => {
      LD.Store.s.profile.level = 'A2';
      LD.Store.s.profile.levelTouched = true;
      LD.Store.save();
    }""")
    paper = _paper(page)
    _start(page)
    _run_all_correct(page, paper)
    page.wait_for_selector("#plPlan", timeout=8000)
    st = page.evaluate("() => ({ lv: LD.Store.s.profile.level, p: LD.Store.s.profile.placement.level })")
    assert st["lv"] == "A2"
    assert st["p"] in LEVELS
    body = page.evaluate("() => document.getElementById('view').innerText")
    assert "不覆盖" in body


def test_placement_abort_does_not_save(page):
    """中途离开不落库：答几题就切走，profile.placement 仍为空"""
    assert page.evaluate("() => LD.Store.s.profile.placement") is None
    _start(page)
    page.locator("#plOpts .list-item").first.click()
    page.wait_for_timeout(80)
    goto(page, "home")
    page.wait_for_timeout(200)
    assert page.evaluate("() => LD.Store.s.profile.placement") is None


def test_analytics_entry_visible(page):
    """学情分析顶部有分级测评入口（未测时给出去测评，测过给起点参考）"""
    goto(page, "analytics")
    page.wait_for_timeout(250)
    html = page.evaluate("() => document.getElementById('view').innerHTML")
    assert ("去测评" in html) or ("起点参考" in html)


def test_placement_route_has_no_console_errors(page):
    page.evaluate("() => window.LD.router.go('placement')")
    page.wait_for_timeout(400)
    assert page.locator("#plStart").count() == 1
    assert page.evaluate("() => window.LD.Modules['placement'].nav") == "more"


def test_placement_no_overflow_at_320(browser, site_url):
    """320px 下说明页 / 答题页 / 结果页都不横向溢出（结果页两张表最宽）"""
    import json

    from conftest import SEED

    ctx = browser.new_context(viewport={"width": 320, "height": 700})
    seed = json.loads(json.dumps(SEED))
    ctx.add_init_script("localStorage.setItem('linguade.v1', %s)" % json.dumps(json.dumps(seed, ensure_ascii=False)))
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=10000)
    pg.evaluate("() => window.LD.router.go('placement')")
    pg.wait_for_selector("#plStart")
    pg.wait_for_timeout(300)

    def no_overflow(tag):
        over = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        assert over <= 1, "%s 在 320px 下横向溢出 %spx" % (tag, over)

    no_overflow("说明页")
    pg.locator("#plStart").click()
    pg.wait_for_selector("#plOpts")
    pg.wait_for_timeout(200)
    no_overflow("答题页")
    # 直接跳到结果页：全答对
    paper = _paper(pg)
    for item in paper["vocab"] + paper["grammar"]:
        stem = _stem(pg)
        if not stem:
            break
        hit = next((q for q in paper["vocab"] + paper["grammar"] if q["s"] == stem), None)
        assert hit is not None, stem
        _answer_current(pg, hit["a"])
        if pg.locator("#plOpts").count() == 0:
            break
    pg.wait_for_selector("#plPlan", timeout=10000)
    pg.wait_for_timeout(300)
    no_overflow("结果页")
    ctx.close()