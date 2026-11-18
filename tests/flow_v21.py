"""flow_v21 · 第三波回归（15 项）

覆盖：首屏主行动按钮收敛为 2 个、首页三横幅「今天不再提示」与次日重现、
正文小字 12px 下限、未内联内容包在 http 形态仍可取文件、构建产物确实不含双语句对正文、
词库外孤儿复习记录在页头可见并能在空队列态一键清理、错题本按错误类型组卷与能力归属、
真人录音优先本地播放（内联 base64 零请求）与逐条许可署名完整。
"""
import json
import pathlib
import re
import sys

from conftest import goto  # noqa: F401  （其他波次夹具保持一致的导入习惯）


def _home(page, wait=280):
    page.evaluate("() => window.LD.router.go('home')")
    page.wait_for_timeout(wait)


def _seed_three_banners(page):
    """同时造出到期、内容包、备份三条横幅，并清空「今天不再提示」记录"""
    page.evaluate("""() => {
        const S = window.LD.Store, s = S.s;
        /* 2–4 天前有学习：备份提醒需要 ≥3 个学习日；昨天空着才会出到期横幅 */
        s.daily = {}; s.cards = {}; s.updatedAt = Date.now(); s.lastExportAt = 0;
        for (const k of [2, 3, 4]) s.daily[S.dayKey(new Date(Date.now() - k * 86400000))] = 10;
        for (const w of ['Zeit', 'Jahr', 'Tag', 'Woche'])
            s.cards[w] = { ef: 2.0, iv: 1, due: Date.now() - 1000, reps: 2, lapses: 1, ok: 1, bad: 1, history: [] };
        s.contentPack = null; s.contentPacksImported = {};
        window.LD_CONTENT_PACKS = [{ file: 'dist/content-pack-pairs.json', kind: 'pairs',
                                     label: '德中双语', count: 10,
                                     license: 'Tatoeba CC BY 2.0 FR', inline: false }];
        window.LD_CONTENT_PACKS_INLINE = {};
        S.save();
        ['due', 'pack', 'backup'].forEach(k => localStorage.removeItem('linguade.banner.' + k));
    }""")
    _home(page)


def test_home_hero_keeps_exactly_two_actions(page):
    """首屏只留「开始今日队列」+「更多数据与模块」，考试日期入口降为文字链接"""
    _seed_three_banners(page)
    assert page.locator(".home-hero-actions .btn").count() == 2
    assert page.locator(".home-hero-actions a.btn[href='#vocab']").count() == 1
    assert page.locator("#openExamSetting").count() == 1

    page.evaluate("() => { window.LD.Store.s.profile.examDate = '2027-01-15'; window.LD.Store.save(); }")
    _home(page)
    assert page.locator(".home-hero-actions .btn").count() == 2, "设了考试日期也不该再加一个按钮"
    assert page.locator(".home-exam .btn").count() == 0, "倒排卡片不应再重复大按钮"
    assert page.locator("#openExamSetting").count() == 1


def test_home_banners_dismissible_for_today(page):
    """每条横幅都有「今天不再提示」，且只影响自己"""
    _seed_three_banners(page)
    for bid in ("#dueBanner", "#packBanner", "#backupBanner"):
        assert page.locator(bid).count() == 1, bid + " 应出现"
        assert page.locator(bid + " [data-banner-close]").count() == 1, bid + " 缺少忽略入口"

    page.locator("#dueBanner [data-banner-close]").click()
    page.wait_for_timeout(160)
    assert page.locator("#dueBanner").count() == 0
    assert page.locator("#packBanner").count() == 1, "关闭一条不该带走其他横幅"

    day = page.evaluate("""() => { const t = new Date();
        return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }""")
    assert page.evaluate("() => localStorage.getItem('linguade.banner.due')") == day
    _home(page)
    assert page.locator("#dueBanner").count() == 0, "当天重进首页不该再出现"
    assert page.evaluate("() => window.LD.Store.bannerDismissed('due')") is True


def test_dismissed_banner_returns_next_day(page):
    """忽略记录按本地日期生效：日期一变，横幅回来"""
    _seed_three_banners(page)
    page.locator("#packBanner [data-banner-close]").click()
    page.wait_for_timeout(160)
    assert page.locator("#packBanner").count() == 0
    page.evaluate("() => localStorage.setItem('linguade.banner.pack', '2020-01-01')")
    _home(page)
    assert page.locator("#packBanner").count() == 1


