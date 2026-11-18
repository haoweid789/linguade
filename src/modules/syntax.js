/* 模块 12 · 句法透视：把德语句子拆解为成分并标注格与动词框架
   借鉴开源项目 lingolift 的 "syntax breakdown" 思路 —— 让学习者看到句子骨架，
   而不是只被告知"错了"。德语语序与格变化是中国学生的两大盲区，可视化拆解直击痛点。 */
(function () {
  const S = () => window.LD.Store.s;

  /* 冠词 / 代词 → 格与性 的映射表 */
  const ART = {
    der: { c: "N", g: "m" }, die: { c: "N/A", g: "f" }, das: { c: "N/A", g: "n" },
    den: { c: "A", g: "m" }, dem: { c: "D", g: "m/n" }, des: { c: "G", g: "m/n" },
    ein: { c: "N", g: "m/n" }, eine: { c: "N/A", g: "f" }, einen: { c: "A", g: "m" },
    einem: { c: "D", g: "m/n" }, einer: { c: "D/G", g: "f" },
    ich: { c: "N" }, du: { c: "N" }, er: { c: "N" }, sie: { c: "N/A" }, es: { c: "N/A" },
    wir: { c: "N" }, ihr: { c: "N/D" }, mir: { c: "D" }, dich: { c: "A" },
    mich: { c: "A" }, uns: { c: "A/D" }, euch: { c: "A/D" }, ihm: { c: "D" }, ihn: { c: "A" }
  };
  const PREP_A = ["für", "ohne", "durch", "um", "gegen", "bis"];
  const PREP_D = ["mit", "bei", "von", "zu", "nach", "aus", "seit", "gegenüber"];
  const PREP_AD = ["in", "an", "auf", "unter", "über", "neben", "vor", "hinter", "zwischen"];
  const PREP_G = ["wegen", "trotz", "während", "statt", "dank"];
  const SUBJUNCT = ["weil", "obwohl", "dass", "wenn", "falls", "ob", "nachdem", "bevor", "damit", "sodass", "während", "als", "sobald"];
  const AUX = ["habe", "hat", "haben", "bin", "ist", "sind", "war", "waren", "werde", "wird", "werden",
    "kann", "kannst", "können", "muss", "musst", "müssen", "will", "willst", "wollen",
    "soll", "sollst", "sollen", "darf", "darfst", "dürfen", "möchte", "möchtest", "mag"];
  const NAMES = ["Subjekt", "Prädikat", "Objekt", "Adverbial", "Präpositional", "Konjunktion", "Nebensatz", "Attribut"];

  const ROLE_COLOR = {
    "主语": "#2c3a55", "谓语": "#a84a44", "宾语": "#2f6d52", "状语": "#b08430",
    "介词短语": "#0891b2", "连词": "#8e44ad", "从句": "#8e44ad", "定语": "#7a7a7a", "其他": "#9aa3b2"
  };

  const SAMPLES = [
    "Ich bin gestern mit dem Bus zur Universität gefahren.",
    "Weil ich keine Zeit habe, kann ich heute nicht kommen.",
    "Der Student schreibt seiner Professorin eine lange E-Mail.",
    "Obwohl das Wetter schlecht ist, gehen wir spazieren.",
    "Ich interessiere mich für die deutsche Geschichte."
  ];

  let cur = SAMPLES[0];

  const Mod = {
    title: "句法透视",
    desc: "句子成分拆解 + 格标记 + 动词框架可视化，直击德语语序与格变化盲区",
    render(host, ctx) {
      window.LD.Store.visit("syntax");
      host.innerHTML = `
        <div class="page-head"><h1>句法透视</h1>
          <p>输入或选择一句德语，系统拆解为主语 / 谓语 / 宾语 / 状语 / 介词短语 / 从句，并标注格与动词框架。</p></div>
        <div class="grid" style="grid-template-columns:1fr 300px">
          <div class="card card-pad">
            <textarea id="sIn" style="min-height:76px">${cur}</textarea>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn-primary" id="sGo">拆解句子</button>
              <button class="btn" id="sSay">${window.LD.icon("volume")} 朗读</button>
              <button class="btn" id="sRand">随机例句</button>
            </div>
            <div id="sOut" style="margin-top:16px"></div>
          </div>
          <div>
            <div class="card card-pad" style="margin-bottom:12px">
              <h2 style="margin:0 0 10px;font-size:13.5px">示例句</h2>
              <div id="sampleList"></div>
            </div>
            <div class="card card-pad">
              <h2 style="margin:0 0 10px;font-size:13.5px">图例</h2>
              <div style="display:flex;flex-wrap:wrap;gap:8px">
                ${Object.keys(ROLE_COLOR).map(k => `<span class="tag" style="border-left:3px solid ${ROLE_COLOR[k]}">${k}</span>`).join("")}
              </div>
              <div class="divider"><span>为什么要拆解</span></div>
              <div style="font-size:12.5px;line-height:1.9;color:var(--text-2)">
                <div>· 德语的<b>动词框架</b>（变位动词 + 句末补足）决定了句子节奏</div>
                <div>· 从句把动词推到<b>句末</b>，这是中国学生最常犯的错误</div>
                <div>· 冠词变位直接暴露<b>格</b>（den=A、dem=D、des=G）</div>
              </div>
            </div>
          </div>
        </div>`;
      const sl = host.querySelector("#sampleList");
      sl.innerHTML = SAMPLES.map((s, i) => `
        <div class="list-item" data-i="${i}" style="padding:9px 4px;cursor:pointer">
          <div class="main"><div class="t1" style="font-size:12.5px">${s}</div></div></div>`).join("");
      [...sl.children].forEach(c => c.onclick = () => { cur = SAMPLES[+c.dataset.i]; host.querySelector("#sIn").value = cur; run(host); });
      host.querySelector("#sGo").onclick = () => { cur = host.querySelector("#sIn").value.trim(); run(host); };
      host.querySelector("#sSay").onclick = () => window.LD.SpeechUtil.say(host.querySelector("#sIn").value.trim());
      host.querySelector("#sRand").onclick = () => { cur = SAMPLES[Math.floor(Math.random() * SAMPLES.length)]; host.querySelector("#sIn").value = cur; run(host); };
      run(host);
    }
  };

  /* ---------- 规则式成分标注器 ---------- */
  function analyze(sentence) {
    const raw = sentence.trim().replace(/[.!?]+$/, "");
    const tokens = raw.split(/\s+/);
    const out = tokens.map((t, i) => {
      const clean = t.replace(/[.,;:!?„“”"]/g, "");
      const low = clean.toLowerCase();
      let role = "其他", note = "";

      // 从句连词
      if (SUBJUNCT.includes(low)) { role = "连词"; note = "引导从句，动词置于从句末尾"; }
      // 介词
      else if ([...PREP_A, ...PREP_D, ...PREP_AD, ...PREP_G].includes(low)) {
        role = "介词短语";
        note = PREP_A.includes(low) ? "支配第四格 (A)" : PREP_D.includes(low) ? "支配第三格 (D)"
          : PREP_AD.includes(low) ? "双向介词：静三动四" : "支配第二格 (G)";
      }
      // 变位动词 / 助动词
      else if (AUX.includes(low)) { role = "谓语"; note = "变位动词（助动词/情态动词）"; }
      // 第二分词或典型实义动词（以 -en 结尾且在词库中标为动词）
      else if (isVerb(clean)) { role = "谓语"; note = "实义动词"; }
      // 冠词：标注格
      else if (ART[low]) {
        const caseInfo = ART[low].c;
        // 判断该词组在句中的角色：句首多为宾语或主语，介词后为介词宾语
        const prev = (tokens[i - 1] || "").toLowerCase().replace(/[.,]/g, "");
        const isAfterPrep = [...PREP_A, ...PREP_D, ...PREP_AD, ...PREP_G].includes(prev);
        if (isAfterPrep) { role = "介词短语"; }
        else if (i === 0 || /^(ich|du|er|sie|es|wir|ihr)$/.test(prev)) role = "宾语";
        else role = "宾语";
        note = `冠词 → ${caseInfo} 格${ART[low].g ? " · " + ART[low].g + " 性" : ""}`;
      }
      // 代词
      else if (["ich", "du", "er", "sie", "es", "wir", "ihr", "man", "mir", "mich", "dich", "ihm", "ihn", "uns"].includes(low)) {
        role = (i === 0 || low === "ich" || low === "wir" || low === "er" || low === "es" || low === "man") ? "主语" : "宾语";
        note = ART[low] ? `${ART[low].c} 格` : "";
      }
      // 时间 / 地点副词
      else if (/^(gestern|heute|morgen|immer|oft|nie|jetzt|schon|noch|dann|danach|jeden)$/i.test(low)) { role = "状语"; note = "时间状语"; }
      else if (/^(hier|dort|oben|unten|überall|zu|nach)$/i.test(low)) { role = "状语"; note = "地点状语"; }
      // 名词（首字母大写且非句首）
      else if (/^[A-ZÄÖÜ]/.test(clean) && i > 0) { role = isPrevArt(tokens[i - 1]) ? "宾语" : "宾语"; note = "名词"; }
      else if (i === 0 && /^[A-ZÄÖÜ]/.test(clean)) { role = "主语"; note = "句首名词（多为主语）"; }
      // 形容词
      else if (/^(gute|guter|kleine|große|deutsche|lange|schöne|neue|alte|interessante)$/i.test(low)) { role = "定语"; note = "形容词（随性数格变化）"; }

      return { t, clean, role, note };
    });

    // 结构判定
    const hasSub = tokens.some(t => SUBJUNCT.includes(t.toLowerCase().replace(/[.,]/g, "")));
    const verbIdx = out.findIndex(o => o.role === "谓语");
    const lastVerbIdx = out.map(o => o.role).lastIndexOf("谓语");
    const structure = [];
    if (hasSub) structure.push({ k: "含从句", v: "从句中变位动词位于句末（Verb-Endstellung）" });
    if (verbIdx === 0 || verbIdx === 1) structure.push({ k: "动词第二位", v: "陈述句 V2 结构成立" });
    else if (verbIdx > 1) structure.push({ k: "动词位置异常", v: `变位动词位于第 ${verbIdx + 1} 位，疑似语序错误` });
    if (lastVerbIdx > verbIdx) structure.push({ k: "动词框架", v: `句子由「${out[verbIdx].clean} … ${out[lastVerbIdx].clean}」构成框架` });
    const counts = {};
    out.forEach(o => counts[o.role] = (counts[o.role] || 0) + 1);

    return { tokens: out, structure, counts, hasSub };
  }

  function isVerb(w) {
    const lex = window.LD_LEX || [];
    const hit = lex.find(x => x[0].toLowerCase() === w.toLowerCase());
    if (hit) return hit[3] === "v";
    return /^(ge|be|ver|ent|er|zer)/.test(w.toLowerCase()) && /(t|en)$/.test(w.toLowerCase());
  }
  const isPrevArt = p => ART[(p || "").toLowerCase().replace(/[.,]/g, "")] != null;

  function run(host) {
    const out = host.querySelector("#sOut");
    if (!cur) return;
    const r = analyze(cur);
    out.innerHTML = `
      <div class="card" style="background:var(--panel-2)">
        <div class="card-pad">
          <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">成分标注（鼠标悬停查看说明）</div>
          <div style="line-height:2.6;font-size:16px">
            ${r.tokens.map(o => `<span class="tok" title="${o.note}" style="border-bottom:2px solid ${ROLE_COLOR[o.role]};padding:2px 3px;margin-right:4px">${esc(o.t)}</span>`).join(" ")}
          </div>
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:7px">
            ${r.tokens.filter(o => o.note).slice(0, 8).map(o => `
              <div style="display:flex;gap:8px;font-size:13px;align-items:baseline">
                <span style="min-width:88px;color:${ROLE_COLOR[o.role]};font-weight:600">${o.role}</span>
                <b>${esc(o.clean)}</b>
                <span style="color:var(--text-3)">${esc(o.note)}</span>
              </div>`).join("")}
          </div>
        </div>
      </div>
      <div class="grid g2" style="margin-top:12px">
        <div class="card card-pad">
          <h2 style="margin:0 0 10px;font-size:13.5px">结构判定</h2>
          ${r.structure.length ? r.structure.map(s => `<div style="font-size:13px;line-height:1.9">· <b>${s.k}</b>：${s.v}</div>`).join("")
        : `<div style="font-size:13px;color:var(--text-3)">简单句，注意动词第二位。</div>`}
        </div>
        <div class="card card-pad">
          <h2 style="margin:0 0 10px;font-size:13.5px">成分分布</h2>
          <div id="roleBars"></div>
        </div>
      </div>`;
    window.LD.Charts.bars(out.querySelector("#roleBars"),
      Object.keys(r.counts).map(k => ({ k, v: r.counts[k], color: ROLE_COLOR[k] })), { h: 150 });
  }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "句法透视", icon: "⌗", group: "沉淀与复盘", priority: "P0", order: 12, nav: "more", ds: "句子成分拆解 + 格标记 + 动词框架可视化" });
  window.LD.define("syntax", Mod);
})();
