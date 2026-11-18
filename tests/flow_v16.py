"""flow_v16 · 第二波回归（5 项）

覆盖：模考报告 → 最弱模块/弱点/专项跳转、今日队列解释、部署形态内容包一键导入、
阅读段落解析的离线降级与 AI 缓存。
"""
from conftest import goto, view_html


def test_mockexam_report_links(page):
    goto(page, "mockexam")
    page.locator("#mxStart").click()
    page.wait_for_timeout(250)
    for _ in range(4):
        page.locator("#mxSkip").click()
        page.wait_for_timeout(220)
    assert page.locator("#mxWeakModule").count() == 1
    assert "去阅读训练" in page.locator("#mxWeakModule").inner_text()
    page.locator("#mxWeakModule").click()
    page.wait_for_timeout(250)
    assert page.evaluate("() => window.LD.router.current()") == "reading"
    assert "阅读理解" in page.locator("#view").inner_text()


def test_vocab_queue_explanation(page):
    goto(page, "vocab")
    assert "今天为什么练这" in page.locator("#view").inner_text()
    page.locator(".vocab-why summary").click()
    page.wait_for_timeout(150)
    text = page.locator(".vocab-why").inner_text()
    assert "HLR 濒危" in text and "SM-2 到期" in text and "自适应新词" in text


def test_content_pack_discovery_and_import(page):
    page.evaluate("""() => {
        window.LD_CONTENT_PACKS = [{ file: 'dist/content-pack-reading.json', kind: 'reading', count: 85, label: '阅读短文' }];
        const s = window.LD.Store.s;
        s.contentPack = null; s.contentPacksImported = {};
        window.LD.Store.save();
        window.LD.router.go('home');
    }""")
    page.wait_for_timeout(250)
    assert page.locator("#packBanner").count() == 1
    page.locator("#importPacks").click()
    page.wait_for_function("() => ((window.LD.Store.s.contentPack || {}).reading || []).length >= 80", timeout=15000)
    page.wait_for_timeout(400)
    assert page.evaluate("() => window.LD.Store.s.contentPacksImported['dist/content-pack-reading.json']") is True
    assert page.locator("#packBanner").count() == 0

    # 导入的短文要带中文标题（tools/data/reading_titles.json → titleZh），列表卡片直接显示
    goto(page, "reading")
    page.wait_for_timeout(300)
    card = page.locator(".reading-card", has_text="Handball").first
    assert card.count() == 1, "导入包里的 Handball 应出现在阅读列表"
    assert "手球" in card.inner_text(), "阅读卡片应显示中文标题"

    # 小标题的中文（headingZh）在练习里随「显示中文译文」一起出现
    card.click()
    page.wait_for_timeout(300)
    opts = page.locator("select[data-h]").first.inner_text()
    assert "两队各七人对抗的球类运动" in opts, "小标题下拉里应带中文"


def test_reading_paragraph_parse_offline_and_cache(page):
    page.evaluate("() => localStorage.removeItem('linguade.paraParse.v1')")
    goto(page, "reading")
    page.locator("[data-p]").first.click()
    page.wait_for_timeout(250)
    assert page.locator("[data-parse]").count() >= 1

    # 1) 未配大模型：离线降级为分句 + 词库释义
    page.locator("[data-parse]").first.click()
    page.wait_for_timeout(200)
    first = page.locator(".para-parse").first.inner_text()
    assert "离线解析" in first and "整段翻译" in first

    # 2) 收起后模拟大模型；第二次解析应命中缓存，只调用一次
    page.locator("[data-parse]").first.click()
    page.wait_for_timeout(120)
    page.evaluate("""() => {
        window.__parseCalls = 0;
        window.LD.LLM.ready = () => true;
        window.LD.LLM.parseParagraph = () => {
            window.__parseCalls++;
            return Promise.resolve({
                source: 'llm', translation: '测试翻译',
                sentences: [{ de: 'Test.', zh: '测试。', structure: '主谓' }], grammar: []
            });
        };
        localStorage.removeItem('linguade.paraParse.v1');
    }""")
    page.locator("[data-parse]").first.click()
    page.wait_for_timeout(200)
    assert "测试翻译" in page.locator(".para-parse").first.inner_text()
    page.locator("[data-parse]").first.click()
    page.wait_for_timeout(100)
    page.locator("[data-parse]").first.click()
    page.wait_for_timeout(150)
    assert "已缓存" in page.locator(".para-parse").first.inner_text()
    assert page.evaluate("() => window.__parseCalls") == 1


def test_path_units_checkpoint_and_unlock(page):
    page.evaluate("() => { window.LD.Store.s.path = {}; window.LD.Store.save(); window.LD.router.go('plan'); }")
    page.wait_for_timeout(300)
    page.locator("#tabPath").click()
    page.wait_for_timeout(250)
    assert page.locator(".path-unit").count() == 9
    assert page.locator(".path-unit.locked").count() == 8

    page.locator("[data-path-check]").first.click()
    page.wait_for_timeout(250)
    assert page.locator("#pathQuiz").count() == 1
    assert page.locator("#pathQuiz .de").count() == 10
    for i in range(10):
        page.locator(f'[data-path-ans="{i}"]').first.click()
    page.locator("#pathSubmit").click()
    page.wait_for_timeout(300)
    assert "检查点结果" in page.locator("#pathQuiz").inner_text()

    # 通过检查点后下一单元解锁（用 API 写入，避免依赖随机题目全对）
    page.evaluate("() => { window.LD.Path.saveResult('a1-1', 100); window.LD.router.go('plan'); }")
    page.wait_for_timeout(300)
    page.locator("#tabPath").click()
    page.wait_for_timeout(250)
    assert page.locator(".path-unit.done").count() == 1
    assert page.locator(".path-unit.locked").count() == 7

    page.locator("#tabSchedule").click()
    page.wait_for_timeout(250)
    assert page.locator("#planGrid").is_visible()
    page.locator("#tabPath").click()
    page.wait_for_timeout(250)
    assert page.locator(".path-unit").count() == 9


def test_second_wave_no_console_errors(page, errors):
    goto(page, "vocab")
    goto(page, "reading")
    page.locator("[data-p]").first.click()
    page.wait_for_timeout(200)
    page.locator("[data-parse]").first.click()
    page.wait_for_timeout(200)
    goto(page, "mockexam")
    assert errors == []
