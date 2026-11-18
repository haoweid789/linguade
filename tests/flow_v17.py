"""flow_v17 · 开放语料 + AI 出题回归（6 项）

守护 3.10.0 那轮的行为：Tatoeba 德中双语句对按 id 去重导入；未配大模型时
阅读 / 语法 / 词汇三个入口都明确拒绝且不伪造内容；严格 JSON 归一后写入
contentPack 并标「AI 生成 · 待校对」；同题重复生成被拒；扩词跳过已有词库词条。
"""
import json

from conftest import goto

PAIRS = {
    "pack": "pairs", "license": "CC BY 2.0 FR", "source": "Tatoeba",
    "items": [
        {"id": "t-1", "de": "Ich lerne seit einem Jahr Deutsch.", "zh": "我学德语一年了。", "level": "A2"},
        {"id": "t-2", "de": "Das Wetter ist heute schön.", "zh": "今天天气很好。", "level": "A1"},
    ],
}

READING = {
    "title": "Die Anmeldung im Studienbüro", "titleZh": "学校办公室注册", "theme": "注册",
    "paras": [
        {"de": "Frau Chen geht zum Studienbüro. Sie braucht einen Termin.", "zh": "陈女士去学校办公室，她需要一个预约。"},
        {"de": "Der Termin ist am Montag. Sie bringt ihre Papiere mit.", "zh": "预约在周一，她带上自己的材料。"},
    ],
    "headings": ["Ein Termin", "Am Montag"],
    "headingZh": ["一个预约", "在周一"],
    "headingAns": [0, 1],
    "tfng": [
        {"q": "Frau Chen braucht einen Termin.", "qzh": "陈女士需要一个预约。", "a": "richtig", "why": "第一段直接说明。"},
        {"q": "Der Termin ist am Freitag.", "qzh": "预约在周五。", "a": "falsch", "why": "第二段写的是周一。"},
    ],
    "mcq": [
        {"q": "Wohin geht Frau Chen?", "qzh": "陈女士去哪里？", "opts": ["Studienbüro", "Bank", "Kino"], "a": 0, "why": "第一段首句。"},
        {"q": "Was bringt sie mit?", "qzh": "她带上什么？", "opts": ["Papiere", "Essen", "Ball"], "a": 0, "why": "第二段末句。"},
    ],
    "words": [{"de": "das Studienbüro", "zh": "学校办公室"}, {"de": "der Termin", "zh": "预约"}],
}

GRAMMAR = {
    "point": "从句语序", "level": "B1",
    "explain": "weil / dass 引导的从句里，变位动词放到句末。",
    "examples": [
        {"de": "Ich lerne Deutsch, weil ich in Deutschland studieren will.", "zh": "我学德语，因为想在德国留学。"},
        {"de": "Er sagt, dass er keine Zeit hat.", "zh": "他说他没有时间。"},
    ],
    "exercises": [
        {"q": "Ich verstehe nicht, warum er ___ geht.", "opts": ["nicht", "nicht geht", "geht nicht"], "a": 0, "why": "从句动词在末位。"},
        {"q": "Sie weiß, dass der Zug ___ .", "opts": ["kommt", "kommen", "gekommen"], "a": 0, "why": "从句末位放变位动词。"},
        {"q": "Weil das Wetter ___ , bleiben wir zu Hause.", "opts": ["schlecht ist", "ist schlecht", "schlecht"], "a": 0, "why": "从句里动词后置。"},
    ],
}

VOCAB = {
    "items": [
        {"de": "Zeit", "art": "die", "zh": "时间", "pos": "n", "lvl": "C1", "ex": "Ich habe keine Zeit.", "exzh": "我没有时间。", "domain": "留学事务"},
        {"de": "der Studienplatz", "zh": "大学名额", "pos": "n", "art": "der", "lvl": "C1",
         "ex": "Sie hat einen Studienplatz in München bekommen.", "exzh": "她拿到了慕尼黑的大学名额。", "domain": "留学事务"},
        {"de": "die Immatrikulationsbescheinigung", "zh": "注册证明", "art": "die", "pos": "n", "lvl": "C1",
         "ex": "Für die Wohnung brauchst du eine Immatrikulationsbescheinigung.", "exzh": "租房需要注册证明。", "domain": "留学事务"},
    ],
}


def _stub_llm(page, payload):
    """配好「已有大模型」但把通道换成固定返回，专测出题核心的归一 / 去重 / 校验"""
    page.evaluate("""(txt) => {
        const s = window.LD.Store.s;
        s.cfg.apiBase = 'http://stub.invalid/v1';
        s.cfg.apiKey = 'sk-test';
        s.cfg.llmOn = true;
        s.contentPack = s.contentPack || {};
        window.LD.Store.save();
        window.LD.LLM.chat = () => Promise.resolve(txt);
    }""", json.dumps(payload, ensure_ascii=False))


