/* 模块 22 · 分级测评（C1）：词汇分层抽样 + 语法抽题 → 参考级别与词汇量估算
   口径：参考级别 / 估算，不是官方 CEFR 认定。规则见 src/core/placement.js。 */
(function () {
  const S = () => window.LD.Store.s;
  const P = () => window.LD.Placement;

  let paper = null, vi = 0, gi = 0, vAns = {}, gAns = {}, phase = "intro", lastResult = null;

  function seedNow() {
    const openId = (S() && S().open_id) || "";
    const dk = window.LD.Store.dayKey ? window.LD.Store.dayKey() : "";
    return P().seedFor(dk, openId);
  }
  function newPaper() {
    paper = P().build(seedNow());
    vi = 0; gi = 0; vAns = {}; gAns = {};
  }
  const total = () => (paper ? paper.vocab.length + paper.grammar.length : 0);
  const posOf = () => (vi < paper.vocab.length ? vi : paper.vocab.length + gi);

  /* 从落档的 placement 还原结果页数据（刷新后「看上次结果」用） */
  function stored() {
    const p = S().profile.placement;
    if (!p) return null;
    return {
      v: p.v, level: p.level, vocabEst: p.vocabEst, vocabRange: p.vocabRange,
      vocabFloor: p.vocabFloor, grammarLevel: p.grammarLevel,
      vocabPassed: p.vocabPassed, grammarPassed: p.grammarPassed,
      layers: p.layers || [], grammar: p.grammar || [], graded: { layers: p.layers || [], grammar: p.grammar || [] },
      at: p.at
    };
  }

  const Mod = {
    title: "分级测评",
    desc: "20 道词汇（按 A1–C2 分层）+ 30 道语法，给出参考级别与词汇量估算",
    render(host, ctx) {
      window.LD.Store.visit("placement");
      /* 学情分析「重测」入口：直接开新卷，不先看说明页 */
      if (ctx && ctx.payload && ctx.payload.restart) { newPaper(); phase = "quiz"; }
      if (!paper) newPaper();
      if (phase === "quiz" && paper) return quiz(host, ctx);
      if (phase === "result") {
        const r = lastResult || stored();
        if (r) { lastResult = r; return result(host, ctx, r); }
        phase = "intro";
      }
      return intro(host, ctx);
    }
  };

  /* ---------- 说明页 ---------- */
  function intro(host, ctx) {
    const prev = S().profile.placement;
    const counts = P().layerCounts();
    const sum = Object.keys(counts).reduce((a, k) => a + counts[k], 0);
    host.innerHTML = `
      <div class="page-head">
        <h1>分级测评</h1>
        <p>按 A1–C2 分层的 20 道词汇题 + 30 道语法题，给出<b>参考级别</b>与<b>词汇量估算</b>。
           这是产品内部的起点参考，<b>不是官方 CEFR 认证</b>，也不测听、说、读、写。</p>
      </div>
      <div class="grid g2">
        <div class="card card-pad">
          <h2 style="margin:0 0 8px;font-size:13.5px">这次测什么</h2>
          <ul style="margin:0;padding-left:18px;line-height:1.9;font-size:13px">
            <li>词汇：从词库 ${sum} 条实词中按层抽 20 题，四选一</li>
            <li>语法：A1–C1 各 6 题，共 30 题</li>
            <li>耗时约 8–10 分钟；中途关闭不保存</li>
            <li>同一天重测是同一套卷，跨天换卷</li>
          </ul>
          <div class="btn-row" style="margin-top:14px">
            <button class="btn btn-primary" id="plStart">${prev ? "重新测评" : "开始测评"}</button>
            ${prev ? '<button class="btn" id="plView">看上次结果</button>' : ""}
          </div>
        </div>
        <div class="card card-pad">
          <h2 style="margin:0 0 8px;font-size:13.5px">当前起点</h2>
          ${prev ? `
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
              <span class="tag tag-blue">参考级别 ${esc(prev.level)}</span>
              <span class="tag">词汇约 ${fmt(prev.vocabEst)} 词</span>
              <span class="tag">${prev.vocabRange ? fmt(prev.vocabRange[0]) + "–" + fmt(prev.vocabRange[1]) : ""}</span>
            </div>
            <p class="hint" style="margin:0">测于 ${new Date(prev.at).toLocaleString("zh-CN")}。计划起点用的是
              <b>${esc(S().profile.level)}</b>${S().profile.levelTouched ? "（你在设置里手动指定过，测评不覆盖）" : "（随测评更新）"}。</p>
          ` : `<p class="hint" style="margin:0">还没测过。入学诊断只覆盖 10 道题、最高只能估到 B1；
            如果你已有 B2 以上基础，用这次测评把起点定得更准。</p>
            <div class="btn-row" style="margin-top:12px">
              <button class="btn btn-sm" id="plToDiag">先去做入学诊断</button>
            </div>`}
        </div>
      </div>`;
    const start = host.querySelector("#plStart");
    if (start) start.onclick = () => { newPaper(); phase = "quiz"; Mod.render(host, ctx); };
    const view = host.querySelector("#plView");
    if (view) view.onclick = () => { lastResult = stored(); phase = "result"; Mod.render(host, ctx); };
    const toDiag = host.querySelector("#plToDiag");
    if (toDiag) toDiag.onclick = () => ctx.go("diagnose");
  }

  /* ---------- 答题页 ---------- */
  function quiz(host, ctx) {
    if (vi >= paper.vocab.length && gi >= paper.grammar.length) return finish(host, ctx);
    const isV = vi < paper.vocab.length;
    const q = isV ? paper.vocab[vi] : paper.grammar[gi];
    const idx = isV ? vi : gi;
    const picked = isV ? vAns[idx] : gAns[idx];
    const done = picked != null;
    const n = total(), cur = posOf();
    const kindLabel = isV ? "词汇 · " + q.lv : "语法 · " + q.lv;

    host.innerHTML = `
      <div class="page-head">
        <h1>分级测评</h1>
        <p>第 ${Math.min(cur + 1, n)} / ${n} 题 · ${kindLabel}</p>
      </div>
      <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:14px">
        <div style="height:100%;width:${Math.round(cur / n * 100)}%;background:var(--brand);transition:width .2s"></div>
      </div>
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span class="tag tag-blue">${kindLabel}</span>
          <span class="tag">${isV ? "选出正确释义" : "选出唯一正确的一句"}</span>
        </div>
        <div style="font-size:16px;line-height:1.7;margin-bottom:14px">${esc(isV ? q.lemma : q.q)}</div>
        <div id="plOpts" style="display:flex;flex-direction:column;gap:8px"></div>
        <div id="plFb" style="margin-top:14px"></div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-primary" id="plNext"${done ? "" : " disabled"}>${n - cur === 1 ? "看结果" : "下一题"}</button>
        </div>
      </div>`;

    const oBox = host.querySelector("#plOpts");
    q.opts.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "list-item";
      b.style.cursor = "pointer";
      b.innerHTML = `<div class="main"><div class="t1">${String.fromCharCode(65 + i)}. ${esc(o)}</div></div>`;
      if (done) {
        b.disabled = true;
        b.style.pointerEvents = "none";
        if (i === q.a) b.style.background = "var(--ok-soft)";
        else if (i === picked) b.style.background = "var(--danger-soft)";
      } else {
        b.onclick = () => {
          if (isV) vAns[idx] = i; else gAns[idx] = i;
          [...oBox.children].forEach((c, k) => {
            c.disabled = true; c.style.pointerEvents = "none";
            if (k === q.a) c.style.background = "var(--ok-soft)";
            else if (k === i) c.style.background = "var(--danger-soft)";
          });
          paintFb(host, q, i);
          const nx = host.querySelector("#plNext");
          if (nx) nx.disabled = false;
        };
      }
      oBox.appendChild(b);
    });

    if (done) paintFb(host, q, picked);

    host.querySelector("#plNext").onclick = () => {
      if (isV) vi++; else gi++;
      if (vi >= paper.vocab.length && gi >= paper.grammar.length) return finish(host, ctx);
      Mod.render(host, ctx);
    };
  }

  function paintFb(host, q, picked) {
    const ok = picked === q.a;
    const fb = host.querySelector("#plFb");
    if (!fb) return;
    fb.innerHTML = `
      <div class="corr-item">
        <div class="row">
          <span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
          <div>
            <div style="font-size:13.5px">${ok ? "回答正确" : "正确答案：" + String.fromCharCode(65 + q.a) + ". " + esc(q.opts[q.a])}</div>
            ${q.why ? `<div class="why">${esc(q.why)}</div>` : ""}
          </div>
        </div>
      </div>`;
  }

  /* ---------- 交卷 ---------- */
  function finish(host, ctx) {
    const graded = P().grade(paper, { v: vAns, g: gAns });
    const res = P().decide(graded);
    res.graded = graded;
    res.at = Date.now();
    phase = "result";
    lastResult = res;
    save(res);
    Mod.render(host, ctx);
  }

  function save(res) {
    const prof = S().profile;
    prof.placement = {
      v: res.v, at: res.at, level: res.level,
      vocabEst: res.vocabEst, vocabRange: res.vocabRange, vocabFloor: res.vocabFloor,
      layers: res.layers, grammar: res.grammar,
      grammarLevel: res.grammarLevel, vocabLevel: res.vocabLevel,
      vocabPassed: res.vocabPassed, grammarPassed: res.grammarPassed,
      seed: paper.seed, src: "placement"
    };
    /* 用户手动设过起点时不覆盖，只在结果页说明差异 */
    if (!prof.levelTouched) {
      prof.level = res.level;
      try { window.LD.Engine.firstWeekPlan(true); } catch (e) { /* 旧档案无计划时忽略 */ }
    }
    window.LD.Store.save();
    window.LD.Store.addXp(15);
    try { window.LD.Store.sync({ force: true }).catch(() => {}); } catch (e) { /* 离线忽略 */ }
    if (window.LD.router && window.LD.router.renderNav) window.LD.router.renderNav();
    if (window.LD.UI && window.LD.UI.updateChips) window.LD.UI.updateChips();
  }

  /* ---------- 结果页 ---------- */
  function result(host, ctx, res) {
    const prof = S().profile;
    const keep = !!prof.levelTouched;
    const diff = prof.level !== res.level;
    const rows = res.layers.map(x => `<tr><td>${x.lv}</td><td>${x.ok} / ${x.n}</td><td>${Math.round(x.acc * 100)}%</td>
      <td>${x.acc >= P().PASS_RATE ? '<span class="tag tag-ok">通过</span>' : '<span class="tag">未通过</span>'}</td></tr>`).join("");
    const grows = res.grammar.map(x => `<tr><td>${x.lv}</td><td>${x.ok} / ${x.n}</td><td>${Math.round(x.acc * 100)}%</td>
      <td>${x.acc >= P().PASS_RATE ? '<span class="tag tag-ok">通过</span>' : '<span class="tag">未通过</span>'}</td></tr>`).join("");

    host.innerHTML = `
      <div class="page-head">
        <h1>测评结果</h1>
        <p>下面是<b>参考</b>结论：由分层抽样的正确率推出，用于定起点，不是官方等级或证书。</p>
      </div>
      <div class="card card-pad" style="margin-bottom:14px;border-color:var(--brand)">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span class="tag tag-blue" style="font-size:15px">参考级别 ${esc(res.level)}</span>
          <span class="tag">词汇约 ${fmt(res.vocabEst)} 词</span>
          <span class="tag">区间 ${fmt(res.vocabRange[0])}–${fmt(res.vocabRange[1])}</span>
          <span class="tag">已掌握下限 ${fmt(res.vocabFloor)}</span>
        </div>
        <h2 style="margin:14px 0 6px">${levelHead(res.level)}</h2>
        <p class="hint" style="margin:0">${levelHint(res.level)}</p>
        ${diff ? `<p class="hint" style="margin:10px 0 0;color:var(--accent-text)">
          计划起点仍是 <b>${esc(prof.level)}</b>——${keep ? "你在设置里手动指定过，测评不覆盖你的选择" : "已按本次结果更新"}。</p>` : ""}
        ${(!res.vocabPassed || !res.grammarPassed) ? `<p class="hint" style="margin:8px 0 0">
          说明：${!res.vocabPassed ? "词汇各层都未达到通过线（" + Math.round(P().PASS_RATE * 100) + "%）" : ""}${!res.vocabPassed && !res.grammarPassed ? "；" : ""}${!res.grammarPassed ? "语法各层都未达到通过线" : ""}，参考级别按 A1 起算。</p>` : ""}
        <div class="btn-row" style="margin-top:14px">
          <button class="btn btn-primary" id="plPlan">按这个起点学</button>
          <button class="btn" id="plAnalytics">看学情分析</button>
          <button class="btn btn-ghost" id="plRedo">重测</button>
        </div>
      </div>
      <div class="grid g2">
        <div class="card card-pad">
          <h2 style="margin:0 0 10px;font-size:13.5px">词汇分层（20 题）</h2>
          <table class="tbl"><thead><tr><th>层</th><th>答对</th><th>正确率</th><th>判定</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="hint" style="margin:8px 0 0">每层 2–4 题，抽样误差是区间宽度的主要来源；
            词汇量按「该层正确率 × 该层词库条数」求和估算。</p>
        </div>
        <div class="card card-pad">
          <h2 style="margin:0 0 10px;font-size:13.5px">语法分层（30 题）</h2>
          <table class="tbl"><thead><tr><th>层</th><th>答对</th><th>正确率</th><th>判定</th></tr></thead><tbody>${grows}</tbody></table>
          <p class="hint" style="margin:8px 0 0">词汇与语法结论不一致时，参考级别取<b>较低者</b>。</p>
        </div>
      </div>
      ${paper ? `<div class="card card-pad" style="margin-top:14px">
        <div class="btn-row">
          <button class="btn" id="plSaveWrong">把答错的题存入错题本</button>
        </div>
        <p class="hint" style="margin:8px 0 0">只存答错的题，可在「错题本」里按知识点重练；不会自动开始练习。</p>
      </div>` : ""}`;

    host.querySelector("#plPlan").onclick = () => ctx.go("plan");
    host.querySelector("#plAnalytics").onclick = () => ctx.go("analytics");
    host.querySelector("#plRedo").onclick = () => { newPaper(); phase = "quiz"; Mod.render(host, ctx); };
    const sw = host.querySelector("#plSaveWrong");
    if (sw) sw.onclick = () => {
      let n = 0;
      paper.vocab.forEach((q, i) => {
        if (vAns[i] == null || vAns[i] === q.a) return;
        window.LD.Store.addWrong({
          module: "分级测评", type: "词汇", wrong: q.opts[vAns[i]], right: q.opts[q.a],
          source: q.lemma, why: "难度层 " + q.lv + "；正确释义：" + q.opts[q.a]
        });
        n++;
      });
      paper.grammar.forEach((q, i) => {
        if (gAns[i] == null || gAns[i] === q.a) return;
        window.LD.Store.addWrong({
          module: "分级测评", type: "语法", wrong: q.opts[gAns[i]], right: q.opts[q.a],
          source: q.q, why: q.why || ("难度层 " + q.lv)
        });
        n++;
      });
      sw.disabled = true;
      sw.textContent = n ? `已存入 ${n} 条` : "没有答错的题";
      if (window.LD.UI && window.LD.UI.toast) window.LD.UI.toast(n ? `已存入错题本（${n} 条）` : "本次没有答错的题", n ? "ok" : "warn");
    };
  }

  /* ---------- 文案 ---------- */
  function levelHead(lv) {
    return {
      A1: "从零起步：先建立最基础的词与句型",
      A2: "已能应对日常场景，接下来补时态与从句",
      B1: "可以开始处理真实语料，重点转向产出",
      B2: "接近可用水平，建议直接读长文本与写作",
      C1: "高级起点，重点放在语体与学术表达"
    }[lv] || "";
  }
  function levelHint(lv) {
    return {
      A1: "建议从 A1 词表与「冠词性别 / 现在时」专项开始，先把发音与名词性数记牢。",
      A2: "建议每天 25–35 分钟：A2 词表 + 过去时 / 从句 / 比较级专项，配合听力跟读。",
      B1: "建议每天 35–45 分钟：B1 词表 + 被动 / 虚拟式 / 关系从句专项，开始整段阅读与写作。",
      B2: "建议每天 45 分钟以上：B2–C1 词表 + 名词化 / 分词结构 / 阅读长文，写作批改按周一次。",
      C1: "建议以 C1 材料与写作反馈为主，语法点查漏（语体 / 连贯 / 复杂定语），不必再刷基础题型。"
    }[lv] || "";
  }

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n) { return Number(n || 0).toLocaleString("zh-CN"); }

  Object.assign(Mod, { label: "分级测评", icon: "◐", group: "沉淀与复盘", priority: "P1", order: 90, nav: "more", ds: "词汇分层抽样 + 语法抽题，给出参考级别与词汇量估算" });
  window.LD.define("placement", Mod);
})();