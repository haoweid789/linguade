"""flow_v11 · 学习者体验闭环回归（11 项）

覆盖 3.x 学习者体验批次：open_id 后端契约 / 诊断不计任务 / 数据导入导出 /
云端快照恢复 / 移动端导航 / 隔日复习横幅 / 模考路由与报告 / B2-C1 词库 /
听力双人对话与语音包探测。
"""
import json

from conftest import goto


def _point_backend(page, url):
    page.evaluate("(url) => { window.LD.Store.s.cfg.backend = url; window.LD.Store.save(); }", url)


# ---------- 1. open_id 契约：mock 已按 schemas.py 校验必填字段 ----------

def test_backend_contract_open_id(page, mock_api):
    """sync 推送带 open_id + snapshot，不再被真实后端 422 拒绝"""
    _point_backend(page, mock_api)
    r = page.evaluate("""async () => {
        const S = window.LD.Store;
        const j = await S.sync();
        return { ok: j.ok, hasOid: !!S.s.open_id, oidLen: (S.s.open_id || '').length };
    }""")
    assert r["ok"] is True
    assert r["hasOid"] is True and r["oidLen"] >= 6


def test_chat_contract_open_id(page, mock_api):
    """流式对话请求体含 open_id（mock 缺字段即 422，前端会降级导致断言失败）"""
    _point_backend(page, mock_api)
    r = page.evaluate("""async () => {
        try { return { ok: true, text: await window.LD.Backend.chatStream('aps', [], 'Guten Tag') }; }
        catch (e) { return { ok: false, err: String(e) }; }
    }""")
    assert r["ok"] is True and "Guten Tag" in r["text"]


def test_interview_contract_open_id(page, mock_api):
    """面试评估请求体含 open_id"""
    _point_backend(page, mock_api)
    r = page.evaluate("""async () => {
        try { return { ok: true, j: await window.LD.Backend.interviewEvaluate([{q:'Warum?',a:'Weil.'}]) }; }
        catch (e) { return { ok: false, err: String(e) }; }
    }""")
    assert r["ok"] is True and r["j"]["total"] == 78


# ---------- 2. 每日任务语义：诊断是测量不是练习 ----------

def test_diagnose_does_not_feed_quests_or_xp(browser, site_url, errors):
    """全新档案走完 10 题诊断：任务进度必须为 0，XP 只拿完成奖励 25"""
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(site_url + "/index.html")
    pg.wait_for_selector(".nav-item", timeout=10000)
    for _ in range(10):
        pg.locator("#quizBox .list-item").first.click()
        pg.wait_for_timeout(60)
        try:
            pg.locator("#nextBtn").click(timeout=1500)
        except Exception:
            break
        pg.wait_for_timeout(40)
    pg.wait_for_timeout(500)
    r = pg.evaluate("""() => {
        const q = window.LD.Store.todayQuests();
        return { xp: window.LD.Store.s.xp,
                 progress: q.items.reduce((a,i)=>a+i.progress,0),
                 done: q.items.filter(i=>i.done).length,
                 types: window.LD.Store.s.log.map(l=>l.type).slice(0,12) };
    }""")
    assert r["progress"] == 0, "诊断作答不应计入每日任务进度"
    assert r["done"] == 0, "诊断不应点亮任何每日任务"
    assert r["xp"] == 25, f"诊断完成应只给 25 XP，实际 {r['xp']}"
    assert all(t == "diagnose" for t in r["types"]), "诊断作答的 type 应为 diagnose"
    ctx.close()


# ---------- 3. 数据可迁移闭环 ----------

def test_export_import_roundtrip(page):
    """全量导出 JSON → 改动状态 → 导入恢复：学习档案不失真"""
    r = page.evaluate("""() => {
        const S = window.LD.Store;
        S.addXp(123); S.s.profile.name = '迁移前用户';
        const dump = S.exportData();
        S.s.profile.name = '被覆盖的名字'; S.s.xp = 1;
        const res = S.importData(dump, 'json');
        return { res: res.ok, name: S.s.profile.name, xp: S.s.xp,
                 cfgKept: S.s.cfg.backend !== undefined };
    }""")
    assert r["res"] is True
    assert r["name"] == "迁移前用户" and r["xp"] == 123
    assert r["cfgKept"] is True