def test_small_text_floor_12px(page):
    """正文类小字一律回到 12px 及以上（10.5px 那批标签是本次红线）"""
    _home(page)
    too_small = page.evaluate("""() => {
        const cases = [
            ['<span class="phon-note">x</span>', '.phon-note'],
            ['<button class="module-tab"><small>x</small></button>', '.module-tab small'],
            ['<span class="path-word"><small>x</small></span>', '.path-word small'],
            ['<details class="nav-more"><summary><em>x</em></summary></details>', '.nav-more>summary em'],
            ['<span class="mod-use-count">x</span>', '.mod-use-count'],
            ['<div class="nav-group-title">x</div>', '.nav-group-title'],
            ['<div class="content-source">x</div>', '.content-source'],
            ['<div class="ld-word-exzh">x</div>', '.ld-word-exzh'],
            ['<p class="hint">x</p>', '.hint'],
            ['<div class="banner-body">x</div>', '.banner-body'],
        ];
        const bad = [];
        for (const [html, sel] of cases) {
            const host = document.createElement('div');
            host.style.cssText = 'position:absolute;left:-9999px;top:0';
            host.innerHTML = html;
            document.body.appendChild(host);
            const px = parseFloat(getComputedStyle(host.querySelector(sel)).fontSize);
            if (px < 12) bad.push(sel + '=' + px + 'px');
            host.remove();
        }
        return bad;
    }""")
    assert not too_small, "仍低于 12px：" + ", ".join(too_small)


def test_uninlined_pack_still_loads_over_http(page):
    """未内联的包在 http 形态仍可发现并走 fetch 导入（离线瘦身不牺牲部署形态功能）"""
    _seed_three_banners(page)
    assert page.locator("#packBanner").count() == 1
    loaded = page.evaluate("""() => window.LD.ContentPacks
        .load({ file: 'dist/content-pack-pairs.json', kind: 'pairs' })
        .then(() => (window.LD.Store.s.contentPack.pairs || []).length)""")
    assert loaded > 0


def test_build_does_not_inline_pairs_pack():
    """构建产物只把双语句对列进清单，正文不进单文件"""
    dist = pathlib.Path(__file__).resolve().parent.parent / "dist" / "index.html"
    html = dist.read_text(encoding="utf-8")
    m = re.search(r"window\.LD_CONTENT_PACKS = (\[.*?\]);window\.LD_CONTENT_PACKS_INLINE = (\{.*?\});</script>",
                  html, re.S)
    assert m, "dist 里应存在内容包注入块（先跑 python tools/build.py）"
    packs = json.loads(m.group(1))
    inline = json.loads(m.group(2))
    pairs = [p for p in packs if p.get("kind") == "pairs"]
    assert pairs, "清单里应有德中双语句对"
    assert all(p["inline"] is False for p in pairs), "德中双语句对应标记为未内联"
    assert not [k for k in inline if "pairs" in k], "德中双语句对正文不该进单文件"
    assert all(bool(inline.get(p["file"])) == p["inline"] for p in packs)


def _seed_orphans(page, n=2):
    page.evaluate("""(n) => {
        const S = window.LD.Store, s = S.s;
        s.cards = {}; s.hlr = {};
        for (const w of ['Zeit', 'Tag', 'Jahr', 'Woche'])
            s.cards[w] = { ef: 2.0, iv: 1, due: Date.now() - 1000, reps: 2, lapses: 1, ok: 1, bad: 1, history: [] };
        for (let i = 1; i <= n; i++)
            s.cards['Alt_Wort_' + i] = { ef: 2.0, iv: 1, due: Date.now() - 2000 * i, reps: 1, lapses: 0, ok: 1, bad: 0, history: [] };
        S.save();
    }""", n)


def test_vocab_header_marks_orphan_records(page):
    """页头把「本机有记录但词库里没有」的到期卡片单独说明，不再混进到期数"""
    _seed_orphans(page, 2)
    goto(page, "vocab")
    head = page.locator(".page-head p").first.inner_text()
    assert "另有 2 条记录待清理" in head
    assert "到期复习 4 个" in head, "孤儿卡片不该被算进今日到期"


def test_orphan_cleanup_entry_in_empty_state(page):
    """队列清空时给出可见说明与一键清理入口，清理后卡片真的从本机消失"""
    page.evaluate("""() => {
        const S = window.LD.Store, s = S.s;
        s.hlr = {};
        s.cards = {};
        for (const w of (window.LD_LEX || []))
            s.cards[w[0]] = { ef: 2.0, iv: 30, due: Date.now() + 30 * 86400000, reps: 5, lapses: 0, ok: 5, bad: 0, history: [] };
        s.cards['Alt_Wort_1'] = { ef: 2.0, iv: 1, due: Date.now() - 1000, reps: 1, lapses: 0, ok: 1, bad: 0, history: [] };
        S.save();
    }""")
    goto(page, "vocab")
    empty = page.locator(".empty").inner_text()
    assert "不在当前词库中" in empty and "不计入到期数" in empty
    assert page.locator("#dropOrphans").count() == 1
    page.locator("#dropOrphans").click()
    page.wait_for_timeout(300)
    assert page.evaluate("() => Object.keys(window.LD.Store.s.cards).filter(w => w.indexOf('Alt_Wort_') === 0)") == []
    assert page.locator("#dropOrphans").count() == 0


