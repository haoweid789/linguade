/* 模块 2 · 德语句法纠错：本地规则引擎 + 大模型双通道，输出错误定位与中文讲解 */
(function () {
  const S = () => window.LD.Store.s;
  let lastText = "";

  const Mod = {
    title: "句法纠错",
    desc: "错误定位 + 中文讲解 + 改写建议，支持一句话即时诊断",
    render(host, ctx) {
      window.LD.Store.visit("grammar");
      const lib = window.LD_GRAMMAR_LIBRARY || [];
      host.innerHTML = `
        <div class="page-head"><h1>德语句法纠错</h1>
          <p>输入德语句子即时诊断${window.LD.LLM.ready() ? ' · <span class="tag tag-ok">大模型已接入</span>' : ' · <span class="tag">本地规则引擎</span>'}。所有诊断均可一键存入错题本。</p></div>
        ${window.LD.FirstWeek ? window.LD.FirstWeek.notice(window.LD.FirstWeek.contextFor("grammar")) : ""}
        <div class="grid" style="grid-template-columns:1fr 300px">
          <div class="card card-pad">
            <textarea id="gIn" placeholder="请输入一句德语，例如：Ich habe gestern ins Kino gegangen."></textarea>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn-primary" id="gCheck">检查语法</button>
              <button class="btn" id="gSample">随机来一句</button>
              <button class="btn" id="gClear">清空</button>
              <button class="btn" id="gImg" title="拍照/上传手写德语，自动识别并纠错">${window.LD.icon("camera")} 从图片导入</button>
            </div>
            <div id="gOut" style="margin-top:16px"></div>
          </div>
          <div>
            <div class="card card-pad" style="margin-bottom:12px">
              <h2 style="margin:0 0 8px;font-size:13.5px">常见错误句库</h2>
              <div class="hint" style="margin-bottom:8px">点击直接填入左侧进行诊断练习，共 ${lib.length} 句。</div>
              <div id="libList" style="max-height:420px;overflow:auto"></div>
            </div>
            <div class="card card-pad">
              <h2 style="margin:0 0 8px;font-size:13.5px">本模块规则覆盖</h2>
              <div style="font-size:12.5px;line-height:2;color:var(--text-2)">
                ${(window.LD_RULES.checks || []).map(c => `<div>· ${c.name}</div>`).join("")}
                <div>· 完成时助动词（sein / haben）</div>
                <div>· 固定搭配与所属关系</div>
              </div>
            </div>
            <div class="card card-pad" style="margin-top:12px;border-color:var(--accent)">
              <h2 style="margin:0 0 6px;font-size:13.5px">AI 知识点讲解</h2>
              <div class="hint" style="margin:0 0 8px">按知识点生成中文讲解 + 3 道练习；AI 内容标注「未人工审校」。</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <select id="gAiPoint" style="flex:1;min-width:150px">
                  ${(window.LD.AIGen ? LD.AIGen.GRAMMAR_POINTS : []).map(p => `<option value="${p.nm}" data-lv="${p.level}">${p.nm}</option>`).join("")}
                </select>
                <select id="gAiLevel" style="width:78px">
                  ${(window.LD.AIGen ? LD.AIGen.LEVELS : ["A2", "B1", "B2", "C1", "C2"]).map(l => `<option value="${l}" ${l === "B1" ? "selected" : ""}>${l}</option>`).join("")}
                </select>
                <button class="btn btn-primary btn-sm" id="gAiGen">生成</button>
              </div>
              <div id="gAiOut" style="margin-top:10px"></div>
            </div>
            ${refCardHtml()}
          </div>
        </div>`;

      LD.UI.moduleTabs(host, [{ route: "grammar", label: "句法纠错" }, { route: "syntax", label: "句法透视", note: "结构拆解" }], "grammar");
      const libList = host.querySelector("#libList");
      libList.innerHTML = lib.map((x, i) => `
        <div class="list-item" data-i="${i}" style="padding:9px 4px;cursor:pointer">
          <div class="main"><div class="t1" style="font-size:12.5px">${x.wrong}</div></div>
          <span class="tag ${x.issues.length ? "tag-warn" : "tag-ok"}">${x.issues.length ? x.issues.length + " 处" : "正确"}</span>
        </div>`).join("");
      [...libList.children].forEach(c => c.onclick = () => {
        const item = lib[+c.dataset.i];
        host.querySelector("#gIn").value = item.wrong;
        run(host, item.wrong, ctx);
      });

      host.querySelector("#gCheck").onclick = () => run(host, host.querySelector("#gIn").value.trim(), ctx);
      host.querySelector("#gSample").onclick = () => {
        const item = lib[Math.floor(Math.random() * lib.length)];
        host.querySelector("#gIn").value = item.wrong; run(host, item.wrong, ctx);
      };
      host.querySelector("#gClear").onclick = () => { host.querySelector("#gIn").value = ""; host.querySelector("#gOut").innerHTML = ""; };
      /* 从图片导入：拍照/上传 → 识别转录（mode=grammar）→ 自动纠错 */
      const gImg = host.querySelector("#gImg");
      if (gImg) gImg.onclick = () => {
        if (!window.LD.OCRUI) { toast("图片导入工具未加载", "err"); return; }
        window.LD.OCRUI.pick({ mode: "grammar" }).then(r => {
          if (!r) return;
          const ta = host.querySelector("#gIn");
          ta.value = r.transcript || "";
          if (!ta.value.trim()) { toast("未识别到文本，请换一张更清晰的图片", "err"); return; }
          toast("已识别转录（可先手动校对）；正在诊断……", "ok");
          run(host, ta.value.trim(), ctx);
        });
      };
      host.querySelector("#gIn").addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run(host, host.querySelector("#gIn").value.trim(), ctx);
      });

      const gPoint = host.querySelector("#gAiPoint");
      if (gPoint) gPoint.onchange = () => {
        const lv = gPoint.options[gPoint.selectedIndex].dataset.lv;
        if (lv) host.querySelector("#gAiLevel").value = lv;
      };
      const gAi = host.querySelector("#gAiGen");
      if (gAi) gAi.onclick = async () => {
        const out = host.querySelector("#gAiOut");
        if (!window.LD.AIGen) { out.textContent = "AI 讲解模块未加载"; return; }
        gAi.disabled = true;
        const old = gAi.textContent;
        gAi.textContent = "生成中…";
        out.innerHTML = `<div class="hint">正在生成讲解与练习…</div>`;
        const r = await LD.AIGen.generateGrammar({
          point: host.querySelector("#gAiPoint").value,
          level: host.querySelector("#gAiLevel").value
        });
        gAi.disabled = false;
        gAi.textContent = old;
        if (!r.ok) { out.innerHTML = `<div class="hint" style="color:var(--danger)">${esc(r.message || "生成失败")}</div>`; return; }
        renderAIGrammar(out, r.item);
      };
      const refLevel = host.querySelector("#gRefLevel");
      if (refLevel) {
        const refList = host.querySelector("#gRefList");
        const pts = window.LD_GRAMMAR_POINTS || [];
        const paintRef = () => {
          const lv = refLevel.value;
          const items = pts.filter(p => !lv || p.lv === lv);
          refList.innerHTML = items.length
            ? items.map(refItem).join("")
            : `<div class="hint">该等级暂无语法点。</div>`;
        };
        refLevel.onchange = paintRef;
        paintRef();
      }
    }
  };

  function refCardHtml() {
    const pts = window.LD_GRAMMAR_POINTS || [];
    if (!pts.length) return "";
    const levels = ["A1", "A2", "B1", "B2", "C1", "C2"].filter(lv => pts.some(p => p.lv === lv));
    return `<div class="card card-pad" style="margin-top:12px">
      <h2 style="margin:0 0 6px;font-size:13.5px">语法速查 A1–C2</h2>
      <div class="hint" style="margin:0 0 8px">共 ${pts.length} 个语法点；按等级筛选，点击展开中文讲解、结构与例句。</div>
      <select id="gRefLevel" style="width:100%;margin-bottom:8px">
        <option value="">全部等级</option>
        ${levels.map(lv => `<option value="${lv}">${lv}（${pts.filter(p => p.lv === lv).length}）</option>`).join("")}
      </select>
      <div id="gRefList" style="max-height:360px;overflow:auto"></div>
    </div>`;
  }

  function refItem(p) {
    return `<details style="padding:8px 4px;border-bottom:1px solid var(--line-soft)">
      <summary style="cursor:pointer;list-style:none">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
          <b style="font-size:12.5px">${esc(p.zh)}</b><span class="tag">${esc(p.lv)}</span>
        </div>
        <div class="hint" style="margin-top:2px">${esc(p.de)}</div>
      </summary>
      <div style="font-size:12.5px;line-height:1.75;margin-top:6px">
        ${p.exp ? `<div>${esc(p.exp)}</div>` : ""}
        ${p.pat ? `<div class="hint" style="margin-top:4px">结构：<code>${esc(p.pat)}</code></div>` : ""}
        ${p.ex ? `<div class="vocab-ex" style="margin-top:6px"><div class="de">${esc(p.ex)}</div>${p.exzh ? `<div class="zh">${esc(p.exzh)}</div>` : ""}</div>` : ""}
      </div>
    </details>`;
  }

  function renderAIGrammar(out, item) {
    out.innerHTML = `
      <div style="padding:10px 11px;border-radius:9px;background:var(--brand-soft);border:1px solid var(--line-soft)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
          <b style="font-size:13px">${esc(item.point)}</b>
          <span class="tag tag-warn">AI 生成 · 未人工审校</span>
        </div>
        <div style="font-size:12.5px;line-height:1.8;margin-top:6px">${esc(item.explain)}</div>
        ${(item.examples || []).length ? `<div style="margin-top:7px">${item.examples.map(x => `<div style="font-size:12px;line-height:1.65"><span class="de">${esc(x.de)}</span>${x.zh ? `<span style="color:var(--text-3)"> — ${esc(x.zh)}</span>` : ""}</div>`).join("")}</div>` : ""}
        ${(item.exercises || []).length ? `<div class="divider" style="margin:9px 0 6px"><span>练习</span></div>
          ${item.exercises.map((x, i) => `<div style="font-size:12px;line-height:1.7;margin-bottom:7px">
            <div><b>${i + 1}.</b> <span class="de">${esc(x.q)}</span></div>
            <div style="color:var(--text-3)">${x.opts.map((o, j) => `${String.fromCharCode(65 + j)}. ${esc(o)}`).join("　")}</div>
            <details style="margin-top:2px"><summary style="cursor:pointer;color:var(--text-3)">答案</summary>
              <div>${String.fromCharCode(65 + x.a)} · ${esc(x.why)}</div></details>
          </div>`).join("")}` : ""}
      </div>`;
  }

  function run(host, text, ctx) {
    if (!text) { toast("请先输入一句德语", "err"); return; }
    lastText = text;
    const out = host.querySelector("#gOut");
    const t0 = Date.now();
    out.innerHTML = `<div class="hint">正在诊断……</div>`;
    window.LD.LLM.correct(text).then(res => {
      const ms = Date.now() - t0;
      const issues = (res.issues || []).filter(i => i && i.why && !(i.fix && i.wrong && String(i.fix).trim() === String(i.wrong).trim()));
      const penalty = issues.reduce((a, i) => a + (i.sev === "info" ? 5 : 15), 0);
      const score = Math.max(20, 100 - penalty);
      const clean = issues.length === 0;
      window.LD.Store.logAnswer({ type: "grammar", ability: "grammar", ok: clean, ms, item: text.slice(0, 40), skill: "g:综合" });
      // 按错误类型分别更新 BKT 知识点
      issues.forEach(i => window.LD.Engine.bktUpdate("g:" + (i.type || "综合"), false));
      if (clean) window.LD.Engine.bktUpdate("g:综合", true);
      window.LD.Store.addSession({ module: "grammar", ms, count: 1 });

      const gRun = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("grammar") : null;
      let gBlock = "";
      if (gRun) {
        const gd = (gRun.data && gRun.data.grammar) || {};
        const attempts = Array.isArray(gd.attempts) ? gd.attempts.slice() : [];
        if (!attempts.includes(text.trim())) attempts.push(text.trim());
        const target = window.LD.FirstWeek.target(gRun);
        window.LD.FirstWeek.update(gRun, { progress: attempts.length, data: Object.assign({}, gRun.data || {}, { grammar: { attempts } }) });
        window.LD.FirstWeek.evidence(gRun, "语法诊断");
        gBlock = attempts.length >= target
          ? window.LD.FirstWeek.receipt(gRun, {
            summary: `语法本轮诊断 ${attempts.length} 句`,
            detail: `最近一句：${clean ? "未发现明显错误" : issues.length + " 处待改进"}`,
            evidence: "语法诊断",
            source: "grammar-round",
            label: "完成语法任务"
          })
          : `<div class="fw-receipt fw-receipt-embedded"><div class="fw-receipt-head"><span class="tag tag-blue">今日计划进度</span><b>${attempts.length} / ${target} 句</b></div><div class="fw-receipt-meta">换一句新的德语再诊断，重复提交同一句不增加进度。</div></div>`;
      }
      const libHit = (window.LD_GRAMMAR_LIBRARY || []).find(x => x.wrong.trim() === text.trim());
      out.innerHTML = `
        ${gBlock}
        <div class="card" style="background:var(--panel-2)">
          <div class="card-pad" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div class="score-ring"><div id="ringBox"></div>
              <div><div style="font-weight:600;font-size:15px">${clean ? "未发现明显错误" : issues.length + " 处待改进"}</div>
              <div style="font-size:12.5px;color:var(--text-3)">诊断用时 ${ms} ms · 引擎：${res.source === "llm" ? "大模型" : "本地规则"}</div></div></div>
            ${libHit ? `<div style="margin-left:auto;font-size:13px">参考写法：<b>${libHit.right}</b></div>` : ""}
          </div>
        </div>
        ${issues.length ? `<div class="corr-diff">${issues.map(i => `
          <div class="corr-item">
            <div class="row">
              <span class="badge-x">${typeIcon(i.type)}</span>
              <div style="flex:1">
                <div style="font-size:14px;line-height:1.7">
                  ${i.wrong ? `<del>${esc(i.wrong)}</del>` : ""}
                  ${i.fix ? ` <span style="color:var(--text-3)">→</span> <ins>${esc(i.fix)}</ins>` : ""}
                  ${!i.wrong && !i.fix ? esc(text) : ""}
                </div>
                <div class="why">${esc(i.why)}</div>
              </div>
              <span class="tag">${esc(i.type || "综合")}</span>
            </div>
          </div>`).join("")}</div>` : `<div class="card card-pad" style="margin-top:12px;background:var(--ok-soft)">
            <div style="font-size:14px">句子结构没有明显问题。若想继续打磨，可尝试用从句或被动式改写同一句话。</div></div>`}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn" id="saveWrong">存入错题本</button>
          <button class="btn" id="toChat">到对话里练这句</button>
        </div>`;
      window.LD.Charts.ring(out.querySelector("#ringBox"), score, { size: 68, color: score >= 85 ? "var(--ok)" : score >= 60 ? "var(--accent)" : "var(--danger)" });
      const gReceipt = out.querySelector(".fw-receipt");
      if (gReceipt) gReceipt.scrollIntoView({ behavior: "smooth", block: "start" });
      out.querySelector("#saveWrong").onclick = () => {
        window.LD.Store.addWrong({
          module: "句法纠错", type: issues.length ? (issues[0].type || "综合") : "综合",
          wrong: text, right: libHit ? libHit.right : (issues[0] && issues[0].fix ? issues[0].fix : ""),
          source: "", why: issues.map(i => i.why).join("；")
        });
        toast("已存入错题本", "ok");
      };
      out.querySelector("#toChat").onclick = () => ctx.go("chat", { preset: text });
    }).catch(e => {
      out.innerHTML = `<div class="card card-pad" style="background:var(--danger-soft)">诊断失败：${esc(e.message || e)}</div>`;
    });
  }

  const typeIcon = t => ({ "语序": "⇄", "格变化": "◱", "助动词": "⟲", "正字法": "Aa", "搭配": "∞", "否定": "∅", "标点": ".", "综合": "✎", "动词框架": "⟲" }[t] || "✎");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "句法纠错", icon: "✎", group: "学习闭环", priority: "P0", order: 3, ds: "错误定位 + 中文讲解 + 改写建议，双引擎校验" });
  window.LD.define("grammar", Mod);
})();
