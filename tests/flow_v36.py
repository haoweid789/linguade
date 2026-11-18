"""LinguaDE · flow_v36：3.25.0 学情分析合并薄弱表 + 移除「更多工具」+ 直达错题本/专项训练

M1 合并表两段渲染；「能力诊断」分类被剔除
M2 分类行「看错题」→ 错题本场景筛选预设生效
M3 知识点行「看错题」（g:）→ 错题本按错误类型组卷预设生效
M4 知识点行「专项训练 · 冠词性别」（art:）→ 专项训练预选题型
M5 首页与导航不再出现「更多工具」；被移出导航的模块仍路由可达
"""


def _seed_weak(page):
    """造数据：分类作答（vocab 薄弱 / grammar / diagnose 应剔除）+ BKT 知识点 + 错题"""
    page.evaluate("""() => {
      const S = window.LD.Store.s, now = Date.now();
      S.log = [];
      for (let i = 0; i < 10; i++) S.log.push({ t: now - i * 60000, type: "vocab", ability: "vocab", ok: i < 3, ms: 9000, item: "w" + i });
      for (let i = 0; i < 4; i++) S.log.push({ t: now - i * 60000, type: "grammar", ability: "grammar", ok: true, ms: 9000, item: "g" + i });
      for (let i = 0; i < 5; i++) S.log.push({ t: now - i * 60000, type: "diagnose", ok: false, ms: 9000, item: "d" + i, noXP: true });
      S.bkt = { "g:名词大写": 0.18, "art:Hund": 0.30, "hear:drücken": 0.56, "v:Wort": 0.40 };
      S.bktN = { "g:名词大写": 5, "art:Hund": 2, "hear:drücken": 1, "v:Wort": 3 };
      S.wrong = [
        { t: now, module: "句法纠错", type: "名词大写", wrong: "hunde", right: "Hunde", source: "", why: "名词首字母大写" },
        { t: now, module: "单词", type: "词义混淆", wrong: "Wort", right: "Wörter", source: "", why: "复数" }
      ];
      window.LD.Store.save();
    }""")


def _go(page, route, wait=450):
    page.evaluate("r => window.LD.router.go(r)", route)
    page.wait_for_timeout(wait)


def test_merged_table_renders_and_excludes_diagnose(page):
    """M1：合并表两段都渲染；diagnose 分类不出现；行动按钮按映射生成"""
    _seed_weak(page)
    _go(page, "analytics")
    tbl = page.locator("#weakMerged")
    txt = tbl.inner_text()
    assert "分类正确率 · 实际作答" in txt, "分类段组头缺失：%r" % txt[:200]
    assert "最需要优先复习的知识点" in txt, "知识点段组头缺失：%r" % txt[:200]
    assert "能力诊断" not in txt, "diagnose 分类应被剔除"
    assert "单词" in txt and "句法纠错" in txt, "分类行缺失"
    assert "语法点 名词大写" in txt and "听力 drücken" in txt, "知识点行缺失"
    assert tbl.locator("[data-nb]").count() >= 2, "「看错题」按钮缺失"
    assert tbl.locator("[data-drill]").count() == 1, "art: 知识点应给出 1 个专项训练按钮"


def test_category_row_links_notebook_module(page):
    """M2：分类行「看错题」→ 错题本按模块场景筛选（单词）"""
    _seed_weak(page)
    _go(page, "analytics")
    page.locator("#weakMerged [data-nb]").first.click()
    page.wait_for_timeout(450)
    active = page.locator(".scene-chip.active")
    assert active.count() == 1, "应恰好一个激活的场景筛选"
    assert active.first.inner_text().strip() == "单词", "场景筛选应为「单词」：%r" % active.first.inner_text()
    assert "开始错题重练" in page.locator("#trainBtn").inner_text()


def test_skill_row_links_notebook_type(page):
    """M3：g: 知识点行「看错题」→ 错题本按错误类型组卷（名词大写）"""
    _seed_weak(page)
    _go(page, "analytics")
    page.locator("#weakMerged [data-nbtype]").first.click()
    page.wait_for_timeout(450)
    chip = page.locator(".nb-type.active")
    assert chip.count() == 1, "应恰好一个激活的类型组卷按钮"
    assert "名词大写" in chip.first.inner_text(), "类型组卷应为「名词大写」：%r" % chip.first.inner_text()
    assert "只练" in page.locator("#trainBtn").inner_text(), "组卷按钮应写明只练该类型"


def test_drill_row_presets_type(page):
    """M4：art: 知识点行「专项训练 · 冠词性别」→ 专项训练预选题型"""
    _seed_weak(page)
    _go(page, "analytics")
    page.locator("#weakMerged [data-drill]").first.click()
    page.wait_for_timeout(450)
    active = page.locator(".scenes .scene-chip.active")
    assert active.count() == 1, "应恰好一个激活的题型"
    assert "冠词性别" in active.first.inner_text(), "题型应预选为冠词性别：%r" % active.first.inner_text()
    assert "冠词性别 · 规则要点" in page.locator("#view").inner_text(), "规则要点卡未随预选切换"


def test_more_tools_removed(page):
    """M5：导航与首页无「更多工具」；弱点突破仍路由可达（专项训练页签）"""
    assert page.locator("#navMore").count() == 0
    assert "更多工具" not in page.locator("#sidebar").inner_text()
    _go(page, "home", wait=500)
    assert "更多工具" not in page.locator("#view").inner_text()
    _go(page, "weak")
    assert "弱点突破" in page.locator("#view .page-head").inner_text()