def _seed_wrong(page):
    page.evaluate("""() => {
        const S = window.LD.Store, s = S.s;
        s.wrong = [];
        s.ability = { vocab: 60, grammar: 55, speaking: 50, listening: 50, reading: 55, writing: 50 };
        S.addWrong({ module: '单词', type: '冠词', wrong: 'der Bär', right: 'der Bär', why: 'Bär 恒取阳性' });
        S.addWrong({ module: '单词', type: '复数', wrong: 'die Bears', right: 'die Bären', why: '强变化复数加 -n' });
        S.addWrong({ module: '句法', type: '语序', wrong: 'Ich habe gegessen gestern', right: 'Ich habe gestern gegessen', why: '完成时分词居末' });
        S.addWrong({ module: '句法', type: '语序', wrong: 'Weil ich gehe heute', right: 'Weil ich heute gehe', why: '从句动词末位' });
        S.save();
    }""")


def test_notebook_type_chips_group_pending_errors(page):
    """错题本按错误类型给出组卷入口，chip 上带该类待掌握数量"""
    _seed_wrong(page)
    goto(page, "notebook")
    chips = page.locator(".nb-type")
    assert chips.count() == 4, "全部 + 语序/冠词/复数 三类"
    assert "全部 · 4" in chips.nth(0).inner_text()
    labels = [chips.nth(i).inner_text() for i in range(chips.count())]
    assert any("语序 · 2" in t for t in labels), labels
    page.locator('.nb-type[data-t="语序"]').click()
    page.wait_for_timeout(260)
    assert page.locator("#list .list-item").count() == 2, "筛选后列表只留这一类"
    train = page.locator("#trainBtn").inner_text()
    assert "只练「语序」" in train and "2" in train


def test_notebook_grouped_drill_and_ability_attribution(page):
    """组卷只出该类型；重练计入能力画像时按来源模块归档，不再一律记成语法"""
    _seed_wrong(page)
    goto(page, "notebook")
    page.locator('.nb-type[data-t="语序"]').click()
    page.wait_for_timeout(260)
    page.locator("#trainBtn").click()
    page.wait_for_timeout(260)
    assert "「语序」组卷" in page.locator(".page-head p").inner_text()
    assert page.locator("#tStage .tag").nth(1).inner_text() == "语序"
    for _ in range(2):
        page.locator("#tFlip").click()
        page.locator('#tRate [data-v="ok"]').click()
        page.wait_for_timeout(220)
    assert "重练完成" in page.locator("#tStage").inner_text()

    _seed_wrong(page)
    goto(page, "notebook")
    page.locator('.nb-type[data-t="冠词"]').click()
    page.wait_for_timeout(260)
    page.locator("#trainBtn").click()
    page.wait_for_timeout(260)
    page.locator("#tFlip").click()
    page.locator('#tRate [data-v="ok"]').click()
    page.wait_for_timeout(240)
    last = page.evaluate("() => window.LD.Store.s.log.filter(x => x.type === '冠词').slice(-1)")
    assert last and last[0]["ability"] == "vocab", last


def _audio_pack():
    root = pathlib.Path(__file__).resolve().parent.parent
    return json.loads((root / "dist" / "content-pack-audio.json").read_text(encoding="utf-8"))


def test_speech_plays_inlined_human_recording_without_network(page):
    """导入真人录音包后，「听原句」优先用打进单文件的 base64 录音，而不是走网络或 TTS"""
    pack = _audio_pack()
    assert pack["inlineAudio"] > 0, "真人录音包应至少内联一条供离线播放"
    target = next(it for it in pack["items"] if it.get("audioB64"))
    page.evaluate("(p) => window.LD.Store.importData(JSON.stringify(p), 'json')", pack)
    page.evaluate("""() => {
        window.__heard = [];
        window.Audio = function (url) {
            window.__heard.push(url);
            return { onerror: null, play: () => Promise.resolve() };
        };
    }""")
    goto(page, "speech")
    lines = page.locator("#lineList .t1")
    idx = next((i for i in range(lines.count())
                if lines.nth(i).inner_text().strip() == target["de"].strip()), None)
    assert idx is not None, "句单里应出现带真人录音的句子"
    page.locator("#lineList .list-item").nth(idx).click()
    page.wait_for_timeout(220)
    assert page.locator('.tag.tag-blue', has_text="实人录音（本地）").count() == 1
    page.locator("#sayRef").click()
    page.wait_for_timeout(250)
    heard = page.evaluate("() => window.__heard")
    assert heard and heard[0].startswith("data:audio/mpeg;base64,"), heard
    assert page.locator("#refSrc").inner_text() == "真人录音 · 已打进单文件"


