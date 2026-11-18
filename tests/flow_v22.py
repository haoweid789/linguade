"""flow_v22 · german_exam.db 接入回归（3 项）

覆盖：考试词库合并去重 / 语法速查卡 / 模考考试结构表。
"""
from conftest import goto


def test_exam_lexicon_merged_and_cleaned(page):
    r = page.evaluate("""() => {
        const lex = window.LD_LEX || [];
        const from = window.LD_LEX_MACHINE_FROM_10 || 0;
        const add = lex.slice(from);
        const find = w => lex.find(x => x[0] === w) || null;
        const low = {};
        lex.forEach(x => { const k = String(x[0]).toLowerCase(); low[k] = (low[k] || 0) + 1; });
        return {
            total: lex.length,
            from,
            add: add.length,
            a1: add.filter(x => x[4] === 'A1').length,
            withEx: add.filter(x => x[5]).length,
            exNoZh: add.filter(x => x[5] && !x[6]).length,
            exTooShort: add.filter(x => x[5] && x[5].length < 14).length,
            dup: Object.values(low).filter(n => n > 1).length,
            machine: window.LD_LEX_MACHINE ? window.LD_LEX_MACHINE.size : 0,
            noExAnywhere: lex.filter(x => !String(x[5] || "").trim()).length,
            noExZhAnywhere: lex.filter(x => String(x[5] || "").trim() && !String(x[6] || "").trim()).length,
            uhr: find('Uhr'), maerz: find('März'), wagen: find('Wagen'),
            stimme: find('Stimme'),
            matura: find('Matura'), abfahren: find('abfahren'), willen: find('willen'),
            polnisch: find('polnisch'),
            lookup: window.LD.Lex.lookup('März')
        };
    }""")
    assert r["total"] >= 5900, "原 2000 词 + 考试词库应达到 5900+"
    assert r["from"] == 2000, "新增词应接在既有 2000 词之后"
    assert r["add"] >= 3900, "考试词库新增应有 3900+ 条"
    assert r["a1"] >= 500, "A1 应补足 500+ 缺口"
    assert r["withEx"] == r["add"], "考试词库应逐条带例句（构建期已保证 100%）"
    assert r["exNoZh"] == 0, "例句必须带中文对照"
    assert r["noExAnywhere"] == 0, "全库 6423 条都应有例句（lexicon-9 已补齐）"
    assert r["noExZhAnywhere"] == 0, "全库例句都应带中文对照"
    assert r["exTooShort"] == 0, "例句长度不得短于 14 字符"
    assert r["dup"] == 0, "词库不允许小写重复词形"
    assert r["machine"] >= 5300, "机器词条应带待抽检标识"
    assert r["uhr"] and r["uhr"][2] == "钟；表"
    assert r["maerz"] and r["maerz"][2] == "三月"
    assert r["wagen"] and r["wagen"][2] == "车"
    assert r["stimme"] and r["stimme"][2] == "声音；嗓音"
    assert r["lookup"] and r["lookup"]["zh"] == "三月"
    assert r["matura"] and "Matura" in r["matura"][5] and r["matura"][6], "人工补写例句应入库"
    assert r["abfahren"] and r["abfahren"][5].rstrip().endswith("ab?"), "可分动词要配到前缀落在句末的句子"
    assert r["willen"] and r["willen"][2] == "为了" and r["willen"][3] == "prep"
    assert r["polnisch"] and r["polnisch"][2].startswith("波兰")


def test_grammar_reference_card(page):
    goto(page, "grammar")
    assert page.locator("#gRefLevel").count() == 1
    assert page.locator("#gRefLevel option").count() == 7, "全部等级 + A1–C2"
    page.select_option("#gRefLevel", "A1")
    page.wait_for_timeout(120)
    text = page.locator("#gRefList").inner_text()
    assert "主句动词第二位" in text and "一般疑问句" in text
    page.locator("#gRefList details").first.click()
    page.wait_for_timeout(80)
    assert "德语有26个基本字母" in page.locator("#gRefList details").first.inner_text()


def test_mockexam_exam_plan_table(page):
    goto(page, "mockexam")
    assert page.locator("#mxPlanExam").count() == 1
    page.locator("summary", has_text="考试结构速查").click()
    page.wait_for_timeout(80)
    page.select_option("#mxPlanExam", "GOETHE_B1")
    page.wait_for_timeout(120)
    text = page.locator("#mxPlanBody").inner_text()
    assert "Lesen" in text and "Hören" in text
    assert "65′" in text and "30" in text
    page.select_option("#mxPlanExam", "TESTDAF")
    page.wait_for_timeout(120)
    text = page.locator("#mxPlanBody").inner_text()
    assert "TestDaF" in text and "Wissenschaftlicher Text" in text
