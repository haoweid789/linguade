/* 模块 3 · 德语对话室：人设 × 场景 × 音色 + 对话锚定生词本
   - 左栏：人设（严谨外教 / 日常语伴 / 慢速入门 / 旅行德语）、朗读音色、清空对话
   - 中栏：场景切换与对话流；点击任意德语单词即可连同来源句子收藏
   - 右栏：生词本快捷区（加入单词本 / 保存当前句 / 最近词条）、本轮统计与课后报告
   对话仍走三层降级：后端 SSE → 直连大模型 → 本地规则；离线可用，不伪造翻译与释义。 */
(function () {
  const S = () => window.LD.Store.s;
  let sceneId = "aps", sending = false, clearArmed = false, voiceBound = false;

  /* 人设：提示词只在大模型通道生效；离线时影响开场白、朗读语速与提示口径 */
  const PERSONAS = [
    {
      id: "strict", name: "严谨外教", desc: "正式称呼 · 有错必纠",
      starter: "Guten Tag! Was möchten Sie heute üben?",
      sys: "人设：严谨外教。用 Sie 正式称呼，语法有错先纠正再继续，每次只问一个问题，难度 B1–B2。",
      rate: 0.92, tip: "严谨外教：先保证格与动词位置正确，再追求表达丰富。"
    },
    {
      id: "buddy", name: "日常语伴", desc: "du 称呼 · 轻松闲聊",
      starter: "Hey! Worüber möchtest du heute reden?",
      sys: "人设：日常语伴。用 du 非正式称呼，像朋友一样闲聊，句子短、口语化，顺便温和指出明显错误。",
      rate: 0.98, tip: "日常语伴：先开口，再把句子一点点说长。"
    },
    {
      id: "slow", name: "慢速入门", desc: "A1–A2 短句 · 0.72× 朗读",
      starter: "Hallo! Wir sprechen langsam. Was möchtest du üben?",
      sys: "人设：慢速入门。只用 A1–A2 的短句，一次一个信息点；先给正确说法，再用中文解释关键词。",
      rate: 0.72, tip: "慢速入门：先听清每个音节，再把短句连起来。"
    },
    {
      id: "travel", name: "旅行德语", desc: "问路点餐 · 实用表达",
      starter: "Hallo! Wohin möchtest du reisen?",
      sys: "人设：旅行德语。围绕问路、点餐、住宿、交通等真实旅行情境，给出可直接使用的实用表达。",
      rate: 0.9, tip: "旅行德语：把句子说成能直接问出口的版本。"
    }
  ];
  const persona = () => PERSONAS.find(p => p.id === S().chatPersona) || PERSONAS[0];

  const Mod = {
    title: "德语对话室",
    desc: "人设 × 场景 × 音色：四种对话人设、点词与整句入库、中文输入（AI 通道）",
    render(host, ctx) {
      window.LD.Store.visit("chat");
      const scenes = window.LD_SCENES || [];
      sceneId = (ctx.payload && ctx.payload.scene) || sceneId;
      clearArmed = false;
      host.innerHTML = `
        <div class="page-head"><h1>德语对话室</h1>
          <p>选一个人设再开口。中文输入需要 AI 翻译通道，离线会明确提示。<b>点击消息中的任意德语单词</b>可连同原句收入生词本。</p>
        </div>
        ${window.LD.FirstWeek ? window.LD.FirstWeek.notice(window.LD.FirstWeek.contextFor("chat")) : ""}
        <div class="chat-room">
          <aside class="card card-pad chat-set">
            <h2 class="chat-panel-title">对话设置</h2>
            <div class="set-label">人设选择</div>
            <div id="personas">${PERSONAS.map(p => `
              <button class="persona-item" data-persona="${p.id}" aria-pressed="false">
                <span class="dot"></span>
                <span><b>${p.name}</b><small>${p.desc}</small></span>
              </button>`).join("")}
            </div>
            <div class="set-label">语音设置</div>
            <select id="voiceSel" class="chat-select" aria-label="德语朗读音色"></select>
            <div class="hint" id="voiceHint"></div>
            <div class="set-label">对话管理</div>
            <button class="btn btn-block" id="clearChat">清空对话</button>
            <div class="hint">只清空当前场景；生词本与课后报告保留。</div>
          </aside>

          <section class="card chat-main">
            <div class="chat-head"><h3>当前对话</h3><span class="persona-badge" id="personaBadge">${persona().name}</span></div>
            <div class="scenes" id="scenes">${scenes.map(s => `<div class="scene-chip" data-id="${s.id}">${s.name}</div>`).join("")}</div>
            <div class="chat-shell">
              <div class="chat-log" id="log"></div>
              <div class="chat-input">
                <textarea id="cIn" placeholder="输入德语或中文…… Ctrl + Enter 发送"></textarea>
                <button class="btn" id="micBtn" title="语音输入（Chrome）">${window.LD.icon("mic")}</button>
                <button class="btn btn-primary" id="sendBtn">发送</button>
              </div>
            </div>
          </section>

          <aside class="card card-pad chat-vocab">
            <h2 class="chat-panel-title">生词本快捷区</h2>
            <button class="btn btn-block" id="addWordBtn">加入单词本</button>
            <form id="quickWordForm" class="quick-word-form" hidden>
              <input id="quickWordIn" placeholder="输入德语单词…" autocomplete="off">
              <button class="btn btn-primary btn-sm" id="quickWordAdd" type="submit">添加</button>
            </form>
            <button class="btn btn-primary btn-block" id="saveSentenceBtn" style="margin-top:8px">保存当前句</button>
            <div class="hint" id="quickHint">保存最近一条德语消息；词库未收录时只记原词，不伪造释义。</div>
            <div id="quickWords" class="quick-words"></div>
            <div class="divider"><span>本轮对话</span></div>
            <div style="font-size:12px;color:var(--text-3);line-height:1.6">场景：<b id="curSceneName">${scene().name}</b> · 已进行 <b id="turnCount">0</b> 轮</div>
            <button class="btn btn-primary btn-block" id="finishChat" style="margin-top:8px">还需 3 轮</button>
            <div class="hint" style="margin:6px 0 0">至少 3 轮后可生成报告；报告会保存在下方历史。</div>
            <div class="divider"><span>历史报告</span></div>
            <div id="reportHist"></div>
            <div class="divider"><span>${window.LD.icon("book")} 对话生词本</span></div>
            <div id="bank" style="max-height:220px;overflow:auto"></div>
          </aside>
        </div>
        <div id="chatReport"></div>
        <div class="hint" style="margin-top:8px">提示：APS 场景中回答尽量给出<b>具体数字与理由</b>，审核官最忌空泛。</div>`;

      const chips = [...host.querySelectorAll(".scene-chip")];
      const activate = id => {
        sceneId = id;
        clearArmed = false;
        chips.forEach(c => c.classList.toggle("active", c.dataset.id === id));
        paintLog(host, ctx);
      };
      chips.forEach(c => c.onclick = () => activate(c.dataset.id));
      chips.forEach(c => c.classList.toggle("active", c.dataset.id === sceneId));

      host.querySelectorAll(".persona-item").forEach(btn => {
        btn.onclick = () => setPersona(btn.dataset.persona, host, ctx);
      });
      paintPersona(host);
      paintVoices(host);

      const input = host.querySelector("#cIn");
      input.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send(host, ctx); });
      host.querySelector("#sendBtn").onclick = () => send(host, ctx);
      host.querySelector("#micBtn").onclick = () => micInput(host, input);
      host.querySelector("#finishChat").onclick = () => finishSession(host, ctx);
      host.querySelector("#clearChat").onclick = () => clearCurrent(host);
      host.querySelector("#addWordBtn").onclick = () => toggleQuickForm(host, true);
      host.querySelector("#quickWordForm").onsubmit = e => { e.preventDefault(); addQuickWord(host); };
      host.querySelector("#quickWordIn").addEventListener("keydown", e => { if (e.key === "Escape") toggleQuickForm(host, false); });
      host.querySelector("#saveSentenceBtn").onclick = () => saveSentence(host);

      if (ctx.payload && ctx.payload.preset) input.value = ctx.payload.preset;
      paintHistory(host, ctx);
      paintLog(host, ctx);
    }
  };

  const scene = () => (window.LD_SCENES || []).find(s => s.id === sceneId) || window.LD_SCENES[0];

  /* ============ 人设 / 音色 / 生词本快捷区 ============ */
  function starterMsg(p) {
    return { role: "assistant", content: (p || persona()).starter || scene().starter, tip: "", t: Date.now() };
  }

  function setPersona(id, host, ctx) {
    const p = PERSONAS.find(x => x.id === id);
    if (!p) return;
    const s = S();
    const changed = s.chatPersona !== id;
    s.chatPersona = id;
    const list = msgs();
    if (changed) {
      const hasUser = list.some(m => m.role === "user");
      if (!hasUser) {
        list.length = 0;
        list.push(starterMsg(p));
      } else {
        list.push({ role: "system", content: `已切换人设：${p.name}（${p.desc}）`, t: Date.now() });
      }
      window.LD.Store.save();
      toast(`已切换人设：${p.name}`, "ok");
    }
    paintPersona(host);
    paintVoices(host);
    paintLog(host, ctx);
  }

  function paintPersona(host) {
    const p = persona();
    host.querySelectorAll(".persona-item").forEach(b => {
      const on = b.dataset.persona === p.id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const badge = host.querySelector("#personaBadge");
    if (badge) badge.textContent = p.name;
  }

  function deVoices() {
    const SU = window.LD.SpeechUtil;
    if (!SU || !SU.deVoices) return [];
    try { return SU.deVoices() || []; } catch (e) { return []; }
  }

  function paintVoices(host) {
    const sel = host.querySelector("#voiceSel");
    if (!sel) return;
    const voices = deVoices();
    const saved = S().chatVoice || "";
    sel.innerHTML = `<option value="">默认德语语音</option>` + voices.map(v =>
      `<option value="${esc(v.voiceURI)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join("");
    if (saved && voices.some(v => v.voiceURI === saved)) sel.value = saved;
    else {
      sel.value = "";
      /* voices 可能尚未异步加载：此时保留用户选择，等 voiceschanged 再回填 */
      if (saved && voices.length) { S().chatVoice = ""; window.LD.Store.save(); }
    }
    sel.onchange = () => {
      S().chatVoice = sel.value;
      window.LD.Store.save();
      toast(sel.value ? "已切换朗读音色" : "已恢复默认德语语音", "ok");
    };
    const hint = host.querySelector("#voiceHint");
    if (hint) {
      hint.textContent = voices.length
        ? `检测到 ${voices.length} 个德语语音${persona().id === "slow" ? "；慢速入门按 0.72× 朗读" : ""}。`
        : "未检测到德语语音包：朗读会用浏览器默认音色，可在系统设置中安装德语语音。";
    }
    if (!voiceBound) {
      voiceBound = true;
      try {
        window.speechSynthesis.addEventListener("voiceschanged", () => {
          const view = document.getElementById("view");
          if (view && view.querySelector("#voiceSel")) paintVoices(view);
        });
      } catch (e) { /* 部分环境没有 voiceschanged 事件 */ }
    }
  }

  function currentVoice() {
    const uri = S().chatVoice;
    if (!uri) return null;
    return deVoices().find(v => v.voiceURI === uri) || null;
  }

  function sayDe(text) {
    try {
      if (window.LD.SpeechUtil && window.LD.SpeechUtil.say) {
        window.LD.SpeechUtil.say(text, persona().rate, { voice: currentVoice() });
      }
    } catch (e) { /* 无语音环境时静默 */ }
  }

  function toggleQuickForm(host, show) {
    const form = host.querySelector("#quickWordForm");
    if (!form) return;
    form.hidden = !show;
    if (show) {
      const input = host.querySelector("#quickWordIn");
      if (input) input.focus();
    }
  }

  function addQuickWord(host) {
    const input = host.querySelector("#quickWordIn");
    const raw = (input.value || "").trim();
    if (!raw) { toast("先输入一个德语单词", "info"); return; }
    const rec = window.LD.Lex ? window.LD.Lex.lookup(raw) : null;
    const de = rec ? rec.de : raw;
    const before = S().wordbank.length;
    const item = window.LD.Store.addWord({
      de, zh: rec ? rec.zh : "", scene: sceneId,
      ctx: (lastGerman() || {}).text || ""
    });
    const existed = item && S().wordbank.length === before;
    if (existed) toast(`「${de}」已在生词本`, "info");
    else toast(rec ? `已加入「${de}」· ${rec.zh}` : `已加入「${de}」（词库未收录，释义待补充）`, rec ? "ok" : "info");
    input.value = "";
    toggleQuickForm(host, false);
    paintQuickWords(host);
    paintBank(host);
  }

  function lastGerman() {
    const list = msgs();
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.role !== "assistant" && m.role !== "user") continue;
      const text = String(m.content || "").trim();
      if (text && !/[\u4e00-\u9fa5]/.test(text)) return { m, text };
    }
    return null;
  }

  function saveSentence(host) {
    const hit = lastGerman();
    if (!hit) { toast("还没有可保存的德语句子，先聊一句吧", "info"); return; }
    const before = S().wordbank.length;
    const item = window.LD.Store.addWord({
      de: hit.text, ctx: `整句收藏 · ${scene().name}`, scene: sceneId, kind: "sentence"
    });
    const existed = item && S().wordbank.length === before;
    toast(existed ? "这句已经在生词本里了" : "已保存整句到生词本", existed ? "info" : "ok");
    paintQuickWords(host);
    paintBank(host);
  }

  function paintQuickWords(host) {
    const box = host.querySelector("#quickWords");
    if (!box) return;
    const bank = (S().wordbank || []).slice(0, 8);
    if (!bank.length) {
      box.innerHTML = `<div class="hint" style="margin:0">还没有收藏 —— 点击对话里的德语单词，或用上方按钮加入。</div>`;
      return;
    }
    box.innerHTML = bank.map(w => `
      <button class="quick-word ${w.kind === "sentence" ? "sentence" : ""}" data-qw="${esc(w.id)}"
        title="${esc(w.zh || w.ctx || w.de)}">${esc(w.de)}</button>`).join("");
    box.querySelectorAll("[data-qw]").forEach(b => b.onclick = () => {
      const w = (S().wordbank || []).find(x => x.id === b.dataset.qw);
      if (w) sayDe(w.de);
    });
  }

  function clearCurrent(host) {
    if (sending) { toast("等这一轮回复完成后再清空", "info"); return; }
    const btn = host.querySelector("#clearChat");
    if (!clearArmed) {
      clearArmed = true;
      if (btn) btn.textContent = "再次点击确认清空";
      setTimeout(() => {
        clearArmed = false;
        const b = host.querySelector("#clearChat");
        if (b) b.textContent = "清空对话";
      }, 3200);
      return;
    }
    clearArmed = false;
    if (btn) btn.textContent = "清空对话";
    const s = S();
    s.chats[sceneId] = [starterMsg()];
    if (s.chatActive) delete s.chatActive[sceneId];
    window.LD.Store.save();
    paintLog(host);
    paintQuickWords(host);
    toast("已清空当前场景对话（生词本与报告保留）", "ok");
  }

  function fmtTime(t) {
    try { return new Date(t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }

  function msgs() {
    const s = S();
    s.chats[sceneId] = s.chats[sceneId] || [starterMsg()];
    return s.chats[sceneId];
  }

  /* 把纯文本中的德语单词包装为可点击收藏的 span（公共层） */
  function linkWords(text) {
    return window.LD.WordLink ? window.LD.WordLink.linkHTML(text) : esc(text);
  }

  function paintLog(host, ctx) {
    const log = host.querySelector("#log");
    if (!log) return;
    const list = msgs();
    let lastSid = "";
    log.innerHTML = list.map((m, idx) => {
      let head = "";
      if (m.sid && lastSid && m.sid !== lastSid) head = `<div class="msg system">— 新一轮 —</div>`;
      if (m.sid) lastSid = m.sid;
      if (m.role === "system") return head + `<div class="msg system">${esc(m.content)}</div>`;
      const note = m.orig ? `<span class="tip">中文原句：${esc(m.orig)} · 大模型翻译</span>` : "";
      const tip = m.tip ? `<span class="tip">${esc(m.tip)}</span>` : "";
      return head + `
        <div class="msg-row ${m.role === "user" ? "me" : "ai"}">
          <div class="msg ${m.role === "user" ? "me" : "ai"}">${linkWords(m.content)}${note}${tip}</div>
          ${m.t ? `<div class="msg-time">${fmtTime(m.t)}</div>` : ""}
        </div>`;
    }).join("");
    log.scrollTop = log.scrollHeight;
    bindWordLinks(log, host);
    paintBank(host);
    paintQuickWords(host);
    paintSession(host);
  }

  function bindWordLinks(log, host) {
    if (window.LD.WordLink) window.LD.WordLink.bind(log, { mode: "quick", module: "德语对话室", scene: sceneId });
  }

  function paintBank(host) {
    const box = host.querySelector("#bank");
    if (!box) return;
    const bank = S().wordbank;
    if (!bank.length) {
      box.innerHTML = `<div class="empty" style="padding:18px 6px"><div class="big">${window.LD.icon("book")}</div><strong>还没有收藏</strong><p>点击左侧对话中的德语单词试试</p></div>`;
      return;
    }
    box.innerHTML = bank.slice(0, 60).map(w => `
      <div style="padding:9px 0;border-bottom:1px solid var(--line-soft)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
          <b class="de" style="font-size:13.5px;${w.known ? "color:var(--text-3);text-decoration:line-through" : ""}">${esc(w.de)}</b>
          <span style="display:flex;gap:4px;flex-shrink:0">
            ${w.kind === "sentence" ? `<span class="tag">整句</span>` : ""}
            <button class="btn btn-sm" data-say="${esc(w.de)}" title="发音">${window.LD.icon("volume")}</button>
            <button class="btn btn-sm" data-known="${w.id}" title="标记掌握">${w.known ? "↺" : "✓"}</button>
            <button class="btn btn-sm" data-del="${w.id}" title="删除">✕</button>
          </span>
        </div>
        ${w.ctx ? `<div style="font-size:12px;color:var(--text-3);margin-top:3px;line-height:1.5">…${esc(w.ctx)}…</div>` : ""}
      </div>`).join("");
    box.querySelectorAll("[data-say]").forEach(b => b.onclick = () => sayDe(b.dataset.say));
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { window.LD.Store.removeWord(b.dataset.del); paintBank(host); });
    box.querySelectorAll("[data-known]").forEach(b => b.onclick = () => { window.LD.Store.toggleWordKnown(b.dataset.known); paintBank(host); });
  }

  /* ============ 对话会话与课后报告 ============ */
  const KNOWN_TYPES = ["语序", "格变化", "助动词", "否定", "搭配", "正字法", "综合"];

  function activeSession() {
    return (S().chatActive || {})[sceneId] || null;
  }

  function ensureSession() {
    const s = S();
    s.chatActive = s.chatActive || {};
    let a = s.chatActive[sceneId];
    if (!a) {
      a = {
        sid: "cs" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        startedAt: Date.now()
      };
      s.chatActive[sceneId] = a;
      window.LD.Store.save();
    }
    const run = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("chat") : null;
    if (run && (!run.data || !run.data.chat || run.data.chat.sessionId !== a.sid)) {
      window.LD.FirstWeek.update(run, { data: Object.assign({}, run.data || {}, {
        chat: Object.assign({}, (run.data && run.data.chat) || {}, { sessionId: a.sid })
      }) });
    }
    return a;
  }

  function sessionMessages(sid) {
    return msgs().filter(m => m.sid === sid);
  }

  function sessionTurns() {
    const a = activeSession();
    return a ? sessionMessages(a.sid).filter(m => m.role === "user").length : 0;
  }

  function paintSession(host) {
    const turns = sessionTurns();
    const n = host.querySelector("#turnCount");
    if (n) n.textContent = turns;
    const sn = host.querySelector("#curSceneName");
    if (sn) sn.textContent = scene().name;
    const btn = host.querySelector("#finishChat");
    if (btn) btn.textContent = turns >= 3 ? "结束本轮并生成报告" : `还需 ${Math.max(0, 3 - turns)} 轮`;
  }

  function normType(type, why) {
    const t = String(type || "");
    if (KNOWN_TYPES.indexOf(t) >= 0) return t;
    for (const k of KNOWN_TYPES) if (t.indexOf(k) >= 0) return k;
    if (/位置|语序|从句|动词/.test(t)) return "语序";
    if (/变格|格/.test(t)) return "格变化";
    if (/助动词|haben|sein/.test(t)) return "助动词";
    if (/否定|kein/.test(t)) return "否定";
    if (/搭配|介词/.test(t)) return "搭配";
    if (/大小写|拼写|正字/.test(t)) return "正字法";
    return window.LD.LLM && LD.LLM.ruleTypeOf ? LD.LLM.ruleTypeOf(why || "") : "综合";
  }

  function normIssues(raw) {
    return (raw || []).filter(i => i && i.why).map(i => ({
      type: normType(i.type, i.why),
      wrong: i.wrong || "",
      fix: i.fix || "",
      why: i.why
    }));
  }

  const clampNum = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

  function buildReport(sess, list) {
    const users = list.filter(m => m.role === "user");
    const turns = users.length;
    const issues = [];
    users.forEach(m => (m.issues || []).forEach(i => issues.push(i)));

    const typeMap = Object.create(null);
    issues.forEach(i => { typeMap[i.type] = (typeMap[i.type] || 0) + 1; });
    const errorTypes = Object.keys(typeMap)
      .map(type => ({ type, n: typeMap[type] }))
      .sort((a, b) => b.n - a.n);

    const repMap = Object.create(null);
    issues.forEach(i => {
      const key = i.type + "|" + String(i.wrong || i.why).toLowerCase();
      if (!repMap[key]) repMap[key] = { type: i.type, wrong: i.wrong || "", fix: i.fix || "", why: i.why || "", n: 0 };
      repMap[key].n++;
    });
    const repeats = Object.keys(repMap).map(k => repMap[k])
      .filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3);

    const bank = (S().wordbank || []).filter(w =>
      w.scene === sceneId && w.kind !== "sentence" && (w.createdAt || w.t || 0) >= sess.startedAt);

    const words = users.map(m => m.content || "").join(" ").split(/\s+/).filter(Boolean);
    const unique = new Set(words.map(w => w.toLowerCase().replace(/[^a-zäöüß-]/g, "")).filter(Boolean));
    const avgWords = words.length / Math.max(1, turns);
    const issuePerTurn = issues.length / Math.max(1, turns);

    const dims = {
      task: clampNum(turns / 5 * 100, 0, 100),
      grammar: clampNum(100 - issuePerTurn * 22, 25, 98),
      vocab: clampNum(48 + Math.min(28, avgWords * 1.4) + Math.min(18, bank.length * 3), 30, 98),
      fluency: clampNum(avgWords * 4, 25, 98)
    };
    const total = clampNum(
      dims.task * .2 + dims.grammar * .35 + dims.vocab * .2 + dims.fluency * .25, 0, 100);

    const topType = errorTypes[0] ? errorTypes[0].type : "";
    let summary = `${turns} 轮对话`;
    summary += issues.length
      ? `共出现 ${issues.length} 处问题，最多的是「${topType}」。`
      : "没有发现明显语法错误。";
    if (repeats.length) summary += ` 其中「${(repeats[0].wrong || repeats[0].why).slice(0, 24)}」重复出现 ${repeats[0].n} 次。`;
    if (bank.length) summary += ` 本轮收藏了 ${bank.length} 个新词。`;
    if (dims.fluency < 60) summary += " 句子偏短，下一轮尝试每轮 25 词以上。";

    const next = [];
    if (repeats.length) next.push({ text: `重练重复错误「${(repeats[0].wrong || repeats[0].why).slice(0, 20)}」`, route: "weak" });
    if (topType) next.push({ text: `去专项训练：${topType}`, route: "drill" });
    if (bank.length) next.push({ text: `复习本轮 ${bank.length} 个生词`, route: "vocab" });
    if (dims.fluency < 60) next.push({ text: "再聊一轮，目标每轮至少 25 词", route: "chat", scene: sceneId });
    if (next.length < 3) next.push({ text: "去弱点突破，把本轮错点加入下一张练习卷", route: "weak" });
    while (next.length > 3) next.pop();

    return {
      id: "cr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sid: sess.sid,
      scene: sceneId,
      sceneName: scene().name,
      t: Date.now(),
      startedAt: sess.startedAt,
      turns,
      issues: issues.length,
      errorTypes,
      repeats,
      newWords: bank.map(w => ({ de: w.de, zh: w.zh || "" })),
      dims,
      total,
      summary,
      next,
      source: "local",
      advice: []
    };
  }

  function finishSession(host, ctx) {
    if (sending) { toast("等这一轮回复完成后再生成报告", "info"); return; }
    const sess = activeSession();
    if (!sess) { toast("先开始一轮对话", "err"); return; }
    const list = sessionMessages(sess.sid);
    const turns = list.filter(m => m.role === "user").length;
    if (turns < 3) { toast("至少进行 3 轮对话后再生成报告", "err"); return; }

    const rep = buildReport(sess, list);
    const s = S();
    s.chatReports = s.chatReports || [];
    s.chatReports.unshift(rep);
    if (s.chatReports.length > 50) s.chatReports = s.chatReports.slice(0, 50);
    delete s.chatActive[sceneId];
    window.LD.Store.addSession({ module: "chat", ms: Date.now() - sess.startedAt, count: turns });
    window.LD.Store.save();

    const run = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("chat") : null;
    if (run && window.LD.FirstWeek) {
      window.LD.FirstWeek.update(run, {
        progress: turns,
        data: Object.assign({}, run.data || {}, {
          chat: { sessionId: sess.sid, reportId: rep.id, turns }
        })
      });
      window.LD.FirstWeek.evidence(run, "对话报告");
    }
    paintSession(host);
    paintHistory(host, ctx);
    showReport(host, ctx, rep, { scroll: true });
    enhanceReport(rep, host, ctx);
  }

  /* 有直连大模型时补一段中文总评与改写；失败不影响本地报告 */
  function enhanceReport(rep, host, ctx) {
    if (!window.LD.LLM || !LD.LLM.ready()) return;
    const sys = `你是面向中国学生的德语口语教练。根据一轮对话的统计生成严格 JSON：
{"summary":"中文总评，80字以内，指出最值得改的一点","rewrite":"针对重复错误给出一个德语改写示范","advice":["一条具体可执行的建议"]}
不要输出 JSON 以外的文字；不要虚构学生没有说过的内容。`;
    const payload = {
      scene: rep.sceneName, turns: rep.turns, errorTypes: rep.errorTypes,
      repeats: rep.repeats, newWords: rep.newWords, dims: rep.dims
    };
    LD.LLM.chat([{ role: "system", content: sys }, { role: "user", content: JSON.stringify(payload) }],
      { temperature: 0.3, timeout: 30000 })
      .then(txt => {
        const j = LD.LLM.safeJSON(txt);
        if (!j) return;
        if (j.summary) rep.summary = String(j.summary).slice(0, 300);
        if (j.rewrite) rep.rewrite = String(j.rewrite).slice(0, 300);
        if (Array.isArray(j.advice) && j.advice.length) rep.advice = j.advice.slice(0, 3).map(String);
        rep.source = "llm";
        window.LD.Store.save();
        if (host.querySelector("#chatReport [data-rep='" + rep.id + "']")) showReport(host, ctx, rep, { scroll: false });
      })
      .catch(() => { /* 保持本地模板报告 */ });
  }

  function showReport(host, ctx, rep, opts) {
    opts = opts || {};
    const box = host.querySelector("#chatReport");
    if (!box) return;
    const dims = [
      ["任务完成", rep.dims.task], ["语法", rep.dims.grammar],
      ["词汇", rep.dims.vocab], ["流利", rep.dims.fluency]
    ];
    const topType = rep.errorTypes[0] ? rep.errorTypes[0].type : "";
    const run = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("chat") : null;
    const chatData = run && run.data && run.data.chat;
    const currentReport = !!(run && chatData && chatData.reportId === rep.id && chatData.sessionId === rep.sid);
    const receipt = currentReport
      ? window.LD.FirstWeek.receipt(run, {
        embedded: true,
        title: "本次对话回执",
        summary: `${rep.turns} 轮对话 · ${rep.total} 分`,
        detail: `问题 ${rep.issues} 处 · ${rep.source === "llm" ? "大模型增强" : "本地模板"}报告`,
        evidence: "对话报告",
        source: "chat-round",
        label: "完成对话任务"
      })
      : "";
    box.innerHTML = `
      <div class="card card-pad" data-rep="${esc(rep.id)}" style="margin-top:14px;border-color:var(--brand)">
        ${receipt}
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
          <div id="crRing"></div>
          <div style="flex:1;min-width:220px">
            <div style="font-weight:600;font-size:17px">对话课后报告 · ${esc(rep.sceneName)}</div>
            <div style="color:var(--text-3);font-size:12.5px;margin-top:3px">${new Date(rep.t).toLocaleString("zh-CN")} · ${rep.turns} 轮对话 · ${rep.issues} 处问题 · ${rep.source === "llm" ? "大模型增强" : "本地模板"}</div>
          </div>
        </div>
        <div class="dims">
          ${dims.map(([n, v]) => `<div class="dim-row"><div class="n">${n}</div>
            <div class="dim-bar"><i style="width:${v}%"></i></div><div class="s">${v}</div></div>`).join("")}
        </div>
        <div class="grid g2" style="margin-top:16px">
          <div class="report-sec"><h2>错误类型分布</h2>
            ${rep.errorTypes.length ? `<div id="crBars"></div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${rep.errorTypes.map(e => `<span class="tag ${e.type === topType ? "tag-warn" : ""}">${esc(e.type)} × ${e.n}</span>`).join("")}</div>`
        : `<p>本轮没有发现明显语法问题。</p>`}
          </div>
          <div class="report-sec"><h2>${window.LD.icon("repeat")} 重复错误</h2>
            ${rep.repeats.length ? rep.repeats.map(r => `<p>· ${esc(r.wrong || r.why)}（${r.n} 次）${r.fix ? `<span style="color:var(--text-3)"> → ${esc(r.fix)}</span>` : ""}</p>`).join("")
        : `<p>没有重复出现同一错误。</p>`}
          </div>
        </div>
        <div class="report-sec"><h2>${window.LD.icon("book")} 本轮新词（${rep.newWords.length}）</h2>
          ${rep.newWords.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${rep.newWords.map(w => `<span class="tag"><b class="de">${esc(w.de)}</b>${w.zh ? " " + esc(w.zh) : ""}</span>`).join("")}</div>`
        : `<p>本轮没有收藏生词 —— 点击对话中的德语单词即可收藏。</p>`}
        </div>
        <div class="report-sec"><h2>下一步</h2>
          <div class="btn-row">${rep.next.map(n => `<button class="btn btn-sm" data-cr-go="${esc(n.route)}"${n.scene ? ` data-cr-scene="${esc(n.scene)}"` : ""}>${esc(n.text)}</button>`).join("")}</div>
        </div>
        ${rep.advice && rep.advice.length ? `<div class="report-sec"><h2>教练建议</h2>${rep.advice.map(a => `<p>· ${esc(a)}</p>`).join("")}</div>` : ""}
        ${rep.rewrite ? `<div class="report-sec"><h2>✍️ 改写示范</h2><p class="de" style="font-size:14px;line-height:1.8">${esc(rep.rewrite)}</p></div>` : ""}
        <div class="report-sec"><h2>${window.LD.icon("pen")} 总评</h2><p>${esc(rep.summary)}</p></div>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn btn-primary" id="crAgain">再来一轮</button>
          <button class="btn" id="crWeak">去弱点突破</button>
        </div>
      </div>`;

    const ring = box.querySelector("#crRing");
    if (ring) window.LD.Charts.ring(ring, rep.total, {
      size: 84,
      color: rep.total >= 75 ? "var(--ok)" : rep.total >= 60 ? "var(--accent)" : "var(--danger)"
    });
    const bars = box.querySelector("#crBars");
    if (bars && rep.errorTypes.length) {
      window.LD.Charts.bars(bars, rep.errorTypes.map(e => ({
        k: e.type, v: e.n, color: e.type === topType ? "var(--accent)" : "var(--brand)"
      })), { w: 420, h: 140 });
    }
    box.querySelectorAll("[data-cr-go]").forEach(b => b.onclick = () =>
      ctx.go(b.dataset.crGo, b.dataset.crScene ? { scene: b.dataset.crScene } : null));
    const again = box.querySelector("#crAgain");
    if (again) again.onclick = () => ctx.go("chat", { scene: rep.scene });
    const weak = box.querySelector("#crWeak");
    if (weak) weak.onclick = () => ctx.go("weak");
    if (opts.scroll !== false) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function paintHistory(host, ctx) {
    const box = host.querySelector("#reportHist");
    if (!box) return;
    const reports = S().chatReports || [];
    if (!reports.length) {
      box.innerHTML = `<div class="hint" style="margin:0">还没有报告 —— 聊满 3 轮后点上方按钮生成。</div>`;
      return;
    }
    box.innerHTML = reports.slice(0, 5).map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:7px 0;border-bottom:1px solid var(--line-soft)">
        <div style="min-width:0">
          <div style="font-size:12.5px;font-weight:500">${esc(r.sceneName)} · ${r.total} 分</div>
          <div style="font-size:12px;color:var(--text-3)">${new Date(r.t).toLocaleDateString("zh-CN")} · ${r.turns} 轮</div>
        </div>
        <button class="btn btn-sm" data-view-rep="${esc(r.id)}">查看</button>
      </div>`).join("");
    box.querySelectorAll("[data-view-rep]").forEach(b => b.onclick = () => {
      const rep = reports.find(x => x.id === b.dataset.viewRep);
      if (rep) showReport(host, ctx, rep, { scroll: true });
    });
  }

  function send(host, ctx) {
    if (sending) return;
    const input = host.querySelector("#cIn");
    const text = input.value.trim();
    if (!text) return;
    if (/[\u4e00-\u9fa5]/.test(text)) { sendChinese(host, ctx, input, text); return; }
    input.value = "";
    sendGerman(host, ctx, text, "");
  }

  /* 中文输入：先走翻译通道（后端 / 直连），失败时明确提示，不伪造德语 */
  function sendChinese(host, ctx, input, text) {
    if (!window.LD.LLM || !window.LD.LLM.translateZh) { toast("当前版本没有翻译通道", "err"); return; }
    sending = true;
    const log = host.querySelector("#log");
    log.insertAdjacentHTML("beforeend", `<div class="msg ai" id="typing">正在翻译中文…</div>`);
    log.scrollTop = log.scrollHeight;
    window.LD.LLM.translateZh(text)
      .then(de => {
        const t = host.querySelector("#typing"); if (t) t.remove();
        const out = String(de || "").trim();
        if (!out) throw new Error("空译文");
        input.value = "";
        sending = false;
        sendGerman(host, ctx, out, text);
      })
      .catch(e => {
        const t = host.querySelector("#typing"); if (t) t.remove();
        sending = false;
        toast(`中文翻译不可用：${window.LD.UI && window.LD.UI.netErr ? window.LD.UI.netErr(e) : String(e && e.message || e)}。请用德语输入，或在设置中配置 AI 通道。`, "err");
      });
  }

  function sendGerman(host, ctx, text, zhOrig) {
    if (sending) return;
    const sess = ensureSession();
    const userMsg = { role: "user", content: text, orig: zhOrig || "", t: Date.now(), sid: sess.sid };
    const list = msgs();
    list.push(userMsg);
    paintLog(host, ctx);
    window.LD.Store.save();

    sending = true;
    const log = host.querySelector("#log");
    log.insertAdjacentHTML("beforeend", `<div class="msg ai" id="typing">…</div>`);
    log.scrollTop = log.scrollHeight;

    // 并行：语法指正（三层降级：后端 → 直连 → 本地）
    const checkP = window.LD.LLM.correct(text).catch(() => ({ issues: [] }));

    const history = list.filter(m => m.role !== "system");
    const useBackend = !!(window.LD.Backend && LD.Backend.ready());
    const sc = Object.assign({}, scene(), { sys: scene().sys + "\n" + persona().sys });
    let backendErr = null;
    const replyP = useBackend
      ? window.LD.Backend.chatStream(sceneId, history, text, full => {
        // 流式增量：后端约定以 --- 分隔德语回复与中文点评，故只渲染德语部分
        const t = log.querySelector("#typing");
        if (t) t.innerHTML = linkWords(splitTipText(full).text);
        log.scrollTop = log.scrollHeight;
      }, persona().id).then(full => splitTipText(full))
        .catch(err => {
          backendErr = err;
          return window.LD.LLM.reply(sc, history, text);   // 流式失败 → 直连/本地降级（原因会写进点评）
        })
      : window.LD.LLM.reply(sc, history, text);

    replyP.then(async r => {
      if (!r || !String(r.text || "").trim()) throw new Error("空回复");
      const issues = await checkP;
      const real = normIssues(issues.issues);
      userMsg.issues = real;
      let tip = r.tip || "";
      if (real.length) {
        const first = real[0];
        tip = (tip ? tip + " ｜ " : "") + `【${first.type || "语法"}】${first.why}`;
        /* 不再自动写入错题本：规则误报不应固化为"错题"，用户可自行存入 */
      }
      if (backendErr) {
        const friendly = window.LD.UI && window.LD.UI.netErr ? window.LD.UI.netErr(backendErr) : String(backendErr && backendErr.message || backendErr);
        const reason = String(friendly).slice(0, 80);
        tip = `【本地规则】后端不可用：${reason}` + (tip ? " ｜ " + tip : "");
      } else if (!real.length && !tip) {
        tip = persona().tip;
      }
      list.push({ role: "assistant", content: r.text, tip, t: Date.now(), sid: sess.sid });
      const t = host.querySelector("#typing"); if (t) t.remove();
      paintLog(host, ctx);
      window.LD.Store.save();
      // 朗读：使用对话室音色与人设语速
      sayDe(r.text.replace(/<[^>]+>/g, ""));
      window.LD.Store.logAnswer({ type: "chat", ability: "speaking", ok: real.length === 0, ms: 20000, item: sceneId, skill: "chat:" + sceneId });
      sending = false;
    }).catch(async e => {
      try {
        const issues = await checkP;
        userMsg.issues = normIssues(issues.issues);
        window.LD.Store.save();
      } catch (_) { /* 连本地规则都失败时不阻塞对话 */ }
      const t = host.querySelector("#typing"); if (t) t.remove();
      toast("回复失败：" + e.message, "err");
      sending = false;
      paintSession(host);
    });
  }

  /* 后端流式以 --- 分隔德语回复与中文点评 */
  function splitTipText(txt) {
    const parts = String(txt || "").split(/\n?---+\n?/);
    return { text: parts[0].trim(), tip: parts.slice(1).join("\n").trim() };
  }

  function micInput(host, input) {
    if (window.LD.ASR && LD.ASR.canRecord()) {
      if (host._chatRecorder) {
        const h = host._chatRecorder; host._chatRecorder = null;
        const btn = host.querySelector("#micBtn");
        if (btn) btn.textContent = "…";
        LD.ASR.stopAndTranscribe(h).then(r => { input.value = String(r.text || "").trim(); })
          .catch(e => toast("Whisper 转写失败：" + e.message, "err"))
          .finally(() => { if (btn) { btn.innerHTML = window.LD.icon("mic"); btn.classList.remove("recording"); } });
        return;
      }
      const btn = host.querySelector("#micBtn");
      LD.ASR.createRecorder().then(h => {
        host._chatRecorder = h; h.rec.start();
        if (btn) { btn.textContent = "■"; btn.classList.add("recording"); }
        toast("录音中；再次点击结束并转写", "info");
        setTimeout(() => { if (host._chatRecorder === h) host.querySelector("#micBtn").click(); }, 20000);
      }).catch(e => toast("无法访问麦克风：" + e.message, "err"));
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("当前浏览器不支持内置语音识别；可连接 Whisper 服务或直接输入德语。", "info"); return; }
    const rec = new SR();
    rec.lang = "de-DE"; rec.interim = true; rec.continuous = false;
    const btn = host.querySelector("#micBtn");
    btn.textContent = "●"; btn.style.color = "var(--danger)";
    rec.onresult = ev => {
      let txt = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      input.value = txt;
      if (ev.results[0].isFinal) { input.value = txt.trim(); }
    };
    rec.onerror = ev => toast("识别失败：" + ev.error, "err");
    rec.onend = () => { btn.innerHTML = window.LD.icon("mic"); btn.style.color = ""; };
    rec.start();
    toast("请开始说德语……", "info");
  }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "德语对话室", icon: "❝", group: "学习闭环", priority: "P0", order: 4, ds: "四种人设 × 场景 × 音色，点词与整句入库，中文输入走 AI 翻译通道" });
  window.LD.define("chat", Mod);
})();