def test_dist_manifest_lists_human_recording_pack():
    """构建清单里真人录音包带独立标签、标记为已内联，且音频文件真实存在"""
    root = pathlib.Path(__file__).resolve().parent.parent
    html = (root / "dist" / "index.html").read_text(encoding="utf-8")
    m = re.search(r"window\.LD_CONTENT_PACKS = (\[.*?\]);window\.LD_CONTENT_PACKS_INLINE", html, re.S)
    assert m, "dist 里应存在内容包清单"
    packs = json.loads(m.group(1))
    audio = [p for p in packs if p["file"] == "content-pack-audio.json"]
    assert audio, "构建清单应包含真人录音包（先跑 tools/fetch_audio.py --write）"
    assert audio[0]["label"] == "真人录音句" and audio[0]["inline"] is True
    assert audio[0]["withAudio"] == _audio_pack()["count"]
    d = _audio_pack()
    for it in d["items"]:
        assert (root / "dist" / it["audioFile"]).exists(), it["audioFile"]
        assert it["audioLicense"] and it["audioBy"], "CC BY 需逐条许可与署名"


def test_reading_filters_by_length_and_level(page):
    """阅读列表可按长度/等级筛选，筛出的每篇词数都落在该档内"""
    goto(page, "reading")
    assert page.locator(".rd-chip").count() >= 7
    total = page.locator(".reading-card").count()
    page.locator('.rd-chip[data-len="s"]').click()
    page.wait_for_timeout(280)
    cards = page.locator(".reading-card")
    assert 0 < cards.count() <= total, "短文档应筛出子集"
    counts = []
    for i in range(cards.count()):
        m = re.findall(r"/ (\d+) 词", cards.nth(i).inner_text())
        assert m, cards.nth(i).inner_text()
        counts.append(int(m[0]))
    assert max(counts) <= 150, counts
    assert "建议" in cards.first.inner_text()
    page.locator('.rd-chip[data-len="all"]').click()
    page.wait_for_timeout(250)
    assert page.locator(".reading-card").count() == total


def test_reading_exam_mode_times_and_locks_translation(page):
    """考试模式：进题给限时、交卷前锁住中文译文与导语，交卷后放开"""
    goto(page, "reading")
    page.locator("#rdExamMode").click()
    page.wait_for_timeout(250)
    assert "考试模式：已开" in page.locator("#rdExamMode").inner_text()
    page.locator(".reading-card").first.click()
    page.wait_for_timeout(320)
    assert page.locator("#rdClock").count() == 1, "应有倒计时"
    assert "考试模式：交卷前隐藏中文译文" in page.locator(".page-head p").inner_text()
    assert page.locator(".rd-zh").count() == 0, "考试模式下译文不该出现"
    page.locator("#toggleZh").click()
    page.wait_for_timeout(200)
    assert page.locator(".rd-zh").count() == 0, "点译文按钮也不该在交卷前放开"
    page.locator('[data-t="0"][data-v="richtig"]').first.click()
    page.wait_for_timeout(200)
    page.locator("#submitBtn").click()
    page.wait_for_timeout(400)
    assert page.locator("#rdClock").count() == 0, "交卷后倒计时应停"
    assert page.locator(".rd-zh").count() > 0, "交卷后放开中文对照"


def test_review_worklist_tool_runs():
    """人工复核清单工具可复跑：例句缺口 / 词形缺原形 / 阅读缺导语 / 录音覆盖率都能算出来"""
    import subprocess
    base = pathlib.Path(__file__).resolve().parent.parent
    r = subprocess.run([sys.executable, str(base / "tools" / "review_worklist.py")],
                       capture_output=True, text=True, cwd=str(base))
    assert r.returncode == 0, r.stdout + r.stderr
    assert "词形原形待补" in r.stdout and "真人录音" in r.stdout
    m = re.search(r"词库 (\d+) 词（人工 (\d+) / 机器 (\d+)）", r.stdout)
    assert m and int(m.group(1)) == 6423 and int(m.group(2)) == 572
