/* LinguaDE · B5 AI 练习（aipractice 模块）
 * 契约对齐小站 aiPractice：诊断（initial-assessment）→ 弱点推荐（recommend）→
 * 练习（前端组装题目）→ 保存判分（save）→ 报告（report）。
 * 服务端只组考点清单；题目内容前端从 LD_LEX 取。无 LLM 时主观题标降级。
 * 历史会话 localStorage：linguade.aipractice.sessions。 */
(function () {
  const S = () => window.LD.Store.s;
  const E = () => window.LD.Engine;

  let tab = "list", cur = null, items = [], idx = 0, answers = [], sessionId = "", t0 = 0;

  const api = (path, body) =>
    window.LD.Backend && LD.Backend.ready()
      ? fetch("/api/ai/practice/" + path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      }).then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      : Promise.reject(new Error("后端未连接"));

  /* 前端组装题目：按考点 skill 从词库取题（B3 题型注册表驱动题型选择） */
  function buildItems(skills) {
    const LEX = window.LD_LEX || [];
    const out = [];
    skills.forEach((sk, k) => {
      const word = String(sk.skill || "").replace(/^[a-z]+:/, "");
      const w = LEX.find(x => x[0] === word) || LEX[k % LEX.length];
      if (!w) return;
      const ex = window.LD.Exercise;
      const t = ex && ex.get("translate_de_zh") ? "translate_de_zh" : "word_recall";
      out.push({
        id: "p" + k, type: t, skill: sk.skill, q: w[0],
        sub: w[2], a: w[2], ex: w[5] || "", opts: null, word: w[0], genus: w[1]
      });
    });
    return out;
  }

  function sessions() {
    try { return JSON.parse(localStorage.getItem("linguade.aipractice.sessions") || "[]"); }
    catch (e) { return []; }
  }
  function pushSession(s) {
    const all = sessions();
    all.unshift(s);
    localStorage.setItem("linguade.aipractice.sessions", JSON.stringify(all.slice(0, 30)));
  }

  const Mod = {
    title: "AI 练习",
    desc: "诊断 → 弱点推荐 → 练习 → 报告（aiPractice 契约，mock/LLM 双通道）",
    render(host, ctx) {
      window.LD.Store.visit("aipractice");
      host.innerHTML = `
        <div class="page-head"><h1>AI 练习</h1>
          <p>诊断出题 → 弱点推荐 → 组卷练习 → 报告。服务端组考点，前端从词库组装题目。</p></div>
        <div class="scenes" style="padding:0;margin-bottom:14px;border:none">
          <div class="scene-chip ${tab === "list" ? "active" : ""}" data-tab="list">练习列表</div>
          <div class="scene-chip ${tab === "session" ? "active" : ""}" data-tab="session">练习</div>
          <div class="scene-chip ${tab === "report" ? "active" : ""}" data-tab="report">报告</div>
        </div>
        <div id="body"></div>`;
      [...host.querySelectorAll("[data-tab]")].forEach(c => {
        if (c.dataset.tab === "session" && !cur) return;
        c.onclick = () => { tab = c.dataset.tab; ctx.go("aipractice"); };
      });
      const body = host.querySelector("#body");
      if (tab === "session") renderSession(body, ctx);
      else if (tab === "report") renderReport(body, ctx);
      else renderList(body, ctx);
    }
  };

  function renderList(host, ctx) {
    const weak = E().weakPoints().weakest || [];
    const hist = sessions();
    host.innerHTML = `
      <div class="grid g2" style="gap:14px">
        <div class="card card-pad">
          <h2 style="margin:0 0 8px;font-size:13.5px">诊断 / 快速练习</h2>
          <p style="font-size:12.5px;color:var(--text-3)">诊断 5 题定位起点；推荐按你的薄弱点组卷。</p>
          <button class="btn btn-primary" id="assess" style="margin-right:8px">开始诊断（5 题）</button>
          <button class="btn" id="quick">快速练习（10 题）</button>
          <div id="asMsg" style="margin-top:8px;font-size:12px;color:var(--text-3)"></div>
        </div>
        <div class="card card-pad">
          <h2 style="margin:0 0 8px;font-size:13.5px">弱点推荐</h2>
          ${weak.length ? weak.slice(0, 6).map(w => `
            <div class="corr-item" style="margin-bottom:6px">
              <div style="display:flex;justify-content:space-between;font-size:13px">
                <span>${w.key}</span><b style="color:${w.acc < 60 ? "var(--danger)" : "var(--warn)"}">${w.acc}%</b>
              </div>
            </div>`).join("") : `<div style="font-size:12.5px;color:var(--text-3)">暂无足够数据，先完成诊断。</div>`}
          ${weak.length ? `<button class="btn" id="rec" style="margin-top:8px">按弱点组卷（10 题）</button>` : ""}
        </div>
      </div>
      <div class="card card-pad" style="margin-top:14px">
        <h2 style="margin:0 0 8px;font-size:13.5px">历史会话</h2>
        ${hist.length ? hist.slice(0, 8).map(s => `
          <div class="corr-item" style="margin-bottom:6px;font-size:13px;display:flex;justify-content:space-between">
            <span>${s.kind} · ${s.total} 题 · ${s.correct}/${s.total} 对</span>
            <span style="color:var(--text-3)">${new Date(s.at).toLocaleDateString()}</span>
          </div>`).join("") : `<div style="font-size:12.5px;color:var(--text-3)">暂无历史。</div>`}
      </div>`;
    const start = (kind, count) => {
      const msg = host.querySelector("#asMsg");
      msg.textContent = "请求考点…";
      api(kind === "assessment" ? "initial-assessment" : "recommend",
        kind === "assessment" ? { seed: Date.now() % 100000, count } : { weakPoints: weak.map(w => ({ key: w.key, acc: w.acc, total: w.total })), count })
        .then(r => {
          cur = { kind, skills: r.items || [] };
          items = buildItems(cur.skills);
          if (!items.length) { msg.textContent = "词库为空，无法组卷。"; return; }
          sessionId = "s" + Date.now();
          idx = 0; answers = []; t0 = Date.now();
          tab = "session"; ctx.go("aipractice");
        })
        .catch(e => { msg.textContent = "后端未连接（离线可先练词卡）：" + e.message; });
    };
    host.querySelector("#assess").onclick = () => start("assessment", 5);
    host.querySelector("#quick").onclick = () => start("recommend", 10);
    const rec = host.querySelector("#rec");
    if (rec) rec.onclick = () => start("recommend", 10);
  }

  function renderSession(host, ctx) {
    if (!cur || !items.length) {
      host.innerHTML = `<div class="card card-pad" style="text-align:center;color:var(--text-3)">无进行中的会话，回列表开始。</div>`;
      return;
    }
    const it = items[idx];
    if (!it) return finish(host, ctx);
    t0 = Date.now();
    const isChoice = it.type === "word_recall" || it.type === "translate_de_zh";
    host.innerHTML = `
      <div class="card card-pad" style="max-width:640px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <span class="tag tag-blue">第 ${idx + 1} / ${items.length}</span>
          <span class="tag">${it.type}</span>
        </div>
        <div class="vocab-word" style="font-size:26px">${it.q}</div>
        <div style="color:var(--text-3);font-size:13px;margin:4px 0 12px">${it.sub || ""}</div>
        <div id="opts" style="display:flex;flex-direction:column;gap:8px">
          ${isChoice ? ["der", "die", "das"].map(g => `<button class="btn" data-g="${g}">${g}</button>`).join("") : ""}
        </div>
        <div id="fb"></div>
      </div>`;
    const oBox = host.querySelector("#opts");
    if (isChoice) {
      oBox.querySelectorAll("button").forEach(b => {
        b.onclick = () => {
          const ok = b.dataset.g === it.genus;
          answers.push({ id: it.id, ok, ms: Date.now() - t0, skill: it.skill });
          window.LD.Store.logAnswer({ type: "aipractice", ability: "grammar", ok, ms: Date.now() - t0, item: it.q, skill: it.skill });
          oBox.querySelectorAll("button").forEach(x => x.disabled = true);
          if (ok) b.style.background = "var(--ok-soft)"; else b.style.background = "var(--danger-soft)";
          host.querySelector("#fb").innerHTML = `
            <div class="corr-item" style="margin-top:10px"><span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
            <span style="font-size:13.5px">${it.genus} ${it.q} — ${it.sub}</span></div>
            <div style="margin-top:10px;text-align:right"><button class="btn btn-primary" id="next">${idx + 1 >= items.length ? "保存并出报告" : "下一题"}</button></div>`;
          host.querySelector("#next").onclick = () => { idx++; renderSession(host, ctx); };
        };
      });
    }
  }

  function finish(host, ctx) {
    const correct = answers.filter(a => a.ok).length;
    const ms = answers.reduce((a, b) => a + (b.ms || 0), 0);
    api("save", { sessionId, items: answers.map(a => ({ id: a.id, type: "word_recall", answer: a.ok ? "✓" : "✗", ms: a.ms })) })
      .catch(() => { /* 离线时本地留档 */ });
    pushSession({ sessionId, kind: cur.kind, total: items.length, correct, at: Date.now(), ms });
    cur = { done: true, correct, total: items.length, ms, sessionId, kind: cur.kind };
    tab = "report"; ctx.go("aipractice");
  }

  function renderReport(host, ctx) {
    if (!cur || !cur.done) {
      host.innerHTML = `<div class="card card-pad" style="text-align:center;color:var(--text-3)">暂无报告，先完成一次练习。</div>`;
      return;
    }
    const acc = cur.total ? Math.round(cur.correct / cur.total * 100) : 0;
    api("report", { sessionId: cur.sessionId }).catch(() => null);
    host.innerHTML = `
      <div class="card card-pad" style="max-width:640px;margin:0 auto;text-align:center">
        <div class="fin-ico" style="color:var(--brand)">${window.LD.icon("check")}</div>
        <h2 style="margin:8px 0 4px">${cur.kind === "assessment" ? "诊断完成" : "练习完成"}</h2>
        <p style="color:var(--text-3);font-size:13px">正确 ${cur.correct} / ${cur.total} · 正确率 ${acc}% · 用时 ${Math.round(cur.ms / 1000)}s</p>
        <div style="margin-top:10px;font-size:12.5px;color:var(--text-3)">弱点更新：BKT 已随作答更新；报告模板化（LLM 增强通道未配置）。</div>
        <button class="btn btn-primary" id="back" style="margin-top:12px">回列表</button>
      </div>`;
    host.querySelector("#back").onclick = () => { tab = "list"; cur = cur.done ? cur : null; ctx.go("aipractice"); };
  }

  Object.assign(Mod, { label: "AI 练习", icon: "sparkle", group: "智能内核", priority: "P1", order: 15, ds: "诊断→推荐→练习→报告（aiPractice 契约）" });
  window.LD.define("aipractice", Mod);
})();