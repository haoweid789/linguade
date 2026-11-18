/* 模块 · 弱点突破：基于学习数据的自适应组卷
   对标 Duolingo 2026 Adaptive Review（弱点定向复习）与 Practice Hub：
   从错题本、BKT 掌握度、HLR 濒危词三类信号中自动抽取最需要训练的题目，
   组成本轮突破练习，练完立即反馈覆盖了哪些弱点。 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let session = null;   // { qs: [...], i: 0, right: 0, done: false }

  /* ---- 弱点信号汇总（错题本 + BKT + HLR + 能力值） ---- */
  function weakSignals() {
    const s = S();
    const wp = E().weakPoints();
    const bkt = s.bkt || {};
    const bktWeak = Object.keys(bkt).map(k => ({ k, v: bkt[k] }))
      .sort((a, b) => a.v - b.v).slice(0, 5);
    const hlrDue = E().hlrDueList().slice(0, 6);
    const pending = window.LD.Store.wrongPending();
    // 按题型正确率给错题排序：正确率低的题型排前
    const accOf = type => { const t = wp.byType.find(x => x.key === type); return t ? t.acc : 100; };
    const pendingSorted = pending.slice().sort((a, b) => accOf(a.type) - accOf(b.type));
    return { wp, bktWeak, hlrDue, pending: pendingSorted, abilityWeak: wp.weakest };
  }

  /* ---- 组卷：错题重练（≤5）+ 词汇弱点（≤4）---- */
  function buildSession() {
    const sig = weakSignals();
    const qs = [];
    sig.pending.slice(0, 5).forEach(w => qs.push({ kind: "wrong", w }));
    // 词汇题：HLR 濒危 + BKT 低掌握的 v: 词条合并
    const lex = window.LD_LEX || [];
    const cand = [...new Set([
      ...sig.hlrDue.map(x => x.w),
      ...sig.bktWeak.filter(x => x.k.indexOf("v:") === 0).map(x => x.k.slice(2))
    ])].map(w => lex.find(x => x[0] === w)).filter(Boolean).slice(0, 4);
    cand.forEach(w => qs.push({ kind: "vocab", w }));
    return qs;
  }

  const Mod = {
    title: "弱点突破",
    desc: "按 BKT 掌握度、错题本与 HLR 濒危词自动组卷，专攻最薄弱的知识点",
    render(host, ctx) {
      window.LD.Store.visit("weak");
      session = null;
      const sig = weakSignals();
      const wp = sig.wp;
      const nameOf = k => ({ vocab: "词汇", grammar: "语法", reading: "阅读", listening: "听力", speaking: "口语", writing: "写作" }[k] || k);
      host.innerHTML = `
        <div class="page-head"><h1>弱点突破</h1>
          <p>系统持续记录每个知识点的掌握概率（BKT）、每个词条的记忆半衰期（HLR）与每一次错误。这里把三类信号汇总成一张「专攻你的薄弱点」的练习卷。</p></div>

        <div class="grid g2" style="margin-bottom:14px">
          <div class="card card-pad">
            <h2 style="margin:0 0 10px;font-size:13.5px">当前弱点信号</h2>
            ${wp.byType.length ? `<table class="tbl"><thead><tr><th>题型</th><th>题量</th><th>正确率</th><th>状态</th></tr></thead><tbody>
              ${wp.byType.slice(0, 6).map(t => `<tr><td>${esc(t.key)}</td><td>${t.total}</td><td>${t.acc}%</td>
                <td><span class="tag ${t.acc >= 80 ? "tag-ok" : t.acc >= 60 ? "tag-warn" : "tag-danger"}">${t.acc >= 80 ? "稳固" : t.acc >= 60 ? "波动" : "薄弱"}</span></td></tr>`).join("")}
            </tbody></table>` : `<div class="empty"><div class="big">◔</div><strong>还没有作答记录</strong><p>先去做一轮任意练习，错题、遗忘词与低掌握知识点会汇总到这里。</p></div>`}
            <div class="divider"><span>能力值最低项</span></div>
            <div style="font-size:13px;line-height:1.9;color:var(--text-2)">
              ${wp.weakest.map(w => `${nameOf(w.key)} <b>${Math.round(w.v)}</b>`).join(" ｜ ")}
            </div>
          </div>
          <div class="card card-pad">
            <h2 style="margin:0 0 10px;font-size:13.5px">可组成的题目来源</h2>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
              <div class="list-item"><div class="main"><div class="t1">✕ 错题本待重练</div><div class="t2">自动沉淀的错题，优先正确率最低的题型</div></div><b>${sig.pending.length}</b></div>
              <div class="list-item"><div class="main"><div class="t1">▤ HLR 濒危词条</div><div class="t2">回忆概率已降到 ${Math.round((S().cfg.retention || 0.9) * 100)}% 以下的词</div></div><b>${sig.hlrDue.length}</b></div>
              <div class="list-item"><div class="main"><div class="t1">◧ BKT 低掌握技能点</div><div class="t2">掌握概率低于 60% 的知识点</div></div><b>${sig.bktWeak.filter(x => x.v < 0.6).length}</b></div>
            </div>
            <div class="btn-row" style="margin-top:12px">
              <button class="btn btn-primary" id="genBtn">${window.LD.icon("zap")} 生成突破练习</button>
            </div>
            <div class="hint">每次生成的题目按当前薄弱度动态决定；练完的错题连续答对 2 次自动标记为已掌握。</div>
          </div>
        </div>
        <div id="stage"></div>`;
      host.querySelector("#genBtn").onclick = () => {
        const qs = buildSession();
        if (!qs.length) { window.LD.UI.toast("当前没有可组的题目，先去学几个单词或做一轮练习", "err"); return; }
        session = { qs, i: 0, right: 0, done: false };
        paintQ(host, ctx);
      };
    }
  };

  function paintQ(host, ctx) {
    const st = host.querySelector("#stage");
    if (!session) return;
    if (session.i >= session.qs.length) return finishQ(st, ctx);
    const q = session.qs[session.i];
    const tag = `<div class="tag tag-blue">第 ${session.i + 1} / ${session.qs.length} 题</div>`;

    if (q.kind === "wrong") {
      const w = q.w;
      st.innerHTML = `
        ${tag}
        <div class="card card-pad" style="margin-top:10px">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <span class="tag">${esc(w.module || "练习")}</span><span class="tag tag-warn">${esc(w.type || "错题")}</span>
            <span class="hint" style="margin:0">已重练 ${w.times || 0} 次</span>
          </div>
          <div style="font-size:14px;line-height:1.9">${esc(w.right || w.source || "")}</div>
          ${w.source ? `<div class="hint">来源：${esc(w.source)}</div>` : ""}
          <div class="divider"><span>这道题当时错在哪</span></div>
          <div style="font-size:13px;color:var(--danger);line-height:1.8">${esc(w.wrong || "")}</div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.8;margin-top:6px">${esc(w.why || "")}</div>
          <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" id="okBtn">✓ 现在掌握了</button>
            <button class="btn" id="noBtn">✕ 还不会</button>
          </div>
          <div id="fb"></div>
        </div>`;
      st.querySelector("#okBtn").onclick = () => {
        window.LD.Store.reviewWrong(w.id, true);
        window.LD.Store.logAnswer({ type: q.w.module === "听力训练" ? "listening" : "weak", ability: abilityOf(w.module), ok: true, ms: 4000, item: w.source || w.right || "", skill: "weak:wrong" });
        after(st, ctx, true, "已标记掌握，连续 2 次答对将自动移入「已掌握」。");
      };
      st.querySelector("#noBtn").onclick = () => {
        window.LD.Store.reviewWrong(w.id, false);
        window.LD.Store.logAnswer({ type: "weak", ability: abilityOf(w.module), ok: false, ms: 4000, item: w.source || w.right || "", skill: "weak:wrong" });
        after(st, ctx, false, "还不会就对了——错题本会继续保留它，明天再见。");
      };
    } else {
      const w = q.w;
      const others = shuffle((window.LD_LEX || []).filter(x => x[0] !== w[0] && x[4] === w[4])).slice(0, 3);
      const pool = others.length >= 3 ? others : shuffle((window.LD_LEX || []).filter(x => x[0] !== w[0])).slice(0, 3);
      const opts = shuffle([w].concat(pool));
      st.innerHTML = `
        ${tag}
        <div class="card card-pad" style="margin-top:10px">
          <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">这个词选自你的濒危词库或低掌握技能点，选出正确释义</div>
          <div style="text-align:center;padding:18px 0">
            <div class="de" style="font-size:26px;font-weight:700">${esc(w[0])}${w[1] ? ' <span style="font-size:15px;color:var(--text-3)">' + esc(w[1]) + '</span>' : ""}</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:4px">${esc(w[3] || "")} · ${esc(w[4] || "")}</div>
            <button class="btn btn-ghost" id="sayBtn" style="margin-top:10px">${window.LD.icon("volume")} 朗读</button>
          </div>
          <div id="opts" style="display:flex;flex-direction:column;gap:8px"></div>
          <div id="fb"></div>
        </div>`;
      st.querySelector("#sayBtn").onclick = () => window.LD.SpeechUtil && window.LD.SpeechUtil.say(w[0], 0.9);
      const oBox = st.querySelector("#opts");
      opts.forEach(o => {
        const b = document.createElement("div");
        b.className = "list-item"; b.style.cursor = "pointer";
        b.innerHTML = `<div class="main"><div class="t1">${esc(o[2])}</div></div>`;
        b.onclick = () => {
          const ok = o[0] === w[0];
          window.LD.Store.logAnswer({ type: "vocab", ability: "vocab", ok, ms: 5000, item: w[0], skill: "v:" + w[0] });
          if (!ok) window.LD.Store.addWrong({ module: "弱点突破", type: "词汇", wrong: o[2], right: w[2], source: w[5] || "", why: `正确释义：${w[2]}` });
          after(st, ctx, ok, ok ? `答对了：${w[0]} = ${w[2]}。例句：${w[5] || "—"}` : `正确答案是「${w[2]}」。例句：${w[5] || "—"}`);
        };
        oBox.appendChild(b);
      });
    }
  }

  function after(st, ctx, ok, why) {
    session.right += ok ? 1 : 0;
    const fb = st.querySelector("#fb");
    if (fb) fb.innerHTML = `
      <div class="corr-item" style="margin-top:12px"><div class="row">
        <span class="${ok ? "badge-v" : "badge-x"}">${ok ? "✓" : "✕"}</span>
        <div><div style="font-size:13.5px">${esc(why)}</div></div>
      </div></div>
      <div style="margin-top:10px"><button class="btn btn-primary" id="next">下一题</button></div>`;
    const nx = st.querySelector("#next");
    if (nx) nx.onclick = () => {
      session.i++;
      const host = document.getElementById("view");
      paintQ(host, ctx);
    };
  }

  function finishQ(st, ctx) {
    session.done = true;
    const n = session.qs.length, r = session.right;
    const pct = n ? Math.round(r / n * 100) : 0;
    window.LD.Store.addSession({ module: "weak", ms: n * 15000, count: n });
    st.innerHTML = `
      <div class="card card-pad" style="margin-top:14px;text-align:center">
        <div class="fin-ico" style="color:var(--brand)">${window.LD.icon("zap")}</div>
        <h3 style="margin:8px 0 4px">突破练习完成</h3>
        <div style="color:var(--text-3);font-size:13px">共 ${n} 题 · 掌握 ${r} 题${pct >= 80 ? " · 本轮状态很好" : pct >= 60 ? " · 还剩几个硬骨头" : " · 建议明天继续专攻"}</div>
        <div class="progress-line" style="max-width:320px;margin:14px auto 0"><i style="width:${pct}%"></i></div>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          <button class="btn btn-primary" id="again">再来一组</button>
          <button class="btn" id="toNotebook">去错题本</button>
          <button class="btn" id="toVocab">去单词练习</button>
        </div>
      </div>`;
    st.querySelector("#again").onclick = () => ctx.go("weak");
    st.querySelector("#toNotebook").onclick = () => ctx.go("notebook");
    st.querySelector("#toVocab").onclick = () => ctx.go("vocab");
  }

  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
  const abilityOf = module => ({ "听力训练": "listening", "句法纠错": "grammar", "写作批改": "writing", "阅读理解": "reading", "口语测评": "speaking", "影子跟读": "listening", "句子复述": "listening" }[module] || "vocab");

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "弱点突破", icon: "⚔", group: "学习闭环", priority: "P0", order: 8, nav: "more", ds: "错题本 + BKT 掌握度 + HLR 濒危词自动组卷，专攻薄弱点" });
  window.LD.define("weak", Mod);
})();
