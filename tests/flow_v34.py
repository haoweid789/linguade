"""LinguaDE · flow_v34：路由切换收口发声（听力录音跨页响的问题）

对照根因：<audio> 元素构造于模块闭包（listening/playPrompt、speech/playUrl、mockexam
独立 Audio），且 speechSynthesis utterance 以单词周期注册队列，路由切换时没有任何
全局收口；SpeechSynthesisUtterance 无本地 onend 注册 —— 切换后队列尾继续播出。

本套用例按渲染结果断言：
  1. 系统语音发音中途切路由 → speechSynthesis 被 cancel（说话中=false）
  2. 音频元素播放中途切路由 → 已注册的 <audio> 被 pause
  3. 新播放先停旧音（全局注册表，而非各模块局部引用）
"""
import time


def test_route_switch_cancels_speech(page):
    """路由切换后系统语音应被取消"""
    page.evaluate("""() => {
      // Headless Chromium 无德语语音：先给 speechSynthesis 造一个可探查状态
      const u = new SpeechSynthesisUtterance("Willkommen bei LinguaDE.");
      u.lang = "de-DE";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }""")
    page.evaluate("() => { window.LD.router.go('vocab'); }")
    page.wait_for_timeout(200)
    assert not page.evaluate("() => speechSynthesis.speaking"), \
        "切路由后系统语音仍在发声（全局收口缺失）"


def test_route_switch_pauses_audio_element(page):
    """<audio> 元素播放中途切路由 → 全部 pause"""
    page.evaluate("""() => {
      const a1 = new Audio();
      const a2 = new Audio();
      window.LD.UI.registerAudio(a1);
      window.LD.UI.registerAudio(a2);
      window.__paused = 0;
      [a1, a2].forEach(a => { a.pause = () => { window.__paused++; }; });
      window.LD.router.go('vocab');
    }""")
    page.wait_for_timeout(250)
    paused = page.evaluate("() => window.__paused")
    assert paused == 2, "切路由应 pause 全部已注册音频（实际 %d）" % paused


def test_new_audio_stops_previous_globally(page):
    """新播放先停旧音（全局注册表，而非各模块局部引用）"""
    n = page.evaluate("""() => {
      if (!(window.LD.UI && window.LD.UI.pauseAllAudio)) return -1;
      const a = new Audio();
      window.LD.UI.registerAudio(a);
      a.pause = () => { window.__oldPaused = true; };
      window.LD.UI.pauseAllAudio();
      return window.__oldPaused ? 1 : 0;
    }""")
    assert n == 1, "pauseAllAudio 应能停到任意模块注册的音频"