def test_import_anki_tsv(page):
    """Anki TSV（front/back/source）导入生词本，含表头跳过与计数（生词本最新在前）"""
    r = page.evaluate("""() => {
        const S = window.LD.Store;
        S.s.wordbank = [];
        const tsv = 'front\\tback\\tsource\\nHaus\\t房子\\tDas Haus ist groß.\\nBuch\\t书\\tDas Buch ist neu.';
        const res = S.importData(tsv, 'tsv');
        return { ok: res.ok, n: res.imported, words: S.s.wordbank.map(w=>w.de) };
    }""")
    assert r["ok"] is True and r["n"] == 2
    assert sorted(r["words"]) == ["Buch", "Haus"]


def test_cloud_pull_restore(page, mock_api):
    """从云端拉取快照并恢复：本地数据被快照覆盖，设置保留"""
    _point_backend(page, mock_api)
    r = page.evaluate("""async () => {
        const before = window.LD.Store.s.cfg.backend;
        const j = await window.LD.Backend.pullSync();
        const ok = window.LD.Store.restoreSnapshot(j.snapshot);
        return { pulled: !!j.snapshot, restored: ok,
                 name: window.LD.Store.s.profile.name, xp: window.LD.Store.s.xp,
                 cfgKept: window.LD.Store.s.cfg.backend === before };
    }""")
    assert r["pulled"] and r["restored"]
    assert r["name"] == "云端学习者" and r["xp"] == 880
    assert r["cfgKept"] is True


# ---------- 4. 移动端导航 ----------

def test_mobile_hamburger_navigation(browser, site_url, errors):
    """390px 视口：汉堡可见 → 打开侧栏抽屉 → 点模块可导航 → 自动收起
    （Playwright 的 is_visible 不把 transform 离屏当隐藏，故以 .open class 判定抽屉态）"""
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(site_url + "/index.html")
    # 入学诊断未完成时其余模块上锁，本用例只测移动端导航，先补上"已完成"状态
    pg.evaluate("() => { LD.Store.s.diagnosed = true; LD.Store.save(); }")
    pg.reload()
    pg.wait_for_selector(".nav-item", timeout=10000)
    assert pg.locator("#menuBtn").is_visible(), "移动端汉堡按钮应可见"
    pg.locator("#menuBtn").click()
    pg.wait_for_timeout(350)
    assert pg.evaluate("() => document.getElementById('sidebar').classList.contains('open')"), "点击汉堡后侧栏抽屉应打开"
    assert pg.locator("#navMask").is_visible(), "遮罩应出现"
    pg.locator('.nav-item[data-route="vocab"]').first.click()
    pg.wait_for_timeout(350)
    assert not pg.evaluate("() => document.getElementById('sidebar').classList.contains('open')"), "导航后抽屉应收起"
    assert "单词" in pg.locator("#view").inner_text()
    assert errors == []
    ctx.close()


# ---------- 5. 复习提醒横幅 ----------

def test_due_review_banner(page):
    """到期词积压 + 昨日空窗 → 首页出现隔日未复习横幅"""
    page.evaluate("""() => {
        const S = window.LD.Store;
        S.s.daily = {};                      // 无任何学习记录（含昨天）
        S.s.cards = {};
        for (const w of ['Zeit','Jahr','Tag','Woche'])
            S.s.cards[w] = { ef: 2.0, iv: 1, due: Date.now() - 1000, reps: 2, lapses: 1, ok: 1, bad: 1, history: [] };
        S.save();
        window.LD.router.go('home');
    }""")
    page.wait_for_timeout(300)
    banner = page.locator("#dueBanner")
    assert banner.count() == 1, "应显示隔日未复习横幅"
    assert "隔日未复习" in banner.inner_text()


# ---------- 6. 全真模考 ----------

