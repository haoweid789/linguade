"""flow_v13 · 音素级发音诊断 + FSRS 目标保持率（3.6.0 · 5 项）

依据开源/论文方向落地的两项升级：
  ① 音素级发音反馈（GOP 思路，Witt et al. 2000 / Hu et al. 2015；浏览器本地实现参考 guettli/pp）：
     规则式 G2P + 音素序列对齐，能指出「具体哪个音发错」；
  ② FSRS 目标保持率调度（Anki / FSRS-rs 公式 interval = S / FACTOR × (R^(1/DECAY) − 1)）。
"""
from conftest import goto


def test_g2p_german_phonemes(page):
    """规则式 G2P：德语特有读音（ich→[ç] / Buch→[x] / sch→[ʃ] / z→[ts]）"""
    p = page.evaluate("() => window.LD.Phonetics.toPhones('Buch')")
    assert "x" in p, "Buch 的 ch 应读 [x]：%s" % p
    p = page.evaluate("() => window.LD.Phonetics.toPhones('ich')")
    assert "ç" in p, "ich 的 ch 应读 [ç]：%s" % p
    p = page.evaluate("() => window.LD.Phonetics.toPhones('Schule')")
    assert "ʃ" in p, "sch 应读 [ʃ]：%s" % p
    p = page.evaluate("() => window.LD.Phonetics.toPhones('Zeit')")
    assert "ts" in p, "z 应读 [ts]：%s" % p


def test_phoneme_alignment_diagnoses_confusion(page):
    """音素对齐：把 ü 读成 u 时能定位到具体音素并给出最小对立对提示"""
    r = page.evaluate("() => window.LD.Phonetics.compare('über', 'uber')")
    assert r and r["per"] > 0, r
    assert r["nErr"] >= 1, r
    tips = " ".join(r["advice"])
    assert "圆唇" in tips or "y" in tips or "ʏ" in tips, "未给出 ü 的诊断提示：%s" % r["advice"]
    st = [s["st"] for s in r["sounds"]]
    assert "bad" in st or "warn" in st, st


def test_speech_score_includes_phonemes(page):
    """口语评分返回值带音素级诊断（engine → 报告渲染的数据源）"""
    r = page.evaluate("() => window.LD.Engine.scoreSpeech('Ich heiße Anna.', 'ich heise anna')")
    assert r and r.get("phonemes"), "scoreSpeech 未返回音素诊断"
    assert isinstance(r["phonemes"]["per"], int)
    assert len(r["phonemes"]["advice"]) >= 1


def test_fsrs_retention_scheduling(page):
    """FSRS 目标保持率：R=0.9 时 interval≈S；R 越高间隔越短、复习越密"""
    assert page.evaluate("() => Math.abs(window.LD.Engine.fsrsInterval(10, 0.9) - 10) < 0.01") is True, \
        "fsrsInterval(S,0.9) 应等于 S"
    r = page.evaluate("""() => {
      const E = window.LD.Engine;
      return { hi: E.fsrsInterval(10, 0.95), mid: E.fsrsInterval(10, 0.9), lo: E.fsrsInterval(10, 0.7) };
    }""")
    assert r["hi"] < r["mid"] < r["lo"], r
    tot = page.evaluate("""() => ({
      hi: window.LD.Engine.sandboxSim({ retention: 0.95, days: 60 }).worlds.fsrs.total,
      lo: window.LD.Engine.sandboxSim({ retention: 0.7, days: 60 }).worlds.fsrs.total
    })""")
    assert tot["hi"] > tot["lo"], "保持率高应带来更多复习：%s" % tot


def test_sandbox_retention_slider(page):
    """沙盘：目标保持率滑杆存在，拖动并运行后结果反映该设定"""
    goto(page, "sandbox")
    assert page.locator("#retIn").count() == 1
    page.evaluate("""() => {
      const el = document.querySelector('#retIn');
      el.value = '96';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#runBtn').click();
    }""")
    page.wait_for_timeout(250)
    txt = page.locator("#result").inner_text()
    assert "96%" in txt, txt[:240]