def _clear_llm(page):
    page.evaluate("""() => {
        const s = window.LD.Store.s;
        s.cfg.apiBase = ''; s.cfg.apiKey = ''; s.cfg.llmOn = false;
        s.contentPack = null;
        window.LD.Store.save();
    }""")


def test_pairs_pack_import_dedupes_by_id(page):
    """同一批句对重复导入只按 id 追加一次（AI grounding 语料可反复刷新）"""
    first = page.evaluate("(p) => window.LD.Store.importData(JSON.stringify(p), 'json')", PAIRS)
    assert first["ok"] is True and first["imported"] == 2
    again = page.evaluate("(p) => window.LD.Store.importData(JSON.stringify(p), 'json')", PAIRS)
    assert again["ok"] is True and again["imported"] == 0
    assert page.evaluate("() => window.LD.Store.s.contentPack.pairs.length") == 2


def test_aigen_refuses_without_llm_and_writes_nothing(page):
    """三条生成通道在未配大模型时都返回 no-ai，且不往 contentPack 塞伪造内容"""
    _clear_llm(page)
    out = page.evaluate("""() => Promise.all([
            window.LD.AIGen.generateReading({ level: 'B1' }),
            window.LD.AIGen.generateGrammar({ point: '从句语序' }),
            window.LD.AIGen.generateVocab({ level: 'B1' }),
        ]).then(a => a.map(x => ({ ok: x.ok, reason: x.reason, message: x.message })))""")
    assert [x["reason"] for x in out] == ["no-ai", "no-ai", "no-ai"]
    assert all("设置" in x["message"] for x in out), "提示要指向设置，而不是硬编内容"
    empty = page.evaluate("""() => { const p = window.LD.Store.s.contentPack || {};
        return [(p.reading || []).length, (p.grammar || []).length, (p.lexicon || []).length]; }""")
    assert empty == [0, 0, 0]


def test_reading_ai_button_explains_missing_llm(page):
    """阅读页点「生成 1 套」时，离线提示直接写在结果区，题池不变"""
    _clear_llm(page)
    goto(page, "reading")
    page.locator("#aiReadGen").click()
    page.wait_for_timeout(400)
    text = page.locator("#aiReadOut").inner_text()
    assert "大模型" in text and "题库" in text
    assert page.evaluate("() => (window.LD.Store.s.contentPack || {}).reading || []") == []


def test_ai_reading_written_tagged_and_duplicate_rejected(page):
    """严格 JSON 归一为一道完整题，标记「AI 生成 · 待校对」，同内容再生成被拒"""
    _stub_llm(page, READING)
    r = page.evaluate("() => window.LD.AIGen.generateReading({ level: 'B2', topic: '注册' })")
    assert r["ok"] is True, r
    item = r["item"]
    assert item["src"] == "AI 生成 · 未人工审校" and item["source"] == "ai"
    assert len(item["paras"]) == 2 and len(item["headings"]) == 2 and len(item["headingAns"]) == 2
    assert len(item["tfng"]) == 2 and len(item["mcq"]) == 2 and item["lv"] == "B2"
    dup = page.evaluate("() => window.LD.AIGen.generateReading({ level: 'B2', topic: '注册' })")
    assert dup["ok"] is False and dup["reason"] == "duplicate"
    assert page.evaluate("() => window.LD.Store.s.contentPack.reading.length") == 1


def test_ai_grammar_requires_valid_exercises(page):
    """语法讲解必须带可作答的练习，缺练习的模型输出被判失败而不是收下半成品"""
    _stub_llm(page, GRAMMAR)
    r = page.evaluate("() => window.LD.AIGen.generateGrammar({ point: '从句语序', level: 'B1' })")
    assert r["ok"] is True, r
    assert len(r["item"]["exercises"]) == 3 and r["item"]["src"].startswith("AI 生成")
    broken = dict(GRAMMAR)
    broken["exercises"] = []
    _stub_llm(page, broken)
    bad = page.evaluate("() => window.LD.AIGen.generateGrammar({ point: '虚拟式', level: 'B2' })")
    assert bad["ok"] is False and "AI 讲解失败" in bad["message"]
    assert page.evaluate("() => window.LD.Store.s.contentPack.grammar.length") == 1


def test_ai_vocab_skips_words_already_in_lexicon(page):
    """AI 扩词跳过词库已有词条，只留新词，并且重复生成不再追加"""
    _stub_llm(page, VOCAB)
    r = page.evaluate("() => window.LD.AIGen.generateVocab({ level: 'C1', domain: '留学事务', count: 5 })")
    assert r["ok"] is True, r
    des = [x["de"] for x in r["items"]]
    assert "Zeit" not in des, "词库已有的 Zeit 不该被当作新词写回"
    assert any("Studienplatz" in d for d in des)
    assert all(x["src"] == "AI 生成 · 未人工审校" for x in r["items"])
    page.evaluate("() => window.LD.AIGen.generateVocab({ level: 'C1', domain: '留学事务', count: 5 })")
    assert page.evaluate("() => window.LD.Store.s.contentPack.lexicon.length") == len(des)
