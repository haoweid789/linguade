/* 模块 10 · 听力训练：授权实人录音优先、TTS 兜底 → 听音选义 / 听写 / 句子复述 / 影子跟读
   补齐多模态中的听觉通道（竞品 Duolingo/Babbel 的强项，本产品此前缺失）。
   无需音频素材：由浏览器 de-DE 语音合成实时生成，可离线运行。
   影子跟读（Shadowing）：借鉴口译训练法与每日德语听力「跟读打分」，
   分级训练：A1–A2 暂停复述 → B1 滞后跟读 → B2 整段同步跟读。 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;

  /* 短对话句库（含关键词，用于挖空与干扰项） */
  const DIALOG = [
    { de: "Guten Tag, ich möchte ein Zimmer reservieren.", zh: "您好，我想预订一个房间。", key: "Zimmer" },
    { de: "Der Zug fährt um acht Uhr vierzig ab.", zh: "列车八点四十分发车。", key: "Zug" },
    { de: "Könnten Sie mir bitte das Formular erklären?", zh: "您能给我解释一下这张表格吗？", key: "Formular" },
    { de: "Die Bibliothek ist bis zweiundzwanzig Uhr geöffnet.", zh: "图书馆开放到二十二点。", key: "Bibliothek" },
    { de: "Ich brauche eine Bescheinigung für die Krankenkasse.", zh: "我需要一份给医保的证明。", key: "Bescheinigung" },
    { de: "Haben Sie einen Termin im Bürgeramt?", zh: "您在市民局约到号了吗？", key: "Termin" },
    { de: "Die Miete ist immer am dritten des Monats fällig.", zh: "房租每月三号到期。", key: "Miete" },
    { de: "Mein Zug hat zwanzig Minuten Verspätung.", zh: "我的列车晚点二十分钟。", key: "Verspätung" },
    { de: "Ich hätte gern ein Glas Mineralwasser.", zh: "我想要一杯矿泉水。", key: "Mineralwasser" },
    { de: "Wo finde ich den Hörsaal für die Vorlesung?", zh: "大课的阶梯教室在哪里？", key: "Hörsaal" }
  ];

  const MODES = {
    /* B3 注册表 id：choice→listen_choice / dictation→listen_gap / diktat→listen_full
       dialog→listen_dialog / repeat→speak_repeat / shadow→speak_shadow（LD.Exercise） */
    choice: { nm: "听音选义", ic: "headphones", desc: "听德语句子，选出中文含义" },
    dictation: { nm: "听写填空", ic: "✎", desc: "听句子，补写被挖去的关键词" },
    diktat: { nm: "整句听写", ic: "▭", desc: "听完整句子并键入全文，逐词标色对比 —— TestDaF 听力第三题同款" },
    dialog: { nm: "双人对话", ic: "people", desc: "A/B 两个角色轮流发声（优先使用两个不同的德语语音包），听完整段对话后作答 —— 更接近考试真实听感" },
    repeat: { nm: "句子复述", ic: "◔", desc: "听后复述，系统按准确度评分" },
    shadow: { nm: "影子跟读", ic: "repeat", desc: "滞后原声半拍到一拍做同步复述，训练韵律与肌肉记忆" }
  };

  /* 双人对话题库：轮流用两个音色（或同一音色双音高）播放，训练对话听解 */
  const DIALOGUES = [
    {
      id: "d-sw", lv: "B1", scene: "大学生服务中心办手续",
      turns: [
        { s: "A", de: "Guten Morgen, was kann ich für Sie tun?", zh: "早上好，我能为您做什么？" },
        { s: "B", de: "Ich möchte mich für das Semester rückmelden. Brauche ich dafür einen Termin?", zh: "我想办理本学期注册。需要预约吗？" },
        { s: "A", de: "Nein, das geht direkt hier. Sie brauchen nur Ihren Studierendenausweis und den Überweisungsbeleg.", zh: "不用，这里直接办。您只需要学生证和转账凭证。" },
        { s: "B", de: "Den Beleg habe ich digitally dabei. Genügt das?", zh: "凭证我带了电子版。够吗？" },
        { s: "A", de: "Ja, zeigen Sie ihn mir einfach auf dem Handy. Dann drucke ich die Bestätigung aus.", zh: "够，手机上给我看一下就行。然后我把确认书打印出来。" }
      ],
      q: "学生最后拿到了什么？", opts: ["一份打印出来的注册确认", "一个新的学生证", "一个预约号", "一张转账单"], a: 0,
      why: "最后一句：Dann drucke ich die Bestätigung aus（我把确认书打印出来）。"
    },
    {
      id: "d-wohnung", lv: "B1", scene: "看房对话",
      turns: [
        { s: "A", de: "Hier ist das Zimmer. Es ist zwölf Quadratmeter groß und geht zum Hinterhof.", zh: "这就是房间。十二平米，朝后院。" },
        { s: "B", de: "Ist die Miete warm oder kalt?", zh: "房租是暖租还是冷租？" },
        { s: "A", de: "Die Warmmiete beträgt 430 Euro, Strom kommt noch dazu, etwa 30 Euro.", zh: "暖租 430 欧，电费另算，大约 30 欧。" },
        { s: "B", de: "Und die Kaution?", zh: "那押金呢？" },
        { s: "A", de: "Zwei Monatsmieten. Sie können ab dem ersten nächsten Monat einziehen.", zh: "两个月房租。您下月一号就可以搬进来。" }
      ],
      q: "关于费用，哪一项是对的？", opts: ["暖租 430 欧 + 约 30 欧电费另算", "全部包含在 430 欧里", "押金是三个月房租", "电费包含在暖租里"], a: 0,
      why: "第三句明确：Warmmiete 430 Euro, Strom kommt noch dazu, etwa 30 Euro。"
    },
    {
      id: "d-vl", lv: "B2", scene: "课后向教授提问",
      turns: [
        { s: "A", de: "Herr Professor, ich habe eine Frage zur gestrigen Vorlesung. Sie haben die Stichprobe kritisiert.", zh: "教授先生，我对昨天的课有个问题。您批评了那份抽样。" },
        { s: "B", de: "Genau. Die Stichprobe war zu klein, deshalb ist die Schlussfolgerung nicht belastbar.", zh: "正是。样本太小，所以结论不可靠。" },
        { s: "A", de: "Wie groß müsste sie denn sein?", zh: "那它应该多大？" },
        { s: "B", de: "Mindestens dreihundert Personen, sonst können wir keine signifikanten Unterschiede messen.", zh: "至少三百人，否则我们测不出显著差异。" }
      ],
      q: "教授认为样本至少要多大？", opts: ["三百人", "三十人", "三千人", "一百人"], a: 0,
      why: "最后一句：Mindestens dreihundert Personen。"
    },
    {
      id: "d-bahn", lv: "A2", scene: "火车站问询",
      turns: [
        { s: "A", de: "Entschuldigung, fährt der Zug nach Leipzig heute auch über Halle?", zh: "请问，今天去莱比锡的火车也经停哈勒吗？" },
        { s: "B", de: "Nein, der Zug fährt direkt. Der nächste mit Halt in Halle ist um vierzehn Uhr zwanzig.", zh: "不,这趟车直达。下一趟经停哈勒的是 14 点 20 分。" },
        { s: "A", de: "Und wo steige ich da ein?", zh: "那我在哪儿上车？" },
        { s: "B", de: "Gleis sieben. Bitte zehn Minuten vorher da sein.", zh: "7 号站台。请提前十分钟到。" }
      ],
      q: "去哈勒应该坐哪趟车？", opts: ["14:20 的车，7 号站台", "直达莱比锡的车", "14:20 的车，3 号站台", "现在这趟直达车"], a: 0,
      why: "直达车不经停哈勒；经停车是 14:20、Gleis sieben。"
    }
  ];

  /* 德语特殊字符快捷输入条（听写/写作时免去切换输入法） */
  const DE_CHARS = ["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü", "é", "è", "ç"];

  /* 影子跟读三级训练（参照 CEFR 与 shadowing 研究：起效区间在「能听懂八成」的材料上） */
  const SHADOW_LEVELS = {
    pause: { nm: "暂停复述", lv: "A1–A2", desc: "听一句、暂停、复述一句。先求准确，再求同步。" },
    lag: { nm: "滞后跟读", lv: "B1", desc: "落后原声两三个词做同步复述，训练即时听解与产出衔接。" },
    full: { nm: "整段跟读", lv: "B2", desc: "整段连续同步跟读，模仿语速、语调与节奏，跟丢就重新跟上。" }
  };

  let mode = "choice", stack = [], i = 0, rate = 0.9, right = 0, wrong = 0, cur = null, finished = false, recHandle = null, recStarted = 0, activeAudio = null, taskApplied = "", roundSaved = false;
  let remoteAudioAssets = [];
  let shadowLevel = "pause", showText = false;

  const hasZh = x => !!(x && x.zh && String(x.zh).trim());

  function corpus() {
    const fromLex = (window.LD_LEX || [])
      .filter(x => x[5] && x[5].length > 12 && x[5].split(" ").length >= 4)
      .map(x => ({ de: x[5], zh: x[6], key: x[0] }));
    const licensedAudio = (((window.LD.Store.s.contentPack || {}).speech) || [])
      .filter(x => x.hasAudio && x.audioLicense && !/NC/i.test(x.audioLicense))
      .map(x => ({ de: x.de, zh: "", key: x.de.split(/\s+/)[0], audioUrl: x.audioUrl || `https://audio.tatoeba.org/sentences/deu/${encodeURIComponent(x.id)}.mp3`, attribution: x.audioBy || "Tatoeba contributor", license: x.audioLicense }));
    return licensedAudio.concat(remoteAudioAssets, DIALOG, fromLex);
  }

  function playPrompt(item, speed) {
    if (activeAudio) { try { activeAudio.pause(); } catch (e) { /* 已停止 */ } activeAudio = null; }
    if (window.LD.UI && window.LD.UI.pauseAllAudio) window.LD.UI.pauseAllAudio();
    if (item && /^https?:$/.test(location.protocol)) {
      /* 三级回落：Tatoeba 实人录音 → 后端 TTS 合成 → 浏览器语音合成 */
      return Promise.resolve(item.audioUrl || window.LD.Backend.tts(item.de)).then(url => {
        if (!url) return window.LD.SpeechUtil.say(item.de, speed || 1);
        const audio = new Audio(url);
        if (window.LD.UI && window.LD.UI.registerAudio) window.LD.UI.registerAudio(audio);
        const stopToSpeech = () => { if (activeAudio === audio) activeAudio = null; window.LD.SpeechUtil.say(item.de, speed || 1); };
        audio.playbackRate = Math.max(0.5, Math.min(1.25, speed || 1));
        activeAudio = audio;
        audio.onerror = () => { if (activeAudio === audio) activeAudio = null; toast("在线发音暂时无法加载，改用系统语音合成。", "info"); stopToSpeech(); };
        audio.onended = () => { if (activeAudio === audio) activeAudio = null; };
        audio.play().catch(stopToSpeech);
      });
    }
    window.LD.SpeechUtil.say(item.de, speed || 1);
  }
  function audioNote(item) {
    const license = item && item.license ? String(item.license) : "开放许可";
    const licenseUrl = /CC BY 4(?:\.0)?/i.test(license) ? "https://creativecommons.org/licenses/by/4.0/"
      : /CC BY 2\.0 FR/i.test(license) ? "https://creativecommons.org/licenses/by/2.0/fr/"
      : /CC BY-SA 4(?:\.0)?/i.test(license) ? "https://creativecommons.org/licenses/by-sa/4.0/" : "";
    return item && item.audioUrl ? `<div class="hint" style="margin:6px 0 0">实人录音 · Tatoeba · ${licenseUrl ? `<a href="${licenseUrl}" target="_blank" rel="noopener noreferrer">${esc2(license)}</a>` : esc2(license)} · ${esc2(item.attribution || "贡献者署名见来源")}${item.sourceUrl ? ` · <a href="${esc2(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">原句与授权</a>` : ""}</div>` : "";
  }
  function recordAndScore(st, host, ctx, kind) {
    const grade = kind === "shadow" ? gradeShadow : gradeRepeat;
    if (recHandle) {
      const h = recHandle; recHandle = null;
      st.querySelector("#hint").textContent = "正在转写……";
      window.LD.ASR.stopAndTranscribe(h).then(r => {
        const text = String(r.text || "").trim();
        st.querySelector("#rec").classList.remove("recording");
        if (text) { st.querySelector("#rIn").value = text; grade(st, host, ctx, text, Date.now() - recStarted); }
        else toast("没有识别到语音，请重试或手动输入", "err");
      }).catch(e => { st.querySelector("#rec").classList.remove("recording"); toast("转写失败：" + e.message, "err"); });
      return;
    }
    if (window.LD.ASR && LD.ASR.canRecord()) {
      window.LD.ASR.createRecorder().then(h => {
        recHandle = h; recStarted = Date.now(); h.rec.start();
        st.querySelector("#rec").classList.add("recording");
        st.querySelector("#hint").textContent = "正在录音（Whisper 转写）；再次点击结束";
        setTimeout(() => { if (recHandle === h) recordAndScore(st, host, ctx, kind); }, 20000);
      }).catch(e => toast("无法访问麦克风：" + e.message, "err"));
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("当前浏览器没有内置语音识别。连接 Whisper 转写服务，或手动输入朗读文本。", "info"); st.querySelector("#rIn").focus(); return; }
    const rec = new SR(); rec.lang = "de-DE"; rec.continuous = kind === "shadow"; rec.interimResults = true;
    let acc = "", t0 = Date.now();
    rec.onresult = ev => { for (let k = ev.resultIndex; k < ev.results.length; k++) if (ev.results[k].isFinal) acc += ev.results[k][0].transcript + " "; st.querySelector("#rIn").value = acc.trim(); };
    rec.onend = () => { st.querySelector("#rec").classList.remove("recording"); if (acc.trim()) grade(st, host, ctx, acc.trim(), Date.now() - t0); };
    rec.onerror = e => toast("识别失败：" + e.error, "err");
    rec.start(); st.querySelector("#rec").classList.add("recording"); st.querySelector("#hint").textContent = "正在聆听……再次点击结束";
  }

  /* 德语语音包探测：getVoices 异步加载，已有则立即返回，否则等 voiceschanged（上限 1.2s） */
  function probeVoices() {
    return new Promise(resolve => {
      const SU = window.LD.SpeechUtil || {};
      const got = () => (SU.deVoices ? SU.deVoices() : []).length;
      if (!("speechSynthesis" in window)) return resolve(0);
      if (got() > 0) return resolve(got());
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(got()); } };
      speechSynthesis.addEventListener("voiceschanged", fin, { once: true });
      setTimeout(fin, 1200);
    });
  }

  /* 双音色分配：优先两个不同德语 voice；只有一个时用音高区分角色 */
  function pickSpeakers() {
    const SU = window.LD.SpeechUtil || {};
    const vs = SU.deVoices ? SU.deVoices() : [];
    if (vs.length >= 2) return { A: { voice: vs[0], pitch: 1 }, B: { voice: vs[1], pitch: 1 }, two: true };
    if (vs.length === 1) return { A: { voice: vs[0], pitch: 1.15 }, B: { voice: vs[0], pitch: 0.85 }, two: false };
    return { A: { pitch: 1.15 }, B: { pitch: 0.85 }, two: false };
  }

  /* 顺序播放一段对话：onend 链式衔接，逐句显示文稿 */
  function playDialogue(dlg, st, onDone) {
    const spk = pickSpeakers();
    const box = st.querySelector("#dlgTurns");
    let k = 0;
    const hint = st.querySelector("#dlgHint");
    const step = () => {
      if (k >= dlg.turns.length) { if (hint) hint.textContent = "播放完毕，请作答"; if (onDone) onDone(); return; }
      const t = dlg.turns[k];
      if (hint) hint.textContent = `播放中 ${k + 1} / ${dlg.turns.length} 句…`;
      window.LD.SpeechUtil.say(t.de, rate, Object.assign({
        onend: () => {
          if (box) {
            box.insertAdjacentHTML("beforeend",
              `<div class="wl-ctx" data-wctx="${window.LD.WordLink ? LD.WordLink.attr(t.de.slice(0, 120)) : ""}" style="padding:6px 0;border-bottom:1px solid var(--line-soft)"><b style="color:${t.s === "A" ? "var(--brand)" : "var(--accent)"}">${t.s}:</b> ${window.LD.WordLink ? LD.WordLink.linkHTML(t.de) : t.de}</div>`);
            if (window.LD.WordLink) LD.WordLink.bind(box, { mode: "popover", module: "听力训练" });
          }
          k++;
          setTimeout(step, 220);
        }
      }, spk[t.s]));
    };
    if (box) box.innerHTML = "";
    step();
  }

  const Mod = {
    title: "听力训练",
    desc: "授权实人录音优先、TTS 兜底；听音选义 / 听写 / 双人对话 / 复述 / 影子跟读六题型",
    render(host, ctx) {
      window.LD.Store.visit("listening");
      const taskCtx = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("listening") : null;
      const saved = taskCtx && taskCtx.data && taskCtx.data.listening;
      if (taskCtx && taskApplied !== taskCtx.taskId) {
        taskApplied = taskCtx.taskId;
        if (taskCtx.spec && taskCtx.spec.mode) mode = taskCtx.spec.mode;
        else if (/跟读/.test(taskCtx.text)) mode = "shadow";
        else if (/填空/.test(taskCtx.text)) mode = "dictation";
        else if (/听写/.test(taskCtx.text)) mode = "diktat";
        else if (/对话/.test(taskCtx.text)) mode = "dialog";
        else if (/复述/.test(taskCtx.text)) mode = "repeat";
      }
      if (saved && saved.mode && (!taskCtx || saved.mode === mode || !taskCtx.spec)) {
        mode = saved.mode;
        if (Array.isArray(saved.stack) && saved.stack.length) {
          stack = saved.stack;
          i = Math.max(0, Math.min(+saved.i || 0, stack.length));
          right = +saved.right || 0;
          wrong = +saved.wrong || 0;
          finished = !!saved.finished;
          roundSaved = !!saved.finished;
          shadowLevel = saved.shadowLevel || shadowLevel;
          showText = !!saved.showText;
        }
      } else {
        i = 0; right = 0; wrong = 0; finished = false; roundSaved = false;
      }
      const supported = "speechSynthesis" in window;
      const locked = !!taskCtx;
      host.innerHTML = `
        <div class="page-head"><h1>听力训练</h1>
          <p>优先使用已授权真人录音；其他练习由浏览器德语语音合成生成，可离线使用。${supported ? "" : " · <span class='tag tag-warn'>当前浏览器不支持语音合成</span>"}</p></div>
        ${window.LD.FirstWeek ? window.LD.FirstWeek.notice(taskCtx) : ""}
        <div class="hint" style="margin:-6px 0 14px">想听简明新闻？<a href="https://www.nachrichtenleicht.de/" target="_blank" rel="noopener noreferrer">前往 Nachrichtenleicht 官网收听</a>。网站音频在原站播放。</div>
        <div id="voiceWarn" style="display:none;margin-bottom:14px;padding:12px 14px;border-radius:10px;background:var(--danger-soft);border:1px solid var(--danger);font-size:13px;line-height:1.8">
          <b>⚠ 当前系统没有安装德语语音包 —— 本模块音频无法发声。</b><br>
          Windows：设置 → 时间和语言 → 语音 → 添加语音 → Deutsch（德语），装完刷新页面；
          或改用桌面版 Edge / Chrome（通常自带德语语音）。口语测评与单词发音同样依赖该语音包。
        </div>
        <div class="card card-pad" style="margin-bottom:14px">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--text-3)">题型</span>
            ${Object.keys(MODES).map(k => `<div class="scene-chip ${mode === k ? "active" : ""}${locked && k !== mode ? " locked" : ""}" data-m="${k}"${locked && k !== mode ? ' aria-disabled="true" title="任务模式已锁定，退出计划练习后可切换"' : ""}>${window.LD.icon(MODES[k].ic)} ${MODES[k].nm}</div>`).join("")}
            <span style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-3)">
              语速 <input type="range" id="rate" min="50" max="125" value="${Math.round(rate * 100)}" style="width:110px">
              <b id="rateVal">${rate.toFixed(2)}×</b>
            </span>
          </div>
          ${mode === "shadow" ? `
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">
            <span style="font-size:13px;color:var(--text-3)">训练级别</span>
            ${Object.keys(SHADOW_LEVELS).map(k => `<div class="scene-chip ${shadowLevel === k ? "active" : ""}" data-sl="${k}" title="${SHADOW_LEVELS[k].lv}">${SHADOW_LEVELS[k].nm} <span style="opacity:.6;font-size:12px">${SHADOW_LEVELS[k].lv}</span></div>`).join("")}
            <label style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-3);cursor:pointer">
              <input type="checkbox" id="showText" ${showText ? "checked" : ""}> 显示原文（进阶后建议关闭）
            </label>
          </div>
          <div class="hint">${SHADOW_LEVELS[shadowLevel].desc} ｜ 研究（Hamada 2017）：连续 8 周每天跟读 15–30 分钟，听力理解与发音均有显著提升。</div>` : ""}
        </div>
        <div class="grid" style="grid-template-columns:1fr 260px">
          <div class="card card-pad" id="stage"></div>
          <div class="card card-pad" style="align-self:flex-start">
            <h2 style="margin:0 0 10px;font-size:13.5px">${MODES[mode].nm}</h2>
            <div style="font-size:12.5px;line-height:1.9;color:var(--text-2)">${MODES[mode].desc}</div>
            <div class="divider"><span>本轮</span></div>
            <div id="board"></div>
            <div class="divider"><span>听力策略</span></div>
            <div style="font-size:12.5px;line-height:1.9;color:var(--text-2)">
              <div>· 第一遍抓<b>实词</b>（名词/动词），别纠结虚词</div>
              <div>· 第二遍抓<b>数字与时间</b></div>
              <div>· 听不清时把语速降到 0.65× 再听</div>
              <div>· 德语词重音多在第一个音节</div>
              ${mode === "shadow" ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)">· 跟读四步：<b>盲听 → 对照原文 → 跟读 → 录音对比</b></div>
              <div>· 材料难度标准：能听懂八成左右最合适</div>
              <div>· 每天 15 分钟胜过周末突击一小时</div>` : ""}
              ${mode === "diktat" ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)">· 听写三遍法：<b>速听抓结构 → 常速逐词 → 慢速补漏</b></div>
              <div>· 写不出时先记首字母，第二遍补全</div>
              <div>· 特别注意名词大写与动词二位语序</div>` : ""}
            </div>
          </div>
        </div>`;
      [...host.querySelectorAll("[data-m]")].forEach(c => c.onclick = () => {
        if (taskCtx && c.dataset.m !== mode) { toast("今日任务已锁定题型；先退出计划练习再切换", "info"); return; }
        mode = c.dataset.m; ctx.go("listening");
      });
      [...host.querySelectorAll("[data-sl]")].forEach(c => c.onclick = () => { shadowLevel = c.dataset.sl; ctx.go("listening"); });
      const st = host.querySelector("#showText");
      if (st) st.onchange = () => { showText = st.checked; };
      const r = host.querySelector("#rate");
      r.oninput = () => { rate = +r.value / 100; host.querySelector("#rateVal").textContent = rate.toFixed(2) + "×"; };
      /* 语音包探测：无声包时整模块不可用，必须显式告知而非静默 */
      probeVoices().then(n => {
        const w = host.querySelector("#voiceWarn");
        if (w && n === 0 && "speechSynthesis" in window) w.style.display = "block";
      });
      const restored = !!(saved && Array.isArray(saved.stack) && saved.stack.length);
      if (!restored) {
        const all = corpus();
        if (mode === "dialog") stack = shuffle(DIALOGUES.slice()).slice(0, 3);
        else if (mode === "choice") stack = shuffle(all.filter(x => !x.audioUrl && hasZh(x))).slice(0, 12);
        else {
          const real = shuffle(all.filter(x => x.audioUrl));
          stack = real.concat(shuffle(all.filter(x => !x.audioUrl)).slice(0, Math.max(0, 12 - real.length))).slice(0, 12);
        }
        if (taskCtx && window.LD.FirstWeek) {
          const cap = window.LD.FirstWeek.target(taskCtx);
          if (cap > 0) stack = stack.slice(0, cap);
        }
        saveRun();
      }
      paint(host, ctx);
      paintBoard(host);
      if (window.LD.Backend.contentAutoLoad() && window.LD.Backend.listListeningAssets) {
        window.LD.Backend.listListeningAssets(30).then(result => {
          if (!host.isConnected || !Array.isArray(result.items)) return;
          remoteAudioAssets = result.items.filter(x => x.audio_url && x.text).map(x => ({
            de: x.text, zh: "", key: x.text.split(/\s+/)[0],
            audioUrl: window.LD.Backend.base() + x.audio_url,
            attribution: x.attribution || "Tatoeba contributor", license: x.audio_license || "",
            sourceUrl: x.source_url, textLicense: x.text_license, assetId: x.asset_id
          }));
          const already = new Set(stack.map(x => x.assetId).filter(Boolean));
          const cap = taskCtx && window.LD.FirstWeek ? window.LD.FirstWeek.target(taskCtx) : 0;
          const room = cap > 0 ? Math.max(0, cap - stack.length) : 6;
          const additions = room > 0 ? shuffle(remoteAudioAssets.filter(x => !already.has(x.assetId))).slice(0, room) : [];
          if (additions.length) {
            stack = stack.concat(additions);
            saveRun();
            paintBoard(host);
          }
        }).catch(() => { /* 本地题库与系统语音合成继续可用 */ });
      }
    }
  };

  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };

  function saveRun() {
    const c = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("listening") : null;
    if (!c) return;
    window.LD.FirstWeek.update(c, {
      progress: right + wrong,
      data: Object.assign({}, c.data || {}, {
        listening: { mode, stack, i, right, wrong, finished, shadowLevel, showText }
      })
    });
  }

  function paint(host, ctx) {
    const st = host.querySelector("#stage");
    if (finished || i >= stack.length) return finish(st, ctx);
    cur = stack[i];
    /* 听音选义的选项文字就是中文释义：没有译文的句子既不能当题目也不能当干扰项，否则会出现空白选项 */
    const others = shuffle(corpus().filter(x => x.de !== cur.de && (mode !== "choice" || hasZh(x)))).slice(0, 3);

    if (mode === "dialog") {
      /* ===== 双人对话：两个角色轮流发声，听完整段后作答 ===== */
      st.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div class="tag tag-blue">第 ${i + 1} / ${stack.length}</div>
          <span class="tag">${cur.scene} · ${cur.lv}</span>
        </div>
        <div style="text-align:center;margin:18px 0">
          <button class="mic-btn" id="playDlg" style="background:var(--grad)" aria-label="播放双人对话">${window.LD.icon("play")}${window.LD.icon("people")}</button>
          <div style="margin-top:10px;color:var(--text-3);font-size:12.5px" id="dlgHint">点击播放整段对话（可重复）</div>
        </div>
        <div id="dlgTurns" style="margin:12px 0;padding:4px 12px;border-radius:10px;background:var(--panel-2);min-height:40px;font-size:13.5px;line-height:1.8"></div>
        <div id="dlgQ" style="display:none">
          <div style="font-size:14.5px;font-weight:600;margin-bottom:10px">❓ ${cur.q}</div>
          <div id="opts" style="display:flex;flex-direction:column;gap:8px"></div>
        </div>
        <div id="fb"></div>`;
      st.querySelector("#playDlg").onclick = () => playDialogue(cur, st, () => {
        const q = st.querySelector("#dlgQ");
        if (q) q.style.display = "block";
      });
      setTimeout(() => playDialogue(cur, st, () => {
        const q = st.querySelector("#dlgQ");
        if (q) q.style.display = "block";
      }), 400);
      const oBox = st.querySelector("#opts");
      cur.opts.forEach((o, k) => {
        const b = document.createElement("div");
        b.className = "list-item"; b.style.cursor = "pointer";
        b.innerHTML = `<div class="main"><div class="t1">${String.fromCharCode(65 + k)}. ${o}</div></div>`;
        b.onclick = () => judgeDlg(st, host, ctx, k === cur.a, `${cur.why}｜对话要点：${cur.turns.map(t => t.de).join(" ")}`, cur.id);
        oBox.appendChild(b);
      });

    } else if (mode === "choice") {
      st.innerHTML = `
        <div class="tag tag-blue">第 ${i + 1} / ${stack.length}</div>
        <div style="text-align:center;margin:22px 0">
          <button class="mic-btn" id="play" style="background:var(--grad)" aria-label="播放">${window.LD.icon("volume")}</button>
          <div style="margin-top:10px;color:var(--text-3);font-size:12.5px">点击播放（可重复）</div>
        </div>
        <div id="opts" style="display:flex;flex-direction:column;gap:8px"></div>
        <div id="fb"></div>`;
      const opts = shuffle([cur].concat(others));
      const oBox = st.querySelector("#opts");
      opts.forEach(o => {
        const b = document.createElement("div");
        b.className = "list-item"; b.style.cursor = "pointer";
        b.innerHTML = `<div class="main"><div class="t1">${o.zh}</div></div>`;
        b.onclick = () => judge(st, host, ctx, o.zh === cur.zh, `原文：${cur.de}`, "listening");
        oBox.appendChild(b);
      });
      st.querySelector("#play").onclick = () => playPrompt(cur, rate);
      setTimeout(() => playPrompt(cur, rate), 400);

    } else if (mode === "dictation") {
      const blanked = cur.de.replace(new RegExp("\\b" + escapeRe(cur.key) + "\\b", "i"), "________");
      st.innerHTML = `
        <div class="tag tag-blue">第 ${i + 1} / ${stack.length}</div>
        <div style="text-align:center;margin:18px 0">
          <button class="mic-btn" id="play" style="background:var(--grad)" aria-label="播放">${window.LD.icon("volume")}</button>
          <div style="margin-top:10px;color:var(--text-3);font-size:12.5px">听写并补上空格处的单词</div>${audioNote(cur)}
        </div>
        <div class="vocab-ex" style="max-width:none;text-align:center;font-size:16px">${blanked}</div>
        <div style="font-size:12.5px;color:var(--text-3);margin-top:10px">提示：${cur.zh}</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <input type="text" id="dIn" placeholder="输入听到的单词（注意首字母大写）">
          <button class="btn btn-primary" id="dOk">提交</button>
        </div>
        <div id="fb"></div>`;
      st.querySelector("#play").onclick = () => playPrompt(cur, rate);
      setTimeout(() => playPrompt(cur, rate), 400);
      const submit = () => {
        const v = st.querySelector("#dIn").value.trim();
        if (!v) return;
        const ok = v.toLowerCase() === cur.key.toLowerCase();
        judge(st, host, ctx, ok, `正确答案：${cur.key} —— 原句：${cur.de}`, "listening");
      };
      st.querySelector("#dOk").onclick = submit;
      st.querySelector("#dIn").addEventListener("keydown", e => { if (e.key === "Enter") submit(); });

    } else if (mode === "diktat") {
      /* ===== 整句听写：TestDaF 听力第三题同款 —— 听全句、键入全文、逐词对比 ===== */
      st.innerHTML = `
        <div class="tag tag-blue">第 ${i + 1} / ${stack.length}</div>
        <div style="text-align:center;margin:18px 0">
          <button class="mic-btn" id="play" style="background:var(--grad)" aria-label="播放">${window.LD.icon("volume")}</button>
          <button class="mic-btn" id="playSlow" style="background:linear-gradient(135deg,#5a7f9e,#8aa5bb);margin-left:12px;font-size:20px" title="0.65× 慢速精听">🐢</button>
          <div style="margin-top:10px;color:var(--text-3);font-size:12.5px">先正常速听 1–2 遍抓大意，再逐词听写；听不清的点用慢速</div>${audioNote(cur)}
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
          ${DE_CHARS.map(c => `<button class="btn btn-ghost" data-ch="${c}" style="min-width:32px;padding:3px 6px;font-size:14px">${c}</button>`).join("")}
          <span class="hint" style="margin:0">点击插入德语特殊字符</span>
        </div>
        <textarea id="dFull" rows="3" placeholder="键入你听到的完整句子……" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--text);font-size:14.5px;line-height:1.7;resize:vertical"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-primary" id="dOk">提交批改</button>
          <button class="btn" id="showAns">查看原文</button>
        </div>
        <div id="ansLine"></div>
        <div id="fb"></div>`;
      st.querySelector("#play").onclick = () => playPrompt(cur, rate);
      st.querySelector("#playSlow").onclick = () => playPrompt(cur, Math.min(rate, 0.65));
      setTimeout(() => playPrompt(cur, rate), 400);
      st.querySelectorAll("[data-ch]").forEach(b => b.onclick = () => {
        const ta = st.querySelector("#dFull");
        const pos = ta.selectionStart || ta.value.length;
        ta.value = ta.value.slice(0, pos) + b.dataset.ch + ta.value.slice(ta.selectionEnd || pos);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = pos + 1;
      });
      const submitD = () => {
        const v = st.querySelector("#dFull").value.trim();
        if (!v) { window.LD.UI.toast("先键入你听到的内容", "err"); return; }
        gradeDiktat(st, host, ctx, v);
      };
      st.querySelector("#dOk").onclick = submitD;
      st.querySelector("#showAns").onclick = () => {
        st.querySelector("#dFull").value = cur.de;
        const line = st.querySelector("#ansLine");
        if (line && window.LD.WordLink) {
          line.innerHTML = `<div class="hint" style="margin:8px 0 2px">原文（点词可查）：</div>
            <div class="de wl-ctx" data-wctx="${LD.WordLink.attr(cur.de.slice(0, 120))}" style="font-size:14.5px;line-height:1.8">${LD.WordLink.linkHTML(cur.de)}</div>`;
          LD.WordLink.bind(line, { mode: "popover", module: "听力训练" });
        }
      };
      st.querySelector("#dFull").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitD(); });

    } else if (mode === "shadow") {
      /* ===== 影子跟读：盲听 → 对照原文 → 跟读 → 评分+词级差异 ===== */
      const L = SHADOW_LEVELS[shadowLevel];
      st.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div class="tag tag-blue">第 ${i + 1} / ${stack.length}</div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="tag">${L.nm} · ${L.lv}</span>
            <span class="hint" style="margin:0">语速 ${rate.toFixed(2)}×</span>
          </div>
        </div>
        <div style="margin:14px 0;padding:10px 14px;border-radius:9px;background:var(--panel-2);font-size:12.5px;color:var(--text-2)">
          <b>第 1 步</b> 盲听原句${showText ? "" : "（先不看原文）"} → <b>第 2 步</b> 对照原文 → <b>第 3 步</b> 跟读 → <b>第 4 步</b> 看评分与差异
        </div>
        <div style="text-align:center;margin:18px 0">
          <button class="mic-btn" id="play" style="background:var(--grad)" aria-label="播放">${window.LD.icon("volume")}</button>
          <button class="mic-btn" id="playRec" style="background:linear-gradient(135deg,#7c5cd6,#b056d8);margin-left:12px" title="播放原句的同时开始录音（滞后/整段跟读用）">${window.LD.icon("volume")}${window.LD.icon("mic")}</button>
          <button class="mic-btn" id="rec" style="background:linear-gradient(135deg,#e05252,#f07c3c);margin-left:12px">${window.LD.icon("mic")}</button>
          <div style="margin-top:10px;color:var(--text-3);font-size:12.5px" id="hint">
            盲听原句 ｜ 边播边跟 ｜ 暂停复述（${shadowLevel === "pause" ? "当前级别推荐" : "练熟后使用"}）
          </div>
        </div>
        ${showText ? `<div class="vocab-ex de wl-ctx" data-wctx="${window.LD.WordLink ? LD.WordLink.attr(cur.de.slice(0, 120)) : ""}" style="max-width:none;text-align:center;font-size:16px">${window.LD.WordLink ? LD.WordLink.linkHTML(cur.de) : cur.de}</div>
        <div style="text-align:center;font-size:12.5px;color:var(--text-3);margin-top:4px">${cur.zh}</div>` : ""}
        <div class="transcript" id="tr"><div class="ph">跟读识别结果……</div></div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="text" id="rIn" placeholder="或手动输入你跟读的句子">
          <button class="btn btn-primary" id="rOk">评分</button>
        </div>
        <div id="fb"></div>`;
      st.querySelector("#play").onclick = () => playPrompt(cur, rate);
      st.querySelector("#playRec").onclick = () => {
        playPrompt(cur, rate);
        startRec(st, host, ctx);
      };
      setTimeout(() => { if (shadowLevel === "pause") playPrompt(cur, rate); }, 400);
      st.querySelector("#rOk").onclick = () => {
        const v = st.querySelector("#rIn").value.trim();
        if (v) gradeShadow(st, host, ctx, v, 8000);
      };
      st.querySelector("#rec").onclick = () => startRec(st, host, ctx);
      if (window.LD.WordLink) LD.WordLink.bind(st, { mode: "popover", module: "听力训练" });

    } else {
      st.innerHTML = `
        <div class="tag tag-blue">第 ${i + 1} / ${stack.length}</div>
        <div style="text-align:center;margin:18px 0">
          <button class="mic-btn" id="play" style="background:var(--grad)" aria-label="播放">${window.LD.icon("volume")}</button>
          <button class="mic-btn" id="rec" style="background:linear-gradient(135deg,#e05252,#f07c3c);margin-left:12px">${window.LD.icon("mic")}</button>
          <div style="margin-top:10px;color:var(--text-3);font-size:12.5px" id="hint">先听原句，再点击麦克风复述</div>
        </div>
        <div class="transcript" id="tr"><div class="ph">识别结果……</div></div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="text" id="rIn" placeholder="或手动输入你说出的句子">
          <button class="btn btn-primary" id="rOk">评分</button>
        </div>
        <div id="fb"></div>`;
      st.querySelector("#play").onclick = () => playPrompt(cur, rate);
      setTimeout(() => playPrompt(cur, rate), 400);
      st.querySelector("#rOk").onclick = () => {
        const v = st.querySelector("#rIn").value.trim();
        if (v) gradeRepeat(st, host, ctx, v, 8000);
      };
      st.querySelector("#rec").onclick = () => recordAndScore(st, host, ctx, "repeat");
    }
    saveRun();
  }

  function gradeRepeat(st, host, ctx, hyp, ms) {
    const res = E().scoreSpeech(cur.de, hyp, { ms, pauses: 2 });
    if (!res) return;
    window.LD.Store.logAnswer({ type: "listening", ability: "listening", ok: res.total >= 70, ms, item: cur.de, skill: "hear:" + cur.key });
    if (res.total < 70) window.LD.Store.addWrong({
      module: "听力训练", type: "复述", wrong: hyp, right: cur.de, source: cur.zh,
      why: `复述评分 ${res.total} 分（${res.grade}）：${res.advice[0]}`
    });
    judge(st, host, ctx, res.total >= 70,
      `评分 ${res.total} 分（${res.grade}）· 准确度 ${res.accuracy} · 流利度 ${res.fluency}｜原句：${cur.de}`, "listening");
  }

  /* ===== 影子跟读：录音 + 评分 + 词级差异 ===== */
  function startRec(st, host, ctx) {
    recordAndScore(st, host, ctx, "shadow");
  }

  function gradeShadow(st, host, ctx, hyp, ms) {
    const res = E().scoreSpeech(cur.de, hyp, { ms, pauses: 2 });
    if (!res) return;
    window.LD.Store.logAnswer({ type: "listening", ability: "listening", ok: res.total >= 70, ms, item: cur.de, skill: "hear:" + cur.key });
    if (res.total < 70) window.LD.Store.addWrong({
      module: "听力训练", type: "影子跟读", wrong: hyp, right: cur.de, source: cur.zh,
      why: `跟读评分 ${res.total} 分（${res.grade}）：${res.advice[0]}`
    });
    right += res.total >= 70 ? 1 : 0; wrong += res.total < 70 ? 1 : 0;
    const diffHtml = wordDiff(cur.de, hyp);
    st.querySelector("#fb").innerHTML = `
      <div class="corr-item" style="margin-top:14px">
        <div class="row">
          <span class="${res.total >= 70 ? "badge-v" : "badge-x"}">${res.total >= 70 ? "✓" : "✕"}</span>
          <div style="flex:1">
            <div style="font-size:13.5px">跟读评分 <b>${res.total}</b> 分（${res.grade}）· 准确度 ${res.accuracy} · 流利度 ${res.fluency}</div>
            <div class="why">${res.advice[0]}</div>
          </div>
        </div>
      </div>
      <div style="margin-top:10px;padding:12px 14px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line)">
        <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">词级差异对比（<span style="color:var(--ok)">绿=命中</span> · <span style="color:var(--danger)">红=遗漏/偏差</span> · <span style="color:var(--text-3)">灰=多读</span>）</div>
        <div class="de" style="font-size:14px;line-height:2">${diffHtml}</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-primary" id="next">下一句</button>
        <button class="btn" id="again">再听一遍</button>
        <button class="btn" id="reRec">重新跟读</button>
      </div>`;
    st.querySelector("#next").onclick = () => { i++; paint(host, ctx); paintBoard(host); };
    st.querySelector("#again").onclick = () => playPrompt(cur, rate);
    st.querySelector("#reRec").onclick = () => paint(host, ctx);
    paintBoard(host);
  }

  /* ===== 整句听写：词级对比 + 准确率评分 ===== */
  function gradeDiktat(st, host, ctx, hyp) {
    const norm = t => (t || "").toLowerCase().replace(/[.,!?;:"„“”]/g, "").replace(/\s+/g, " ").trim();
    const A = norm(cur.de).split(" ").filter(Boolean);
    const B = norm(hyp).split(" ").filter(Boolean);
    const hits = A.filter(w => B.indexOf(w) >= 0).length;
    const acc = A.length ? Math.round(hits / A.length * 100) : 0;
    const ok = acc >= 85;
    window.LD.Store.logAnswer({ type: "listening", ability: "listening", ok, ms: 20000, item: cur.de, skill: "hear:diktat" });
    if (!ok) window.LD.Store.addWrong({
      module: "听力训练", type: "整句听写", wrong: hyp, right: cur.de, source: cur.zh,
      why: `听写准确率 ${acc}%（命中 ${hits}/${A.length} 词）：漏听或拼错的词已标红，建议慢速精听后再写一遍`
    });
    right += ok ? 1 : 0; wrong += ok ? 0 : 1;
    const diffHtml = wordDiff(cur.de, hyp);
    st.querySelector("#fb").innerHTML = `
      <div class="corr-item" style="margin-top:14px">
        <div class="row">
          <span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
          <div style="flex:1">
            <div style="font-size:13.5px">听写准确率 <b>${acc}%</b>（命中 ${hits}/${A.length} 词）${ok ? "· 达到 85% 过关线" : "· 未到 85% 过关线"}</div>
            <div class="why">${cur.zh}</div>
          </div>
        </div>
      </div>
      <div style="margin-top:10px;padding:12px 14px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line)">
        <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">词级对比（<span style="color:var(--ok)">绿=写对</span> · <span style="color:var(--danger)">红=漏/错</span> · <span style="color:var(--text-3)">灰=多写</span>）</div>
        <div class="de" style="font-size:14px;line-height:2">${diffHtml}</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="next">下一题</button>
        <button class="btn" id="again">再听一遍</button>
        <button class="btn" id="retry">重写本句</button>
      </div>`;
    st.querySelector("#next").onclick = () => { i++; paint(host, ctx); paintBoard(host); };
    st.querySelector("#again").onclick = () => playPrompt(cur, rate);
    st.querySelector("#retry").onclick = () => paint(host, ctx);
    paintBoard(host);
  }

  /* 词级差异：基于 LCS 对齐，输出着色 HTML */
  function wordDiff(ref, hyp) {
    const norm = t => (t || "").toLowerCase().replace(/[.,!?;:"„“”]/g, "").replace(/\s+/g, " ").trim();
    const A = norm(ref).split(" ").filter(Boolean);
    const B = norm(hyp).split(" ").filter(Boolean);
    const m = A.length, n = B.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let x = 1; x <= m; x++) for (let y = 1; y <= n; y++) {
      dp[x][y] = A[x - 1] === B[y - 1] ? dp[x - 1][y - 1] + 1 : Math.max(dp[x - 1][y], dp[x][y - 1]);
    }
    let x = m, y = n; const out = [];
    while (x > 0 && y > 0) {
      if (A[x - 1] === B[y - 1]) { out.unshift(`<span style="color:var(--ok);font-weight:600">${esc2(A[x - 1])}</span>`); x--; y--; }
      else if (dp[x - 1][y] >= dp[x][y - 1]) { out.unshift(`<span style="color:var(--danger);text-decoration:line-through">${esc2(A[x - 1])}</span>`); x--; }
      else { out.unshift(`<span style="color:var(--text-3)">${esc2(B[y - 1])}</span>`); y--; }
    }
    while (x > 0) { out.unshift(`<span style="color:var(--danger);text-decoration:line-through">${esc2(A[x - 1])}</span>`); x--; }
    while (y > 0) { out.unshift(`<span style="color:var(--text-3)">${esc2(B[y - 1])}</span>`); y--; }
    return out.join(" ");
  }
  const esc2 = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* 双人对话判题：错题沉淀带完整对话原文，便于复盘 */
  function judgeDlg(st, host, ctx, ok, whyText, itemId) {
    right += ok ? 1 : 0; wrong += ok ? 0 : 1;
    window.LD.Store.logAnswer({ type: "listening", ability: "listening", ok, ms: 30000, item: cur.scene, skill: "hear:dialog:" + (itemId || "") });
    if (!ok) window.LD.Store.addWrong({
      module: "听力训练", type: "双人对话", wrong: cur.q, right: cur.opts[cur.a],
      source: cur.turns.map(t => t.de).join(" "), why: cur.why
    });
    st.querySelector("#fb").innerHTML = `
      <div class="corr-item" style="margin-top:14px"><div class="row">
        <span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
        <div><div style="font-size:13.5px">${whyText}</div>
        <div class="why">按 Enter 或点击按钮进入下一题</div></div>
      </div></div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-primary" id="next">下一题</button>
        <button class="btn" id="again">重听本段对话</button>
      </div>`;
    st.querySelector("#next").onclick = () => { i++; paint(host, ctx); paintBoard(host); };
    st.querySelector("#again").onclick = () => paint(host, ctx);
    paintBoard(host);
  }

  function judge(st, host, ctx, ok, whyText, ability) {
    right += ok ? 1 : 0; wrong += ok ? 0 : 1;
    window.LD.Store.logAnswer({ type: ability || "listening", ability: ability === "listening" ? "listening" : "listening", ok, ms: 9000, item: cur.de, skill: "hear:" + cur.key });
    if (!ok) window.LD.Store.addWrong({ module: "听力训练", type: MODES[mode].nm, wrong: cur.zh, right: whyText, source: cur.de, why: "听力题未答对，建议反复精听原句" });
    st.querySelector("#fb").innerHTML = `
      <div class="corr-item" style="margin-top:14px"><div class="row">
        <span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
        <div><div style="font-size:13.5px">${whyText}</div>
        <div class="why">按 Enter 或点击按钮进入下一题</div></div>
      </div></div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-primary" id="next">下一题</button>
        <button class="btn" id="again">再听一遍</button>
      </div>`;
    st.querySelector("#next").onclick = () => { i++; paint(host, ctx); paintBoard(host); };
    st.querySelector("#again").onclick = () => playPrompt(cur, rate);
    paintBoard(host);
  }

  function paintBoard(host) {
    const b = host.querySelector("#board");
    if (!b) return;
    const t = right + wrong;
    b.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">已练</span><b>${t} / ${stack.length}</b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">正确率</span><b>${t ? Math.round(right / t * 100) : 0}%</b></div>
      </div>`;
  }

  function finish(st, ctx) {
    finished = true;
    const taskCtx = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("listening") : null;
    if (!stack.length) {
      st.innerHTML = `<div style="text-align:center;padding:26px 0">
        <div style="font-size:40px">🎧</div>
        <h2 style="margin:10px 0 4px">本轮没有可用题目</h2>
        <div class="hint">未生成听力材料，不计入练习记录，也不会标记任务完成。</div>
        <div class="btn-row" style="justify-content:center;margin-top:16px"><button class="btn btn-primary" id="again2">重新开始</button></div>
      </div>`;
      const again = st.querySelector("#again2");
      if (again) again.onclick = () => ctx.go("listening");
      return;
    }
    const attempted = right + wrong;
    if (!roundSaved) {
      window.LD.Store.addSession({ module: "listening", ms: stack.length * 20000, count: stack.length });
      roundSaved = true;
    }
    saveRun();
    const target = taskCtx ? window.LD.FirstWeek.target(taskCtx) : 0;
    const enough = !!(taskCtx && attempted > 0 && attempted >= Math.min(stack.length, target));
    if (taskCtx && enough && window.LD.FirstWeek) {
      window.LD.FirstWeek.update(taskCtx, { progress: attempted });
      window.LD.FirstWeek.evidence(taskCtx, "听力作答");
    }
    st.innerHTML = `<div style="text-align:center;padding:26px 0">
      <div style="font-size:40px">🎧</div>
      <h2 style="margin:10px 0 4px">听力训练完成</h2>
      <div style="color:var(--text-3)">共 ${stack.length} 题 · 正确 ${right} · 错误 ${wrong}</div>
      ${enough
        ? window.LD.FirstWeek.receipt(taskCtx, {
          summary: `听力本轮 ${attempted} 题 · 正确 ${right}`,
          detail: `错误 ${wrong} 题 · ${MODES[mode].nm}`,
          evidence: "听力作答",
          source: "listening-round",
          label: "完成听力任务",
          embedded: true
        })
        : taskCtx
          ? `<div class="fw-receipt fw-receipt-embedded"><div class="fw-receipt-meta">本任务还没有完成足够题目，暂不能确认完成。</div><div class="btn-row fw-receipt-actions"><button type="button" class="btn" data-fw-return>暂时离开，稍后继续</button></div></div>`
          : `<div class="btn-row" style="justify-content:center;margin-top:16px">
            <button class="btn btn-primary" id="again2">再来一组</button>
            <button class="btn" id="toSpeech">去口语测评</button></div>`}</div>`;
    const receipt = st.querySelector(".fw-receipt");
    if (receipt) receipt.scrollIntoView({ behavior: "smooth", block: "start" });
    const again = st.querySelector("#again2");
    if (again) again.onclick = () => ctx.go("listening");
    const toSpeech = st.querySelector("#toSpeech");
    if (toSpeech) toSpeech.onclick = () => ctx.go("speech");
  }

  const escapeRe = s => (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "听力训练", icon: "♪", group: "学习闭环", priority: "P0", order: 6, ds: "授权实人录音优先、TTS 兜底；听音选义 / 听写 / 双人对话 / 复述 / 影子跟读" });
  window.LD.define("listening", Mod);
  /* 题库导出：供「全真模考」听力节复用 */
  window.LD_LISTEN_BANK = DIALOG;
  window.LD_LISTEN_DIALOGUES = DIALOGUES;
})();
