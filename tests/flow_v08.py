"""flow_v08 · 新机制与全域冒烟（10 项）

覆盖：算法沙盘可复现性、弱点画像、口语评分、数据导出格式、连胜统计，
以及全部路由（首页 + 18 个常驻模块）冒烟零控制台错误。
"""
from conftest import goto, view_html, ROUTES


def test_sandbox_is_deterministic(page):
    """同一 seed 的沙盘模拟结果必须完全一致（可复现实验台）"""
    r = page.evaluate(
        """() => {
            const E = window.LD.Engine, opt = { seed: 7, days: 30, n: 60, newPerDay: 4 };
            const a = JSON.stringify(E.sandboxSim(opt).worlds);
            const b = JSON.stringify(E.sandboxSim(opt).worlds);
            return { same: a === b, len: a.length };
        }""")
    assert r["same"] is True and r["len"] > 50


def test_sandbox_seed_changes_result(page):
    """不同 seed 应产生不同结果（证明随机源确实生效）"""
    r = page.evaluate(
        """() => {
            const E = window.LD.Engine;
            const a = JSON.stringify(E.sandboxSim({ seed: 7, days: 30, n: 60 }).worlds);
            const c = JSON.stringify(E.sandboxSim({ seed: 99, days: 30, n: 60 }).worlds);
            return a !== c;
        }""")
    assert r is True


def test_sandbox_compares_four_schedulers(page):
    """沙盘应同时输出 HLR / SM-2 / Leitner / FSRS 四套调度器结果"""
    keys = page.evaluate("() => Object.keys(window.LD.Engine.sandboxSim({ seed: 7, days: 10 }).worlds)")
    assert keys == ["hlr", "sm2", "leitner", "fsrs"]


def test_sandbox_verdict(page):
    """沙盘结论由实测数字生成，不应为空"""
    v = page.evaluate("() => window.LD.Engine.sandboxVerdict(window.LD.Engine.sandboxSim({ seed: 7, days: 20 }))")
    assert v["headline"] and len(v["headline"]) > 4
    assert v["detail"]


def test_weak_points_structure(page):
    """弱点画像返回 byType / weakest / ability"""
    w = page.evaluate("() => window.LD.Engine.weakPoints()")
    assert "byType" in w and "weakest" in w and "ability" in w
    assert isinstance(w["weakest"], list)


def test_speech_scoring_dimensions(page):
    """口语评分包含四个维度与总分"""
    r = page.evaluate(
        """() => window.LD.Engine.scoreSpeech(
            'Guten Tag, ich möchte mich kurz vorstellen.',
            'Guten Tag ich mochte mich kurz vorstellen',
            { ms: 9000, pauses: 2 })""")
    for k in ("total", "accuracy", "fluency", "stress", "intonation", "grade", "advice"):
        assert k in r, "缺少评分维度：%s" % k
    assert 0 <= r["total"] <= 100


def test_wordbank_tsv_export(page):
    """生词本可导出 Anki 兼容 TSV（含制表符）"""
    r = page.evaluate(
        """() => {
            const S = window.LD.Store;
            S.addWord({ id: 't1', de: 'Haus', zh: '房子', ctx: 'Das Haus ist groß.', scene: 'test', t: Date.now(), known: false });
            return { tsv: S.exportWordbankTSV(), csv: S.exportLogCSV() };
        }""")
    assert isinstance(r["tsv"], str) and "\t" in r["tsv"]
    assert "Haus" in r["tsv"]
    assert isinstance(r["csv"], str) and len(r["csv"]) > 0


def test_streak_counts_consecutive_days(page):
    """连胜按连续日期统计"""
    r = page.evaluate(
        """() => {
            const S = window.LD.Store;
            const dk = n => { const t = new Date(Date.now() - n * 86400000);
                return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
            S.s.daily = {};
            S.s.daily[dk(0)] = 10; S.s.daily[dk(1)] = 10; S.s.daily[dk(2)] = 10;
            return { streak: S.streak(), freezes: S.s.freezes,
                     hasFreezeApi: typeof S.consumeFreezeIfNeeded === 'function' };
        }""")
    assert r["streak"] == 3
    assert r["freezes"] == 0
    assert r["hasFreezeApi"] is True


def test_all_routes_smoke(page, errors):
    """首页 + 20 个模块全部可达且渲染非空、无控制台错误"""
    page.locator(".brand").click()
    page.wait_for_timeout(200)
    assert len(view_html(page)) > 100
    for r in ROUTES:
        goto(page, r)
        assert len(view_html(page)) > 80, "路由 %s 渲染为空" % r
    assert errors == [], "控制台错误：%s" % errors


def test_wrong_book_sink(page):
    """跨模块错题自动沉淀到错题本，并计入待复习数"""
    r = page.evaluate(
        """() => {
            const S = window.LD.Store;
            const n0 = S.s.wrong.length;
            S.addWrong({ module: '单词练习', type: 'vocab', wrong: 'der Haus', right: 'das Haus', why: '中性名词 das Haus' });
            return { n0, n1: S.s.wrong.length, pending: S.wrongPending().length,
                     hasToggle: typeof S.toggleWrong === 'function' };
        }""")
    assert r["n1"] == r["n0"] + 1
    assert r["pending"] >= 1
    assert r["hasToggle"] is True