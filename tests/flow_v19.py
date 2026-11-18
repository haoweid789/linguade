"""flow_v19 · 德语对话室回归（6 项）

覆盖：三栏布局与人设切换、人设提示/音色语速、对话管理 + 生词本快捷区、
中文输入双路径（离线提示 / AI 翻译）、全路由零控制台错误。
"""
from conftest import goto, ROUTES


def _seed_room(page):
    page.evaluate("""() => {
        const s = window.LD.Store.s;
        s.chats = {}; s.chatActive = {}; s.chatReports = []; s.wordbank = [];
        s.chatPersona = 'strict'; s.chatVoice = '';
        window.LD.Store.save();
        window.LD.Backend.ready = () => false;
    }""")


def test_room_layout_and_persona_switch(page):
    _seed_room(page)
    goto(page, "chat")
    assert page.locator(".chat-room").count() == 1
    assert page.locator(".chat-set").count() == 1
    assert page.locator(".chat-vocab").count() == 1
    assert page.locator(".persona-item").count() == 4
    assert page.locator("#personaBadge").inner_text() == "严谨外教"
    assert "Was möchten Sie heute üben?" in page.locator("#log").inner_text()

    page.locator('.persona-item[data-persona="slow"]').click()
    page.wait_for_timeout(150)
    assert page.locator("#personaBadge").inner_text() == "慢速入门"
    assert page.evaluate("() => window.LD.Store.s.chatPersona") == "slow"
    persisted = page.evaluate("() => JSON.parse(localStorage.getItem('linguade.v1')).chatPersona")
    assert persisted == "slow"
    assert "Wir sprechen langsam" in page.locator("#log").inner_text()


def test_persona_prompt_backend_contract_and_voice_rate(page):
    _seed_room(page)
    page.evaluate("""() => {
        window.__backendArgs = null;
        window.__sys = '';
        window.__say = null;
        window.LD.Backend.ready = () => true;
        window.LD.Backend.chatStream = (sceneId, history, text, onDelta, personaId) => {
            window.__backendArgs = { sceneId, personaId };
            onDelta('Sehr gut! Erzählen Sie bitte weiter.');
            return Promise.resolve('Sehr gut! Erzählen Sie bitte weiter.');
        };
        window.LD.LLM.correct = () => Promise.resolve({ issues: [], source: 'local' });
        window.LD.LLM.reply = (sc) => {
            window.__sys = sc.sys;
            return Promise.resolve({ text: 'Gut! Noch einmal bitte.', tip: '' });
        };
        window.LD.SpeechUtil.deVoices = () => [{ name: 'Anna', lang: 'de-DE', voiceURI: 'anna' }];
        window.LD.SpeechUtil.say = (text, rate, opts) => {
            window.__say = { text, rate, voice: opts && opts.voice && opts.voice.voiceURI };
        };
    }""")
    goto(page, "chat")
    page.locator('.persona-item[data-persona="slow"]').click()
    page.wait_for_timeout(100)
    page.select_option("#voiceSel", "anna")
    page.fill("#cIn", "Ich heiße Li.")
    page.click("#sendBtn")
    page.wait_for_function("() => window.__say && window.__say.text && !document.querySelector('#typing')")
    page.wait_for_timeout(100)

    args = page.evaluate("() => window.__backendArgs")
    assert args == {"sceneId": "aps", "personaId": "slow"}
    say = page.evaluate("() => window.__say")
    assert say["voice"] == "anna"
    assert abs(say["rate"] - 0.72) < 0.001
    assert page.evaluate("() => window.LD.Store.s.chatVoice") == "anna"

    # 关掉后端：人设提示词应拼进直连大模型的 system 消息
    page.evaluate("""() => {
        window.LD.Backend.ready = () => false;
        window.__say = null;
        window.__sys = '';
    }""")
    page.fill("#cIn", "Noch eine Frage.")
    page.click("#sendBtn")
    page.wait_for_function("() => window.__sys && !document.querySelector('#typing')")
    sys = page.evaluate("() => window.__sys")
    assert "慢速入门" in sys and "A1–A2" in sys
    assert "APS" in sys

    # 有用户轮次后切换人设：插入系统提示，但不影响本轮计分
    page.locator('.persona-item[data-persona="travel"]').click()
    page.wait_for_timeout(120)
    assert page.locator("#personaBadge").inner_text() == "旅行德语"
    assert "已切换人设：旅行德语" in page.locator("#log").inner_text()


