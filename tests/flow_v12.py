"""flow_v12 · 内容池扩容（3 项）

验证 3.5.0-d 的阅读池内容包闭环：
  导入 dist/content-pack-reading.json → contentPack.reading 落库 → 阅读模块列表即时扩容；
  并验证维基短文（无中文译文、模板出题）在详情页可正常渲染。
"""
import io
import os

from conftest import goto

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(ROOT, "dist", "content-pack-reading.json")


def _read_pack():
    assert os.path.exists(PACK), "缺少阅读内容包：先跑 python tools/reading_pipeline.py --all"
    return io.open(PACK, encoding="utf-8").read()


def test_reading_pack_import(page):
    """导入阅读内容包：入库为 contentPack.reading 且条数达标"""
    raw = _read_pack()
    r = page.evaluate("(raw) => window.LD.Store.importData(raw, 'json')", raw)
    assert r["ok"] is True and r["kind"] == "pack"
    n = page.evaluate("() => (window.LD.Store.s.contentPack.reading || []).length")
    assert n >= 50, "阅读包条数不足：%d" % n


def test_reading_list_expands(page):
    """导入后阅读列表 = 内置 5 篇 + 内容包篇数"""
    base = page.evaluate("() => document.querySelectorAll('[data-p]').length") if False else None
    raw = _read_pack()
    page.evaluate("(raw) => window.LD.Store.importData(raw, 'json')", raw)
    goto(page, "reading")
    n = page.evaluate("() => (window.LD.Store.s.contentPack.reading || []).length")
    cards = page.locator("[data-p]").count()
    assert cards == 5 + n, "列表卡片数 %d != 5 + %d" % (cards, n)


def test_wiki_passage_renders_without_translation(page, errors):
    """维基短文（无中文译文）可正常渲染，且标注来源与授权"""
    raw = _read_pack()
    page.evaluate("(raw) => window.LD.Store.importData(raw, 'json')", raw)
    goto(page, "reading")
    # 打开第一篇导入的（wiki-*）短文
    wid = page.evaluate("() => (window.LD.Store.s.contentPack.reading || [])[0].id")
    page.click('[data-p="%s"]' % wid)
    page.wait_for_timeout(300)
    txt = page.locator("#view").inner_text()
    assert "Wikipedia" in txt and "CC BY-SA" in txt
    assert "难度" in txt
    assert errors == [], "控制台错误：%s" % errors


def test_lexicon_pack_contract(page):
    """词库册内容包契约：导入即扩容内存词表 window.LD_LEX；无中文释义条目被拒（红线）"""
    before = page.evaluate("() => (window.LD_LEX || []).length")
    raw = ('{"pack":"lexicon","count":2,"items":['
           '{"de":"Hausboot","art":"das","zh":"船屋","pos":"n","lvl":"B2",'
           '"ex":"Wir schlafen auf einem Hausboot.","exzh":"我们睡在船屋上。"},'
           '{"de":"vermeintlich","art":"—","zh":"","pos":"adj","lvl":"C1"}]}')
    r = page.evaluate("(raw) => window.LD.Store.importData(raw, 'json')", raw)
    assert r["ok"] is True and r["kind"] == "pack", r
    assert r["imported"] == 1, "无中文释义条目未被拒：%s" % r          # 红线
    after = page.evaluate("() => (window.LD_LEX || []).length")
    assert after == before + 1, "词表未扩容：%d -> %d" % (before, after)
    hit = page.evaluate("() => (window.LD_LEX || []).some(w => w[0] === 'Hausboot' && w[2] === '船屋')")
    assert hit is True, "词库册词条未并入 window.LD_LEX"
    noz = page.evaluate("() => (window.LD_LEX || []).some(w => w[0] === 'vermeintlich')")
    assert noz is False, "无中文释义条目混入词表"