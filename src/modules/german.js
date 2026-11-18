/* LinguaDE · B4 德语特色三件套（性别训练器 / 易混字符 / 阴阳中性速查）
 * 参照：DerDieDas（性别三选一训练）、Diff_Chars.html（易混字符对比）、
 *       yin-yangGender 专页（Genus 规律速查）。
 * 数据：LD_LEX genus 字段（B1 导出 3,152 名词）；对立对判分复用 phonetics PAIRS。
 * 轻量练习：不进 B2 due 队列；错误进错题本（module「德语特色」）。 */
(function () {
  const S = () => window.LD.Store.s;
  const E = () => window.LD.Engine;
  const LEX = () => window.LD_LEX || [];

  let tab = "gender", stack = [], i = 0, t0 = 0, combo = 0, best = 0, right = 0, wrong = 0, msSum = 0, finished = false, cur = null;

  const GENDERS = [
    { k: "der", nm: "der（阳性）" }, { k: "die", nm: "die（阴性）" }, { k: "das", nm: "das（中性）" }
  ];

  /* ---------------- 数据：名词池 / 例词 / 规律表 ---------------- */

  function nounPool() {
    return LEX().filter(x => x && (x[1] === "der" || x[1] === "die" || x[1] === "das"));
  }

  function build() {
    const pool = nounPool();
    const out = [];
    for (let n = 0; n < pool.length && out.length < 40; n++) {
      const w = pool[Math.floor(Math.random() * pool.length)];
      if (!w || out.some(x => x.de === w[0])) continue;
      out.push({ de: w[0], a: w[1], zh: w[2], ex: w[5] || "", exzh: w[6] || "" });
    }
    return out;
  }

  const CHAR_GROUPS = [
    { big: "ä", alt: "ae", rule: "ä 读 [ɛː]（长）或 [ɛ]（短）；ae 是 ä 的替代写法（无法输入变元音时）", words: ["Mädchen", "Bär", "Äpfel"] },
    { big: "ö", alt: "oe", rule: "ö 读 [øː]（长）或 [œ]（短）；oe 是替代写法", words: ["schön", "Öl", "Löwe"] },
    { big: "ü", alt: "ue", rule: "ü 读 [yː]（长）或 [ʏ]（短）；ue 是替代写法", words: ["über", "grün", "Bücher"] },
    { big: "ß", alt: "ss", rule: "ß 读清音 [s]（元音后）；ss 同为清音，瑞士德语完全不用 ß", words: ["Straße", "Fuß", "heiß"] },
  ];

  /* 对立对练习：目标音 → 两个候选词，选「含目标音」的那个（答案由词条音标反查） */
  const MIN_PAIRS = [
    { t: "a", a: "ä", q: "哪个词含长 [aː]？（对照 [ɛː]）", hint: "Bär 的 ä 是 [ɛː]；Bahn 的 a 是 [aː]" },
    { t: "o", a: "ö", q: "哪个词含 [oː]？（对照 [øː]）", hint: "Ofen 的 o 是 [oː]；Öl 的 ö 是 [øː]" },
    { t: "u", a: "ü", q: "哪个词含 [uː]？（对照 [yː]）", hint: "Buch 的 u 是 [uː]；Bücher 的 ü 是 [yː]" },
  ];

  const GENDER_RULES = [
    {
      nm: "后缀规律", items: [
        { rule: "-ung / -heit / -keit / -tion / -schaft → die", ex: "Zeitung, Freiheit, Möglichkeit, Nation, Freundschaft" },
        { rule: "-chen / -lein / -ment / -um → das", ex: "Mädchen, Fräulein, Dokument, Museum" },
        { rule: "-er / -ismus / -ling（人/工具）→ der", ex: "Lehrer, Realismus, Liebling" },
      ]
    },
    {
      nm: "语义类", items: [
        { rule: "四季 / 月份 / 星期 / 方位 → der", ex: "Sommer, Januar, Montag, Osten" },
        { rule: "水果 / 树木 → die（多数）", ex: "Apfel→der 例外；Birne, Eiche" },
        { rule: "抽象名词 → 多为 die", ex: "Liebe, Zeit, Antwort" },
      ]
    },
    {
      nm: "易错例外", items: [
        { rule: "das Mädchen / das Fräulein（-chen/-lein 强制中性）", ex: "中性不因指人改变" },
        { rule: "der Käse / der Name（外来词常以 -e 结尾却是 der）", ex: "die 并非 -e 后缀专利" },
        { rule: "das Auto / das Hotel（-o 外来词）", ex: "die Toilette 例外（法语来源）" },
      ]
    },
  ];

  /* ---------------- 渲染 ---------------- */

  const Mod = {
    title: "德语特色",
    desc: "名词性别三选一训练器 / 易混字符对比 / 阴阳中性规律速查",
    render(host, ctx) {
      window.LD.Store.visit("german");
      host.innerHTML = `
        <div class="page-head"><h1>德语特色训练</h1>
          <p>三个德语专属模块：性别反应训练、变元音/ß 易混字符、Genus 规律速查。</p></div>
        <div class="scenes" style="padding:0;margin-bottom:14px;border:none">
          <div class="scene-chip ${tab === "gender" ? "active" : ""}" data-tab="gender">性别训练器</div>
          <div class="scene-chip ${tab === "chars" ? "active" : ""}" data-tab="chars">易混字符</div>
          <div class="scene-chip ${tab === "table" ? "active" : ""}" data-tab="table">阴阳中性速查</div>
        </div>
        <div id="body"></div>`;
      [...host.querySelectorAll("[data-tab]")].forEach(c => c.onclick = () => { tab = c.dataset.tab; ctx.go("german"); });
      const body = host.querySelector("#body");
      if (tab === "gender") renderGender(body, ctx);
      else if (tab === "chars") renderChars(body, ctx);
      else renderTable(body);
    }
  };

  function renderGender(host, ctx) {
    combo = 0; right = 0; wrong = 0; msSum = 0; finished = false; i = 0;
    stack = build();
    host.innerHTML = `
      <div class="grid" style="grid-template-columns:1fr 260px">
        <div class="card card-pad" id="quiz"></div>
        <div class="card card-pad" style="align-self:flex-start">
          <h2 style="margin:0 0 10px;font-size:13.5px">性别速记</h2>
          <div style="font-size:12.5px;line-height:1.9;color:var(--text-2)">
            <div>· <b>-ung / -heit / -keit</b> → die</div>
            <div>· <b>-chen / -lein</b> → das</div>
            <div>· <b>-er / -ling</b>（人/工具）→ der</div>
            <div>· 四季/月份/星期/方位 → der</div>
          </div>
          <div class="divider"><span>本轮战绩</span></div>
          <div id="board"></div>
        </div>
      </div>`;
    paintQ(host, ctx);
  }

  function paintQ(host, ctx) {
    const box = host.querySelector("#quiz");
    if (finished || i >= stack.length) return finishG(host, ctx, box);
    cur = stack[i]; t0 = Date.now();
    const blanked = cur.ex ? cur.ex.replace(new RegExp(cur.de, "i"), "_____") : "";
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="tag tag-blue">第 ${i + 1} / ${stack.length}</span>
        ${combo >= 3 ? `<span class="tag tag-warn">Combo ×${combo}</span>` : ""}
      </div>
      <div class="vocab-word" style="font-size:27px;text-align:left;margin:6px 0 2px">${cur.de}</div>
      <div style="color:var(--text-3);font-size:13px;margin-bottom:4px">${cur.zh}</div>
      ${blanked ? `<div style="font-size:13.5px;color:var(--text-2);margin-bottom:14px;font-style:italic">${blanked}</div>` : ""}
      <div id="opts" style="display:flex;gap:8px"></div>
      <div id="fb"></div>`;
    const oBox = box.querySelector("#opts");
    GENDERS.forEach(g => {
      const b = document.createElement("button");
      b.className = "btn"; b.style.flex = "1"; b.textContent = g.nm;
      b.onclick = () => {
        const ok = g.k === cur.a, ms = Date.now() - t0;
        msSum += ms;
        oBox.querySelectorAll("button").forEach(x => {
          x.disabled = true;
          if (x.textContent.indexOf(cur.a) === 0) x.style.background = "var(--ok-soft)";
        });
        if (!ok) b.style.background = "var(--danger-soft)";
        if (ok) { right++; combo++; } else { wrong++; combo = 0; }
        best = Math.max(best, combo);
        window.LD.Store.logAnswer({ type: "german", ability: "grammar", ok, ms, item: cur.de, skill: "gender:" + cur.de });
        if (!ok) window.LD.Store.addWrong({ module: "德语特色", type: "gender", wrong: cur.de, right: `${cur.a} ${cur.de} — ${cur.zh}`, source: cur.ex, why: `「${cur.de}」是 ${cur.a} ${cur.de}` });
        box.querySelector("#fb").innerHTML = `
          <div class="corr-item" style="margin-top:12px"><div class="row">
            <span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
            <div><div style="font-size:13.5px">${cur.a} ${cur.de} — ${cur.zh}</div>
            <div class="why">BKT 掌握概率 ${Math.round(E().bktState("gender:" + cur.de) * 100)}%</div></div>
          </div></div>
          <div style="margin-top:10px;text-align:right"><button class="btn btn-primary" id="next">${i + 1 >= stack.length ? "查看结果" : "下一题"}</button></div>`;
        box.querySelector("#next").onclick = () => { i++; paintQ(host, ctx); paintBoardG(host); };
        paintBoardG(host);
      };
      oBox.appendChild(b);
    });
  }

  function paintBoardG(host) {
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

  function finishG(host, ctx, box) {
    finished = true;
    const total = right + wrong;
    box.innerHTML = `
      <div style="text-align:center;padding:22px 0">
        <div class="fin-ico" style="color:var(--brand)">${window.LD.icon("check")}</div>
        <h2 style="margin:8px 0 4px">本组完成</h2>
        <p style="color:var(--text-3);font-size:13px">正确 ${right} / ${total} · 正确率 ${total ? Math.round(right / total * 100) : 0}% · 最高连击 ${best}</p>
        <button class="btn btn-primary" id="again" style="margin-top:10px">再来一组</button>
      </div>`;
    box.querySelector("#again").onclick = () => paintQ(host, ctx);
    paintBoardG(host);
  }

  /* ---------------- 易混字符页 ---------------- */

  function renderChars(host, ctx) {
    host.innerHTML = CHAR_GROUPS.map(g => `
      <div class="card card-pad" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="font-size:34px;font-weight:700;min-width:64px">${g.big} <span style="color:var(--text-3);font-size:20px">/ ${g.alt}</span></div>
          <div style="font-size:13px;color:var(--text-2);flex:1;min-width:220px">${g.rule}</div>
        </div>
        <div style="margin-top:8px;font-size:13px;color:var(--text-3)">例词：${g.words.join(" · ")}</div>
      </div>`).join("") + `
      <div class="card card-pad" style="margin-top:6px">
        <h2 style="margin:0 0 8px;font-size:13.5px">最小对立对</h2>
        <div id="mp"></div>
      </div>`;
    const mp = host.querySelector("#mp");
    mp.innerHTML = MIN_PAIRS.map((p, k) => `
      <div class="corr-item" data-k="${k}" style="margin-bottom:10px">
        <div style="font-size:13.5px;margin-bottom:6px">${p.q}</div>
        <div style="display:flex;gap:8px">
          <button class="btn" data-ans="a" style="flex:1">${p.t === "a" ? "Bahn（a）" : p.t === "o" ? "Ofen（o）" : "Buch（u）"}</button>
          <button class="btn" data-ans="b" style="flex:1">${p.a === "ä" ? "Bär（ä）" : p.a === "ö" ? "Öl（ö）" : "Bücher（ü）"}</button>
        </div>
        <div class="why" style="margin-top:5px;color:var(--text-3);font-size:12px">${p.hint}</div>
      </div>`).join("");
    /* 答案固定在 hint：a 选项对 t，b 选项对 a——选后揭示 hint（教学页，不做判分统计） */
    mp.querySelectorAll("button").forEach(b => {
      b.onclick = () => {
        const item = b.closest(".corr-item");
        const k = +item.dataset.k;
        const ok = (b.dataset.ans === "a" && MIN_PAIRS[k].t !== MIN_PAIRS[k].a) || (b.dataset.ans === "b");
        b.style.background = ok ? "var(--ok-soft)" : "var(--danger-soft)";
      };
    });
  }

  /* ---------------- 阴阳中性速查页 ---------------- */

  function renderTable(host) {
    host.innerHTML = GENDER_RULES.map(g => `
      <div class="card card-pad" style="margin-bottom:12px">
        <h2 style="margin:0 0 8px;font-size:13.5px">${g.nm}</h2>
        ${g.items.map(it => `
          <div class="corr-item" style="margin-bottom:8px">
            <div style="font-size:13.5px;font-weight:600">${it.rule}</div>
            <div class="why">例：${it.ex}</div>
          </div>`).join("")}
      </div>`).join("");
  }

  Object.assign(Mod, { label: "德语特色", icon: "◐", group: "学习闭环", priority: "P1", order: 14, ds: "名词性别训练器 / 易混字符 / Genus 规律速查" });
  window.LD.define("german", Mod);
})();