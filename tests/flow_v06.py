"""flow_v06 · 沉淀复盘 / 场景实战回归（5 项）"""
from conftest import goto, view_html


def test_analytics_page(page):
    goto(page, "analytics")
    assert len(view_html(page)) > 200


def test_plan_page(page):
    goto(page, "plan")
    assert "计划" in view_html(page)


def test_interview_page(page):
    goto(page, "interview")
    assert "面试" in view_html(page)


def test_drill_page(page):
    goto(page, "drill")
    assert len(view_html(page)) > 150


def test_writing_page(page):
    goto(page, "writing")
    assert "写作" in view_html(page)