def test_clear_chat_and_quick_wordbank(page):
    page.evaluate("""() => {
        const s = window.LD.Store.s;
        s.chats = { aps: [
            { role: 'assistant', content: 'Guten Tag! Möchten Sie sich vorstellen?', t: 1, sid: 'sx' },
            { role: 'user', content: 'Ich möchte mich vorstellen.', t: 2, sid: 'sx' }
        ]};
        s.chatActive = { aps: { sid: 'sx', startedAt: 1 } };
        s.wordbank = [];
        s.chatPersona = 'strict'; s.chatVoice = '';
        window.LD.Store.save();
        window.LD.Backend.ready = () => false;
    }""")
    goto(page, "chat")
    page.click("#saveSentenceBtn")
    page.wait_for_timeout(120)
    bank = page.evaluate("() => window.LD.Store.s.wordbank")
    assert bank and bank[0]["kind"] == "sentence"
    assert bank[0]["de"] == "Ich möchte mich vorstellen."
    assert page.locator(".quick-word.sentence").count() == 1

    page.click("#addWordBtn")
    page.fill("#quickWordIn", "Universität")
    page.click("#quickWordAdd")
    page.wait_for_timeout(120)
    bank = page.evaluate("() => window.LD.Store.s.wordbank")
    uni = [w for w in bank if w["de"] == "Universität"]
    assert uni and uni[0]["zh"] == "大学"
    assert page.locator(".quick-word").count() >= 2

    page.click("#clearChat")
    assert "再次点击" in page.locator("#clearChat").inner_text()
    page.click("#clearChat")
    page.wait_for_timeout(150)
    assert page.locator(".msg.me").count() == 0
    assert page.evaluate("() => window.LD.Store.s.chats.aps.length") == 1
    assert page.evaluate("() => window.LD.Store.s.wordbank.length") == 2
    assert page.evaluate("() => Object.keys(window.LD.Store.s.chatActive).length") == 0


def test_chinese_input_offline_hint_and_ai_translation(page):
    _seed_room(page)
    page.evaluate("""() => {
        window.LD.LLM.ready = () => false;
        window.LD.LLM.translateZh = () => Promise.reject(new Error('离线模式未配置 AI 通道'));
    }""")
    goto(page, "chat")
    page.fill("#cIn", "我想自我介绍")
    page.click("#sendBtn")
    page.wait_for_timeout(200)
    assert page.locator(".msg.me").count() == 0
    assert "中文翻译不可用" in page.locator(".toast").last.inner_text()

    page.evaluate("""() => {
        window.__tr = '';
        window.LD.LLM.ready = () => true;
        window.LD.LLM.translateZh = (t) => { window.__tr = t; return Promise.resolve('Ich möchte mich vorstellen.'); };
        window.LD.LLM.correct = () => Promise.resolve({ issues: [], source: 'local' });
        window.LD.LLM.chat = () => Promise.resolve('Sehr gut! --- 已经翻译成德语再回答。');
    }""")
    page.fill("#cIn", "我想自我介绍")
    page.click("#sendBtn")
    page.wait_for_function("() => document.querySelectorAll('.msg.me').length >= 1")
    page.wait_for_timeout(200)
    me = page.locator(".msg.me").last.inner_text()
    assert "Ich möchte mich vorstellen." in me
    assert "中文原句" in me and "我想自我介绍" in me
    assert page.evaluate("() => window.__tr") == "我想自我介绍"


def test_chinese_input_backend_translate(page, mock_api):
    _seed_room(page)
    page.evaluate("""(url) => {
        window.LD.Store.s.cfg.backend = url;
        window.LD.Store.save();
        window.LD.Backend.ready = () => true;
    }""", mock_api)
    goto(page, "chat")
    page.fill("#cIn", "我想自我介绍")
    page.click("#sendBtn")
    page.wait_for_function("() => document.querySelectorAll('.msg.me').length >= 1 && !document.querySelector('#typing')")
    me = page.locator(".msg.me").last.inner_text()
    assert "Ich möchte mich vorstellen." in me
    assert "中文原句" in me
    assert page.evaluate("() => window.LD.Store.s.chats.aps.some(m => m.orig === '我想自我介绍')")


def test_all_routes_no_console_errors(page, errors):
    _seed_room(page)
    for route in ROUTES:
        goto(page, route, wait=120)
    assert errors == [], "控制台出现错误：%s" % errors
