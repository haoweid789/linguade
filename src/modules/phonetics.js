/* 模块 · 发音专项：最小对立对 + 方言口音适应
   把「德语发音难」拆成可练的最小单位：ü/u、ch 两种读音、长短元音、ei/ie 等对立对；
   并提供德语方言（巴伐利亚 / 施瓦本 / 萨克森 / 奥地利 / 瑞士）的常见变音知识卡。
   跟读通道复用 LD.ASR：后端 Whisper → 浏览器识别 → 手动对照。 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;

  /* 最小对立对：只差一个音位，意思完全不同 —— 听辨与口型训练的核心素材 */
  const PAIRS = [
    { cat: "ü / u", a: "über", b: "Uhr", zh: "关于 / 钟点", tip: "ü：前舌位 + 圆唇（先摆 i 的口型再圆唇）；u：后舌位圆唇。" },
    { cat: "ü / u", a: "fünf", b: "funt", zh: "五 / （非词）", tip: "Umlaut 必须体现：fünf 的 ü 不可读成 u。" },
    { cat: "ö / o", a: "schön", b: "schon", zh: "美 / 已经", tip: "ö 前舌圆唇；schon 是后舌 o —— 一词之差，语义完全不同。" },
    { cat: "ch", a: "ich", b: "Bach", zh: "我 / 小溪", tip: "ich-Laut 靠前（近「希」），ach-Laut 在喉部（近「喝」）。" },
    { cat: "ch", a: "Kirche", b: "Kuchen", zh: "教堂 / 蛋糕", tip: "ch 的读法由前一元音决定：前元音后读 ich-Laut，后元音后读 ach-Laut。" },
    { cat: "长短元音", a: "Staat", b: "Stadt", zh: "国家 / 城市", tip: "双写元音表示长音：Staat [aː]；Stadt 为短 [a]。" },
    { cat: "长短元音", a: "bieten", b: "bitten", zh: "提供 / 请求", tip: "ie 是长 [iː]；短元音后常跟双辅音。" },
    { cat: "长短元音", a: "Höhle", b: "Hölle", zh: "洞穴 / 地狱", tip: "h 不发音，只负责延长前面的元音。" },
    { cat: "ei / ie", a: "Bein", b: "Biene", zh: "腿 / 蜜蜂", tip: "ei 读 [aɪ]，ie 读 [iː] —— 字母顺序颠倒，读音全变。" },
    { cat: "ei / ie", a: "Leid", b: "Lied", zh: "痛苦 / 歌曲", tip: "听力高频混淆对，务必成对记忆。" },
    { cat: "b / p", a: "Bahn", b: "Panne", zh: "铁路 / 故障", tip: "词尾浊音清化：lieb 读 [liːp]。" },
    { cat: "d / t", a: "Dank", b: "Tank", zh: "感谢 / 油箱", tip: "词尾 -d 清化为 [t]：Kind 读 [kɪnt]。" },
    { cat: "g / k", a: "Gasse", b: "Kasse", zh: "小巷 / 收银台", tip: "-ig 在标准音中读 [ɪç]（如 wichtig）。" },
    { cat: "sch / s", a: "Schule", b: "Süden", zh: "学校 / 南方", tip: "sch [ʃ] 为卷舌擦音；s 在元音前浊化为 [z]。" },
    { cat: "r", a: "Rot", b: "Brot", zh: "红色 / 面包", tip: "词首 r 可用小舌音 [ʀ]；辅音簇中的 r 更短促。" },
    { cat: "z", a: "Zug", b: "Zeit", zh: "火车 / 时间", tip: "德语 z 固定读 [ts]，不是英语的 [z]。" },
    { cat: "v / f", a: "Vater", b: "Foto", zh: "父亲 / 照片", tip: "德语本族词中 v 读 [f]；外来词中读 [v]。" },
    { cat: "eu / au", a: "Feuer", b: "Frau", zh: "火 / 女士", tip: "eu / äu 读 [ɔʏ]；au 读 [aʊ]。" },
    { cat: "n / ng", a: "singen", b: "sinken", zh: "唱歌 / 下沉", tip: "ng 读单一鼻音 [ŋ]，不要把 g 读出来。" },
    { cat: "m / n", a: "Kamm", b: "Kann", zh: "梳子 / 能", tip: "词尾 m / n 口型闭合位置不同，易混。" }
  ];

  let idx = 0, mode = "pairs", recording = false, mrec = null, rec = null, startTime = 0;

  function say(text) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "de-DE";
      u.rate = 0.88;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { toast("当前环境不支持语音合成", "err"); }
  }

  const Mod = {
    title: "发音专项",
    desc: "最小对立对与方言口音适应训练（发音对照 + 跟读评分）",
    render(host, ctx) {
      window.LD.Store.visit("phonetics");
      host.innerHTML = `
        <div class="page-head"><h1>发音专项</h1>
          <p>德语发音的难点常常落在「最小对立对」上——差一个音，意思就完全变了。这里把 ü/u、ch 双读音、长短元音等拆成可练的小组，并附德国方言口音知识。</p></div>
        <div class="card card-pad" style="margin-bottom:14px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span style="font-size:12px;color:var(--text-3)">模式</span>
            <div class="scene-chip ${mode === "pairs" ? "active" : ""}" data-mode="pairs">最小对立对</div>
            <div class="scene-chip ${mode === "dialect" ? "active" : ""}" data-mode="dialect">方言口音</div>
          </div>
        </div>
        <div id="body"></div>`;
      host.querySelectorAll("[data-mode]").forEach(c => c.onclick = () => { mode = c.dataset.mode; ctx.go("phonetics"); });
      if (mode === "pairs") renderPairs(host, ctx); else renderDialects(host);
    }
  };

  function renderPairs(host, ctx) {
    const p = PAIRS[idx];
    host.querySelector("#body").innerHTML = `
      <div class="card card-pad" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="tag tag-blue">${p.cat}</span>
          <span style="font-size:12px;color:var(--text-3)">第 ${idx + 1} / ${PAIRS.length} 组</span>
        </div>
        <div class="grid g2" style="gap:12px">
          ${[[p.a], [p.b]].map(([w]) => `
            <div style="padding:14px;border:1px solid var(--line);border-radius:12px;text-align:center;background:var(--panel-2)">
              <div class="de" style="font-size:22px;font-weight:700">${w}</div>
              <div style="margin-top:8px;display:flex;gap:6px;justify-content:center">
                <button class="btn btn-sm" data-say="${w}">${window.LD.icon("volume")} 听</button>
                <button class="btn btn-sm btn-primary" data-read="${w}">${window.LD.icon("mic")} 跟读</button>
              </div>
            </div>`).join("")}
        </div>
        <div class="hint" style="margin-top:10px"><b>${p.a}</b> / <b>${p.b}</b> · ${p.zh}<br>${p.tip}</div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-sm" id="prev">← 上一组</button>
          <button class="btn btn-sm" id="next">下一组 →</button>
          <button class="btn btn-sm" id="randBtn">随机一组</button>
        </div>
        <div id="readOut"></div>
      </div>
      <div class="card card-pad" style="background:var(--panel-2)">
        <div class="hint" style="margin:0">跟读三通道：① 后端 Whisper 转写（需 http(s) 且配置后端地址）② 浏览器语音识别（Chrome / Edge）③ 手动输入对照。</div>
      </div>`;

    host.querySelectorAll("[data-say]").forEach(b => b.onclick = () => say(b.dataset.say));
    host.querySelectorAll("[data-read]").forEach(b => b.onclick = () => startRead(host, b.dataset.read));
    host.querySelector("#prev").onclick = () => { idx = (idx + PAIRS.length - 1) % PAIRS.length; renderPairs(host, ctx); };
    host.querySelector("#next").onclick = () => { idx = (idx + 1) % PAIRS.length; renderPairs(host, ctx); };
    host.querySelector("#randBtn").onclick = () => { idx = Math.floor(Math.random() * PAIRS.length); renderPairs(host, ctx); };
  }

  function renderDialects(host) {
    const list = window.LD_DIALECTS || [];
    host.querySelector("#body").innerHTML = `
      <div class="grid g2">
        ${list.map(d => `
          <div class="card card-pad">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <b style="font-size:14px">${d.nm}</b>
              <button class="btn btn-sm" data-say="${d.ex}">${window.LD.icon("volume")} 例句</button>
            </div>
            <div class="hint" style="margin:0 0 8px">${d.feat}</div>
            <div class="de" style="font-size:13.5px;color:var(--text-2)">${d.ex}</div>
          </div>`).join("") || '<div class="empty"><div class="big">◍</div><div>方言知识卡未加载</div></div>'}
      </div>
      <div class="card card-pad" style="margin-top:14px;background:var(--panel-2)">
        <div class="hint" style="margin:0">提示：TestDaF / DSH / Telc 均以<b>标准德语</b>为评分基准。了解方言特征是为了听懂，而不是在考试中模仿。</div>
      </div>`;
    host.querySelectorAll("[data-say]").forEach(b => b.onclick = () => say(b.dataset.say));
  }

  /* ---------- 跟读：三通道 ---------- */
  function startRead(host, target) {
    if (window.LD.ASR && LD.ASR.canRecord()) return readViaBackend(host, target);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return readManual(host, target);
    if (recording && rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = "de-DE"; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 1;
    startTime = Date.now();
    rec.onresult = ev => {
      const txt = ev.results[0][0].transcript;
      finish(host, target, txt, Date.now() - startTime);
    };
    rec.onerror = ev => { recording = false; toast("识别失败：" + ev.error, "err"); readManual(host, target); };
    rec.onend = () => { recording = false; };
    try { rec.start(); recording = true; toast("请跟读：" + target, "info"); }
    catch (e) { readManual(host, target); }
  }

  function readViaBackend(host, target) {
    if (recording && mrec) return;
    window.LD.ASR.createRecorder().then(h => {
      mrec = h; recording = true; startTime = Date.now();
      h.rec.start();
      toast("正在录音（后端转写）…… 再次点击结束", "info");
      setTimeout(() => stopBackend(host, target), 8000);
    }).catch(e => { toast("无法访问麦克风：" + e.message, "err"); readManual(host, target); });
  }

  function stopBackend(host, target) {
    if (!mrec) return;
    const h = mrec; mrec = null; recording = false;
    window.LD.ASR.stopAndTranscribe(h)
      .then(r => finish(host, target, r.text, Date.now() - startTime))
      .catch(e => { toast("转写失败：" + e.message, "err"); readManual(host, target); });
  }

  function readManual(host, target) {
    const t = window.prompt("请输入你朗读的德语文本（用于与目标词对照评分）：", "");
    if (t && t.trim()) finish(host, target, t.trim(), 4000);
  }

  /* ---------- 评分与沉淀 ---------- */
  function finish(host, target, hyp, ms) {
    const r = E().scoreSpeech(target, hyp, { ms: ms || 4000, pauses: 1 });
    if (!r) { toast("未能识别到有效文本", "err"); return; }
    const s = S();
    s.ability.speaking = Math.round((s.ability.speaking * 3 + r.total) / 4);
    window.LD.Store.logAnswer({ type: "phonetics", ability: "speaking", ok: r.total >= 70, ms: ms || 4000, item: target, skill: "pron:" + target });
    window.LD.Store.addSession({ module: "phonetics", ms: ms || 4000, count: 1 });
    if (r.total < 70) {
      window.LD.Store.addWrong({
        module: "发音专项", type: "pron", wrong: hyp, right: target,
        why: `发音评分 ${r.total} 分（${r.grade}）：${(r.advice || [])[0] || "注意元音长短与 Umlaut 的口型"}`
      });
    }
    window.LD.Store.save();
    const out = host.querySelector("#readOut");
    if (out) {
      out.innerHTML = `
        <div class="card" style="margin-top:12px;background:var(--panel-2)">
          <div class="card-pad">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div style="font-size:22px;font-weight:700;color:${r.total >= 70 ? "var(--ok)" : "var(--accent)"}">${r.total} 分 · ${r.grade}</div>
              <div style="font-size:12.5px;color:var(--text-3)">目标：<b class="de">${target}</b> ｜ 识别：<span class="de">${hyp}</span></div>
            </div>
            <div class="hint" style="margin-top:8px">${(r.advice || []).join("；")}</div>
          </div>
        </div>`;
    }
    toast(`发音评分 ${r.total} 分`, r.total >= 70 ? "ok" : "info");
  }

  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "发音专项", icon: "◍", group: "学习闭环", priority: "P0", order: 99, nav: "more", ds: "最小对立对（ü/u、ch 双读音、长短元音）+ 德语方言口音适应" });
  window.LD.define("phonetics", Mod);
})();