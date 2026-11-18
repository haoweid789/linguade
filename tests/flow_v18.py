"""flow_v18 · 2000 词词库回归（2 项）

覆盖：词库总量 2000、C2 与专业领域词、生词本词典查询命中。
"""
from conftest import goto


def test_selfbuilt_lexicon_c2_and_professional(page):
    r = page.evaluate("""() => {
        const lex = window.LD_LEX || [];
        const find = w => lex.find(x => x[0] === w) || null;
        return {
            n: lex.length,
            machine: window.LD_LEX_MACHINE ? window.LD_LEX_MACHINE.size : 0,
            c2: lex.filter(x => x[4] === 'C2').length,
            b2b: lex.filter(x => x[4] === 'B2').length,
            c1b: lex.filter(x => x[4] === 'C1').length,
            nach: find('Nachhaltigkeit'),
            data: find('Datenintegrität'),
            unab: find('Unabdingbar'),
            resid: find('Resilienz')
        };
    }""")
    assert r["n"] >= 2000, "词库总量应达到 2000"
    assert r["machine"] >= 1400, "机器对齐词条应有待校对标识"
    assert r["c2"] >= 100, "应有足量 C2 层级词条"
    assert r["nach"] and r["nach"][4] == "B2"
    assert r["data"] and "数据完整性" in r["data"][2]
    assert r["unab"] and "不可或缺" in r["unab"][2]
    assert r["resid"] and r["resid"][4] == "C2"


def test_selfbuilt_word_lookup_in_notebook(page):
    goto(page, "notebook")
    page.fill("#wbIn", "Unabdingbar")
    page.click("#wbLookup")
    page.wait_for_timeout(150)
    text = page.locator("#wbLookupOut").inner_text()
    assert "不可或缺" in text
