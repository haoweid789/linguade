/* 模块 19 · TestDaF 全真模考：四节限时（读 60' / 听 40' / 写 60' / 说 30'）+ TDN 估分
   题材复用现有题库（阅读 PASSAGES / 听力 DIALOG+DIALOGUES / 写作 TASKS / 口语 LINES），
   以「整卷节奏 + 估分报告」补齐零散题型训练缺的考试临场感。
   TDN 估分为启发式换算（≥85%→TDN5，≥70%→TDN4，≥50%→TDN3，否则低于 TDN3），非官方评分。 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;

  const SECTIONS = [
    { id: "lesen", nm: "阅读 Leseverstehen", minutes: 60, ability: "reading", ic: "▣" },
    { id: "hoeren", nm: "听力 Hörverstehen", minutes: 40, ability: "listening", ic: "headphones" },
    { id: "schreiben", nm: "写作 Schreiben", minutes: 60, ability: "writing", ic: "pen" },
    { id: "sprechen", nm: "口语 Sprechen", minutes: 30, ability: "speaking", ic: "◔" }
  ];

  /* TDN 换算（启发式，页面上明示非官方） */
  const tdnOf = pct => pct >= 85 ? 5 : pct >= 70 ? 4 : pct >= 50 ? 3 : 2;

  let stage = "intro", secIdx = 0;
  let qs = [], qi = 0, answers = [];            // lesen / hoeren 共用题流
  let writeText = "", writeTask = null;
  let speakDone = 0, speakIdx = 0, speakPhase = "prep";
  let timerHandle = null, timerTick = null, deadline = 0, timerHost = null;
  let result = null;

  const Mod = {
    title: "TestDaF 全真模考",
    desc: "读听写说四节限时整卷 + TDN 估分报告",
    render(host, ctx) {
      window.LD.Store.visit("mockexam");
      stopTimer();
      stage = "intro"; secIdx = 0; result = null;
      paintIntro(host, ctx);
    }
  };

  /* ============ 首页 / 历史 ============ */
  function paintIntro(host, ctx) {
    const hist = (S().mockexams || []).slice(0, 6);
    host.innerHTML = `
      <div class="page-head"><h1>TestDaF 全真模考</h1>
        <p>四节限时整卷：阅读 60 分钟 → 听力 40 分钟 → 写作 60 分钟 → 口语 30 分钟。计时结束自动交卷，也可提前提交。</p></div>
      <div class="card mx-brief" style="margin-bottom:14px">
        <div class="mx-sections">
          ${SECTIONS.map(s => `<div class="mx-section"><span class="mx-ic" aria-hidden="true">${window.LD.icon(s.ic)}</span><b>${s.nm.split(" ")[0]}</b><span>${s.nm.split(" ").slice(1).join(" ")}</span><em>${s.minutes} 分钟</em></div>`).join("")}
        </div>
        <div class="mx-brief-body">
          <div class="mx-copy">
            <b>全程 3 小时 10 分 · 四节独立计时</b>
            <p>阅读听力客观判分，写作按要点覆盖启发式估分，口语按任务完成度计；交卷后输出四节 TDN 估分（≥85%→TDN5 · ≥70%→TDN4 · ≥50%→TDN3，非官方换算）。</p>
          </div>
          <button class="btn btn-primary" id="mxStart">开始整卷模考</button>
        </div>
        <div class="hint">想快速体验流程（演示/测试）？每节都有「跳过本节」，可直接走到报告页。</div>
      </div>
      ${examPlanHtml()}
      ${hist.length ? `<div class="card card-pad">
        <h2 style="margin:0 0 10px;font-size:13.5px">历史模考（${hist.length}）</h2>
        <table class="tbl"><thead><tr><th>时间</th><th>读</th><th>听</th><th>写</th><th>写作题目</th><th>说</th><th>综合 TDN</th></tr></thead><tbody>
        ${hist.map(h => `<tr><td>${new Date(h.t).toLocaleString("zh-CN")}</td>
          <td>${h.pct.lesen}%</td><td>${h.pct.hoeren}%</td><td>${h.pct.schreiben}%</td><td>${esc((window.LD_WRITING_BANK || []).find(x => x.id === h.writeTask)?.title || "—")}</td><td>${h.pct.sprechen}%</td>
          <td><b style="color:${h.overall >= 4 ? "var(--ok)" : h.overall >= 3 ? "var(--warn)" : "var(--danger)"}">TDN ${h.overall}</b></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="card card-pad">
          <h2 style="margin:0 0 10px;font-size:13.5px">历史模考（0）</h2>
          <div class="empty"><div class="big">◷</div><strong>还没有模考记录</strong><p>完成一次整卷后，这里会保存四节正确率与 TDN 估分。</p></div>
        </div>`}`;
    host.querySelector("#mxStart").onclick = () => { secIdx = 0; startSection(host, ctx); };
    bindExamPlan(host);
  }

  /* ============ 考试结构速查（german_exam.db exams / exam_tasks） ============ */
  function examPlanHtml() {
    const plan = window.LD_EXAM_PLAN;
    if (!plan || !Array.isArray(plan.exams) || !plan.exams.length) return "";
    const def = plan.exams.some(e => e.exam_id === "TESTDAF") ? "TESTDAF" : plan.exams[0].exam_id;
    return `<details class="card card-pad" style="margin-bottom:14px">
      <summary style="cursor:pointer;font-weight:600;font-size:13.5px">考试结构速查（Goethe / telc / TestDaF）</summary>
      <div class="hint" style="margin-top:6px">选一个考试查看模块、时长与题量。数据来自公开考试说明，非官方评分细则。</div>
      <select id="mxPlanExam" style="width:100%;margin:8px 0">
        ${plan.exams.map(e => `<option value="${esc(e.exam_id)}" ${e.exam_id === def ? "selected" : ""}>${esc(e.name)}（${esc(e.level_code)}）</option>`).join("")}
      </select>
      <div id="mxPlanBody" style="overflow:auto"></div>
    </details>`;
  }

  function bindExamPlan(host) {
    const plan = window.LD_EXAM_PLAN;
    const sel = host.querySelector("#mxPlanExam");
    const body = host.querySelector("#mxPlanBody");
    if (!plan || !sel || !body) return;
    const paint = () => {
      const exam = plan.exams.find(e => e.exam_id === sel.value);
      const tasks = (plan.tasks || []).filter(t => t.exam_id === sel.value);
      const pass = (plan.pass || []).find(p => p.exam_id === sel.value);
      if (!exam) { body.innerHTML = ""; return; }
      body.innerHTML = `
        <div style="font-size:12.5px;line-height:1.8;margin-bottom:8px">
          <b>${esc(exam.name)}</b><br><span class="hint">${esc(exam.provider || "")} · ${esc(exam.level_code)}${exam.official_wordlist ? " · 有官方词表" : " · 词表为词频派生/参考"}</span>
        </div>
        <table class="tbl"><thead><tr><th>模块</th><th>部分</th><th>时长</th><th>题量</th><th>题型 / 说明</th></tr></thead><tbody>
        ${tasks.map(t => `<tr>
          <td>${esc(t.module)}</td><td>${esc(t.part || "—")}</td>
          <td>${t.minutes ? t.minutes + "′" : "—"}</td><td>${t.items || "—"}</td>
          <td style="font-size:12px"><b>${esc(t.task_type || "")}</b>${t.description_zh ? `<div class="hint" style="margin-top:2px">${esc(t.description_zh)}</div>` : ""}</td>
        </tr>`).join("")}
        </tbody></table>
        ${pass && pass.criteria_zh ? `<div class="hint" style="margin-top:8px">及格标准：${esc(pass.criteria_zh)}</div>` : ""}`;
    };
    sel.onchange = paint;
    paint();
  }

  /* ============ 节奏控制 ============ */
  function startSection(host, ctx) {
    const sec = SECTIONS[secIdx];
    stage = sec.id;
    answers = []; qi = 0; writeText = ""; speakDone = 0; speakIdx = 0;
    if (sec.id === "lesen") qs = buildLesen();
    if (sec.id === "hoeren") qs = buildHoeren();
    if (sec.id === "schreiben") writeTask = pickWriteTask();
    deadline = Date.now() + sec.minutes * 60000;
    startTimer(host);
    paintSection(host, ctx);
  }

  function startTimer(host) {
    stopTimer();
    timerHost = host;    // 切到别页时收口，避免向任意路由交付答卷（deadline 自行交卷 bug）
    timerTick = () => {
      const el = document.getElementById("mxTimer");
      const left = Math.max(0, deadline - Date.now());
      if (!el) { stopTimer(); return; }   // 人已不在模考页：先收口，不交付
      const m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
      el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      el.style.color = left < 5 * 60000 ? "var(--danger)" : "";
      if (left <= 0) {
        stopTimer();
        const host = (timerHost && document.contains(timerHost)) ? timerHost : null;
        if (host) finishSection(host, null, true);
      }
    };
    timerTick();
    timerHandle = setInterval(timerTick, 1000);
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } timerTick = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && timerTick) timerTick(); });

  function sectionShell(host, ctx, inner) {
    const sec = SECTIONS[secIdx];
    host.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div><h1 style="font-size:19px">${window.LD.icon(sec.ic)} 第 ${secIdx + 1}/4 节 · ${sec.nm}</h1>
        <p style="margin:0">限时 ${sec.minutes} 分钟</p></div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="tag" style="font-size:15px;font-weight:700;font-family:monospace" id="mxTimer">--:--</span>
          <button class="btn" id="mxSkip">跳过本节</button>
        </div>
      </div>
      <div class="card card-pad">${inner}</div>`;
    host.querySelector("#mxSkip").onclick = () => finishSection(host, ctx, false);
  }

  function finishSection(host, ctx, auto) {
    stopTimer();
    const sec = SECTIONS[secIdx];
    const pct = gradeSection(sec.id);
    result = result || { pct: {} };
    result.pct[sec.id] = pct;
    window.LD.Store.logAnswer({
      type: "mockexam", ability: sec.ability, ok: pct >= 50, ms: sec.minutes * 60000,
      item: "TestDaF 模考·" + sec.nm, skill: "mx:" + sec.id
    });
    window.LD.Store.addSession({ module: "mockexam", ms: 60000, count: 1 });
    secIdx++;
    if (secIdx >= SECTIONS.length) return finishExam(host, ctx);
    startSection(host, ctx);
  }

  /* ============ 阅读：复用 PASSAGES 组题 ============ */
  function buildLesen() {
    const bank = window.LD.ReadingPool ? window.LD.ReadingPool() : (window.LD_READING_PASSAGES || []);
    const readDone = S().readingDone || {};
    const ps = bank.slice().sort((a, b) => ((readDone[a.id] && readDone[a.id].times) || 0) - ((readDone[b.id] && readDone[b.id].times) || 0)).slice(0, 2);
    const out = [];
    ps.forEach(p => {
      p.paras.forEach((para, i) => {
        out.push({
          kind: "heading", lv: p.lv,
          q: `第 ${i + 1} 段的小标题是？`,
          sub: para.de.length > 160 ? para.de.slice(0, 160) + "…" : para.de,
          opts: p.headings.map((h, k) => `${h}（${p.headingZh[k]}）`),
          a: p.headingAns[i], why: `正确标题：${p.headings[p.headingAns[i]]}`
        });
      });
      p.tfng.forEach(t => out.push({
        kind: "tfng", lv: p.lv, q: t.qzh, sub: t.q,
        opts: ["richtig（正确）", "falsch（错误）", "nicht im Text（原文未提及）"],
        a: ["richtig", "falsch", "nicht im Text"].indexOf(t.a), why: t.why
      }));
      p.mcq.forEach(m => out.push({
        kind: "mcq", lv: p.lv, q: m.qzh, sub: m.q,
        opts: m.opts, a: m.a, why: m.why
      }));
    });
    return out;
  }

  /* ============ 听力：4 句单句听选 + 2 段双人对话 ============ */
  function buildHoeren() {
    const singles = (window.LD_LISTEN_BANK || []).slice(0, 4);
    const others = (window.LD_LISTEN_BANK || []).slice(4, 8);
    const pack = (((window.LD.Store.s.contentPack || {}).speech) || [])
      .filter(x => x.de && x.hasAudio && x.audioLicense && !/NC/i.test(x.audioLicense));
    const variedPack = pack.slice().sort(() => Math.random() - 0.5);
    const realAudioQs = variedPack.slice(0, 2).map(x => {
      const distractors = [...pack.filter(y => y.id !== x.id).map(y => y.de), ...singles.map(y => y.de), ...others.map(y => y.de)]
        .filter((de, k, all) => de !== x.de && all.indexOf(de) === k).slice(0, 3);
      return {
        kind: "hear", q: "你听到的是哪一句德语？", sub: "开放许可真人录音 · 可重复播放",
        opts: [x.de].concat(distractors), a: 0, why: `原句：${x.de}`,
        audioUrl: x.audioUrl || `https://audio.tatoeba.org/sentences/deu/${encodeURIComponent(x.id)}.mp3`,
        audioBy: x.audioBy || "Tatoeba contributor", audioLicense: x.audioLicense, realAudio: true
      };
    });
    const out = singles.slice(0, Math.max(0, 4 - realAudioQs.length)).map(x => ({
      kind: "hear", q: "这句话说了什么？", sub: "点击播放，可重复听",
      opts: [x.zh].concat(others.slice(0, 3).map(o => o.zh)), a: 0,
      why: `原句：${x.de}`, audio: x.de
    }));
    out.push(...realAudioQs);
    (window.LD_LISTEN_DIALOGUES || []).slice(0, 2).forEach(d => {
      out.push({
        kind: "dlg", q: d.q, sub: `对话场景：${d.scene}`,
        opts: d.opts, a: d.a, why: d.why, dialogue: d
      });
    });
    return shuffleMix(out);
  }

  /* 单句正确项恒在 A 不好，做一次固定打乱并记录答案 */
  function shuffleMix(arr) {
    const out = arr.map(item => {
      const idx = item.opts.map((_, k) => k).sort(() => Math.random() - 0.5);
      return Object.assign({}, item, {
        opts: idx.map(k => item.opts[k]),
        a: idx.indexOf(item.a)
      });
    });
    return out;
  }

  function pickWriteTask() {
    const bank = window.LD_WRITING_BANK || [];
    if (!bank.length) return null;
    const used = S().mockexams || [];
    const counts = new Map(bank.map(t => [t.id, used.filter(x => x.writeTask === t.id).length]));
    const min = Math.min(...counts.values());
    const leastUsed = bank.filter(t => counts.get(t.id) === min);
    const last = used[0] && used[0].writeTask;
    const choices = leastUsed.length > 1 ? leastUsed.filter(t => t.id !== last) : leastUsed;
    return (choices.length ? choices : leastUsed)[Math.floor(Math.random() * (choices.length || leastUsed.length))];
  }

  /* ============ 各节渲染 ============ */
  function paintSection(host, ctx) {
    const sec = SECTIONS[secIdx];
    if (sec.id === "lesen" || sec.id === "hoeren") return paintQuiz(host, ctx);
    if (sec.id === "schreiben") return paintWrite(host, ctx);
    return paintSpeak(host, ctx);
  }

  function paintQuiz(host, ctx) {
    if (qi >= qs.length) return finishSection(host, ctx, false);
    const q = qs[qi];
    const inner = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="tag tag-blue">第 ${qi + 1} / ${qs.length} 题</span>
        <span class="tag">${q.kind === "heading" ? "小标题匹配" : q.kind === "tfng" ? "判断正误" : q.kind === "mcq" ? "细节理解" : q.kind === "hear" ? "单句听力" : "对话听力"}</span>
      </div>
      ${q.audio || q.audioUrl ? `<div style="text-align:center;margin:14px 0">
        <button class="mic-btn" id="mxPlay" style="background:var(--grad)" aria-label="播放">${window.LD.icon("volume")}</button>
        ${q.realAudio ? `<div class="hint" style="margin-top:8px">真人录音 · ${esc(q.audioBy)} · ${esc(q.audioLicense)}</div>` : ""}
      </div>` : ""}
      ${q.dialogue ? `<div style="text-align:center;margin:14px 0">
        <button class="mic-btn" id="mxPlayDlg" style="background:var(--grad)" aria-label="播放对话">${window.LD.icon("play")}${window.LD.icon("people")}</button>
        <div class="hint" id="mxDlgHint" style="margin-top:8px">点击播放整段对话（可重复）</div>
      </div>` : ""}
      ${q.sub ? `<div style="font-size:13.5px;color:var(--text-2);line-height:1.8;margin-bottom:12px">${esc(q.sub)}</div>` : ""}
      <div style="font-size:15px;font-weight:600;margin-bottom:12px">${esc(q.q)}</div>
      <div id="mxOpts" style="display:flex;flex-direction:column;gap:8px"></div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-primary" id="mxNext" disabled>下一题</button>
        <button class="btn" id="mxSubmitSec">提前交本节</button>
      </div>`;
    sectionShell(host, ctx, inner);
    const play = host.querySelector("#mxPlay");
    if (play) play.onclick = () => {
      if (!q.audioUrl || !/^https?:$/.test(location.protocol)) return window.LD.SpeechUtil.say(q.audio || q.why.replace(/^原句：/, ""), 0.95);
      const audio = new Audio(q.audioUrl);
      if (window.LD.UI && window.LD.UI.registerAudio) window.LD.UI.registerAudio(audio);
      audio.playbackRate = 0.95;
      audio.onerror = () => window.LD.SpeechUtil.say(q.audio || q.why.replace(/^原句：/, ""), 0.95);
      audio.play().catch(() => window.LD.SpeechUtil.say(q.audio || q.why.replace(/^原句：/, ""), 0.95));
    };
    const playDlg = host.querySelector("#mxPlayDlg");
    if (playDlg) playDlg.onclick = () => {
      const st = { querySelector: () => null };  // 模考不显示逐句文稿（考试形态）
      window.LD.ListeningPlay ? window.LD.ListeningPlay(q.dialogue) : playDialogueLocal(q.dialogue);
    };
    let picked = -1;
    const oBox = host.querySelector("#mxOpts");
    q.opts.forEach((o, k) => {
      const b = document.createElement("div");
      b.className = "list-item"; b.style.cursor = "pointer";
      b.innerHTML = `<div class="main"><div class="t1">${String.fromCharCode(65 + k)}. ${esc(o)}</div></div>`;
      b.onclick = () => {
        picked = k;
        [...oBox.children].forEach((c, j) => c.style.background = j === k ? "var(--brand-soft)" : "");
        host.querySelector("#mxNext").disabled = false;
      };
      oBox.appendChild(b);
    });
    host.querySelector("#mxNext").onclick = () => {
      answers[qi] = picked;
      qi++;
      paintQuiz(host, ctx);
    };
    host.querySelector("#mxSubmitSec").onclick = () => finishSection(host, ctx, false);
  }

  /* 对话播放（模考内不显示文稿的简化版：顺序朗读两个角色） */
  function playDialogueLocal(dlg) {
    const SU = window.LD.SpeechUtil;
    const vs = SU && SU.deVoices ? SU.deVoices() : [];
    let k = 0;
    const step = () => {
      if (k >= dlg.turns.length) return;
      const t = dlg.turns[k];
      SU.say(t.de, 0.95, {
        voice: vs.length >= 2 ? vs[t.s === "A" ? 0 : 1] : undefined,
        pitch: vs.length >= 2 ? 1 : (t.s === "A" ? 1.15 : 0.85),
        onend: () => { k++; setTimeout(step, 200); }
      });
    };
    step();
  }

  function paintWrite(host, ctx) {
    const t = writeTask;
    const inner = `
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <span class="tag tag-blue">${t.exam} · ${t.type}</span><span class="tag">建议 ${t.min} 词以上</span>
      </div>
      <div style="font-weight:600;font-size:15px;margin-bottom:6px">${esc(t.title)}</div>
      <div style="font-size:13.5px;color:var(--text-2);line-height:1.8;margin-bottom:8px">${esc(t.prompt)}</div>
      <div class="hint">评分要点：${t.points.join(" / ")}</div>
      <textarea id="mxWrite" rows="12" style="width:100%;margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--text);font-size:14.5px;line-height:1.8;resize:vertical" placeholder="用德语写作……（考试形态：不显示范文，交卷后可回写作模块查看）"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span class="hint" id="mxWC" style="margin:0">0 词</span>
        <button class="btn btn-primary" id="mxSubmitSec">提交本节（写作）</button>
      </div>`;
    sectionShell(host, ctx, inner);
    const ta = host.querySelector("#mxWrite");
    ta.addEventListener("input", () => {
      writeText = ta.value;
      host.querySelector("#mxWC").textContent = (writeText.trim().match(/\S+/g) || []).length + " 词";
    });
    host.querySelector("#mxSubmitSec").onclick = () => finishSection(host, ctx, false);
  }

  function paintSpeak(host, ctx) {
    const lines = ((window.LD_SPEECH_BANK || []).slice(0, 3));
    const inner = `
      <div class="hint" style="margin-bottom:12px">口语节按「任务完成度」计分（模拟考试节奏：每题 30 秒准备 + 60 秒作答倒计时，完成后点「已完成」）。录音评分请到「口语测评」模块做精练。</div>
      ${lines.map((l, k) => `
        <div style="padding:10px 0;border-bottom:1px solid var(--line-soft)">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
            <div style="flex:1;min-width:220px">
              <div class="de" style="font-size:14px">${esc(l.de)}</div>
              <div style="font-size:12px;color:var(--text-3);margin-top:3px">${esc(l.zh)} · ${l.lv}</div>
            </div>
            <button class="btn ${speakDone > k ? "" : "btn-primary"}" data-mxdone="${k}">${speakDone > k ? "✓ 已完成" : "已完成"}</button>
          </div>
        </div>`).join("")}
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-primary" id="mxSubmitSec">提交本节（口语）</button>
      </div>`;
    sectionShell(host, ctx, inner);
    host.querySelectorAll("[data-mxdone]").forEach(b => b.onclick = () => {
      const k = +b.dataset.mxdone;
      if (speakDone <= k) speakDone = k + 1;
      b.textContent = "✓ 已完成"; b.classList.remove("btn-primary");
    });
    host.querySelector("#mxSubmitSec").onclick = () => finishSection(host, ctx, false);
  }

  /* ============ 判分 ============ */
  function gradeSection(id) {
    if (id === "lesen" || id === "hoeren") {
      if (!qs.length) return 0;
      const okN = qs.reduce((a, q, k) => a + (answers[k] === q.a ? 1 : 0), 0);
      return Math.round(okN / qs.length * 100);
    }
    if (id === "schreiben") {
      if (!writeTask) return 0;
      return window.LD.Writing && window.LD.Writing.evaluateLocal
        ? window.LD.Writing.evaluateLocal(writeText, writeTask).total
        : Math.min(100, Math.round((writeText.trim().match(/\S+/g) || []).length / writeTask.min * 100));
    }
    if (id === "sprechen") return Math.round(speakDone / 3 * 100);
    return 0;
  }

  function finishExam(host, ctx) {
    stopTimer();
    const tdn = {};
    SECTIONS.forEach(s => tdn[s.id] = tdnOf(result.pct[s.id]));
    const overall = Math.round(SECTIONS.reduce((a, s) => a + tdn[s.id], 0) / SECTIONS.length);
    const rec = { t: Date.now(), pct: result.pct, tdn, overall, writeTask: writeTask && writeTask.id };
    S().mockexams = S().mockexams || [];
    S().mockexams.unshift(rec);
    if (S().mockexams.length > 30) S().mockexams = S().mockexams.slice(0, 30);
    S().ability.reading = Math.round((S().ability.reading * 3 + Math.min(95, result.pct.lesen)) / 4);
    S().ability.listening = Math.round((S().ability.listening * 3 + Math.min(95, result.pct.hoeren)) / 4);
    window.LD.Store.save();
    window.LD.Store.addXp(80);

    const nm = { lesen: "阅读", hoeren: "听力", schreiben: "写作", sprechen: "口语" };
    const weak = SECTIONS.slice().sort((a, b) => result.pct[a.id] - result.pct[b.id])[0];
    const weakModule = { lesen: "reading", hoeren: "listening", schreiben: "writing", sprechen: "speech" };
    host.innerHTML = `
      <div class="page-head"><h1>模考报告 · 综合 TDN ${overall}</h1>
        <p>TDN 3 为多数德国高校入学门槛，TDN 4 为优势线；本估分为启发式换算，非官方成绩。</p></div>
      <div class="grid g4">
        ${SECTIONS.map(s => `<div class="card card-pad stat">
          <div class="k">${nm[s.id]}</div>
          <div class="v" style="color:${tdn[s.id] >= 4 ? "var(--ok)" : tdn[s.id] >= 3 ? "var(--warn)" : "var(--danger)"}">TDN ${tdn[s.id]}</div>
          <div class="s">${result.pct[s.id]}%</div></div>`).join("")}
      </div>
      <div class="card card-pad" style="margin-top:14px">
        <h2 style="margin:0 0 8px;font-size:14px">下一步建议</h2>
        <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:2;color:var(--text-2)">
          <li>最弱一节是 <b>${nm[weak.id]}</b>（${result.pct[weak.id]}%）—— 优先安排对应模块的专项训练；</li>
          <li>写作估分基于要点覆盖，请到「写作批改」模块用大模型做逐句精批；</li>
          <li>口语为完成度计分，发音与流利度请以「口语测评」的三维评分为准。</li>
        </ul>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-primary" id="mxWeakModule">去${nm[weak.id]}训练</button>
          <button class="btn" id="mxWeak">去弱点突破</button>
          <button class="btn" id="mxDrill">去专项训练</button>
        </div>
      </div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn-primary" id="mxAgain">再考一次</button>
        <button class="btn" id="mxHome">返回首页</button>
      </div>`;
    const go = ctx && ctx.go ? ctx.go : window.LD.router.go;
    host.querySelector("#mxAgain").onclick = () => Mod.render(host, ctx || { go });
    host.querySelector("#mxHome").onclick = () => go("home");
    host.querySelector("#mxWeakModule").onclick = () => go(weakModule[weak.id]);
    host.querySelector("#mxWeak").onclick = () => go("weak");
    host.querySelector("#mxDrill").onclick = () => go("drill");
  }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "全真模考", icon: "⏱", group: "场景实战", priority: "P0", order: 19, tags: ["考试"], ds: "TestDaF 四节限时整卷 + TDN 估分报告" });
  window.LD.define("mockexam", Mod);
})();
