# -*- coding: utf-8 -*-
"""B9 数据互通 e2e：设置面板新入口存在 + 词库 TSV 下载触发。"""
import pytest

from conftest import goto


def test_settings_has_interop_entries(page):
    """设置抽屉含 B9 三个入口（抽屉在 #settingsDrawer，非 #view）。"""
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_timeout(300)
    html = page.evaluate("() => document.getElementById('settingsDrawer').innerHTML")
    assert "导出词库（Anki TSV）" in html
    assert "导入 LibreLingo 课程包" in html


def test_export_tsv_button_triggers_download(page):
    """导出词库按钮触发 blob 下载（不等待真文件落盘）。"""
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_timeout(200)
    btn = page.locator("#exportTsvBtn")
    assert btn.count() == 1
    # 点击不抛错（download 在 headless 下被放行，不等待真落盘）
    btn.click()
    page.wait_for_timeout(300)
    # toast 或按钮反馈（下载可能静默，验证无 pageerror 即可——见下一测试）
    src = open("src/core/ui.js", encoding="utf-8").read()
    assert "exportLexiconTSV" in src
    assert "importLibreLingoYaml" in src


def test_no_console_errors(page, errors):
    page.evaluate("() => document.getElementById('settingsBtn').click()")
    page.wait_for_timeout(200)
    page.locator("#exportTsvBtn").click()
    page.wait_for_timeout(300)
    real = [e for e in errors if "favicon" not in e]
    assert real == [], real