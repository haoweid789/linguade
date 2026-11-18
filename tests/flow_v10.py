"""flow_v10 · 拍照批改（OCR / 视觉批改）链路（3 项）

验证三层降级的第①层真实生效：配好 mock 后端后，图像经 /api/ocr/grade 完成转录 + 批改；
无任何 AI 通道时给出明确提示而非静默失败。
"""
from conftest import goto


def _point_backend(page, url):
    page.evaluate("(url) => { window.LD.Store.s.cfg.backend = url; window.LD.Store.save(); }", url)


def test_ocr_grade_goes_through_backend(page, mock_api, sample_png):
    """上传图片 → 后端视觉批改 → 展示转录与逐条修改"""
    _point_backend(page, mock_api)
    goto(page, "ocrgrade")
    page.set_input_files("#ocrFile", sample_png)
    page.wait_for_timeout(500)
    page.click("#ocrRun")
    page.wait_for_timeout(1800)
    out = page.locator("#ocrOut").inner_text()
    assert "Ich habe nach Deutschland gegangen" in out
    assert "助动词" in out


def test_ocr_requires_ai_channel(page, sample_png):
    """无后端且无直连 key 时，应明确提示需要 AI 通道"""
    goto(page, "ocrgrade")
    page.set_input_files("#ocrFile", sample_png)
    page.wait_for_timeout(400)
    page.click("#ocrRun")
    page.wait_for_timeout(1000)
    out = page.locator("#ocrOut").inner_text()
    assert ("AI 通道" in out) or ("无法批改" in out)


def test_ocr_api_surface(page):
    """三层降级的公开入口存在"""
    r = page.evaluate("() => ({ llm: typeof window.LD.LLM.ocrGrade, be: typeof window.LD.Backend.ocrGrade })")
    assert r["llm"] == "function"
    assert r["be"] == "function"


def test_grammar_image_import(page, mock_api, sample_png):
    """句法纠错内嵌「从图片导入」：选图 → 转录填入 → 自动纠错"""
    _point_backend(page, mock_api)
    goto(page, "grammar")
    assert page.locator("#gImg").count() == 1
    with page.expect_file_chooser() as fc:
        page.click("#gImg")
    fc.value.set_files(sample_png)
    page.wait_for_timeout(2000)
    assert "Ich habe nach Deutschland gegangen" in page.input_value("#gIn")
    assert len(page.locator("#gOut").inner_text()) > 20      # 已触发运行


def test_writing_image_import(page, mock_api, sample_png):
    """写作批改内嵌「从图片导入」：选图 → 转录填入正文（并更新词数）"""
    _point_backend(page, mock_api)
    goto(page, "writing")
    assert page.locator("#wImg").count() == 1
    with page.expect_file_chooser() as fc:
        page.click("#wImg")
    fc.value.set_files(sample_png)
    page.wait_for_timeout(2000)
    assert "Ich habe nach Deutschland gegangen" in page.input_value("#wIn")
    assert page.locator("#wCount").inner_text() != "0 词"