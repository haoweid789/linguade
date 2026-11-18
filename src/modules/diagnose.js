/* 模块 0 · 入学能力诊断：10 分钟定位起点，生成个性化学习档案 */
(function () {
  const E = () => window.LD.Engine, S = () => window.LD.Store.s;

  const QUESTIONS = [
    { id: "d1", type: "vocab", ability: "vocab", q: "选出「大学」的正确德语表达", opts: ["die Universität", "die Schule", "das Studium", "die Lehre"], a: 0, why: "Universität（综合性大学）；Hochschule 泛指高校，Studium 指大学学业。" },
    { id: "d2", type: "vocab", ability: "vocab", q: "选出「注册入学」的正确名词", opts: ["die Immatrikulation", "der Immatrikulation", "die Immatrikulate", "das Immatrikulation"], a: 0, why: "-tion 结尾的外来名词多为阴性（die，如 die Immatrikulation）。" },
    { id: "d3", type: "grammar", ability: "grammar", q: "哪一句的语序是正确的？", opts: ["Weil ich habe keine Zeit.", "Weil ich keine Zeit habe.", "Weil keine Zeit ich habe.", "Weil keine Zeit habe ich."], a: 1, why: "weil 从句中变位动词必须置于从句末尾。" },
    { id: "d4", type: "grammar", ability: "grammar", q: "选出完成时助动词正确的一句", opts: ["Ich habe nach Berlin gefahren.", "Ich bin nach Berlin gefahren.", "Ich bin nach Berlin gefährt.", "Ich werde nach Berlin gefahren."], a: 1, why: "位移动词 fahren 完成时用 sein；fahren 的分词为 gefahren。" },
    { id: "d5", type: "grammar", ability: "grammar", q: "Er wohnt ______ einem kleinen Zimmer.", opts: ["in", "in dem", "im", "in der"], a: 0, why: "表示静态位置 in + 第三格；der/dem 均可但 einem 才是中性第三格。" },
    { id: "d6", type: "vocab", ability: "vocab", q: "选出「申请截止日期」的正确说法", opts: ["die Bewerbungsfrist", "der Bewerbungstermin", "die Bewerbungzeit", "das Bewerbungsdatum"], a: 0, why: "Frist 表示期限、截止日，是申请场景的核心词。" },
    { id: "d7", type: "grammar", ability: "grammar", q: "Ich interessiere mich ______ Geschichte.", opts: ["für", "auf", "an", "über"], a: 0, why: "sich interessieren für + A 为固定搭配。" },
    { id: "d8", type: "reading", ability: "reading", q: "Dieses Modul ist eine Pflichtveranstaltung. — 句意是？", opts: ["这门课可以自行选择", "这门课是必修课", "这门课已经取消", "这门课需要补考"], a: 1, why: "Pflicht = 义务；Wahl = 选择。Pflichtfach 必修 / Wahlfach 选修。" },
    { id: "d9", type: "grammar", ability: "grammar", q: "选出名词大写全部正确的一句", opts: ["Ich lerne jeden tag Deutsch.", "Ich lerne jeden Tag Deutsch.", "Ich lerne Jeden Tag Deutsch.", "Ich lerne jeden Tag deutsch."], a: 1, why: "仅名词 Tag 与语言名 Deutsch 需要大写。" },
    { id: "d10", type: "vocab", ability: "vocab", q: "选出「保证金账户」对应的德语词", opts: ["das Sperrkonto", "die Sperrung", "der Sperrmüll", "das Kontobuch"], a: 0, why: "Sperrkonto 是留德签证要求的保证金账户，属 APS/签证高频词。" }
  ];

  let cur = 0, answers = [], started = 0;

  const Mod = {
    title: "能力诊断",
    desc: "10 道题定位你的真实起点，系统据此调整词库难度与每日计划",
    render(host, ctx) {
      /* 已完成诊断通过结果页的「重新诊断」入口复测 */
      if (S().diagnosed) { ctx.go("home"); return; }
      answers = []; cur = 0; started = Date.now();
      host.innerHTML = `
        <div class="page-head">
          <h1>入学能力诊断</h1>
          <p>覆盖词汇、语法、阅读三类共 10 题，约 5 分钟。诊断结果直接决定自适应引擎的起点难度。</p>
        </div>
        <div class="card card-pad" style="margin-bottom:14px;border-color:var(--brand);background:var(--brand-soft)">
          <div style="font-size:13.5px;line-height:1.8">${window.LD.icon("lock")} 完成入学诊断后解锁学习模块。结果页可重新测量；诊断题不计入练习经验。</div>
        </div>
        <div class="card card-pad" id="quizBox"></div>
      `;
      renderQ(host, ctx);
    }
  };

  function renderQ(host, ctx) {
    const box = host.querySelector("#quizBox");
    if (cur >= QUESTIONS.length) return finish(box, ctx);
    const q = QUESTIONS[cur];
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="tag tag-blue">第 ${cur + 1} / ${QUESTIONS.length} 题</span>
        <span class="tag">${ { vocab: "词汇", grammar: "语法", reading: "阅读" }[q.type] }</span>
      </div>
      <div style="font-size:16px;line-height:1.7;margin-bottom:14px">${q.q}</div>
      <div id="opts" style="display:flex;flex-direction:column;gap:8px"></div>
      <div id="fb" style="margin-top:14px"></div>
    `;
    const oBox = box.querySelector("#opts");
    q.opts.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "list-item";
      b.style.cursor = "pointer";
      b.innerHTML = `<div class="main"><div class="t1">${String.fromCharCode(65 + i)}. ${o}</div></div>`;
      b.onclick = () => pick(i, q, box, oBox, ctx);
      oBox.appendChild(b);
    });
  }

  function pick(i, q, box, oBox, ctx) {
    const ok = i === q.a;
    answers.push({ id: q.id, ok, type: q.type, ability: q.ability, ms: Date.now() - started, picked: i });
    /* 诊断是「测量」不是「练习」：type=diagnose 不进每日任务，noXP 不产生经验值，
       避免新用户首日任务被诊断答案点亮、XP 虚高（真实练习的成长感知被稀释） */
    window.LD.Store.logAnswer({ type: "diagnose", ability: q.ability, ok, ms: 12000, item: q.id, noXP: true });
    [...oBox.children].forEach((c, k) => {
      c.style.pointerEvents = "none";
      /* pointer-events 拦不住键盘 Enter，禁用按钮才能保证一题只计一次 */
      c.disabled = true;
      if (k === q.a) c.style.background = "var(--ok-soft)";
      if (k === i && !ok) c.style.background = "var(--danger-soft)";
    });
    if (!ok) {
      /* 诊断是测量不是练习：错题只在结果页由用户点「存入错题本」时才落盘 */
    }
    box.querySelector("#fb").innerHTML = `
      <div class="corr-item"><div class="row"><span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
      <div><div style="font-size:13.5px">${ok ? "回答正确" : "正确答案：" + q.opts[q.a]}</div>
      <div class="why">${q.why}</div></div></div></div>
      <div style="margin-top:12px;text-align:right"><button class="btn btn-primary" id="nextBtn">${cur + 1 >= QUESTIONS.length ? "查看诊断报告" : "下一题"}</button></div>
    `;
    box.querySelector("#nextBtn").onclick = () => { cur++; renderQ(document.getElementById("view"), ctx); };
  }

  function finish(host, ctx) {
    host = document.getElementById("view");
    const correct = answers.filter(a => a.ok).length;
    const acc = Math.round(correct / answers.length * 100);
    const byAb = {};
    answers.forEach(a => { byAb[a.ability] = byAb[a.ability] || { n: 0, ok: 0 }; byAb[a.ability].n++; if (a.ok) byAb[a.ability].ok++; });
    // 更新能力画像
    const ab = (window.LD.Store.s).ability;
    Object.keys(byAb).forEach(k => { ab[k] = Math.max(10, Math.min(95, Math.round(byAb[k].ok / byAb[k].n * 100))); });
    (window.LD.Store.s).diagnosed = true;
    window.LD.Store.save();

    // 十道客观题只能提供粗略起点，不能据此推断 B2 及以上。
    const level = acc >= 80 ? "B1" : acc >= 60 ? "A2" : "A1";
    const focus = Object.keys(byAb).map(k => ({ k, acc: byAb[k].ok / byAb[k].n })).sort((a, b) => a.acc - b.acc).slice(0, 2)
      .map(x => ({ vocab: "词汇", grammar: "语法", reading: "阅读" })[x.k]);
    const min = acc >= 70 ? 45 : acc >= 50 ? 35 : 25;
    localStorage.setItem("linguade.diag", JSON.stringify({ level, acc, min, focus, t: Date.now() }));
    /* 用户手动设过起点（设置页/结果页）时，复测只更新能力画像，不把 C1 改回 B1 */
    const prevLevel = S().profile.level;
    const keepLevel = !!S().profile.levelTouched && prevLevel && prevLevel !== level;
    const startLevel = keepLevel ? prevLevel : level;
    S().profile.dailyMin = min;
    if (!keepLevel) S().profile.level = level;
    window.LD.Store.save();
    /* 诊断完成即生成首周排期：结果页与首页共用同一份 7 天计划 */
    let fw = E().firstWeekPlan(true);
    const fwOpts = {
      full: true,
      id: "diagWeekInner",
      title: "未来 7 天",
      subtitle: `按每天约 ${min} 分钟排好；复盘日替换次薄弱项，不额外加时`
    };
    const todayKey = window.LD.Store.dayKey();
    const todayEntry = fw.plan.find(d => d.date === todayKey) || fw.plan[0];
    const planFocus = (fw.focus && fw.focus.length) ? fw.focus : focus;

    host.innerHTML = `
      <div class="page-head"><h1>诊断完成</h1><p>先看清起点，再开始今天的第一项。</p></div>
      <div class="hint" style="margin-bottom:12px">这是基于 10 道词汇、语法和阅读题的初步估计，不代表完整 CEFR 认证或口语水平。</div>
      <div class="card card-pad" style="margin-bottom:14px;border-color:var(--brand)">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="tag tag-blue">起点 ${startLevel}</span><span class="tag">正确率 ${acc}%</span><span class="tag">每天约 ${min} 分钟</span></div>
        <h2 style="margin:10px 0 4px">接下来重点补 ${planFocus.join("、")}</h2>
        <p class="hint" style="margin:0">今天的计划：${todayEntry.tasks.map(t => t.text).join(" → ")}。完整七天安排收在下方，不需要现在全部看完。</p>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn btn-primary" id="toVocab">开始今天第一项</button>
          <button class="btn" id="toPlan">查看同一份计划</button>
        </div>
        <div class="hint" style="margin-top:10px">每日 ${min} 分钟是本次诊断给出的建议，可在「设置」中调整；不是能力结论。</div>
      </div>
      <details class="card card-pad" id="diagBasis" style="margin-top:14px">
        <summary style="cursor:pointer;font-weight:600">测评依据与本次覆盖范围</summary>
        <div class="grid g2" style="margin-top:14px">
          <div>
            <h2 style="margin:0 0 10px">本次测到的能力</h2>
            <div id="rd"></div>
            <p class="hint" style="margin:8px 0 0">本次只覆盖词汇、语法、阅读；听力、口语、写作<strong>未测</strong>，雷达不展示，也不代表初始水平。</p>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn-sm" data-diag-go="listening">练一组听力</button>
              <button class="btn btn-sm" data-diag-go="speech">练一组口语</button>
              <button class="btn btn-sm" data-diag-go="writing">练一次写作</button>
            </div>
          </div>
          <div>
            <h2 style="margin:0 0 10px">调整起点与后续操作</h2>
            <p class="hint" style="margin-top:0">10 道客观题最高只能估计到 B1；如果你已有 B2/C1 基础，可直接改这里，无需重做诊断。</p>
            <div class="form-row">
              <label for="diagLevel">实际起点（可调整）</label>
              <select id="diagLevel">
                ${["A1", "A2", "B1", "B2", "C1", "C2"].map(lv => `<option value="${lv}"${lv === startLevel ? " selected" : ""}>${lv}</option>`).join("")}
              </select>
              ${keepLevel ? `<div class="hint" style="color:var(--accent-text)">系统估计 ${level}；你之前手动设置的 ${startLevel} 已保留。</div>` : ""}
            </div>
            <div class="btn-row" style="margin-top:14px">
              ${answers.some(a => !a.ok) ? '<button class="btn" id="saveDiagWrong">存入错题本</button>' : ""}
              <button class="btn" id="toPlacement">已有基础？测得更准</button>
              <button class="btn btn-ghost" id="redoDiag">重新诊断</button>
            </div>
            <div class="hint" style="margin-top:8px">10 题诊断最高只能估到 B1；「测得更准」用 20 道词汇 + 30 道语法给出参考级别与词汇量估算（约 8–10 分钟，不测听说读写）。</div>
          </div>
        </div>
      </details>
      <details class="card card-pad" id="diagFirstWeek" style="margin-top:14px">
        <summary style="cursor:pointer;font-weight:600">查看未来 7 天安排 <span class="tag">${todayEntry.tasks.reduce((a, t) => a + t.min, 0)} 分钟 / 今天</span></summary>
        <div id="diagWeekBox" style="margin-top:12px">${window.LD.FirstWeek.render(fw.plan, fwOpts)}</div>
      </details>`;
    const lvSel = host.querySelector("#diagLevel");
    if (lvSel) {
      lvSel.value = startLevel;
      lvSel.onchange = () => {
        S().profile.level = lvSel.value;
        S().profile.levelTouched = true;
        window.LD.Store.save();
        fw = E().firstWeekPlan(true);
        const box = host.querySelector("#diagWeekBox");
        if (box) box.innerHTML = window.LD.FirstWeek.render(fw.plan, fwOpts);
        bindFirstWeek();
        window.LD.UI.toast(`起点已调整为 ${lvSel.value}，计划已按新起点重排`, "ok");
      };
    }
    window.LD.Store.addXp(25);   // 完成诊断一次性奖励（低于一次正常练习的量级）
    /* 完成状态跟随账号：服务端记一份（换浏览器也认），并同步学习档案 */
    if (window.LD.Auth && window.LD.Auth.markDiagnosed) window.LD.Auth.markDiagnosed();
    try { window.LD.Store.sync({ force: true }).catch(() => {}); } catch (e) { /* 离线模式忽略 */ }
    if (window.LD.router && window.LD.router.renderNav) window.LD.router.renderNav();
    if (window.LD.UI && window.LD.UI.updateChips) window.LD.UI.updateChips();
    const basis = host.querySelector("#diagBasis");
    const drawRadar = () => {
      const rd = host.querySelector("#rd");
      if (!rd || rd.dataset.drawn) return;
      rd.dataset.drawn = "1";
      const labels = { vocab: "词汇", grammar: "语法", reading: "阅读" };
      const tested = new Set(answers.map(a => labels[a.ability]).filter(Boolean));
      const data = E().radarData().filter(x => tested.has(x.key));
      window.LD.Charts.radar(rd, data, { h: 240 });
    };
    if (basis) basis.addEventListener("toggle", () => { if (basis.open) drawRadar(); });
    host.querySelector("#toVocab").onclick = () => {
      const day = fw.plan.find(d => d.date === window.LD.Store.dayKey()) || fw.plan[0];
      if (day && day.tasks[0]) window.LD.FirstWeek.launch(day.tasks[0], day.date, "home");
      ctx.go("vocab");
    };
    host.querySelector("#toPlan").onclick = () => {
      try { sessionStorage.setItem("linguade.planFocus", window.LD.Store.dayKey()); } catch (e) { }
      ctx.go("plan");
    };
    host.querySelectorAll("[data-diag-go]").forEach(b => b.onclick = () => ctx.go(b.dataset.diagGo));
    /* 首周计划勾选：只重绘这一块，不打断诊断结果页的其他交互 */
    const bindFirstWeek = () => window.LD.FirstWeek.bind(host, {
      onToggle: id => {
        const box = host.querySelector("#diagWeekBox");
        if (box) {
          box.innerHTML = window.LD.FirstWeek.render(fw.plan, fwOpts);
          bindFirstWeek();
          const row = box.querySelector('[data-fw-task="' + id + '"]');
          const again = row ? row.querySelector(".fw-check") : null;
          if (window.LD.FirstWeek.markRow) window.LD.FirstWeek.markRow(row);
          if (again) again.focus({ preventScroll: true });
        }
      },
      onGo: route => ctx.go(route),
      returnTo: "home"
    });
    bindFirstWeek();
    const saveDiagWrong = host.querySelector("#saveDiagWrong");
    if (saveDiagWrong) saveDiagWrong.onclick = () => {
      const qMap = new Map(QUESTIONS.map(q => [q.id, q]));
      let n = 0;
      answers.filter(a => !a.ok).forEach(a => {
        const q = qMap.get(a.id);
        if (!q || a.picked == null) return;
        window.LD.Store.addWrong({
          module: "诊断", type: q.type, wrong: q.opts[a.picked], right: q.opts[q.a],
          source: q.q, why: q.why
        });
        n++;
      });
      saveDiagWrong.disabled = true;
      saveDiagWrong.textContent = `已存入 ${n} 条`;
      window.LD.UI.toast(n ? `已存入错题本（${n} 条），可在「错题本」中组卷重练` : "没有需要存入的错题", n ? "ok" : "warn");
    };
    const toPlacement = host.querySelector("#toPlacement");
    if (toPlacement) toPlacement.onclick = () => ctx.go("placement");
    host.querySelector("#redoDiag").onclick = async () => {
      const proceed = await (window.LD.Auth && window.LD.Auth.resetDiagnosed ? window.LD.Auth.resetDiagnosed() : Promise.resolve(true));
      if (!proceed) return;
      /* 不擅自清理用户已存入错题本的诊断错题 */
      S().diagnosed = false;
      window.LD.Store.save();
      cur = 0; answers = []; started = Date.now();
      window.LD.router.renderNav();
      window.LD.router.go("diagnose");
    };
  }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "能力诊断", icon: "◎", group: "学习闭环", priority: "P0", order: 1, tags: ["入口"], ds: "10 题定位起点，生成能力画像与推荐强度" });
  window.LD.define("diagnose", Mod);
})();
