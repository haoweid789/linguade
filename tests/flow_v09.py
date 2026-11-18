"""flow_v09 · AI 链路回归（4 项）

配好 mock 后端后，验证「后端确实被调用」：纠错 / 对话（SSE 流式）/ 面试评估 / 语音通道，
从而证明三层降级中的第①层真实生效（而非仅有代码）。
"""
from conftest import goto


def _point_backend(page, url):
    page.evaluate("(url) => { window.LD.Store.s.cfg.backend = url; window.LD.Store.save(); }", url)


def test_correct_goes_through_backend(page, mock_api):
    """语法纠错优先走后端 /api/ai/correct"""
    _point_backend(page, mock_api)
    r = page.evaluate("async () => await window.LD.LLM.correct('Ich habe nach Deutschland gegangen')")
    assert r["source"] == "backend"
    assert r["issues"] and r["issues"][0]["fix"] == "Ich bin nach Deutschland gegangen"


def test_chat_streams_from_backend(page, mock_api):
    """对话走后端 SSE 流式端点，德语回复增量渲染到对话区"""
    _point_backend(page, mock_api)
    goto(page, "chat")
    page.fill("#cIn", "Guten Tag")
    page.click("#sendBtn")
    page.wait_for_timeout(1800)
    text = " ".join(page.locator("#log").inner_text().split())
    assert "Guten Tag! Wie geht es Ihnen?" in text


def test_interview_eval_goes_through_backend(page, mock_api):
    """面试评估走后端 /api/ai/interview/evaluate"""
    _point_backend(page, mock_api)
    r = page.evaluate(
        "async () => await window.LD.LLM.evaluateInterview([{ q: 'Warum Deutschland?', a: 'Weil die Ausbildung praxisnah ist.' }])")
    assert r["source"] == "backend"
    assert r["total"] == 78


def test_asr_channel_available_under_http(page, mock_api):
    """http 环境 + 配好后端时，语音转写通道应就绪"""
    _point_backend(page, mock_api)
    r = page.evaluate("() => ({ backend: window.LD.Backend.ready(), secure: window.LD.ASR.secureContext(), media: window.LD.ASR.mediaSupported() })")
    assert r["backend"] is True
    assert r["secure"] is True          # http 而非 file://
    assert r["media"] is True           # 具备录音能力