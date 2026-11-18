/* 模块 7 · 自适应学习计划：按薄弱项 × 每日时长 × 到期复习量动态生成四周日程 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;
  let days = 7;
  let planTab = "schedule";
  let pathQuiz = null;

  const Mod = {
    title: "自适应计划",
    desc: "引擎依据能力画像与每日可用时长，生成并滚动更新训练日程",
    render(host, ctx) {
      window.LD.Store.visit("plan");
      /* 从首页「查看本周计划」或日期格进入时，直接落到对应日期的日程。
         直接点侧栏仍先看学习路径，避免打断原有使用习惯。 */
      let focusDate = "";
      try {
        focusDate = sessionStorage.getItem("linguade.planFocus") || "";
        sessionStorage.removeItem("linguade.planFocus");
      } catch (e) { }
      if (focusDate) { planTab = "schedule"; days = 7; }
      const plan = E().planForDays(days);
      S().plan = plan; window.LD.Store.save();
      const phase = plan.phase || E().examPhase(S().profile.examDate);
      const today = window.LD.Store.dayKey();
      const totalMin = plan.plan.reduce((a, d) => a + d.tasks.reduce((x, t) => x + t.min, 0), 0);
      const tl = window.LD.Timeline ? window.LD.Timeline.status() : null;
      const daysLeft = S().profile.examDate ? Math.max(0, Math.ceil((new Date(S().profile.examDate + "T23:59:59") - new Date()) / 86400000)) : null;

      host.innerHTML = `
        <div class="page-head"><h1>自适应学习计划</h1>
          <p>每日 ${plan.daily} 分钟 · ${days} 天合计约 ${Math.round(totalMin / 60 * 10) / 10} 小时 <button class="btn" id="focus5" style="margin-left:8px;padding:2px 10px;font-size:12px">5 分钟专注</button><span id="focusBar" style="display:none;margin-left:8px;font-size:12px;color:var(--text-3)"></span></p></div>
        <div class="card card-pad plan-summary">
          <span class="tag ${phase.key === "final" ? "tag-danger" : phase.key === "regular" ? "" : "tag-blue"}">${phase.nm}</span>
          <span>重点 <b>${plan.focus.join(" + ")}</b></span>
          <span>到期 <b>${E().dueCount()}</b> 词</span>
          <span>目标 <b>${S().profile.exam}</b></span>
          ${daysLeft != null ? `<span class="tag tag-warn">距考试 ${daysLeft} 天</span>` : `<span class="hint">未设置考试日期</span>`}
        </div>
        <div class="btn-row" style="margin-bottom:14px">
          <button class="btn ${planTab === "schedule" ? "btn-primary" : ""}" id="tabSchedule">本周安排</button>
          <button class="btn ${planTab === "path" ? "btn-primary" : ""}" id="tabPath">学习路径</button>
        </div>
        <div id="pathPane" style="display:${planTab === "path" ? "block" : "none"}"></div>
        <div id="schedulePane" style="display:${planTab === "schedule" ? "block" : "none"}">
        <div class="card card-pad plan-toolbar">
          <span class="hint" style="margin:0">计划周期</span>
          ${[7, 14, 28].map(d => `<button type="button" class="scene-chip ${days === d ? "active" : ""}" data-d="${d}">${d} 天</button>`).join("")}
          <button class="btn btn-sm" id="regen" style="margin-left:auto">重新生成</button>
        </div>
        <div class="grid g2" id="planGrid"></div>
        </div>
        <details class="plan-timeline card card-pad" style="margin-top:14px">
          <summary>
            <span><b>留德时间轴</b> <span class="hint">${tl && tl.current ? "当前：" + tl.current.nm : "长期路径参考"}</span></span>
            <span class="tag tag-blue">${tl ? `${tl.doneStages}/${tl.totalStages} 阶段` : "查看"}</span>
          </summary>
          <div class="plan-timeline-body">${timelineCard()}</div>
        </details>`;

      host.querySelector("#tabPath").onclick = () => { planTab = "path"; ctx.go("plan"); };
      host.querySelector("#tabSchedule").onclick = () => { planTab = "schedule"; ctx.go("plan"); };
      /* B6 会话制：5 分钟专注（纯前端计时，到时柔性提示，不强制中断、不改会话数据） */
      const f5 = host.querySelector("#focus5"), fBar = host.querySelector("#focusBar");
      if (f5) f5.onclick = () => {
        if (f5.dataset.running) return;
        f5.dataset.running = "1"; f5.textContent = "专注中…";
        const until = Date.now() + 300000;
        fBar.style.display = ""; fBar.textContent = "5:00";
        const tick = () => {
          const left = Math.max(0, until - Date.now());
          fBar.textContent = `${Math.floor(left / 60000)}:${String(Math.ceil((left % 60000) / 1000)).padStart(2, "0")}`;
          if (left <= 0) {
            clearInterval(timer);
            fBar.textContent = "时间到，休息一下";
            f5.dataset.running = ""; f5.textContent = "5 分钟专注";
            window.LD.UI.toast("5 分钟专注完成，休息一下再继续", "ok");
            return;
          }
          if (!document.body.contains(fBar)) { clearInterval(timer); }
        };
        const timer = setInterval(tick, 1000);
        tick();
      };
      [...host.querySelectorAll("[data-d]")].forEach(c => c.onclick = () => {
        days = +c.dataset.d;
        planTab = "schedule";
        ctx.go("plan");
      });
      host.querySelector("#regen").onclick = () => {
        E().planForDays(days, true);
        planTab = "schedule";
        ctx.go("plan");
      };
      host.querySelectorAll("[data-tl-st]").forEach(el => el.onclick = () => {
        if (window.LD.Timeline) LD.Timeline.toggle(el.dataset.tlSt, +el.dataset.tlTi);
        ctx.go("plan");
      });
      host.querySelectorAll("[data-tl-go]").forEach(b => b.onclick = e => {
        e.stopPropagation();
        ctx.go(b.dataset.tlGo);
      });

      const grid = host.querySelector("#planGrid");
      const activeRun = window.LD.FirstWeek.context();
      grid.innerHTML = plan.plan.map(d => {
        const isToday = d.date === today;
        const isFocus = focusDate && d.date === focusDate;
        const doneN = window.LD.FirstWeek.count(d);
        const items = d.tasks.map(t => {
          const done = window.LD.FirstWeek.isDone(t.id);
          const active = !!(activeRun && activeRun.taskId === t.id && activeRun.status !== "done");
          return `<div class="list-item" data-k="${t.id}" style="padding:8px 0;cursor:pointer">
            <span style="width:18px;text-align:center;color:${done ? "var(--ok)" : "var(--text-3)"}">${done ? "✓" : "○"}</span>
            <div class="main"><div class="t1" style="font-size:13px;${done ? "text-decoration:line-through;opacity:.55" : ""}">${t.text}${active ? ' <span class="tag tag-blue">进行中</span>' : ""}</div>
            <div class="t2"><span class="tag">${modName(t.mod)}</span> ${t.min} 分钟</div></div>
            <button class="btn btn-sm" data-go="${window.LD.FirstWeek.route(t.mod, t)}" data-id="${t.id}" onclick="event.stopPropagation()">${active ? "继续" : "前往"}</button>
          </div>`;
        }).join("");
        return `<div class="card card-pad" id="planDay-${d.date}" style="${isToday || isFocus ? "border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-soft)" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-weight:600;font-size:14px">${fmt(d.date)} ${isToday ? '<span class="tag tag-blue">今天</span>' : `<span class="tag">第 ${d.week} 周</span>`} <span class="tag" data-plan-count>${doneN}/${d.tasks.length}</span></div>
            <div style="font-size:12px;color:var(--text-3)">${d.tasks.reduce((a, t) => a + t.min, 0)} 分钟</div>
          </div>
          ${items}
        </div>`;
      }).join("");

      grid.querySelectorAll(".list-item").forEach(li => li.onclick = () => {
        const k = li.dataset.k;
        const on = !window.LD.FirstWeek.isDone(k);
        window.LD.FirstWeek.setDone(k, on);
        const icon = li.querySelector("span");
        if (icon) { icon.textContent = on ? "✓" : "○"; icon.style.color = on ? "var(--ok)" : "var(--text-3)"; }
        const title = li.querySelector(".t1");
        if (title) { title.style.textDecoration = on ? "line-through" : ""; title.style.opacity = on ? ".55" : ""; }
        const card = li.closest(".card");
        if (card) {
          const ids = [...card.querySelectorAll(".list-item")].map(x => x.dataset.k);
          const n = ids.filter(id => window.LD.FirstWeek.isDone(id)).length;
          const tag = card.querySelector("[data-plan-count]");
          if (tag) tag.textContent = n + "/" + ids.length;
        }
      });
      grid.querySelectorAll("[data-go]").forEach(b => b.onclick = e => {
        e.stopPropagation();
        const task = plan.plan.flatMap(d => d.tasks).find(t => t.id === b.dataset.id);
        const day = plan.plan.find(d => (d.tasks || []).some(t => t.id === b.dataset.id));
        if (!task || !day) return;
        try { sessionStorage.setItem("linguade.planScroll", String(window.scrollY)); } catch (err) { }
        try { sessionStorage.setItem("linguade.planFocus", day.date); } catch (err) { }
        const route = window.LD.FirstWeek.launch(task, day.date, "plan");
        ctx.go(["vocab", "grammar", "speech", "notebook", "reading", "listening", "drill", "syntax", "writing", "chat", "plan"].includes(route) ? route : "vocab");
      });
      let savedPlanScroll = 0;
      try {
        savedPlanScroll = +sessionStorage.getItem("linguade.planScroll") || 0;
        sessionStorage.removeItem("linguade.planScroll");
      } catch (e) { }
      if (focusDate) {
        const target = host.querySelector("#planDay-" + CSS.escape(focusDate));
        if (target) setTimeout(() => target.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
        if (savedPlanScroll) setTimeout(() => window.scrollTo({ top: savedPlanScroll, behavior: "auto" }), 120);
      }
      if (planTab === "path") renderPath(host, ctx);
    }
  };

  /* ============ 学习路径：9 单元 + 检查点 ============ */
  function renderPath(host, ctx) {
    const pane = host.querySelector("#pathPane");
    if (!pane) return;
    if (!window.LD.Path || !window.LD_PATH) {
      pane.innerHTML = `<div class="card card-pad empty">学习路径数据未加载</div>`;
      return;
    }
    const st = window.LD.Path.status();
    pane.innerHTML = `
      <div class="card card-pad" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0;font-size:15px">学习路径 · A1 → B1</h3>
            <div class="hint" style="margin:2px 0 0">内容来自现有词库 / 语法 / 阅读 / 听力 / 口语 / 面试 / 模考；CEFR 仅为分级参考，不是官方认证。</div>
          </div>
          <span class="tag tag-blue">${st.passed} / ${st.total} 单元 · ${st.pct}%</span>
        </div>
        <div class="progress-line" style="margin-top:10px;max-width:none"><i style="width:${st.pct}%"></i></div>
      </div>
      <div class="grid g3">
        ${st.units.map((u, i) => {
          const p = window.LD.Path.unitProgress(u, i);
          const cls = p.passed ? "done" : (p.unlocked ? "current" : "locked");
          const status = p.passed ? "已通过" : (p.unlocked ? (i === st.currentIdx ? "当前单元" : "可开始") : "未解锁");
          return `<div class="card card-pad path-unit ${cls}">
            <div class="path-unit-hd"><span class="path-no">${i + 1}</span><b>${u.nm}</b><span class="tag ${p.passed ? "tag-ok" : p.unlocked ? "tag-blue" : ""}">${status}</span></div>
            <div class="hint" style="margin:4px 0 6px">${u.desc}</div>
            <details class="path-lesson">
              <summary>讲解 · 词表 · 验收</summary>
              ${u.canDo ? `<div class="path-cando">学完能做到：${u.canDo}</div>` : ""}
              ${(u.grammar && u.grammar.length) ? `<ul class="path-grammar">${u.grammar.map(g => `<li>${g}</li>`).join("")}</ul>` : ""}
              <div class="path-words">${window.LD.Path.unitWords(u).map(r => `<span class="path-word" title="${r[2]}"><b>${r[1] && r[1] !== "-" ? r[1] + " " : ""}${r[0]}</b><small>${r[2]}</small></span>`).join("")}</div>
              <div class="hint" style="margin:6px 0 0">词表从现有词库抽取；单词练习会按你的队列与等级逐步覆盖这些词。</div>
            </details>
            <div class="path-tasks">
              ${p.tasks.map(t => `<div class="path-task">
                <span class="path-check">${t.done ? "✓" : "○"}</span>
                <span style="flex:1">${t.label}</span>
                <span style="color:var(--text-3);font-size:12px">${t.n}/${t.target}</span>
                ${p.unlocked ? `<button class="btn btn-sm" data-path-go="${t.route}">去</button>` : ""}
              </div>`).join("")}
            </div>
            <div class="progress-line" style="margin-top:8px;max-width:none"><i style="width:${p.pct}%"></i></div>
            <div class="btn-row" style="margin-top:8px">
              ${p.unlocked ? `<button class="btn btn-sm ${p.passed ? "" : "btn-primary"}" data-path-check="${u.id}">${p.passed ? "重测检查点" : "开始检查点"}</button>` : `<span class="hint" style="margin:0">先通过上一单元检查点</span>`}
            </div>
          </div>`;
        }).join("")}
      </div>
      ${pathQuizHTML()}`;

    pane.querySelectorAll("[data-path-go]").forEach(b => b.onclick = () => ctx.go(b.dataset.pathGo));
    pane.querySelectorAll("[data-path-check]").forEach(b => b.onclick = () => {
      const unit = window.LD.Path.units().find(x => x.id === b.dataset.pathCheck);
      if (!unit) return;
      pathQuiz = {
        unitId: unit.id, qs: window.LD.Path.checkpointQuestions(unit),
        answers: [], submitted: false, score: null, passed: false
      };
      renderPath(host, ctx);
      const q = host.querySelector("#pathQuiz");
      if (q) q.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    pane.querySelectorAll("[data-path-ans]").forEach(el => el.onclick = () => {
      if (!pathQuiz || pathQuiz.submitted) return;
      const qi = +el.dataset.pathAns, ai = +el.dataset.a;
      pathQuiz.answers[qi] = ai;
      el.parentElement.querySelectorAll("[data-path-ans]").forEach(x =>
        x.classList.toggle("active", +x.dataset.a === ai));
    });
    const submit = pane.querySelector("#pathSubmit");
    if (submit) submit.onclick = () => {
      if (!pathQuiz) return;
      const unit = window.LD.Path.units().find(x => x.id === pathQuiz.unitId);
      if (!unit) return;
      const missing = pathQuiz.qs.filter((_, i) => pathQuiz.answers[i] == null).length;
      if (missing) { window.LD.UI.toast(`还有 ${missing} 题未答`, "err"); return; }
      const sc = window.LD.Path.score(unit, pathQuiz.qs, pathQuiz.answers);
      const passed = window.LD.Path.saveResult(unit.id, sc);
      pathQuiz.submitted = true; pathQuiz.score = sc; pathQuiz.passed = passed;
      renderPath(host, ctx);
      window.LD.UI.toast(passed ? `检查点 ${sc} 分，已解锁下一单元` : `检查点 ${sc} 分，未达到 ${unit.checkpoint.pass || 70} 分`, passed ? "ok" : "err");
      const q = host.querySelector("#pathQuiz");
      if (q) q.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const cancel = pane.querySelector("#pathCancel");
    if (cancel) cancel.onclick = () => { pathQuiz = null; renderPath(host, ctx); };
    const retry = pane.querySelector("#pathRetry");
    if (retry) retry.onclick = () => {
      const unit = window.LD.Path.units().find(x => x.id === pathQuiz.unitId);
      if (!unit) return;
      pathQuiz = {
        unitId: unit.id, qs: window.LD.Path.checkpointQuestions(unit),
        answers: [], submitted: false, score: null, passed: false
      };
      renderPath(host, ctx);
    };
    const close = pane.querySelector("#pathClose");
    if (close) close.onclick = () => { pathQuiz = null; renderPath(host, ctx); };
  }

  function pathQuizHTML() {
    if (!pathQuiz) return "";
    const unit = window.LD.Path.units().find(x => x.id === pathQuiz.unitId);
    if (!unit) return "";
    const pass = unit.checkpoint.pass || 70;
    if (pathQuiz.submitted) {
      return `<div class="card card-pad" id="pathQuiz" style="margin-top:14px;border-color:${pathQuiz.passed ? "var(--ok)" : "var(--warn)"}">
        <h3 style="margin:0 0 4px;font-size:15px">检查点结果 · ${unit.nm}</h3>
        <div style="font-size:26px;font-weight:700;color:${pathQuiz.passed ? "var(--ok)" : "var(--warn)"}">${pathQuiz.score} 分</div>
        <div class="hint">${pathQuiz.passed ? `已达到 ${pass} 分，下一单元已解锁。` : `未达到 ${pass} 分；建议先完成本单元任务，再重测。`}</div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-primary" id="pathRetry">重测检查点</button>
          <button class="btn" id="pathClose">关闭</button>
        </div>
      </div>`;
    }
    return `<div class="card card-pad" id="pathQuiz" style="margin-top:14px">
      <h3 style="margin:0 0 4px;font-size:15px">检查点 · ${unit.nm}</h3>
      <div class="hint">${pathQuiz.qs.length} 题 · 达到 ${pass} 分解锁下一单元 · 题目从现有 ${unit.checkpoint.level} 词库抽取，不是 CEFR 官方考试。</div>
      ${pathQuiz.qs.map((q, i) => `<div style="padding:10px 0;border-bottom:1px solid var(--line-soft)">
        <div class="de" style="font-size:14px;font-weight:600">${i + 1}. ${q.art && q.art !== "-" ? q.art + " " : ""}${q.de}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">
          ${q.opts.map((o, j) => `<div class="scene-chip ${pathQuiz.answers[i] === j ? "active" : ""}" data-path-ans="${i}" data-a="${j}">${String.fromCharCode(65 + j)}. ${o}</div>`).join("")}
        </div>
      </div>`).join("")}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-primary" id="pathSubmit">提交检查点</button>
        <button class="btn" id="pathCancel">取消</button>
      </div>
    </div>`;
  }

  /* 留德时间轴：一般规划参考，不与下方自适应日程混为一谈 */
  function timelineCard() {
    if (!window.LD.Timeline) return "";
    const tl = window.LD.Timeline.status();
    if (!tl.stages.length) return "";
    const cur = tl.next ? `下一步：${tl.next.task.text}` : "全部阶段任务已完成";
    return `<div class="card card-pad" style="margin-bottom:14px;border-color:var(--brand)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <h3 style="margin:0;font-size:15px">留德时间轴</h3>
          <div class="hint" style="margin:2px 0 0">${tl.current ? `当前阶段：${tl.current.nm}（${tl.current.months}）` : ""} · ${cur}</div>
        </div>
        <span class="tag tag-blue">${tl.doneStages} / ${tl.totalStages} 阶段 · ${tl.pct}%</span>
      </div>
      <div class="tl-wrap">
        ${tl.stages.map((st, i) => {
          const p = window.LD.Timeline.progress(st);
          const cls = p.done === p.total ? "done" : (i === tl.currentIdx ? "current" : "");
          return `<div class="tl-stage ${cls}">
            <div class="tl-head"><span class="tl-no">${i + 1}</span><b>${st.nm}</b></div>
            <div class="tl-months">${st.months}</div>
            <div class="tl-desc">${st.desc}</div>
            <div class="tl-tasks">
              ${st.tasks.map((t, j) => `<div class="tl-task" data-tl-st="${st.id}" data-tl-ti="${j}">
                <span class="tl-check">${window.LD.Timeline.isDone(st, j) ? "✓" : "○"}</span>
                <span>${t.text}</span>
              </div>`).join("")}
            </div>
            <div class="progress-line" style="margin-top:8px;max-width:none"><i style="width:${p.pct}%"></i></div>
            <div class="tl-links">${(st.modules || []).map(([r, label]) => `<button class="btn btn-sm" data-tl-go="${r}">${label}</button>`).join("")}</div>
          </div>`;
        }).join("")}
      </div>
      <div class="hint">一般时间线，具体以 APS / 大学 / 使领馆官方要求为准；勾选任务或完成对应模块后会自动点亮。</div>
    </div>`;
  }

  const fmt = date => { const d = new Date(date); return `${d.getMonth() + 1}月${d.getDate()}日（${"日一二三四五六"[d.getDay()]}）`; };
  const modName = m => ({ vocab: "词汇", grammar: "语法", reading: "阅读", listening: "听力", speaking: "口语", writing: "写作", review: "复盘" }[m] || m);

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "自适应计划", icon: "compass", group: "沉淀与复盘", priority: "P1", order: 11, ds: "按薄弱项与考试日期倒排生成训练日程" });
  window.LD.define("plan", Mod);
})();
