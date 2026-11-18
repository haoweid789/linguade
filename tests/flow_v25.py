"""LinguaDE · flow_v25：3.19.1 体验修复渲染断言（长期使用报告回访）

对应 D:/111/华为ict/LinguaDE-长期使用体验报告-2026-11-05.md 的 P0/P1 修复项：
  1. 首卡强制人工词：新词队列前段禁入待抽检词
  2. 内容包横幅降噪：打开过阅读/错题本/对话后不再出现
  3. 无德语语音包时发音按钮给 toast 提示（而非静默）
  4. 考试预警三档（距考 30/14/7 天措辞渐进）
  5. 报错闭环：报过的词再次出现时词卡显式回执

全部按渲染结果断言（与 flow_v24 同口径）。
"""
import pathlib

DIST = pathlib.Path(__file__).resolve().parent.parent / "dist" / "index.html"


def test_new_words_front_half_are_manual(page):
    """新词队列前 50% 必须是人工校对词条；待抽检词禁入前段"""
    page.evaluate("() => { window.LD.router.go('vocab'); }")
    page.wait_for_timeout(400)
    info = page.evaluate("""() => {
      const Q = window.LD.Engine.buildQueue();
      return { n: Q.length, newWords: Q.filter(x => !x.isDue).map(x => ({ de: x.de, qa: x.qa })) };
    }""")
    nw = [x for x in info["newWords"] if x["qa"] in ("machine", "ai")]
    front = info["newWords"][:max(1, (len(info["newWords"]) + 1) // 2)]
    assert not [x for x in front if x["qa"] in ("machine", "ai")], \
        "新词队列前半混入待抽检词：%s（人工优先两阶段抽样失效）" % [x["de"] for x in front[:4]]


def test_pack_banner_suppressed_after_first_use(page):
    """用过阅读/错题本/对话后，首页不再弹内容包横幅"""
    page.evaluate("() => { window.LD.Store.visit('reading'); }")
    page.evaluate("() => { window.LD.router.go('home'); }")
    page.wait_for_timeout(400)
    has = page.evaluate("() => !!document.getElementById('packBanner')")
    assert not has, "打开过阅读后内容包横幅仍出现（降噪失效）"
    # 对照组：未用过 → 横幅应出现（单文件版 dist 未必有包，但部署形态走 dist 注入）
    fresh = page.evaluate("() => { window.LD.Store.s.visited = {}; window.LD.router.go('home'); return null; }")
    page.wait_for_timeout(300)
    # 若 dist 已内置包则横幅出现；源码服务（http 根）通常无包，跳过此对照
    total = page.evaluate("() => (window.LD.ContentPacks ? window.LD.ContentPacks.available().length : 0)")
    if total:
        assert page.evaluate("() => !!document.getElementById('packBanner')"), \
            "未用过且有内容包时横幅应出现（对照组）"


def test_speak_without_german_voice_toasts(page):
    """无德语语音包时点击发音应 toast 提示一次（不是静默）"""
    page.evaluate("() => { window.LD.router.go('vocab'); }")
    page.wait_for_timeout(400)
    # 用 headless 环境（大概率无德语 voice）或注入空 getVoices
    has_de = page.evaluate("""() => {
      try { return (speechSynthesis.getVoices() || []).filter(v => /^de/i.test(v.lang || "")).length > 0; }
      catch (e) { return false; }
    }""")
    if has_de:
        page.evaluate("""() => {
          const orig = speechSynthesis.getVoices.bind(speechSynthesis);
          speechSynthesis.getVoices = () => (orig() || []).filter(v => !/^de/i.test(v.lang || ""));
        }""")
    page.evaluate("() => { const b = document.getElementById('sayBtn'); if (b) b.click(); }")
    page.wait_for_timeout(600)
    toasts = page.evaluate("() => (document.getElementById('toastWrap') || {}).innerText || ''")
    assert "德语语音" in toasts, "无语音包点击发音应提示（实际 toast：%r）" % toasts[:120]
    # 会话内第二次点击不再重复轰炸
    page.evaluate("() => { const b = document.getElementById('sayBtn'); if (b) b.click(); }")
    page.wait_for_timeout(400)
    n = page.evaluate("() => document.querySelectorAll('.toast').length")
    assert n <= 1, "发音缺失提示应会话级只出现一次（toast 数 %d）" % n


def test_exam_tier_hints(page):
    """距考 6/10/20/60 天分别落三档提示"""
    import datetime as dt
    def days_case(days):
        exam = (dt.date.today() + dt.timedelta(days=days)).isoformat()
        page.evaluate("""(d) => {
          window.LD.Store.s.profile.examDate = d;
          window.LD.router.go('home');
        }""", exam)
        page.wait_for_timeout(350)
        return page.evaluate("() => document.getElementById('view').innerText")

    t6 = days_case(6)
    assert "不到一周" in t6, "距考 6 天应命中第一档（实际：%r）" % t6[t6.find('距') - 40:t6.find('距') + 200]
    t10 = days_case(10)
    assert "只剩两周" in t10, "距考 10 天应命中第二档"
    t20 = days_case(20)
    assert "剩下的时间只够覆盖" in t20, "距考 20 天应命中第三档"
    t60 = days_case(60)
    assert "来得及" in t60, "距考 60 天应命中第四档"
    assert all(x not in t60 for x in ("不到一周", "只剩两周", "只够覆盖")), "60 天不应出现更急迫的措辞"


def test_report_closure_on_card(page):
    """用户报过的词再次出现时词卡显式回执"""
    page.evaluate("""() => {
      const S = window.LD.Store.s;
      const lex = window.LD_LEX;
      const w = lex[0][0];
      S.contentReports = [{ de: w, fields: ["释义"], t: Date.now() }];
      window.LD.Store.save();
      // 强制队列首词为该词
      const idx = lex.findIndex(x => x[0] === w);
      S.cards[w] = { due: Date.now() - 86400000, reps: 1, ok: 0, bad: 1, lapses: 0, ef: 2.5, iv: 1, history: [] };
      window.LD.router.go('vocab');
    }""")
    page.wait_for_timeout(500)
    txt = page.evaluate("() => document.getElementById('stage').innerText")
    assert "曾反馈" in txt, "报过的词再出现应有回执（实际：%r）" % txt[:240]
    assert "释义" in txt, "回执应带上被反馈的字段名"
    # 未报过的词不显示
    page.evaluate("""() => {
      window.LD.Store.s.contentReports = [];
      window.LD.Store.save();
      window.LD.router.go('vocab');
    }""")
    page.wait_for_timeout(400)
    txt2 = page.evaluate("() => document.getElementById('stage').innerText")
    assert "曾反馈" not in txt2, "未报过的词不应出现回执"