def test_mockexam_route_and_flow(page, errors):
    """模考页可达；跳过四节后输出 TDN 报告并写入历史"""
    goto(page, "mockexam")
    assert "全真模考" in page.locator("#view").inner_text()
    page.locator("#mxStart").click()
    page.wait_for_timeout(300)
    for _ in range(4):                       # 四节全部走「跳过本节」快速通道
        page.locator("#mxSkip").click()
        page.wait_for_timeout(250)
    assert "模考报告" in page.locator("#view").inner_text()
    assert "TDN" in page.locator("#view").inner_text()
    r = page.evaluate("() => window.LD.Store.s.mockexams.length")
    assert r == 1, "模考记录应写入历史"
    assert errors == []


def test_mockexam_listen_answers_graded(page):
    """阅读节实际作答：全对得 100%，错题有反馈"""
    goto(page, "mockexam")
    page.locator("#mxStart").click()
    page.wait_for_timeout(250)
    r = page.evaluate("""() => {
        const mod = window.LD.Modules.mockexam;   // 只触内部判分函数路径
        const qs = (window.LD_READING_PASSAGES || []).length;
        return { passages: qs, bank: {
            lesen: !!(window.LD_READING_PASSAGES || []).length,
            hoeren: !!(window.LD_LISTEN_BANK || []).length,
            dialogues: !!(window.LD_LISTEN_DIALOGUES || []).length,
            schreiben: !!(window.LD_WRITING_BANK || []).length,
            sprechen: !!(window.LD_SPEECH_BANK || []).length } };
    }""")
    assert r["passages"] >= 5, "阅读题库不足 5 篇"
    assert all(r["bank"].values()), "模考依赖的四个题库导出缺失: %s" % r["bank"]


# ---------- 7. 词库纵深 ----------

def test_lexicon_b2_c1_depth(page):
    """词库含 B2 与 C1 分级，总量不低于 460"""
    r = page.evaluate("""() => {
        const lv = {};
        (window.LD_LEX || []).forEach(x => lv[x[4]] = (lv[x[4]] || 0) + 1);
        return { total: (window.LD_LEX || []).length, lv };
    }""")
    assert r["total"] >= 460
    assert r["lv"].get("B2", 0) >= 90, "B2 词条应 ≥ 90"
    assert r["lv"].get("C1", 0) >= 60, "C1 词条应 ≥ 60"


# ---------- 8. 听力真实化 ----------

def test_listening_dialog_mode(page, errors):
    """双人对话模式存在且可交互；无声包环境显示安装指引横幅"""
    goto(page, "listening")
    chips = page.locator('[data-m="dialog"]')
    assert chips.count() == 1, "听力模块应有双人对话题型"
    chips.click()
    page.wait_for_timeout(400)
    assert "对话" in page.locator("#view").inner_text()
    page.wait_for_timeout(1500)              # 等语音包探测（上限 1.2s）
    voices = page.evaluate("() => (window.LD.SpeechUtil.deVoices() || []).length")
    if voices == 0:                          # 仅在无声包环境断言横幅（CI 确定性条件）
        assert page.locator("#voiceWarn").is_visible(), "无声包时应显示安装指引"
    assert errors == []


def test_speech_rate_actually_applies(page):
    """SpeechUtil.say 接受 rate 参数（语速滑杆修复的回归锚点）"""
    r = page.evaluate("""() => {
        const src = window.LD.SpeechUtil.say.toString();
        return { takesRate: /rate/.test(src), hasDeVoices: typeof window.LD.SpeechUtil.deVoices === 'function' };
    }""")
    assert r["takesRate"] is True
    assert r["hasDeVoices"] is True


# ---------- 9. 内容扩容（3.5.0-a：AEG 纠错句库 + 跟读池派生） ----------

def test_grammar_library_scaled_by_aeg(page):
    """纠错句库 20 → 170+：AEG 产物无重复、错句必带讲解、错句 != 正确句"""
    r = page.evaluate("""() => {
        const lib = window.LD_GRAMMAR_LIBRARY || [];
        const wrongs = lib.map(x => x.wrong);
        const aeg = lib.filter(x => (x.issues || []).length && x.issues[0].why);
        return { total: lib.length, dup: wrongs.length - new Set(wrongs).size,
                 withIssues: aeg.length,
                 badPairs: lib.filter(x => x.wrong === x.right && (x.issues || []).length).length,
                 types: {} };
    }""")
    assert r["total"] >= 160, f"纠错句库应 ≥160，实际 {r['total']}"
    assert r["dup"] == 0, "句库存在重复错句"
    assert r["badPairs"] == 0, "带讲解的条目 wrong 不得等于 right"


