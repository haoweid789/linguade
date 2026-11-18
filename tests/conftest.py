"""LinguaDE · e2e 公共夹具

提供：
  - site_url：以 http 方式服务工程根（便于加载 src/*.js，并让 getUserMedia 等更接近真实环境）
  - mock_api：零依赖 mock 后端（tools/mock_backend.py）
  - browser / page：Playwright 浏览器页面，预置 localStorage 跳过入学诊断
  - errors：页面控制台/未捕获错误收集器

运行：python -m pytest tests -v
"""
import functools
import http.server
import json
import pathlib
import socket
import subprocess
import sys
import threading
import time
import urllib.request

import pytest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

# 预置状态：跳过诊断，给出稳定的能力画像
SEED = {
    "diagnosed": True,
    "profile": {"name": "测试学习者", "exam": "TestDaF", "level": "B1", "dailyMin": 30, "lang": "bilingual", "examDate": ""},
    "cfg": {"apiBase": "", "apiKey": "", "model": "", "backend": "", "theme": "light", "llmOn": False},
    "ability": {"vocab": 60, "grammar": 55, "listening": 50, "speaking": 50, "reading": 55, "writing": 50},
}

ROUTES = ["vocab", "grammar", "chat", "speech", "listening", "drill", "weak", "phonetics",
          "notebook", "analytics", "plan", "syntax", "writing", "reading", "ocrgrade",
          "sandbox", "interview", "mockexam"]   # diagnose 为一次性入口，不在常驻路由内


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="session")
def site_url():
    port = _free_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield "http://127.0.0.1:%d" % port
    srv.shutdown()


@pytest.fixture(scope="session")
def mock_api():
    port = _free_port()
    proc = subprocess.Popen([sys.executable, str(ROOT / "tools" / "mock_backend.py"), "--port", str(port)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = "http://127.0.0.1:%d" % port
    for _ in range(60):
        try:
            urllib.request.urlopen(url + "/api/health", timeout=0.5)
            break
        except Exception:
            time.sleep(0.1)
    yield url
    proc.terminate()


@pytest.fixture(scope="session")
def browser():
    pw = sync_playwright().start()
    b = pw.chromium.launch()
    yield b
    b.close()
    pw.stop()


@pytest.fixture
def sample_png():
    """1×1 PNG，用于图像上传类测试（OCR 链路）

    写入工程内 tests/_artifacts，避免依赖系统临时目录权限
    （受限环境下 pytest 的 tmp_path 可能不可用）。
    """
    import base64
    import os
    d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_artifacts")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "sample.png")
    with open(path, "wb") as f:
        f.write(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="))
    return path


@pytest.fixture
def errors():
    return []


@pytest.fixture
def page(browser, site_url, errors):
    ctx = browser.new_context()
    ctx.add_init_script("localStorage.setItem('linguade.v1', %s)" % json.dumps(json.dumps(SEED, ensure_ascii=False)))
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))

    def _on_console(m):
        if m.type != "error":
            return
        loc = getattr(m, "location", None) or {}
        url = loc.get("url", "") if isinstance(loc, dict) else ""
        # 测试服务器是纯静态托管（没有 /api），启动时后端探测的 /api/health 404 属预期降级；
        # 其它 404／控制台错误照常计入，避免把真实缺资源放过去。
        if "Failed to load resource" in m.text and "/api/health" in url:
            return
        errors.append("console.%s: %s" % (m.type, m.text))

    pg.on("console", _on_console)
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=10000)
    yield pg
    ctx.close()


def goto(page, route, wait=200):
    """切到指定路由并等待渲染完成（不在导航中的路由直接走 router.go）"""
    item = page.locator('.nav-item[data-route="%s"]' % route).first
    if not item.is_visible():
        page.evaluate("r => window.LD.router.go(r)", route)
        page.wait_for_timeout(wait)
        return
    item.click()
    page.wait_for_timeout(wait)


def view_html(page):
    return page.evaluate("() => document.getElementById('view').innerHTML")