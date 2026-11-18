/* 模块 9 · 德语专项训练：冠词性别 / 强动词变位 / 介词支配格
   借鉴竞品 Bretzi 的 "article mastery game"：把德语三大高频痛点做成计时连击训练。 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;

  /* ---------- 题库一：冠词性别（由词库自动生成，覆盖全部名词） ---------- */
  function articlePool() {
    const nouns = (window.LD_LEX || []).filter(x => x[3] === "n" && x[1] !== "-");
    return nouns.map(n => ({ kind: "art", de: n[0], zh: n[2], a: n[1], lv: n[4], ex: n[5] }));
  }

  /* ---------- 题库二：强动词 / 助动词变位（人称 + 完成时） ---------- */
  const VERBS = [
    { inf: "sein", zh: "是", pr: ["bin", "bist", "ist", "sind", "seid", "sind"], perf: "ist", part: "gewesen", aux: "sein" },
    { inf: "haben", zh: "有", pr: ["habe", "hast", "hat", "haben", "habt", "haben"], perf: "hat", part: "gehabt", aux: "haben" },
    { inf: "werden", zh: "变成", pr: ["werde", "wirst", "wird", "werden", "werdet", "werden"], perf: "ist", part: "geworden", aux: "sein" },
    { inf: "können", zh: "能够", pr: ["kann", "kannst", "kann", "können", "könnt", "können"], perf: "hat", part: "gekonnt", aux: "haben" },
    { inf: "müssen", zh: "必须", pr: ["muss", "musst", "muss", "müssen", "müsst", "müssen"], perf: "hat", part: "gemusst", aux: "haben" },
    { inf: "wollen", zh: "想要", pr: ["will", "willst", "will", "wollen", "wollt", "wollen"], perf: "hat", part: "gewollt", aux: "haben" },
    { inf: "fahren", zh: "乘车", pr: ["fahre", "fährst", "fährt", "fahren", "fahrt", "fahren"], perf: "ist", part: "gefahren", aux: "sein" },
    { inf: "essen", zh: "吃", pr: ["esse", "isst", "isst", "essen", "esst", "essen"], perf: "hat", part: "gegessen", aux: "haben" },
    { inf: "lesen", zh: "读", pr: ["lese", "liest", "liest", "lesen", "lest", "lesen"], perf: "hat", part: "gelesen", aux: "haben" },
    { inf: "geben", zh: "给", pr: ["gebe", "gibst", "gibt", "geben", "gebt", "geben"], perf: "hat", part: "gegeben", aux: "haben" },
    { inf: "nehmen", zh: "拿", pr: ["nehme", "nimmst", "nimmt", "nehmen", "nehmt", "nehmen"], perf: "hat", part: "genommen", aux: "haben" },
    { inf: "sehen", zh: "看", pr: ["sehe", "siehst", "sieht", "sehen", "seht", "sehen"], perf: "hat", part: "gesehen", aux: "haben" },
    { inf: "sprechen", zh: "说", pr: ["spreche", "sprichst", "spricht", "sprechen", "sprecht", "sprechen"], perf: "hat", part: "gesprochen", aux: "haben" },
    { inf: "schlafen", zh: "睡觉", pr: ["schlafe", "schläfst", "schläft", "schlafen", "schlaft", "schlafen"], perf: "hat", part: "geschlafen", aux: "haben" },
    { inf: "laufen", zh: "跑", pr: ["laufe", "läufst", "läuft", "laufen", "lauft", "laufen"], perf: "ist", part: "gelaufen", aux: "sein" },
    { inf: "kommen", zh: "来", pr: ["komme", "kommst", "kommt", "kommen", "kommt", "kommen"], perf: "ist", part: "gekommen", aux: "sein" },
    { inf: "gehen", zh: "走", pr: ["gehe", "gehst", "geht", "gehen", "geht", "gehen"], perf: "ist", part: "gegangen", aux: "sein" },
    { inf: "helfen", zh: "帮助", pr: ["helfe", "hilfst", "hilft", "helfen", "helft", "helfen"], perf: "hat", part: "geholfen", aux: "haben" },
    { inf: "treffen", zh: "遇见", pr: ["treffe", "triffst", "trifft", "treffen", "trefft", "treffen"], perf: "hat", part: "getroffen", aux: "haben" },
    { inf: "vergessen", zh: "忘记", pr: ["vergesse", "vergisst", "vergisst", "vergessen", "vergesst", "vergessen"], perf: "hat", part: "vergessen", aux: "haben" },
    { inf: "beginnen", zh: "开始", pr: ["beginne", "beginnst", "beginnt", "beginnen", "beginnt", "beginnen"], perf: "hat", part: "begonnen", aux: "haben" },
    { inf: "schreiben", zh: "写", pr: ["schreibe", "schreibst", "schreibt", "schreiben", "schreibt", "schreiben"], perf: "hat", part: "geschrieben", aux: "haben" },
    { inf: "studieren", zh: "攻读", pr: ["studiere", "studierst", "studiert", "studieren", "studiert", "studieren"], perf: "hat", part: "studiert", aux: "haben" }
  ];
  const PRON = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];

  /* ---------- 题库三：介词支配格 ---------- */
  const PREPS = [
    { p: "für", zh: "为了", k: "A", tip: "für 永远支配第四格" },
    { p: "mit", zh: "和…一起", k: "D", tip: "mit 永远支配第三格" },
    { p: "bei", zh: "在…那里", k: "D", tip: "bei 支配第三格" },
    { p: "von", zh: "从；…的", k: "D", tip: "von 支配第三格" },
    { p: "zu", zh: "去（某处）", k: "D", tip: "zu 支配第三格" },
    { p: "nach", zh: "去（城市/国家）；之后", k: "D", tip: "nach 支配第三格" },
    { p: "aus", zh: "从…出来；来自", k: "D", tip: "aus 支配第三格" },
    { p: "seit", zh: "自从", k: "D", tip: "seit 支配第三格" },
    { p: "ohne", zh: "没有", k: "A", tip: "ohne 支配第四格" },
    { p: "durch", zh: "穿过；通过", k: "A", tip: "durch 支配第四格" },
    { p: "um", zh: "围绕；在…点（时间）", k: "A", tip: "um 支配第四格" },
    { p: "gegen", zh: "反对；朝", k: "A", tip: "gegen 支配第四格" },
    { p: "in", zh: "在…里 / 进入", k: "A/D", tip: "双向介词：静态（wo?）第三格，方向（wohin?）第四格" },
    { p: "an", zh: "在…旁 / 到…旁", k: "A/D", tip: "双向介词：静三动四" },
    { p: "auf", zh: "在…上 / 到…上", k: "A/D", tip: "双向介词：静三动四" },
    { p: "unter", zh: "在…下 / 到…下", k: "A/D", tip: "双向介词：静三动四" },
    { p: "über", zh: "在…上方 / 越过", k: "A/D", tip: "双向介词：静三动四" },
    { p: "neben", zh: "在…旁边", k: "A/D", tip: "双向介词：静三动四" },
    { p: "wegen", zh: "由于", k: "G", tip: "书面语支配第二格" },
    { p: "trotz", zh: "尽管", k: "G", tip: "支配第二格" },
    { p: "während", zh: "在…期间", k: "G", tip: "支配第二格" }
  ];

  const TYPES = {
    /* B3 注册表 id：select_genus（LD.Exercise） */
    art: { nm: "冠词性别", ic: "◉" },
    /* B3 注册表 id：conjugate */
    verb: { nm: "动词变位", ic: "⟲" },
    /* B3 注册表 id：select_case */
    prep: { nm: "介词支配格", ic: "⊕" }
  };

  let type = "art", stack = [], i = 0, t0 = 0, combo = 0, best = 0, right = 0, wrong = 0, msSum = 0, finished = false;

  const Mod = {
    title: "专项训练",
    desc: "冠词性别 / 动词变位 / 介词支配格——德语三大高频痛点，计时连击训练",
    render(host, ctx) {
      window.LD.Store.visit("drill");
      combo = 0; right = 0; wrong = 0; msSum = 0; finished = false; i = 0;
      /* 3.25.0：payload.type 预选题型（学情分析薄弱表 → 专项训练直达），chips/规则要点/题库随之切换 */
      if (ctx && ctx.payload && TYPES[ctx.payload.type]) type = ctx.payload.type;
      host.innerHTML = `
        <div class="page-head"><h1>德语专项训练</h1>
          <p>把德语三大高频痛点拆成可量化训练：冠词性别、强动词变位、介词支配格。连续答对形成 Combo。</p></div>
        <div class="scenes" style="padding:0;margin-bottom:14px;border:none">
          ${Object.keys(TYPES).map(k => `<div class="scene-chip ${type === k ? "active" : ""}" data-t="${k}">${TYPES[k].ic} ${TYPES[k].nm}</div>`).join("")}
        </div>
        <div class="grid" style="grid-template-columns:1fr 260px">
          <div class="card card-pad" id="quiz"></div>
          <div class="card card-pad" style="align-self:flex-start">
            <h2 style="margin:0 0 10px;font-size:13.5px">${TYPES[type].nm} · 规则要点</h2>
            <div id="cheat" style="font-size:12.5px;line-height:1.9;color:var(--text-2)"></div>
            <div class="divider"><span>本轮战绩</span></div>
            <div id="board"></div>
          </div>
        </div>`;
      LD.UI.moduleTabs(host, [{ route: "drill", label: "专项训练" }, { route: "weak", label: "弱点突破", note: "自动组卷" }], "drill");
      [...host.querySelectorAll("[data-t]")].forEach(c => c.onclick = () => { type = c.dataset.t; ctx.go("drill"); });
      host.querySelector("#cheat").innerHTML = cheatSheet(type);
      stack = build(type);
      paint(host, ctx);
      paintBoard(host);
    }
  };

  function cheatSheet(t) {
    if (t === "art") return `
      <div>· <b>-ung / -heit / -keit / -tion / -schaft</b> → die</div>
      <div>· <b>-chen / -lein / -ment / -um</b> → das</div>
      <div>· <b>-er / -ismus / -ling</b>（人或工具）→ der</div>
      <div>· 四季、月份、星期、方位 → der</div>
      <div class="hint">训练题由真实词库生成，共 ${articlePool().length} 个名词。</div>`;
    if (t === "verb") return `
      <div>· 强动词现在时第二/三人称单数常发生<b>元音变化</b>（e→i/ie，a→ä）</div>
      <div>· fahren → er <b>fährt</b>；essen → er <b>isst</b>；geben → er <b>gibt</b></div>
      <div>· 位移动词完成时用 <b>sein</b>，其余多用 haben</div>
      <div class="hint">共 ${VERBS.length} 个高频动词。</div>`;
    return `
      <div>· <b>静三动四</b>：in / an / auf / unter / über / neben / vor / hinter</div>
      <div>· <b>永远第三格</b>：mit / bei / von / zu / nach / aus / seit</div>
      <div>· <b>永远第四格</b>：für / ohne / durch / um / gegen / bis</div>
      <div>· <b>第二格</b>：wegen / trotz / während（书面语）</div>
      <div class="hint">共 ${PREPS.length} 个介词。</div>`;
  }

  function build(t) {
    const out = [];
    if (t === "art") {
      articlePool().forEach(n => {
        out.push({
          q: `${n.de}`, sub: n.zh, a: n.a, opts: ["der", "die", "das"], ex: n.ex,
          why: `「${n.de}」= ${n.a} ${n.de}（${n.zh}）`,
          skill: "art:" + n.de
        });
      });
    } else if (t === "verb") {
      VERBS.forEach(v => {
        const pi = Math.floor(Math.random() * 6);
        out.push({
          q: `${PRON[pi]}  ______   （原形 ${v.inf}）`, sub: `${v.zh} · 现在时变位`,
          a: v.pr[pi], opts: shuffleUnique([v.pr[pi], v.pr[(pi + 1) % 6], v.inf, v.part]),
          why: `${PRON[pi]} + ${v.inf} → ${v.pr[pi]}`,
          skill: "verb:" + v.inf
        });
        out.push({
          q: `完成时：er  ______  ${v.part}`, sub: `${v.zh} · 助动词选择`,
          a: v.perf, opts: ["hat", "ist"],
          why: `${v.inf} 完成时助动词为 ${v.aux}：er ${v.perf} ${v.part}`,
          skill: "aux:" + v.inf
        });
      });
    } else {
      PREPS.forEach(p => {
        out.push({
          q: `${p.p}  ______   （${p.zh}）`, sub: "这个介词支配第几格？",
          a: p.k, opts: p.k === "A/D" ? ["A", "D", "A/D", "G"] : ["A", "D", "G"],
          why: p.tip, skill: "prep:" + p.p
        });
      });
    }
    return shuffle(out).slice(0, 40);
  }

  function shuffleUnique(arr) {
    const keep = arr[0];
    const s = [...new Set(arr)];
    while (s.length < 4) s.push(["-er", "-e", "-t", "-st"][s.length % 4]);
    let out = shuffle(s).slice(0, 4);
    if (!out.includes(keep)) out[0] = keep;
    return shuffle(out);
  }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };

  function paint(host, ctx) {
    const box = host.querySelector("#quiz");
    if (finished || i >= stack.length) return finish(box, ctx);
    const q = stack[i]; t0 = Date.now();
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="tag tag-blue">第 ${i + 1} / ${stack.length}</span>
        <span class="tag">${TYPES[type].nm}</span>
      </div>
      ${combo >= 3 ? `<div style="margin-bottom:10px"><span class="tag tag-warn">Combo ×${combo}</span></div>` : ""}
      <div class="vocab-word" style="font-size:27px;text-align:left;margin:6px 0 4px">${q.q}</div>
      <div style="color:var(--text-3);font-size:13px;margin-bottom:14px">${q.sub}</div>
      <div id="opts" style="display:flex;flex-direction:column;gap:8px"></div>
      <div id="fb"></div>`;
    const oBox = box.querySelector("#opts");
    q.opts.forEach(o => {
      const b = document.createElement("div");
      b.className = "list-item";
      b.style.cursor = "pointer";
      b.innerHTML = `<div class="main"><div class="t1">${o}</div></div>`;
      b.onclick = () => {
        const ok = o === q.a, ms = Date.now() - t0;
        msSum += ms;
        [...oBox.children].forEach(c => {
          c.style.pointerEvents = "none";
          const v = c.innerText.trim();
          if (v === q.a) c.style.background = "var(--ok-soft)";
          if (v === o && !ok) c.style.background = "var(--danger-soft)";
        });
        if (ok) { right++; combo++; } else { wrong++; combo = 0; }
        best = Math.max(best, combo);
        window.LD.Store.logAnswer({ type: "drill", ability: "grammar", ok, ms, item: q.q, skill: q.skill });
        if (!ok) window.LD.Store.addWrong({ module: "专项训练", type: TYPES[type].nm, wrong: q.q, right: q.a, source: q.sub, why: q.why });
        box.querySelector("#fb").innerHTML = `
          <div class="corr-item" style="margin-top:12px"><div class="row">
            <span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
            <div><div style="font-size:13.5px">${q.why}</div>
            <div class="why">BKT 掌握概率 ${Math.round(E().bktState(q.skill) * 100)}% · 预测下次正确率 ${E().bktPredict(q.skill)}%</div></div>
          </div></div>
          <div style="margin-top:10px;text-align:right"><button class="btn btn-primary" id="next">${i + 1 >= stack.length ? "查看结果" : "下一题"}</button></div>`;
        box.querySelector("#next").onclick = () => { i++; paint(host, ctx); paintBoard(host); };
        paintBoard(host);
      };
      oBox.appendChild(b);
    });
  }

  function paintBoard(host) {
    const b = host.querySelector("#board");
    if (!b) return;
    const total = right + wrong;
    b.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">当前 Combo</span><b>${combo}</b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">最高连击</span><b>${best}</b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">正确率</span><b>${total ? Math.round(right / total * 100) : 0}%</b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">平均反应</span><b>${total ? Math.round(msSum / total) : 0} ms</b></div>
      </div>`;
  }

  function finish(box, ctx) {
    finished = true;
    const total = right + wrong;
    window.LD.Store.addSession({ module: "drill", ms: msSum, count: total });
    box.innerHTML = `<div style="text-align:center;padding:26px 0">
      <div class="fin-ico" style="${right / Math.max(1, total) >= .8 ? "" : "color:var(--warn)"}">${window.LD.icon(right / Math.max(1, total) >= .8 ? "trophy" : "zap")}</div>
      <h2 style="margin:10px 0 4px">本轮结束</h2>
      <div style="color:var(--text-3)">${total} 题 · 正确 ${right} · 最高连击 ${best} · 平均 ${Math.round(msSum / Math.max(1, total))} ms</div>
      <div class="btn-row" style="justify-content:center;margin-top:16px">
        <button class="btn btn-primary" id="again">再来一轮</button>
        <button class="btn" id="toNote">看错题本</button></div></div>`;
    box.querySelector("#again").onclick = () => ctx.go("drill");
    box.querySelector("#toNote").onclick = () => ctx.go("notebook");
  }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "专项训练", icon: "◉", group: "学习闭环", priority: "P0", order: 7, ds: "冠词性别 / 动词变位 / 介词支配格连击训练" });
  window.LD.define("drill", Mod);
})();
