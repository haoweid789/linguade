# -*- coding: utf-8 -*-
"""B5 AI 练习前端 e2e：路由渲染 / 诊断入口 / 报告结构（mock 后端）。"""
import pytest

from conftest import goto, view_html


def test_aipractice_route_renders(page):
    """路由 /aipractice 渲染列表页三区块。"""
    goto(page, "aipractice")
    html = view_html(page)
    assert "诊断" in html or "快速练习" in html
    assert "弱点推荐" in html
    assert "历史会话" in html


def test_aipractice_backend_offline_hint(page):
    """后端未连（静态测试服务器无 /api）→ 提示后端未连接，不假成功。"""
    goto(page, "aipractice")
    page.locator("#assess").click()
    page.wait_for_timeout(600)
    msg = page.locator("#asMsg").text_content()
    assert "后端未连接" in msg or "无法组卷" in msg or "请求考点" in msg


def test_aipractice_tabs_guarded(page):
    """无进行中会话时，练习/报告页签显示空态（不白屏、不报错）。"""
    goto(page, "aipractice")
    page.evaluate("() => window.LD.router.go('aipractice', {tab:'session'})")
    page.wait_for_timeout(200)
    html = view_html(page)
    assert "无进行中的会话" in html or "诊断" in html