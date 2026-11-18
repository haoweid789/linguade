/* 模块 6 · 学情分析：正确率趋势 / 能力雷达 / 分类表现 / 学习热力日历 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = n => Number(n || 0).toLocaleString("zh-CN");

  const Mod = {
    title: "学情分析",
    desc: "学习数据闭环：趋势、薄弱点雷达、分类正确率与学习时长分布",
    render(host, ctx) {
      window.LD.Store.visit("analytics");
      const s = S();
      const recent = s.log.slice(-300);
      // 近 14 天趋势（按天聚合正确率）
      const days = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        const key = window.LD.Store.dayKey(d);
        const rec = recent.filter(r => window.LD.Store.dayKey(new Date(r.t)) === key);
        const acc = rec.length ? Math.round(rec.filter(r => r.ok).length / rec.length * 100) : null;
        days.push({ k: (d.getMonth() + 1) + "/" + d.getDate(), v: acc, n: rec.length, full: key });
      }
      const today = window.LD.Store.todayMinutes(), target = s.profile.dailyMin || 30;
      const totalMin = Object.values(s.daily).reduce((a, b) => a + b, 0);
      const totalLog = s.log.length;
      const acc = totalLog ? Math.round(s.log.filter(l => l.ok).length / totalLog * 100) : 0;
      const weak = E().weakPoints();
      const due = E().dueCount();
      const m = E().masterySummary();
      const badges = window.LD.Store.badgeList();
      const pl = s.profile.placement || null;
      const R = window.LD.Report;
      const rpt = R ? R.collect() : null;
      const rptPrev = s.profile.lastReport || null;
      const rptDelta = (rpt && rptPrev) ? R.deltas(rpt, rptPrev) : [];
      const rptChanged = rptDelta.filter(x => x.diff !== 0).length;
      const rptEmpty = !rpt || (rpt.answers.all === 0 && !rpt.placement && rpt.minTotal === 0);
      const pctOf = r => r.answers.all ? Math.round(r.answers.ok / r.answers.all * 100) : 0;

      host.innerHTML = `
        <div class="page-head"><h1>学情分析</h1>
          <p>数据驱动的学习闭环看板 · 全部数据来自本地学习记录${s.cfg.backend ? "，并可同步至后端" : ""}</p></div>
        <div class="grid g4" style="margin-bottom:14px">
          <div class="card card-pad stat"><div class="k">累计学习</div><div class="v">${totalMin}<small>分钟</small></div><div class="s">连续 ${window.LD.Store.streak()} 天 · 最长 ${s.bestStreak || 0} 天${(s.freezes || 0) > 0 ? ` · ❄ 冻结×${s.freezes}` : ""}${s.revive && Date.now() < s.revive.until ? ` · 复活窗口剩 ${Math.max(1, Math.ceil((s.revive.until - Date.now()) / 3600000))}h` : ""}</div></div>
          <div class="card card-pad stat"><div class="k">今日进度</div><div class="v">${Math.min(today, target)}<small>/${target}分</small></div><div class="s"><div class="pbar" style="margin-top:5px"><div class="pbar-in" style="width:${Math.min(100, today / target * 100)}%"></div></div></div></div>
          <div class="card card-pad stat"><div class="k">累计作答</div><div class="v">${totalLog}<small>题</small></div><div class="s">总正确率 ${acc}%</div></div>
          <div class="card card-pad stat"><div class="k">待复习词条</div><div class="v">${due}</div><div class="s">间隔重复队列</div></div>
        </div>
        <div class="card card-pad" style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="min-width:220px">
              <div style="font-size:13.5px;font-weight:600">
                ${pl ? `起点参考 <span class="tag tag-blue">${esc(pl.level)}</span> · 词汇约 ${fmt(pl.vocabEst)} 词` : "还没测过起点"}
              </div>
              <div class="hint" style="margin:4px 0 0">${
                pl ? `测于 ${new Date(pl.at).toLocaleDateString("zh-CN")} · 参考性质，不是官方等级`
                   : "10 题入学诊断最高只能估到 B1；分级测评给参考级别与词汇量估算（约 8–10 分钟）"
              }</div>
            </div>
            <div class="btn-row" style="margin:0">
              <button class="btn btn-sm" data-pl-go="result">${pl ? "看结果" : "去测评"}</button>
              ${pl ? '<button class="btn btn-sm btn-ghost" data-pl-go="restart">重测</button>' : ""}
            </div>
          </div>
        </div>
        <div class="card card-pad" style="margin-bottom:14px">
          <h2 style="margin:0 0 10px;font-size:13.5px">阶段成效报告</h2>
          ${rptEmpty ? `
            <p class="hint" style="margin:0">还没有可报告的数据：先完成<b>分级测评</b>（给起点基线）或做几轮练习（产生作答与时长），这里会汇总成一份可导出的 Markdown 报告。</p>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn-sm" data-pl-go="result">先做分级测评</button>
            </div>
          ` : `
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span class="tag tag-blue">学习 ${fmt(rpt.daysUsed)} 天</span>
              <span class="tag">掌握词 ${fmt(rpt.vocab.mastered)}</span>
              <span class="tag">累计 ${fmt(rpt.minTotal)} 分钟</span>
              <span class="tag">${rpt.answers.all ? `累计正确率 ${pctOf(rpt) }%` : "暂无作答"}</span>
              ${rptDelta.length ? `<span class="tag tag-ok">较上次报告 ${rptChanged} 项变化</span>` : '<span class="tag">首次报告，本次为对比基线</span>'}
            </div>
            ${rptDelta.length && rptChanged ? `<div class="hint" style="margin:8px 0 0">${rptDelta.filter(x => x.diff !== 0).map(x =>
              `${x.label} ${fmt(x.old)} → ${fmt(x.cur)}（${x.diff > 0 ? "+" : ""}${x.diff}${x.unit}）`).join(" · ")}</div>`
              : (rptDelta.length ? '<div class="hint" style="margin:8px 0 0">较上次报告：各项数值无变化（本次生成未产生新学习数据）。</div>'
                : '<div class="hint" style="margin:8px 0 0">下次生成报告时，会与本次数值逐项对比。</div>')}
            <div class="hint" style="margin:6px 0 0">口径：掌握词 = FSRS 稳定性 ≥ ${window.LD.Report.WORD_MASTER_DAYS} 天；正确率基于最近 ${window.LD.Report.LOG_WINDOW} 条作答。过程数据，非考试分数；参数为默认档案，待真实数据校准。</div>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn-sm" id="reportExport">导出 Markdown</button>
            </div>
          `}
        </div>
        <div class="grid g2" style="margin-bottom:14px">
          <div class="card card-pad"><h2 style="margin:0 0 10px;font-size:13.5px">近 14 天正确率趋势</h2><div id="trend"></div></div>
          <div class="card card-pad"><h2 style="margin:0 0 10px;font-size:13.5px">六维能力画像</h2>
            <div id="radar"></div>
            <div class="hint" style="text-align:center;margin-top:-6px">最薄弱：${weak.weakest.map(w => nameOf(w.key)).join(" / ")}</div></div>
        </div>
        <div class="grid g2" style="margin-bottom:14px">
          <div class="card card-pad">
            <h2 style="margin:0 0 10px;font-size:13.5px">BKT 知识点掌握度分布</h2>
            <div id="mastery"></div>
            <div class="hint" style="text-align:center">${m.n ? `共 ${m.n} 个知识点 · 已达掌握阈值（≥95%）${m.mastered} 个` : "还没有知识点记录；先做一轮练习再回来。"}</div>
          </div>
          <div class="card card-pad">
            <h2 style="margin:0 0 10px;font-size:13.5px">近 8 周学习时长（分钟）</h2><div id="weekBars"></div>
          </div>
        </div>
        <div class="card card-pad" style="margin-bottom:14px">
          <h2 style="margin:0 0 10px;font-size:13.5px">分类正确率 · 优先复习知识点</h2>
          <div id="weakMerged"></div>
          <div class="hint" style="margin-top:8px">分类行 = 实际作答正确率；知识点行 = BKT 掌握概率与模型预测正确率。「看错题」直达错题本对应筛选，「专项训练」直达明确题型。</div>
        </div>
        <div class="card card-pad" style="margin-bottom:14px">
          <h2 style="margin:0 0 10px;font-size:13.5px">成就徽章 <span class="tag">${badges.filter(b => b.got).length} / ${badges.length}</span></h2>
          ${[["已解锁", badges.filter(b => b.got)], ["未解锁", badges.filter(b => !b.got)]].map(([grp, list]) => list.length ? `
            <div style="font-size:12px;color:var(--text-3);margin:8px 0 5px">${grp}（${list.length}）</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">
              ${list.map(b => `
                <div style="padding:10px;border-radius:10px;border:1px solid ${b.got ? "var(--brand)" : "var(--line)"};background:${b.got ? "var(--brand-soft)" : "var(--panel-2)"};opacity:${b.got ? 1 : .55}">
                  <div class="badge-ic" style="line-height:1">${b.got ? window.LD.icon(b.ic) : window.LD.icon("lock")}</div>
                  <div style="font-size:12.5px;font-weight:600;margin-top:5px">${b.nm}</div>
                  <div style="font-size:12px;color:var(--text-3);margin-top:2px;line-height:1.5">${b.desc}</div>
                </div>`).join("")}
            </div>` : "").join("")}
          <div class="hint" style="margin-top:8px">徽章记录里程碑（连胜 / 词汇量 / 模块覆盖 / 特殊时段学习），全部本地保存；连胜冻结与复活记录计入「不屈连胜」。</div>
        </div>
        <div class="card card-pad">
          <h2 style="margin:0 0 10px;font-size:13.5px">近 10 周学习热力图</h2>
          <div id="heat" style="display:flex;gap:3px;flex-wrap:wrap"></div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:var(--text-3)">
            <span>少</span>
            ${[0, 1, 2, 3, 4].map(l => `<span style="width:12px;height:12px;border-radius:3px;background:${heatColor(l)}"></span>`).join("")}
            <span>多</span>
          </div>
        </div>`;

      window.LD.Charts.line(host.querySelector("#trend"), days.map(d => ({ k: d.k, v: d.v })), { h: 190 });
      window.LD.Charts.radar(host.querySelector("#radar"), E().radarData(), { h: 230 });
      // 近 8 周时长
      const weeks = [];
      for (let i = 7; i >= 0; i--) {
        let sum = 0;
        for (let j = 0; j < 7; j++) {
          const d = new Date(); d.setDate(d.getDate() - (i * 7 + j));
          sum += s.daily[window.LD.Store.dayKey(d)] || 0;
        }
        weeks.push({ k: "W" + (8 - i), v: sum });
      }
      const weekSum = weeks.reduce((a, w) => a + w.v, 0);
      if (weekSum > 0) {
        window.LD.Charts.bars(host.querySelector("#weekBars"), weeks, { h: 170 });
      } else {
        host.querySelector("#weekBars").innerHTML = `<div class="empty"><div class="big">▥</div><strong>暂无时长记录</strong><p>先去做一轮练习，学习时长会自动统计。</p></div>`;
      }

      // BKT 掌握度分布：没有任何知识点时不要画 5 根 0 值柱（视觉上像「全部没掌握」）
      const BANDS = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];
      const masteryBox = host.querySelector("#mastery");
      const hasSkill = Object.keys(s.bkt || {}).length > 0;
      if (hasSkill) {
        window.LD.Charts.bars(masteryBox,
          m.bands.map((v, i) => ({ k: BANDS[i], v, color: ["var(--chart-4)", "var(--chart-2)", "var(--chart-5)", "var(--chart-1)", "var(--chart-3)"][i] })),
          { h: 160 });
      } else {
        masteryBox.innerHTML = `<div class="empty"><div class="big">▥</div><strong>还没有知识点记录</strong><p>先去「句法纠错」跑一轮，这里会按知识点汇总掌握度。</p><button type="button" class="btn btn-primary" id="toSyntax">去句法纠错</button></div>`;
      }
      const toSyntax = host.querySelector("#toSyntax");
      if (toSyntax) toSyntax.onclick = () => window.LD.router.go("syntax");

      /* 合并薄弱表（3.25.0）：分类正确率（实际作答，剔除能力诊断）+ 优先复习知识点（BKT）。
         每行带明确行动：看错题 → 错题本对应筛选；art/verb/aux/prep → 专项训练明确题型。 */
      const EXCLUDE_TYPE = { diagnose: true };   // 能力诊断是一次性测试，不进分类正确率
      const SKILL_CAT = { v: "vocab", g: "grammar", g2: "grammar", art: "drill", verb: "drill", aux: "drill", prep: "drill", chat: "chat", speak: "speech", pron: "phonetics", hear: "listening", read: "reading", write: "writing", mx: "mockexam" };
      const NB_MODULE = { vocab: "单词", grammar: "句法纠错", listening: "听力训练", drill: "专项训练", reading: "阅读理解", writing: "写作批改", speech: "口语测评", phonetics: "发音专项", chat: "德语对话室" };
      const DRILL_OF = { art: ["art", "冠词性别"], verb: ["verb", "动词变位"], aux: ["verb", "动词变位"], prep: ["prep", "介词支配格"] };
      const bkt = s.bkt || {}, bktN = s.bktN || {};
      const catBkt = {};
      Object.keys(bkt).forEach(k => {
        const c = SKILL_CAT[k.split(":")[0]];
        if (!c) return;
        (catBkt[c] = catBkt[c] || { sum: 0, n: 0 }).sum += bkt[k];
        catBkt[c].n++;
      });
      const cats = weak.byType.filter(t => !EXCLUDE_TYPE[t.key]).sort((a, b) => a.acc - b.acc);
      const worst = Object.keys(bkt).map(k => ({ k, v: bkt[k] })).sort((a, b) => a.v - b.v).slice(0, 6);
      const accTag = a => `<span class="tag ${a >= 80 ? "tag-ok" : a >= 60 ? "tag-warn" : "tag-danger"}">${a >= 80 ? "稳固" : a >= 60 ? "波动" : "薄弱"}</span>`;
      const nbBtn = attr => `<button type="button" class="btn btn-sm" ${attr}>看错题</button>`;
      const catRows = cats.map(t => {
        const b = catBkt[t.key], mod = NB_MODULE[t.key];
        return `<tr><td>${typeLabel(t.key)}</td><td>${t.total} 题</td><td>${t.acc}% ${accTag(t.acc)}</td>
          <td>${b ? Math.round(b.sum / b.n * 100) + "%" : "—"}</td>
          <td>${mod ? nbBtn(`data-nb="${esc(mod)}"`) : '<span class="hint" style="margin:0">—</span>'}</td></tr>`;
      }).join("");
      const skillRows = worst.map(w => {
        const pre = w.k.split(":")[0], val = w.k.slice(pre.length + 1);
        const dt = DRILL_OF[pre];
        const action = dt
          ? `<button type="button" class="btn btn-sm btn-primary" data-drill="${dt[0]}">专项训练 · ${dt[1]}</button>`
          : pre === "v" || pre === "hear" ? nbBtn(`data-nb="${pre === "v" ? "单词" : "听力训练"}"`)
          : pre === "g" || pre === "g2" ? nbBtn(`data-nbtype="${esc(val)}"`)
          : nbBtn(`data-nbq="${esc(val)}"`);
        return `<tr><td>${skillName(w.k)}</td><td>${bktN[w.k] || 0} 次</td><td>${E().bktPredict(w.k)}% <span class="tag">预测</span></td><td>${Math.round(w.v * 100)}%</td><td>${action}</td></tr>`;
      }).join("");
      const mergedHead = `<thead><tr><th>分类 / 知识点</th><th>作答</th><th>正确率</th><th>掌握概率</th><th>行动</th></tr></thead>`;
      const groupRow = t => `<tr><th colspan="5" style="text-align:left;background:var(--panel-2);color:var(--text-2);font-size:12px">${t}</th></tr>`;
      host.querySelector("#weakMerged").innerHTML = (cats.length || worst.length) ? `
        <table class="tbl">${mergedHead}<tbody>
          ${cats.length ? groupRow("分类正确率 · 实际作答") + catRows : ""}
          ${worst.length ? groupRow("最需要优先复习的知识点 · BKT 掌握概率") + skillRows : ""}
        </tbody></table>`
        : `<div class="empty"><div class="big">▥</div><strong>还没有作答与知识点记录</strong><p>先去做一轮练习，分类正确率与知识点掌握度会自动汇总到这里。</p></div>`;
      [...host.querySelectorAll("[data-nb]")].forEach(b => b.onclick = () => window.LD.router.go("notebook", { module: b.dataset.nb }));
      [...host.querySelectorAll("[data-nbtype]")].forEach(b => b.onclick = () => window.LD.router.go("notebook", { type: b.dataset.nbtype }));
      [...host.querySelectorAll("[data-nbq]")].forEach(b => b.onclick = () => window.LD.router.go("notebook", { q: b.dataset.nbq }));
      [...host.querySelectorAll("[data-drill]")].forEach(b => b.onclick = () => window.LD.router.go("drill", { type: b.dataset.drill }));
      [...host.querySelectorAll("[data-pl-go]")].forEach(b => b.onclick = () => window.LD.router.go("placement",
        b.dataset.plGo === "restart" ? { restart: true } : undefined));
      const repBtn = host.querySelector("#reportExport");
      if (repBtn) repBtn.onclick = () => {
        const r = window.LD.Report.buildAndStore();
        const blob = new Blob(["\uFEFF" + r.md], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "linguade-report-" + new Date().toISOString().slice(0, 10) + ".md";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        window.LD.UI.toast("报告已导出到下载目录（并作为下次对比基线）", "ok");
        Mod.render(host, ctx);
      };

      // 热力图
      const heat = host.querySelector("#heat");
      const cells = [];
      for (let i = 69; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = window.LD.Store.dayKey(d);
        const v = s.daily[key] || 0;
        cells.push(`<div title="${key} · ${v} 分钟" style="width:14px;height:14px;border-radius:3px;background:${heatColor(level(v))}"></div>`);
      }
      heat.innerHTML = cells.join("");
    }
  };

  const level = v => v === 0 ? 0 : v < 15 ? 1 : v < 30 ? 2 : v < 60 ? 3 : 4;
  const heatColor = l => ["var(--line-soft)", "#e4e8ee", "#c3ccd9", "#8b9bb3", "#5b6f90"][l];
  const nameOf = k => ({ vocab: "词汇", grammar: "语法", reading: "阅读", listening: "听力", speaking: "口语", writing: "写作" }[k] || k);
  /* 题型/模块 key 的中文名（分类正确率表用） */
  const typeLabel = k => ({ vocab: "单词", grammar: "句法纠错", chat: "对话室", speaking: "口语", listening: "听力", reading: "阅读", writing: "写作", speech: "口语测评", drill: "专项训练", phonetics: "发音", diagnose: "能力诊断", notebook: "错题本", sandbox: "算法沙盘", ocrgrade: "拍照批改", mockexam: "全真模考", interview: "AI 面试", weak: "弱点突破" }[k] || k);
  const skillName = k => {
    const [pre, valRaw] = k.split(":");
    const val = String(valRaw || "").replace(/^[a-z]{2,4}$/, s => s.toUpperCase());   // aps → APS
    return ({ v: "词汇 ", g: "语法点 ", art: "冠词 ", verb: "变位 ", aux: "助动词 ", prep: "介词 ", chat: "对话 ", speak: "口语 ", write: "写作 ", hear: "听力 ", g2: "语法点 " }[pre] || "") + (val || k);
  };

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "学情分析", icon: "◧", group: "沉淀与复盘", priority: "P1", order: 10, ds: "趋势、雷达、BKT 掌握度分布、成就徽章墙与学习热力" });
  window.LD.define("analytics", Mod);
})();
