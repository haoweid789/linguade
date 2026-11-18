"""LinguaDE · flow_v28：3.21.0 云端进度自动同步

覆盖：
  1. 回访设备（本机有数据 + 曾登录）启动时拉取云端 → 字段级合并 → 有增量才刷新一次
  2. 合并幂等：本机已与云端一致时启动不刷新、不重复推送（防刷新循环回归）
  3. 作答后自动推送（debounce 触发 / 立即冲刷），未登录静默跳过
  4. 手动同步 force 始终推送；无增量的启动合并不再上传整份快照
  5. 设置 → 数据管理 显示「最近云端同步」时间（linguade:synced 事件驱动）
"""
import json

from conftest import SEED


def _seed(backend, xp=880, with_cloud_data=True, acct=True):
    """构造与 mock_backend.MOCK_SNAPSHOT 对齐（或留空以模拟落后本机）的种子状态"""
    s = json.loads(json.dumps(SEED, ensure_ascii=False))
    s["cfg"]["backend"] = backend
    s["xp"] = xp
    if with_cloud_data:
        s["cards"] = {"Zimmer": {"ef": 2.3, "iv": 6, "due": 0, "reps": 4, "lapses": 0,
                                 "ok": 4, "bad": 0, "history": [{"t": 1, "ok": True}]}}
        s["log"] = [{"t": 1, "type": "vocab", "ability": "vocab", "ok": True, "ms": 3000, "item": "Zimmer"}]
    else:
        s["cards"] = {}
        s["log"] = []
    init = ["localStorage.setItem('linguade.v1', %s)" % json.dumps(json.dumps(s, ensure_ascii=False))]
    if acct:
        init.append("localStorage.setItem('linguade.acct', 'utest123456')")
    return "; ".join(init)


def _settled_page(browser, site_url, mock_api, init_script):
    """加载应用并等到外壳渲染完成（启动自动合并如有刷新也会在其中完成）"""
    ctx = browser.new_context()
    ctx.add_init_script(init_script)
    pg = ctx.new_page()
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=15000)
    pg.wait_for_timeout(400)      # 启动合并 resolve / toast 渲染的余量
    return ctx, pg


def test_boot_merges_cloud_for_returning_device(browser, site_url, mock_api):
    """本机落后于云端：启动自动合并 → 刷新一次 → 云端数据落位 + 同步时间落盘 + 一次性提示"""
    ctx, pg = _settled_page(browser, site_url, mock_api, _seed(mock_api, xp=0, with_cloud_data=False))
    assert pg.evaluate("() => window.LD.Store.s.xp") == 880, "启动合并应接回云端的 XP"
    assert pg.evaluate("() => !!window.LD.Store.s.cards.Zimmer"), "云端词卡应合并进本机"
    last = pg.evaluate("() => +(localStorage.getItem('linguade.lastSyncAt') || 0)")
    assert last > 0, "合并后应记录最近同步时间"
    pg.wait_for_selector("text=已同步云端进度", timeout=3000), "合并刷新后应有一次 toast 提示"
    assert pg.evaluate("() => sessionStorage.getItem('linguade.cloudMerged')") is None, "标记应被消费"
    ctx.close()


def test_boot_merge_idempotent_no_reload_loop(browser, site_url, mock_api):
    """本机与云端一致：启动合并不刷新、不提示（mergeStates 幂等的回归防线）"""
    ctx, pg = _settled_page(browser, site_url, mock_api, _seed(mock_api))
    assert pg.evaluate("() => window.LD.Store.s.xp") == 880
    pg.evaluate("() => sessionStorage.clear()")
    pg.reload()
    pg.wait_for_selector(".nav-item", timeout=10000)
    pg.wait_for_timeout(1500)     # 若存在刷新循环，这里会出现二次 reload / toast
    assert pg.evaluate("() => window.LD.Store.s.xp") == 880, "数据不应被合并破坏"
    assert pg.evaluate("() => sessionStorage.getItem('linguade.cloudMerged')") is None, "幂等合并不应触发刷新标记"
    assert pg.locator(".toast").count() == 0, "无增量不应弹同步提示"
    ctx.close()


def test_answer_auto_push_and_anonymous_skip(browser, site_url, mock_api):
    """作答 → 冲刷 → 快照离机；退出登录态后冲刷静默跳过"""
    ctx, pg = _settled_page(browser, site_url, mock_api, _seed(mock_api))
    posts = []
    pg.on("request", lambda r: posts.append(r) if "/api/sync" in r.url and r.method == "POST" else None)

    pg.evaluate("""() => window.LD.Store.logAnswer(
      { type: 'vocab', ability: 'vocab', ok: true, ms: 900, item: 'Haus', skill: 'v:haus' })""")
    r = pg.evaluate("() => window.LD.Store.autoPushFlush(false)")
    assert r.get("ok") is True and r.get("merge") == {"added": 0, "updated": 0}, "冲刷应真正推送"
    assert len(posts) >= 1, "作答后应有 POST /api/sync"
    body = posts[-1].post_data_json
    assert len(body["open_id"]) >= 6 and body["snapshot"]["xp"] >= 880, "推送应带 open_id 与最新快照"

    pg.evaluate("() => localStorage.removeItem('linguade.acct')")
    n = len(posts)
    assert pg.evaluate("() => window.LD.Store.autoPushFlush(false)") == {"skipped": True}, "未登录应跳过"
    assert len(posts) == n, "未登录不应发出请求"
    ctx.close()


def test_manual_force_push_and_idle_skip(browser, site_url, mock_api):
    """无增量：启动口径不推（省整包上传）；手动 sync force 仍必推"""
    ctx, pg = _settled_page(browser, site_url, mock_api, _seed(mock_api))
    posts = []
    pg.on("request", lambda r: posts.append(r) if "/api/sync" in r.url and r.method == "POST" else None)

    pg.evaluate("() => window.LD.Store.sync()")     # 无增量的启动口径：不推
    pg.wait_for_timeout(600)
    assert posts == [], "无增量且云端已有快照时不应重复推送"

    pg.evaluate("() => window.LD.Store.sync({ force: true })")
    pg.wait_for_timeout(600)
    assert len(posts) >= 1, "手动同步属于明确意图，必须推送"
    ctx.close()


def test_data_management_shows_last_sync(browser, site_url, mock_api):
    """设置 → 数据管理：展示「最近云端同步」，linguade:synced 事件即时刷新"""
    ctx, pg = _settled_page(browser, site_url, mock_api, _seed(mock_api))
    pg.evaluate("() => document.getElementById('settingsBtn').click()")   # 状态行随设置抽屉打开而绘制
    pg.wait_for_timeout(300)
    before = pg.evaluate("() => document.getElementById('backupStatus').textContent")
    assert "最近云端同步" in before, "同步过就应展示时间"
    pg.evaluate("() => localStorage.setItem('linguade.lastSyncAt', String(Date.now() - 3600_000))")
    pg.evaluate("() => document.dispatchEvent(new CustomEvent('linguade:synced'))")
    after = pg.evaluate("() => document.getElementById('backupStatus').textContent")
    assert "最近云端同步" in after and after != before, "事件应驱动状态行刷新"
    ctx.close()
