/* 模块 4 · 口语测评：跟读录音 → Whisper/SpeechRecognition 转写 → 重音·语调·流利度三维评分 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;

  const LINES = [
    { de: "Guten Tag, ich möchte mich kurz vorstellen.", zh: "您好，我想简短地介绍一下自己。", lv: "A2", tag: "面试开场" },
    { de: "Ich studiere Maschinenbau an der Universität Shanghai.", zh: "我在上海大学读机械制造专业。", lv: "A2", tag: "自我介绍" },
    { de: "Ich habe mich für Deutschland entschieden, weil die Ausbildung sehr praxisnah ist.", zh: "我选择德国，因为其培养模式非常贴近实践。", lv: "B1", tag: "动机陈述" },
    { de: "Obwohl das Studium schwer ist, bleibe ich motiviert.", zh: "尽管学业很难，我依然保持动力。", lv: "B1", tag: "从句语序" },
    { de: "Könnten Sie mir bitte erklären, wie die Immatrikulation funktioniert?", zh: "您能给我讲讲注册入学怎么办理吗？", lv: "B1", tag: "行政办理" },
    { de: "Die Warmmiete beträgt 620 Euro, inklusive Heizung und Wasser.", zh: "暖租620欧，含暖气和水费。", lv: "B1", tag: "租房" },
    { de: "Meiner Meinung nach ist Wasserstoff eine Schlüsseltechnologie.", zh: "我认为氢能是一项关键技术。", lv: "B1", tag: "观点表达" },
    { de: "Ich hätte gern ein Glas Wasser, bitte.", zh: "我想要一杯水，谢谢。", lv: "A1", tag: "日常点单" },
    { de: "Entschuldigung, wo finde ich den Hörsaal B?", zh: "打扰一下，请问 B 阶梯教室在哪里？", lv: "A2", tag: "校园问路" },
    { de: "Ich habe zwei Jahre Deutsch gelernt und übe jeden Tag.", zh: "我学德语两年了，每天都练习。", lv: "A2", tag: "语言背景" }
  ];

  let cur = LINES[0], rec = null, mrec = null, localRec = null, recording = false, startTime = 0, pauses = 0, custom = false;

  /* 句池 = 精选 10 句 + 词库例句派生（4–14 词，带等级标签）：
     跟读素材从 10 句扩到数百句，离线零成本（3.5.0-a 内容扩容，见 docs/content-scaling-plan.md） */
  const POOL = LINES.concat((window.LD_LEX || [])
    .filter(x => x[5] && x[5].split(" ").length >= 4 && x[5].split(" ").length <= 14)
    .map(x => ({ de: x[5], zh: x[6] || "", lv: x[4], tag: "词库例句·" + x[4] })));

  /* 全量句池：基础池 + 已导入内容包（Tatoeba 实句，标记是否带实人录音）——每次进入模块时重建 */
  function pool() {
    const pack = (window.LD.Store.s.contentPack || {}).speech || [];
    return pack
      .filter(i => i.de && i.de.split(" ").length >= 3 && i.de.split(" ").length <= 16)
      .map(i => {
        const remote = i.audioUrl || (i.hasAudio && i.audioLicense && !/NC/i.test(i.audioLicense)
          ? `https://audio.tatoeba.org/sentences/deu/${encodeURIComponent(i.id)}.mp3` : "");
        return {
          de: i.de, zh: i.audioBy ? `录音贡献者：${i.audioBy} · ${i.audioLicense || ""}` : "", lv: "Tatoeba",
          audioData: i.audioB64 ? "data:audio/mpeg;base64," + i.audioB64 : "",
          audioFile: i.audioFile || "", audioUrl: remote,
          audioBy: i.audioBy || "", audioLicense: i.audioLicense || "",
          tag: "Tatoeba" + (i.hasAudio ? (i.audioB64 || i.audioFile ? " · 实人录音（本地）" : " · 实人录音") : "")
        };
      })
      .concat(POOL);
  }

  /* 示范音通道（按优先级）：本地真人录音（单文件内联 / dist/audio）→ 在线真人录音 → 后端 TTS */
  function sources(cur) {
    const http = /^https?:$/.test(location.protocol);
    const out = [];
    if (cur.audioData) out.push({ url: cur.audioData, from: "真人录音 · 已打进单文件" });
    if (http && cur.audioFile) out.push({ url: cur.audioFile, from: "真人录音 · 本机文件" });
    if (http && cur.audioUrl) out.push({ url: cur.audioUrl, from: "真人录音 · Tatoeba 在线" });
    if (http && window.LD.Backend && window.LD.Backend.ready()) {
      return window.LD.Backend.tts(cur.de).then(u => (u ? out.concat({ url: u, from: "后端 TTS 合成" }) : out));
    }
    return Promise.resolve(out);
  }

  function playUrl(url) {
  return new Promise(res => {
      const a = new Audio(url);
      if (window.LD.UI && window.LD.UI.registerAudio) window.LD.UI.registerAudio(a);
      const end = v => { if (window.LD.UI && window.LD.UI.unregisterAudio) window.LD.UI.unregisterAudio(a); res(v); };
      a.onerror = () => end(false);
      a.play().then(() => end(true)).catch(() => end(false));
    });
  }

  const Mod = {
    title: "口语测评",
    desc: "跟读录音 → 语音转写 → 重音/语调/流利度三维评分报告（辅助参考分）",
    render(host, ctx) {
      window.LD.Store.visit("speech");
      const speechRun = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("speech") : null;
      const lastDe = speechRun && speechRun.data && speechRun.data.speech && speechRun.data.speech.last;
      if (lastDe) {
        const at = pool().findIndex(x => x.de === lastDe);
        if (at >= 0) cur = pool()[at];
      }
      const browserAsr = !!(window.SpeechRecognition || window.webkitSpeechRecognition) && /^https?:$/.test(location.protocol);
      const asrReady = !!(window.LD.ASR && LD.ASR.canRecord());
      const localCapture = !!(window.LD.ASR && LD.ASR.canCapture && LD.ASR.canCapture());
      const hs = (window.LD.Backend && LD.Backend.healthState) ? LD.Backend.healthState() : "off";
      const mode = hs === "unknown" ? "checking" : asrReady ? "auto" : browserAsr ? "browser" : localCapture ? "record" : "manual";
      const modeText = {
        checking: "正在检测后端通道…（若后端已部署，几秒后这里会变成「就绪」）",
        auto: "华为云/后端 Whisper 转写已就绪：录音 → 转写 → 内容分 + 音素近似发音分。",
        browser: "浏览器语音识别：识别文本后评分；识别依赖云端时断网会失效。",
        record: "当前环境只能本地录音回放：请先录音回听，再手动转写文本评分；不声称自动评估发音。",
        manual: "当前环境无法录音：只能手动输入文本，评分为内容分，不评你的实际发音。"
      }[mode];
      if (mode === "checking" && window.LD.Backend && LD.Backend.probeHealth) {
        LD.Backend.probeHealth(1800).then(() => ctx.go("speech")).catch(() => ctx.go("speech"));
      }
      host.innerHTML = `
        <div class="page-head"><h1>口语测评</h1>
          <p>跟读录音 → 转写 → 内容分与发音分分开报告；所有分数均为辅助参考，不代表官方水平认定。</p></div>
        ${window.LD.FirstWeek ? window.LD.FirstWeek.notice(window.LD.FirstWeek.contextFor("speech")) : ""}
        <div class="card card-pad" style="margin-bottom:14px;border-color:${mode === "auto" || mode === "browser" ? "var(--brand)" : mode === "checking" ? "var(--line)" : "var(--accent)"};background:${mode === "auto" || mode === "browser" ? "var(--brand-soft)" : mode === "checking" ? "var(--panel-2)" : "var(--warn-soft)"}">
          <div style="font-size:13px;line-height:1.75">${mode === "auto" || mode === "browser" ? window.LD.icon("mic") : mode === "checking" ? "…" : "⚠"} ${modeText}</div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 320px">
          <div class="card card-pad">
            <div class="iv-q">
      <div class="de" id="refLine">${cur.de}</div>
              <div class="zh" id="refZh">${cur.zh}</div>
              <div style="margin-top:10px" class="btn-row">
                <span class="tag tag-blue" id="refTag">${cur.tag}</span><span class="tag" id="refLv">${cur.lv}</span>
                <button class="btn btn-sm" id="sayRef">${window.LD.icon("volume")} 听原句</button>
                <button class="btn btn-sm" id="randBtn">换一句</button>
                <span class="ref-src" id="refSrc"></span>
              </div>
            </div>
            <div style="text-align:center;margin:22px 0 6px">
              <button class="mic-btn" id="micBtn">${window.LD.icon("mic")}</button>
              <div style="margin-top:10px;color:var(--text-3);font-size:12.5px" id="micHint">${mode === "record" ? "点击录音，回听后再手动转写" : mode === "manual" ? "此环境无法录音，请使用下方手动通道" : "点击开始跟读（最多 20 秒）"}</div>
            </div>
            <div class="transcript" id="trans"><div class="ph">识别结果会显示在这里……</div></div>
            <div id="manualWrap" style="margin-top:10px">
              <div class="hint" style="margin-bottom:6px">手动通道：把你说的话转写成文本再评分。手动输入只评内容，不评发音。</div>
              <textarea id="manual" placeholder="粘贴或手动输入你的朗读文本，然后点击下方按钮评分"></textarea>
              <button class="btn btn-primary btn-sm" id="useManual" style="margin-top:8px">用此文本评分（仅内容分）</button>
            </div>
            <div id="detail"></div>
          </div>
          <div>
            <div class="card card-pad" style="margin-bottom:12px">
              <h2 style="margin:0 0 8px;font-size:13.5px">练习句单（共 ${pool().length} 句 · 精选 + 词库例句 + 内容包）</h2>
              <div id="lineList" style="max-height:330px;overflow:auto"></div>
            </div>
            <div class="card card-pad">
              <h2 style="margin:0 0 8px;font-size:13.5px">评分维度说明</h2>
              <div style="font-size:12.5px;line-height:1.9;color:var(--text-2)">
                <div><b>内容分</b>：识别文本与原文的词错率（WER）+ 流利度</div>
                <div><b>发音分</b>：转写文本 → 规则式音素序列对比（近似，不是声学模型）</div>
                <div><b>置信度</b>：随通道变化；手动输入没有声学证据，不评发音</div>
                <div><b>音素诊断</b>：指出可能错读的音素，供跟读定位</div>
                <div class="hint" style="margin-top:8px">本评分为辅助参考值，不代表专业语言水平认定。</div>
              </div>
            </div>
          </div>
        </div>`;

      LD.UI.moduleTabs(host, [{ route: "speech", label: "口语测评" }, { route: "phonetics", label: "发音专项", note: "最小对立对" }], "speech");
      const linesEl = host.querySelector("#lineList");
      const shown = pool().slice(0, 160);
      linesEl.innerHTML = shown.map((l, i) => `
        <div class="list-item" data-i="${i}" style="padding:9px 4px;cursor:pointer">
          <div class="main"><div class="t1" style="font-size:12.5px">${l.de}</div><div class="t2">${l.zh}</div></div>
        </div>`).join("");
      [...linesEl.children].forEach(c => c.onclick = () => select(+c.dataset.i, host));

      host.querySelector("#sayRef").onclick = async () => {
        const note = host.querySelector("#refSrc");
        const list = await sources(cur);
        for (const s of list) {
          if (await playUrl(s.url)) { if (note) note.textContent = s.from; return; }
        }
        if (note) note.textContent = cur.audioData || cur.audioUrl ? "浏览器语音合成（真人录音此刻不可用）" : "浏览器语音合成（此句无真人录音）";
        window.LD.SpeechUtil.say(cur.de);
      };
      host.querySelector("#randBtn").onclick = () => select(Math.floor(Math.random() * pool().length), host);
      host.querySelector("#micBtn").onclick = () => {
        if (mode === "manual") {
          host.querySelector("#manualWrap").style.display = "block";
          toast("当前环境无法录音，请使用手动文本通道", "err");
          return;
        }
        toggle(host);
      };
      host.querySelector("#useManual").onclick = () => {
        const t = host.querySelector("#manual").value.trim();
        if (t) scoreIt(host, t, 8000, 2, "manual");
      };
      if (mode === "record" || mode === "manual") host.querySelector("#manualWrap").style.display = "block";
    }
  };

  function select(i, host) {
    cur = pool()[i];
    host.querySelector("#refLine").textContent = cur.de;
    host.querySelector("#refZh").textContent = cur.zh;
    host.querySelector("#refTag").textContent = cur.tag;
    host.querySelector("#refLv").textContent = cur.lv;
    host.querySelector("#refSrc").textContent = "";
    host.querySelector("#detail").innerHTML = "";
    host.querySelector("#trans").innerHTML = `<div class="ph">识别结果会显示在这里……</div>`;
  }

  /* 录音通道分派：① 后端 Whisper ② http(s) 浏览器识别 ③ 本地录音回放 ④ 手动录入
     file:// 下不假装浏览器识别可用（它通常依赖云端）。 */
  function toggle(host) {
    if (window.LD.ASR && LD.ASR.canRecord()) return toggleWhisper(host);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && /^https?:$/.test(location.protocol)) return toggleBrowser(host);
    if (window.LD.ASR && LD.ASR.canCapture && LD.ASR.canCapture()) return toggleLocalCapture(host);
    host.querySelector("#manualWrap").style.display = "block";
    toast("当前环境无法录音，请使用手动文本通道", "err");
  }

  function toggleLocalCapture(host) {
    if (recording && localRec) {
      const h = localRec; localRec = null;
      host.querySelector("#micHint").textContent = "正在整理录音……";
      window.LD.ASR.stopCapture(h).then(blob => {
        const url = URL.createObjectURL(blob);
        const player = `<audio controls style="width:100%;margin-top:8px" src="${url}"></audio>`;
        host.querySelector("#trans").innerHTML = `<div class="hint">本地录音已完成。播放后可在下方手动填写识别文本进行评分。</div>${player}`;
        host.querySelector("#manualWrap").style.display = "block";
      }).catch(e => {
        toast("录音处理失败：" + e.message, "err");
        host.querySelector("#manualWrap").style.display = "block";
      }).finally(() => {
        stopUI(host);
        const hint = host.querySelector("#micHint");
        if (hint) hint.textContent = "本地录音可回放；连接华为云/后端 Whisper 可自动转写。";
      });
      return;
    }
    window.LD.ASR.createRecorder().then(h => {
      localRec = h; recording = true; startTime = Date.now(); h.rec.start();
      const b = host.querySelector("#micBtn"); b.classList.add("recording"); b.textContent = "■";
      host.querySelector("#micHint").textContent = "正在本地录音（不会上传）；再次点击结束并回放。";
      setTimeout(() => { if (recording && localRec === h) toggleLocalCapture(host); }, 20000);
    }).catch(e => {
      toast("无法访问麦克风：" + e.message, "err");
      host.querySelector("#manualWrap").style.display = "block";
    });
  }

  /* ① 后端 Whisper：录音 → 上传转写 → 三维评分（需 http(s) 且配置后端地址） */
  function toggleWhisper(host) {
    if (recording && mrec) return stopWhisper(host);
    window.LD.ASR.createRecorder().then(h => {
      mrec = h;
      recording = true;
      startTime = Date.now();
      h.rec.start();
      const b = host.querySelector("#micBtn");
      b.classList.add("recording");
      b.textContent = "■";
      host.querySelector("#micHint").textContent = "正在录音（后端 Whisper 转写）……再次点击结束";
      setTimeout(() => { if (recording && mrec) stopWhisper(host); }, 20000);
    }).catch(e => {
      toast("无法访问麦克风：" + e.message, "err");
      host.querySelector("#manualWrap").style.display = "block";
    });
  }

  function stopWhisper(host) {
    if (!mrec) return;
    const h = mrec;
    mrec = null;
    host.querySelector("#micHint").textContent = "正在转写……";
    window.LD.ASR.stopAndTranscribe(h)
      .then(r => { stopUI(host); useText(host, r.text, Date.now() - startTime, 2, "whisper"); })
      .catch(e => {
        stopUI(host);
        toast("转写失败：" + e.message, "err");
        host.querySelector("#manualWrap").style.display = "block";
      });
  }

  /* 统一出口：把识别文本交给评分 */
  function useText(host, text, ms, pauseN, channel) {
    const t = (text || "").trim();
    if (!t) { toast("未识别到有效文本，本次不计分", "err"); return; }
    host.querySelector("#trans").innerHTML = `<div>${t}</div>`;
    scoreIt(host, t, ms, pauseN, channel || "unknown");
  }

  /* ② 浏览器 SpeechRecognition */
  function toggleBrowser(host) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("浏览器不支持语音识别，请手动录入文本", "err"); host.querySelector("#manualWrap").style.display = "block"; return; }
    if (recording && rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = "de-DE"; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
    let finalTxt = ""; pauses = 0; startTime = Date.now();
    rec.onresult = ev => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) { finalTxt += t + " "; pauses++; } else interim += t;
      }
      host.querySelector("#trans").innerHTML = `<div>${finalTxt}<span style="color:var(--text-3)">${interim}</span></div>`;
    };
    rec.onerror = ev => { stopUI(host); toast("识别失败：" + ev.error, "err"); host.querySelector("#manualWrap").style.display = "block"; };
    rec.onend = () => { stopUI(host); const txt = finalTxt.trim(); if (txt) scoreIt(host, txt, Date.now() - startTime, pauses, "browser"); else toast("未识别到有效文本，本次不计分", "err"); };
    try {
      rec.start();
      recording = true;
      const b = host.querySelector("#micBtn"); b.classList.add("recording"); b.textContent = "■";
      host.querySelector("#micHint").textContent = "正在聆听……再次点击结束";
      setTimeout(() => { if (recording && rec) { try { rec.stop(); } catch (e) { } } }, 20000);
    } catch (e) { toast("无法启动麦克风：" + e.message, "err"); }
  }

  function stopUI(host) {
    recording = false;
    const b = host.querySelector("#micBtn");
    if (b) { b.classList.remove("recording"); b.innerHTML = window.LD.icon("mic"); }
    const h = host.querySelector("#micHint");
    if (h) h.textContent = "点击开始跟读（最多 20 秒）";
  }

  function scoreIt(host, hyp, ms, pauseN, channel) {
    const res = E().scoreSpeech(cur.de, hyp, { ms, pauses: pauseN, channel: channel || "unknown" });
    if (!res) { toast("未能识别到有效文本，本次不计分", "err"); return; }
    if (res.accuracy < 10 && res.coverage < 15) {
      host.querySelector("#detail").innerHTML = `
        <div class="card card-pad" style="margin-top:14px;border-color:var(--warn);background:var(--warn-soft)">
          <b>未识别到与原文匹配的内容，本次不计分</b>
          <div class="hint" style="margin:6px 0 0">识别文本：${hyp}</div>
          <div class="hint" style="margin:4px 0 0">可以换个安静环境重录，或把你说的话手动转写后再评（手动只评内容）。</div>
        </div>`;
      toast("识别内容与原文不匹配，本次不计分", "err");
      return;
    }
    if (channel !== "manual") S().ability.speaking = Math.round((S().ability.speaking * 3 + res.total) / 4);
    const taskCtx = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("speech") : null;
    const taskTarget = taskCtx ? window.LD.FirstWeek.target(taskCtx) : 0;
    const speechData = (taskCtx && taskCtx.data && taskCtx.data.speech) || {};
    const scored = new Set(Array.isArray(speechData.scored) ? speechData.scored : []);
    const isNewSentence = !!(taskCtx && !scored.has(cur.de));
    if (isNewSentence) scored.add(cur.de);
    let taskProgress = taskCtx ? (+taskCtx.progress || 0) : 0;
    if (taskCtx && window.LD.FirstWeek) {
      if (isNewSentence) taskProgress = scored.size;
      window.LD.FirstWeek.update(taskCtx, {
        progress: taskProgress,
        data: Object.assign({}, taskCtx.data || {}, { speech: { scored: Array.from(scored), last: cur.de } })
      });
      window.LD.FirstWeek.evidence(taskCtx, channel === "manual" ? "内容评分（无声学证据）" : "跟读评分");
    }
    window.LD.Store.logAnswer({ type: "speech", ability: "speaking", ok: res.total >= 70, ms, item: cur.de, skill: "speak:" + cur.de, manual: channel === "manual" });
    S().speeches.unshift({ t: Date.now(), ref: cur.de, hyp, ...res });
    window.LD.Store.addSession({ module: "speech", ms, count: 1 });
    if (res.total < 70) {
      window.LD.Store.addWrong({
        module: "口语测评", type: "speech", wrong: hyp, right: cur.de, source: cur.zh,
        why: `口语评分 ${res.total} 分（${res.grade}）：${res.advice[0]}`
      });
    }
    window.LD.Store.save();
    const reached = !!(taskCtx && taskProgress >= taskTarget);
    const taskTop = taskCtx
      ? (reached
        ? window.LD.FirstWeek.receipt(taskCtx, {
          summary: `口语本轮完成 ${taskTarget} 句`,
          detail: `已评 ${taskProgress} 句 · ${channel === "manual" ? "手动词本，仅内容参考" : "含发音近似评分"}`,
          evidence: channel === "manual" ? "内容评分（无声学证据）" : "跟读评分",
          source: "speech-round",
          label: "完成口语任务"
        })
        : `<div class="fw-receipt fw-receipt-embedded">
            <div class="fw-receipt-head"><span class="tag tag-blue">今日计划进度</span><b>${taskProgress} / ${taskTarget} 句</b></div>
            <div class="fw-receipt-meta">${isNewSentence ? "本句已计入进度。" : "本句之前已计过，换一句才增加进度。"}${channel === "manual" ? " 手动输入只作内容参考，不含声学证据。" : ""}</div>
            <div class="btn-row fw-receipt-actions"><button type="button" class="btn btn-primary" id="spNext">再练一句（${taskProgress}/${taskTarget}）</button><button type="button" class="btn" data-fw-return>暂时离开，稍后继续</button></div>
          </div>`)
      : "";
    host.querySelector("#detail").innerHTML = `
      <div class="card" style="margin-top:14px;background:var(--panel-2)">
        <div class="card-pad">
          <div class="hint" style="margin:0 0 8px">辅助参考分：识别文本比对 + 流利度/填充词语义启发式，非官方判分；发音分为规则式音素近似，非声学模型。</div>
          ${taskTop}
          <div class="score-ring">
            <div id="spRing"></div>
            <div><div style="font-weight:600;font-size:16px">${res.total} 分 · ${res.channel === "manual" ? "内容参考分" : res.grade}</div>
              <div style="font-size:12.5px;color:var(--text-3)">语速约 ${res.wpm} 词/分钟（${res.wpmTag || "—"}） · 填充词 ${res.fillers != null ? res.fillers : 0} 个 · 用时 ${(ms / 1000).toFixed(1)} 秒</div>
              <div style="margin-top:6px"><span class="tag ${res.confidence.startsWith("高") ? "tag-ok" : res.confidence.startsWith("低") ? "tag-warn" : ""}">置信度：${res.confidence}</span></div></div>
          </div>
          <div class="grid g2" style="margin-top:14px">
            <div class="card card-pad" style="background:var(--panel-2)">
              <div class="hint" style="margin:0">内容分 · WER</div>
              <div style="font-size:26px;font-weight:700;color:var(--brand);line-height:1.3">${res.contentScore}</div>
              <div class="hint" style="margin:2px 0 0">${res.channel === "manual" ? "手动文本：只评内容" : "识别文本与原文的匹配 + 流利度"}</div>
            </div>
            <div class="card card-pad" style="background:var(--panel-2)">
              <div class="hint" style="margin:0">发音分 · 音素近似</div>
              <div style="font-size:26px;font-weight:700;color:${res.pronScore == null ? "var(--text-3)" : "var(--brand)"};line-height:1.3">${res.pronScore == null ? "—" : res.pronScore}</div>
              <div class="hint" style="margin:2px 0 0">${res.pronScore == null ? "手动输入没有声学证据，不评发音" : "规则式音素对比，非声学模型"}</div>
            </div>
          </div>
          <div class="dims" style="margin-top:12px">
            ${dimRows(res)}
          </div>
          <div class="hint">重音与语调由文本启发式估计，仅作参考；真正的发音评估需要声学模型。</div>
          <div class="divider"><span>改进建议</span></div>
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.9;color:var(--text-2)">
            ${res.advice.map(a => `<li>${a}</li>`).join("")}
          </ul>
          ${res.phonemes ? `<div id="phonBox">${phonBlock(res.phonemes)}</div>` : ""}
        </div>
      </div>`;
    window.LD.Charts.ring(host.querySelector("#spRing"), res.total, { size: 72, color: res.total >= 70 ? "var(--ok)" : "var(--accent)" });
    const receiptBox = host.querySelector(".fw-receipt");
    if (receiptBox) receiptBox.scrollIntoView({ behavior: "smooth", block: "start" });
    const spNext = host.querySelector("#spNext");
    if (spNext) spNext.onclick = () => {
      const list = pool();
      if (list.length < 2) return;
      let n = Math.floor(Math.random() * list.length);
      let guard = 0;
      while (list[n].de === cur.de && guard++ < 8) n = Math.floor(Math.random() * list.length);
      select(n, host);
    };
    /* 后端可选通道（3.7.0）：已配后端且音素通道为 acoustic 时，用服务端声学评估替换诊断块；
       未配后端 / 服务端回落规则 / 请求失败 —— 一律静默，保持本地规则结果（离线能力不受影响） */
    if (res.phonemes && window.LD.Backend && LD.Backend.ready() && LD.Backend.contentAutoLoad && LD.Backend.contentAutoLoad() && LD.Backend.phonemeAssess) {
      LD.Backend.phonemeAssess(cur.de, hyp).then(sv => {
        if (!sv || !sv.sounds || sv.channel !== "acoustic") return;
        const box = host.querySelector("#phonBox");
        if (box) box.innerHTML = phonBlock({
          per: sv.per != null ? sv.per : res.phonemes.per,
          nRef: sv.nRef != null ? sv.nRef : res.phonemes.nRef,
          nErr: sv.nErr != null ? sv.nErr : res.phonemes.nErr,
          sounds: sv.sounds, advice: sv.advice || res.phonemes.advice
        });
      }).catch(() => { });
    }
  }

  const dimRows = r => [
    ["准确度", r.accuracy], ["流利度", r.fluency], ["重音", r.stress], ["语调", r.intonation]
  ].map(([n, v]) => `<div class="dim-row"><div class="n">${n}</div>
      <div class="dim-bar"><i style="width:${v}%"></i></div><div class="s">${v}</div></div>`).join("");

  /* 音素级诊断块（3.6.0）：把「文本比对」落成「哪个音发错」
     参考 GOP（音素级发音评估）与 Phoneme Party 的「音素比对 + PER + 编辑距离」可视化 */
  const phonBlock = p => {
    const chip = s => {
      const c = s.st === "ok" ? "var(--ok)" : s.st === "warn" ? "var(--warn)" : "var(--danger)";
      const bg = s.st === "ok" ? "var(--ok-soft)" : s.st === "warn" ? "rgba(240,160,32,.15)" : "var(--danger-soft)";
      return `<span title="${s.t || "∅"} → ${s.a || "∅"}" style="display:inline-block;min-width:20px;text-align:center;padding:2px 6px;margin:2px;border-radius:6px;font-size:13px;background:${bg};color:${c}">${s.t || "·"}</span>`;
    };
    return `
      <div class="divider"><span>音素诊断 · 音素错误率 PER ${p.per}%</span></div>
      <div class="hint" style="margin-bottom:8px">参考音素 ${p.nRef} 个 · 错读 ${p.nErr} 处 · 绿=一致 / 黄=易混音 / 红=不一致（规则式 G2P + 音素序列对齐估算，辅助参考）</div>
      <div style="line-height:1.4">${p.sounds.map(chip).join("")}</div>
      <ul style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.9;color:var(--text-2)">
        ${p.advice.map(a => `<li>${a}</li>`).join("")}
      </ul>`;
  };

  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "口语测评", icon: "◔", group: "学习闭环", priority: "P0", order: 5, ds: "跟读录音，重音/语调/流利度三维评分报告" });
  window.LD.define("speech", Mod);
  /* 跟读句库导出：供「全真模考」口语节复用 */
  window.LD_SPEECH_BANK = LINES;
  window.LD_SPEECH_POOL = POOL;   // 基础句池（精选+派生），供测试与模考复用
  window.LD.SpeechPool = pool;      // 全量句池（含已导入内容包），每次进入模块重建
})();