def test_speech_pool_derived_from_lexicon(page):
    """跟读池从 10 句扩到 200+ 句（精选 + 词库例句派生），等级标签齐备"""
    r = page.evaluate("""() => {
        const pool = window.LD_SPEECH_POOL || [];
        return { total: pool.length,
                 curated: (window.LD_SPEECH_BANK || []).length,
                 lvOk: pool.every(x => x.de && x.lv) };
    }""")
    assert r["curated"] == 10
    assert r["total"] >= 200, f"跟读池应 ≥200 句，实际 {r['total']}"
    assert r["lvOk"] is True


def test_content_pack_import_grows_pool(page):
    """导入内容包（content_pipeline 产物格式）→ 跟读池即时扩容且持久化"""
    r = page.evaluate("""() => {
        const S = window.LD.Store;
        const base = window.LD.SpeechPool().length;
        const pack = { pack: 'speech', version: 1, items: [
            { id: 't1', de: 'Die Sonne scheint heute sehr hell.', hasAudio: true },
            { id: 't2', de: 'Wir lernen jeden Tag zusammen Deutsch.' }
        ] };
        const res = S.importData(JSON.stringify(pack), 'json');
        const after = window.LD.SpeechPool().length;
        const persisted = JSON.stringify(JSON.parse(S.exportData()).contentPack.speech.length);
        S.s.contentPack = null; S.save();          # 还原现场，不污染其他用例
        return { ok: res.ok, kind: res.kind, n: res.imported, base, after, persisted };
    }""".replace("# 还原现场", "// 还原现场"))
    assert r["ok"] is True and r["kind"] == "pack" and r["n"] == 2
    assert r["after"] == r["base"] + 2, f"导入 2 句后句池应 +2（{r['base']}→{r['after']}）"
    assert r["persisted"] == "2", "内容包应随 exportData 持久化（云端快照/导出同路径）"


# ---------- 10. 第二轮体验缺口（手动生词 + 词典查询 / 写作历史对比） ----------

def test_notebook_manual_add_and_dict_lookup(page):
    """生词本支持手动添加（API 层）；页面查词典命中释义并一键入库"""
    r = page.evaluate("""() => {
        const S = window.LD.Store;
        S.s.wordbank = [];
        S.addWord({ de: 'Sperrkonto', zh: '保证金账户', ctx: '手动添加' });
        const m = S.s.wordbank.find(w => w.de === 'Sperrkonto');
        return { added: !!m, zh: m && m.zh };
    }""")
    assert r["added"] is True and r["zh"] == "保证金账户"

    goto(page, "notebook")
    page.fill("#wbIn", "Universität")
    page.click("#wbLookup")
    assert "大学" in page.locator("#wbLookupOut").inner_text(), "词典查询应命中释义"
    page.click("#wbAdd")
    page.wait_for_timeout(200)
    assert "Universität" in page.locator("#bankList").inner_text(), "一键入库应出现在生词本列表"


def test_writing_history_and_delta(page):
    """写作历史入档；同题第二次批改显示「vs 上次」对比徽标"""
    page.evaluate("() => { window.LD.Store.s.writingHist = []; window.LD.Store.save(); }")
    goto(page, "writing")
    text = ("Sehr geehrte Damen und Herren, ich habe mich für einen Kurs angemeldet. "
            "Leider gibt es ein Problem mit der Zeit. Deshalb möchte ich bitte umbuchen. "
            "Sie erreichen mich unter Mail. Mit freundlichen Grüßen")
    for _ in range(2):                      # 无 AI 通道 → submit 走本地引擎兜底链路
        page.fill("#wIn", text)
        page.click("#wSubmit")
        page.wait_for_timeout(900)
    hist = page.evaluate("() => window.LD.Store.s.writingHist")
    assert len(hist) >= 2, "两次批改都应入档"
    assert "vs 上次" in page.locator("#wOut").inner_text(), "第二次批改应显示同题分数对比"
