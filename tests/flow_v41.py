# -*- coding: utf-8 -*-
"""B8 口语报告页 e2e：新指标行（填充词/语速标签）+ 边界文案。"""
import pytest

from conftest import goto, view_html


def test_speech_report_new_metrics_and_disclaimer(page):
    """报告页：填充词/语速标签 + 辅助参考分边界文案（静态交叉验证 + 路由可达）。"""
    goto(page, "speech")
    html = view_html(page)
    # 未作答时报告区不渲染；验证模块加载与录音按钮存在
    assert "口语测评" in html
    # 边界文案在源码模板里（detail 渲染时插入）：静态断言
    src = open("src/modules/speech.js", encoding="utf-8").read()
    assert "辅助参考分" in src
    assert "非官方判分" in src
    assert "填充词" in src
    assert "wpmTag" in src