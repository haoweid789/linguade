/* 模块 5 · 错题本：跨模块错题自动沉淀 → 按类型组卷 → 二次重练 → 掌握标记 */
(function () {
  const S = () => window.LD.Store.s;
  let filter = "all", typeFilter = "all", view = [], baseView = [];
  let pageNo = 0, query = "";
  const PAGE = 20;

  /* 类型筛选后的全集；搜索实时在其上过滤（不重渲染整页，输入框保持焦点） */
  function applyQuery() {
    const q = query.trim().toLowerCase();
    view = q ? baseView.filter(w => [w.wrong, w.right, w.why, w.module, w.type].some(v => String(v || "").toLowerCase().includes(q))) : baseView.slice();
    if (pageNo * PAGE >= view.length) pageNo = 0;
  }

  /* 错题重练计入能力画像时按来源模块归档，不再一律记成语法 */
  const ABILITY_OF = { "单词": "vocab", "语法": "grammar", "句法": "grammar", "口语": "speaking", "听力": "listening", "阅读": "reading", "写作": "writing", "对话": "speaking" };
  const abilityOf = w => ABILITY_OF[w.module] || (w.type && /词|词汇/.test(w.type) ? "vocab" : "grammar");
  const typeOf = w => w.type || "综合";
  /* 内部 type 字段（vocab / grammar …）只在数据层用，界面一律显示中文 */
  const TYPE_LABEL = { vocab: "词汇", grammar: "语法", listening: "听力", reading: "阅读", speech: "口语", speaking: "口语", writing: "写作", diagnose: "诊断", chat: "对话", dictation: "听写", drill: "专项", mockexam: "模考" };
  const typeLabel = t => TYPE_LABEL[String(t || "").toLowerCase()] || t || "综合";
  /* 模块名与类型说的是同一件事时（单词 / 词汇）只留一个标签 */
  const sameKind = (mod, t) => { const l = typeLabel(t); return l === mod || (mod === "单词" && l === "词汇") || ((mod === "句法纠错" || mod === "句法") && l === "语法"); };

  const Mod = {
    title: "错题本",
    desc: "单词、语法、口语、对话中的错题自动沉淀，可按错误类型组卷重练",
    render(host, ctx) {
      window.LD.Store.visit("notebook");
      /* 3.25.0：跨模块直达预设（学情分析薄弱表 → 看错题）：module=场景筛选 / type=错误类型组卷 / q=搜索词 */
      const p = ctx && ctx.payload;
      if (p) {
        if (p.module) { filter = String(p.module); typeFilter = "all"; }
        if (p.type) typeFilter = String(p.type);
        if (p.q != null) query = String(p.q);
      }
      const all = S().wrong;
      const bank = S().wordbank;
      const pending = all.filter(w => !w.mastered);
      const scoped = filter === "all" ? all : filter === "pending" ? pending : all.filter(w => w.module === filter);
      const scopedPending = scoped.filter(w => !w.mastered);
      const typeCounts = {};
      scopedPending.forEach(w => { typeCounts[typeOf(w)] = (typeCounts[typeOf(w)] || 0) + 1; });
      const typeList = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);
      if (typeFilter !== "all" && !typeCounts[typeFilter]) typeFilter = "all";
      baseView = typeFilter === "all" ? scoped : scoped.filter(w => typeOf(w) === typeFilter);
      applyQuery();
      const q = query.trim().toLowerCase();
      const trainSet = typeFilter === "all" ? scopedPending : scopedPending.filter(w => typeOf(w) === typeFilter);
      const mods = [...new Set(all.map(w => w.module))];
      host.innerHTML = `
        <div class="page-head"><h1>错题本</h1>
          <p>共 ${all.length} 条记录 · 待掌握 ${pending.length} 条${pending.length ? " · 连续答对 2 次后可自动标记掌握" : ""}</p></div>
        <div class="grid g4" style="margin-bottom:14px">
          <div class="card card-pad stat"><div class="k">总错题</div><div class="v">${all.length}</div></div>
          <div class="card card-pad stat"><div class="k">待掌握</div><div class="v" style="color:var(--danger)">${pending.length}</div></div>
          <div class="card card-pad stat"><div class="k">已掌握</div><div class="v" style="color:var(--ok)">${all.length - pending.length}</div></div>
          <div class="card card-pad stat"><div class="k">本周新增</div><div class="v">${all.filter(w => Date.now() - w.t < 604800000).length}</div></div>
        </div>
        <div class="scenes" style="padding:0;margin-bottom:12px;border:none">
          ${[["all", "全部"], ["pending", "待掌握"]].concat(mods.map(m => [m, m])).map(([k, n]) =>
            `<div class="scene-chip ${filter === k ? "active" : ""}" data-k="${k}">${n}</div>`).join("")}
        </div>
        ${typeList.length ? `<div class="nb-types">
          <span class="nb-types-label">按错误类型组卷</span>
          <button type="button" class="btn btn-sm nb-type ${typeFilter === "all" ? "active" : ""}" data-t="all">全部 · ${scopedPending.length}</button>
          ${typeList.map(t => `<button type="button" class="btn btn-sm nb-type ${typeFilter === t ? "active" : ""}" data-t="${esc(t)}">${esc(typeLabel(t))} · ${typeCounts[t]}</button>`).join("")}
        </div>` : ""}
        <div class="card">
          <div class="card-pad" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding-bottom:12px">
            <button class="btn btn-primary" id="trainBtn">${typeFilter === "all" ? "开始错题重练" : `只练「${esc(typeFilter)}」`}（${trainSet.length}）</button>
            <button class="btn" id="clearMastered">清理已掌握</button>
            <input type="text" id="nbSearch" placeholder="搜索错题 / 正确答案 / 原因" value="${esc(query)}" style="flex:1;min-width:180px">
            <span class="hint" style="margin:0">${q ? `搜索到 ${view.length} 条 · ` : ""}${typeFilter === "all" ? "重练时答对即计入一次，答错则重新计数。" : `已按类型组卷：本轮只出「${esc(typeFilter)}」的错题。`}</span>
          </div>
          <div id="list"></div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-pad" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding-bottom:12px">
            <h3 style="margin:0;font-size:15px">${window.LD.icon("book")} 生词本</h3>
            <span class="tag tag-blue">${bank.length} 词</span>
            <span class="hint" style="margin:0">对话点击收藏 + 手动添加，词条带来源句子</span>
            <button class="btn btn-sm" id="toChat" style="margin-left:auto">去对话收词</button>
          </div>
          <div class="card-pad" style="padding-top:0;padding-bottom:10px">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <input type="text" id="wbIn" placeholder="输入德语单词：查询释义 / 添加到生词本" style="flex:1;min-width:200px">
              <button class="btn btn-sm" id="wbLookup">${window.LD.icon("search")} 查词典</button>
              <button class="btn btn-sm btn-primary" id="wbAdd">＋ 加生词</button>
            </div>
            <div id="wbLookupOut" class="hint" style="margin-top:6px;min-height:18px"></div>
          </div>
          <div class="card-pad" style="padding-top:0;padding-bottom:10px;border-top:1px dashed var(--line)">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <b style="font-size:13px">AI 扩展词汇</b>
              <span class="hint" style="margin:0">B2 / C1 / C2 / 专业词</span>
              <select id="aiVocabLevel" style="width:auto">
                ${(window.LD.AIGen ? LD.AIGen.LEVELS : ["A2", "B1", "B2", "C1", "C2"]).map(l => `<option value="${l}" ${l === "B2" ? "selected" : ""}>${l}</option>`).join("")}
              </select>
              <select id="aiVocabDomain" style="width:auto">
                ${(window.LD.AIGen ? LD.AIGen.DOMAINS : ["留学事务"]).map(d => `<option value="${d}">${d}</option>`).join("")}
              </select>
              <button class="btn btn-sm btn-primary" id="aiVocabGen">生成 5 个</button>
            </div>
            <div id="aiVocabOut" class="hint" style="margin-top:6px"></div>
          </div>
          <div id="bankList"></div>
        </div>`;

      host.querySelector("#toChat").onclick = () => ctx.go("chat");
      bindWordTools(host, ctx);
      bindAIVocab(host, ctx);
      paintBank(host, ctx);

      [...host.querySelectorAll(".scene-chip")].forEach(c => c.onclick = () => { filter = c.dataset.k; typeFilter = "all"; ctx.go("notebook"); });
      [...host.querySelectorAll(".nb-type")].forEach(c => c.onclick = () => { typeFilter = c.dataset.t; ctx.go("notebook"); });
      host.querySelector("#trainBtn").onclick = () => startTrain(host, ctx);
      host.querySelector("#clearMastered").onclick = () => {
        S().wrong = S().wrong.filter(w => !w.mastered);
        window.LD.Store.save(); toast("已清理", "ok"); ctx.go("notebook");
      };
      paintList(host, ctx);
      const search = host.querySelector("#nbSearch");
      if (search) search.oninput = () => {
        query = search.value;
        pageNo = 0;
        applyQuery();
        paintList(host, ctx);   // 只重绘列表，输入框保持焦点
      };
    }
  };

  /* 手动加生词 + 内置词典查询：查词库（2000 词，冠词/释义/例句）命中则回填中文 */
  function bindWordTools(host, ctx) {
    const input = host.querySelector("#wbIn");
    const out = host.querySelector("#wbLookupOut");
    if (!input) return;

    const lookup = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { out.textContent = ""; return; }
      const lex = (window.LD_LEX || []).filter(x => x[0].toLowerCase() === q || x[0].toLowerCase().startsWith(q + " "));
      const hit = lex.length ? lex[0] : null;
      if (hit) {
        out.innerHTML = `<b>${hit[1] !== "-" ? hit[1] + " " : ""}${hit[0]}</b>（${hit[4]}·${hit[2]}）${hit[5] ? "例：" + esc(hit[5]) : ""}`;
      } else {
        out.textContent = `词库暂无「${input.value.trim()}」——可先加入生词本，释义会在练习中补全。`;
      }
      return hit;
    };
    const add = () => {
      const de = input.value.trim();
      if (!de) { toast("先输入一个德语单词", "err"); return; }
      const hit = lookup();
      const item = window.LD.Store.addWord({ de, zh: hit ? hit[2] : "", ctx: "手动添加" });
      if (item) { toast(`已收藏「${de}」`, "ok"); input.value = ""; out.textContent = ""; paintBank(host, ctx); }
      else toast("已在生词本中", "err");
    };
    host.querySelector("#wbLookup").onclick = lookup;
    host.querySelector("#wbAdd").onclick = add;
    input.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
  }

  /* AI 扩展 B2/C1/C2/专业词：加入 contentPack.lexicon 后，单词练习会自动纳入队列 */
  function bindAIVocab(host, ctx) {
    const btn = host.querySelector("#aiVocabGen");
    if (!btn) return;
    btn.onclick = async () => {
      const out = host.querySelector("#aiVocabOut");
      if (!window.LD.AIGen) { out.textContent = "AI 词汇模块未加载"; return; }
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "生成中…";
      out.textContent = "正在按等级与领域生成词条…";
      const r = await LD.AIGen.generateVocab({
        level: host.querySelector("#aiVocabLevel").value,
        domain: host.querySelector("#aiVocabDomain").value,
        count: 5
      });
      btn.disabled = false;
      btn.textContent = old;
      if (!r.ok) { out.textContent = r.message || "生成失败"; return; }
      out.innerHTML = `
        <div style="margin-top:4px">已加入词库，可在「单词练习」队列中复习；标 <span class="tag tag-warn">AI · 未人工审校</span> 的词条尚未经过人工语义复核。</div>
        ${r.items.map(x => `<div class="list-item" style="padding:6px 0">
          <div class="main"><div class="t1"><b class="de">${esc(x.art && x.art !== "-" ? x.art + " " : "")}${esc(x.de)}</b> <span class="tag tag-warn">${esc(x.lvl)} · ${esc(x.domain)}</span></div>
          <div class="t2">${esc(x.zh)}${x.ex ? ` · ${esc(x.ex)}` : ""}</div></div>
          <button class="btn btn-sm" data-ai-word="${esc(x.de)}" data-ai-zh="${esc(x.zh)}" data-ai-ctx="${esc(x.ex || "")}">收藏</button>
        </div>`).join("")}`;
      out.querySelectorAll("[data-ai-word]").forEach(b => b.onclick = () => {
        const item = window.LD.Store.addWord({
          de: b.dataset.aiWord, zh: b.dataset.aiZh, ctx: b.dataset.aiCtx, scene: "AI 词汇"
        });
        if (item) { toast(`已收藏「${item.de}」`, "ok"); paintBank(host, ctx); b.disabled = true; b.textContent = "已收藏"; }
      });
    };
  }

  function paintList(host, ctx) {
    const box = host.querySelector("#list");
    if (!view.length) {
      box.innerHTML = filter === "all" && typeFilter === "all"
        ? `<div class="empty"><div class="big">✓</div><strong>还没有错题记录</strong><p>去「单词练习」或「句法纠错」里跑一轮，错题会自动进入这里。</p></div>`
        : `<div class="empty"><div class="big">✓</div><strong>当前筛选没有错题</strong><p>当前筛选（${esc(filter === "all" ? "全部" : filter)} · ${esc(typeFilter === "all" ? "全部类型" : typeFilter)}）下没有记录，换个筛选或回到「全部」。</p></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(view.length / PAGE));
    const slice = view.slice(pageNo * PAGE, pageNo * PAGE + PAGE);
    box.innerHTML = slice.map(w => `
      <div class="list-item" data-id="${w.id}">
        <div class="main">
          <div class="t1">${esc(w.wrong || "—")} ${w.right ? `<span style="color:var(--text-3)">→</span> <span style="color:var(--ok)">${esc(w.right)}</span>` : ""}</div>
          <div class="t2">${esc(w.why || "")}</div>
          <div style="margin-top:6px">
            <span class="tag">${esc(w.module)}</span>${sameKind(w.module, w.type) ? "" : ` <span class="tag">${esc(typeLabel(w.type))}</span>`}
            ${w.mastered ? '<span class="tag tag-ok">已掌握</span>' : ""}
            <span style="font-size:12px;color:var(--text-3);margin-left:4px">${w.times ? `重练 ${w.times} 次 · ` : ""}${new Date(w.t).toLocaleDateString("zh-CN")}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${w.module === "单词" ? `<button class="btn btn-sm" data-say="${esc(w.wrong)}">${window.LD.icon("volume")}</button>` : ""}
          <button class="btn btn-sm" data-ok="${w.id}">答对了</button>
          <button class="btn btn-sm" data-bad="${w.id}">还不会</button>
        </div>
      </div>`).join("") + (pages > 1 ? `
      <div class="card-pad" style="display:flex;gap:10px;align-items:center;justify-content:center;border-top:1px solid var(--line-soft)">
        <button class="btn btn-sm" data-page="prev" ${pageNo === 0 ? "disabled" : ""}>上一页</button>
        <span class="hint" style="margin:0">第 ${pageNo + 1} / ${pages} 页 · 共 ${view.length} 条（每页 ${PAGE}）</span>
        <button class="btn btn-sm" data-page="next" ${pageNo >= pages - 1 ? "disabled" : ""}>下一页</button>
      </div>` : "");
    box.querySelectorAll("[data-page]").forEach(b => b.onclick = () => {
      pageNo += b.dataset.page === "next" ? 1 : -1;
      pageNo = Math.max(0, Math.min(pageNo, pages - 1));
      paintList(host, ctx);
      box.scrollIntoView({ block: "start" });
    });
    box.querySelectorAll("[data-say]").forEach(b => b.onclick = () => window.LD.SpeechUtil.say(b.dataset.say));
    box.querySelectorAll("[data-ok]").forEach(b => b.onclick = () => { window.LD.Store.reviewWrong(b.dataset.ok, true); toast("记录一次掌握，两次即自动出师", "ok"); ctx.go("notebook"); });
    box.querySelectorAll("[data-bad]").forEach(b => b.onclick = () => { window.LD.Store.reviewWrong(b.dataset.bad, false); toast("已重新计数，继续保持", "info"); ctx.go("notebook"); });
  }

  /* 对话生词本区：带来源句子、发音、掌握标记 */
  function paintBank(host, ctx) {
    const box = host.querySelector("#bankList");
    if (!box) return;
    const bank = S().wordbank;
    if (!bank.length) {
      box.innerHTML = `<div class="empty" style="padding:26px 12px"><div class="big">${window.LD.icon("book")}</div>
        <strong>还没有收藏生词</strong><p>去「德语对话室」点击消息中的德语单词，词条会自动带来源句子。</p></div>`;
      return;
    }
    box.innerHTML = bank.map(w => `
      <div class="list-item">
        <div class="main">
          <div class="t1 de" style="${w.known ? "color:var(--text-3);text-decoration:line-through" : ""}">${esc(w.de)}</div>
          ${w.ctx ? `<div class="t2" style="white-space:normal">…${esc(w.ctx)}…</div>` : ""}
          <div style="margin-top:5px">
            <span class="tag ${w.known ? "tag-ok" : "tag-warn"}">${w.known ? "已掌握" : "待巩固"}</span>
            <span class="tag">${esc(w.scene || "对话")}</span>
            <span style="font-size:12px;color:var(--text-3);margin-left:4px">${new Date(w.t).toLocaleString("zh-CN")}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm" data-bsay="${esc(w.de)}">${window.LD.icon("volume")}</button>
          <button class="btn btn-sm" data-bknown="${w.id}">${w.known ? "↺ 待巩固" : "✓ 掌握了"}</button>
          <button class="btn btn-sm danger" data-bdel="${w.id}">删除</button>
        </div>
      </div>`).join("");
    box.querySelectorAll("[data-bsay]").forEach(b => b.onclick = () => window.LD.SpeechUtil.say(b.dataset.bsay));
    box.querySelectorAll("[data-bknown]").forEach(b => b.onclick = () => { window.LD.Store.toggleWordKnown(b.dataset.bknown); ctx.go("notebook"); });
    box.querySelectorAll("[data-bdel]").forEach(b => b.onclick = () => { window.LD.Store.removeWord(b.dataset.bdel); ctx.go("notebook"); });
  }

  /* 错题重练：卡片式，正面 wrong/提示，翻面显示 right + 讲解；选了类型就只出该类 */
  function startTrain(host, ctx) {
    const allPending = S().wrong.filter(w => !w.mastered);
    const pending = typeFilter === "all" ? allPending : allPending.filter(w => typeOf(w) === typeFilter);
    if (!pending.length) { toast(typeFilter === "all" ? "当前没有待掌握的错题" : `「${typeFilter}」已无待掌握错题`, "info"); return; }
    /* 组卷顺序：重练次数少的先出（最生疏的先补），其次按记录时间 */
    const stack = pending.slice().sort((a, b) => (a.times || 0) - (b.times || 0) || a.t - b.t).slice(0, 20);
    let i = 0;
    host.innerHTML = `
      <div class="page-head"><h1>错题重练</h1><p>${typeFilter === "all" ? "全部类型" : `「${esc(typeFilter)}」组卷`} · 共 ${stack.length} 条 · 回想答案后再翻面核对</p></div>
      <div class="card"><div class="vocab-stage" id="tStage"></div>
        <div class="progress-line"><i id="tPg" style="width:0%"></i></div>
        <div style="padding:12px 18px;color:var(--text-3);font-size:12.5px"><span id="tHint">1 / ${stack.length}</span></div>
      </div>`;
    paint(stack[i], i, host, ctx, stack);
  }

  function paint(w, i, host, ctx, stack) {
    const st = host.querySelector("#tStage");
    st.innerHTML = `
      <div style="color:var(--text-3);font-size:12.5px;margin-bottom:8px"><span class="tag">${esc(w.module)}</span>${sameKind(w.module, w.type) ? "" : ` <span class="tag">${esc(typeLabel(w.type))}</span>`}</div>
      <div class="vocab-word" style="font-size:26px;text-align:center;line-height:1.5;max-width:600px">${esc(w.source || w.wrong)}</div>
      ${w.source ? `<div class="vocab-phon">原句语境</div>` : ""}
      <div id="tRev" style="display:none;width:100%;max-width:620px;text-align:center">
        <div class="vocab-zh" style="color:var(--ok)">${esc(w.right || "（见讲解）")}</div>
        ${w.why ? `<div class="vocab-ex"><div class="zh">${esc(w.why)}</div></div>` : ""}
      </div>
      <div class="vocab-actions">
        <button class="btn" id="tFlip">翻面核对</button>
        ${w.module === "单词" ? `<button class="btn" id="tSay">${window.LD.icon("volume")}</button>` : ""}
      </div>
      <div class="rate-bar" id="tRate" style="display:none">
        <div class="rate-btn" data-v="bad">还想不起来</div>
        <div class="rate-btn" data-v="ok">已经掌握了</div>
      </div>`;
    st.querySelector("#tFlip").onclick = () => { st.querySelector("#tRev").style.display = "block"; st.querySelector("#tRate").style.display = "flex"; };
    const sayB = st.querySelector("#tSay"); if (sayB) sayB.onclick = () => window.LD.SpeechUtil.say(w.wrong);
    [...st.querySelectorAll(".rate-btn")].forEach(b => b.onclick = () => {
      const ok = b.dataset.v === "ok";
      window.LD.Store.reviewWrong(w.id, ok);
      window.LD.Store.logAnswer({ type: w.type || "综合", ability: abilityOf(w), ok, ms: 8000, item: w.wrong });
      i++;
      host.querySelector("#tPg").style.width = (i / stack.length * 100) + "%";
      if (i >= stack.length) {
        window.LD.Store.addSession({ module: "notebook", ms: stack.length * 9000, count: stack.length });
        st.innerHTML = `<div style="text-align:center;padding:20px 0"><div class="fin-ico" style="color:var(--brand)">${window.LD.icon("target")}</div>
          <h2 style="margin:10px 0">重练完成</h2><div style="color:var(--text-3)">共 ${stack.length} 条</div>
          <div class="btn-row" style="justify-content:center;margin-top:16px">
            <button class="btn btn-primary" id="backNote">返回错题本</button></div></div>`;
        st.querySelector("#backNote").onclick = () => ctx.go("notebook");
        return;
      }
      host.querySelector("#tHint").textContent = `${i + 1} / ${stack.length}`;
      paint(stack[i], i, host, ctx, stack);
    });
  }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "错题本", icon: "✕", group: "沉淀与复盘", priority: "P0", order: 9, ds: "跨模块错题自动沉淀，二次重练与掌握标记" });
  window.LD.define("notebook", Mod);
})();
