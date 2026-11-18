"""flow_v20 · 大模型连接诊断回归（4 项）

覆盖：三种接口类型的设置 UI、设置页「检测连接」成功/失败、
后端 AI 失败原因透出，以及对话主页面不再保留连接状态条。
"""
import json
from conftest import goto


def test_settings_three_api_styles_ui(page):
    page.click("#settingsBtn")
    page.wait_for_timeout(250)
    page.evaluate("() => { document.getElementById('adminBox').hidden = false; }")
    assert page.locator("#cfgApiStyle option").count() == 3
    assert page.locator("#rowApiVersion").is_hidden()
    assert "自动补" in page.locator("#apiStyleHint").inner_text()

    page.select_option("#cfgApiStyle", "azure")
    page.wait_for_timeout(100)
    assert page.locator("#rowApiVersion").is_visible()
    assert "deployment" in page.locator("#apiStyleHint").inner_text()

    page.select_option("#cfgApiStyle", "custom")
    page.wait_for_timeout(100)
    assert page.locator("#rowApiVersion").is_hidden()
    assert "原样请求" in page.locator("#apiStyleHint").inner_text()


def test_settings_detect_button_success_and_failure(page):
    state = {"mode": "ok"}

    def handler(route):
        if state["mode"] == "ok":
            body = {"ok": True, "stage": "ok", "style": "openai", "model": "deepseek-chat",
                    "latency_ms": 42, "reply": "OK", "hint": ""}
        else:
            body = {"ok": False, "stage": "request", "style": "openai", "model": "deepseek-chat",
                    "http_status": 401, "message": "HTTP 401 · invalid api key", "hint": ""}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body, ensure_ascii=False))

    page.route("**/api/admin/llm-test", handler)
    page.click("#settingsBtn")
    page.wait_for_timeout(250)
    page.evaluate("() => { document.getElementById('adminBox').hidden = false; }")

    page.click("#llmTest")
    page.wait_for_function("() => document.querySelector('#llmTestOut').textContent.includes('连接成功')")
    out = page.locator("#llmTestOut").inner_text()
    assert "openai" in out and "deepseek-chat" in out and "42 ms" in out

    state["mode"] = "bad"
    page.click("#llmTest")
    page.wait_for_function("() => document.querySelector('#llmTestOut').textContent.includes('请求失败')")
    out = page.locator("#llmTestOut").inner_text()
    assert "HTTP 401" in out and "invalid api key" in out


def test_backend_failure_reason_visible_in_chat(page):
    page.evaluate("""() => {
        const s = window.LD.Store.s;
        s.chats = {}; s.chatActive = {};
        window.LD.Store.save();
        window.LD.Backend.ready = () => true;
        window.LD.Backend.chatStream = () => Promise.reject(new Error('HTTP 501 · 后端未配置大模型'));
        window.LD.LLM.correct = () => Promise.resolve({ issues: [], source: 'local' });
        window.LD.LLM.reply = () => Promise.resolve({ text: 'Guten Tag! Wie geht es Ihnen?', tip: '', source: 'local' });
    }""")
    goto(page, "chat")
    page.fill("#cIn", "Guten Tag")
    page.click("#sendBtn")
    page.wait_for_function(
        "() => document.querySelectorAll('.msg.ai').length >= 2 && !document.querySelector('#typing')")
    text = page.locator("#log").inner_text()
    # 学习者界面用白话说明失败原因（不出现裸 HTTP 状态码），见 src/core/ui.js netErr()
    assert "【本地规则】后端不可用" in text
    assert "后端还没有配置大模型" in text
    assert "HTTP" not in text, "学习者界面不应出现裸状态码"


def test_chat_page_has_no_connection_strip(page):
    goto(page, "chat")
    assert page.locator("#aiStatus").count() == 0
    assert page.locator("#aiCheck").count() == 0
    assert page.locator(".ai-line").count() == 0
    assert page.locator('.nav-item .tag-free', has_text="新增").count() == 0
    assert page.locator('.nav-item[data-route="reading"]').count() == 1
    assert "德语对话室" in page.locator("#view").inner_text()
