/* 模块 1 · 单词练习：图文卡片 + 发音 + SM-2 间隔重复 + 自适应队列 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;
  let queue = [], idx = 0, flipped = false, t0 = 0, done = [], taskCtx = null, roundSaved = false;

  const Mod = {
    title: "单词练习",
    desc: "到期复习 + 自适应新词，HLR 半衰期模型 + SM-2 双调度，卡片显示记忆强度",
    render(host, ctx) {
      window.LD.Store.visit("vocab");
      taskCtx = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("vocab") : null;
      const due = E().dueCount();
      const orphans = E().orphanDue();
      const hlrDue = E().hlrDueList();
      queue = E().buildQueue(taskCtx && taskCtx.limit ? taskCtx.limit : undefined, {
        reviewOnly: !!(taskCtx && taskCtx.reviewOnly)
      });
      const saved = taskCtx && taskCtx.data && taskCtx.data.vocab;
      if (saved && Array.isArray(saved.queue) && saved.queue.length && !saved.finished) {
        queue = saved.queue;
        idx = Math.max(0, Math.min(+saved.idx || 0, queue.length));
        done = Array.isArray(saved.done) ? saved.done : [];
        roundSaved = !!saved.finished;
      } else {
        idx = 0; done = []; roundSaved = false;
      }
      const back = E().backlogStats();
      const lexiconCount = (window.LD_LEX || []).length;
      const machineCount = window.LD_LEX_MACHINE && typeof window.LD_LEX_MACHINE.size === "number" ? window.LD_LEX_MACHINE.size : 0;
      const aiReviewedCount = window.LD_LEX_AI_REVIEWED && typeof window.LD_LEX_AI_REVIEWED.size === "number" ? window.LD_LEX_AI_REVIEWED.size : 0;
      const pendingReview = Math.max(0, machineCount - aiReviewedCount);
      const humanAuthored = Math.max(0, lexiconCount - machineCount);
      // 考试倒排：设置了考试日期时，把被压缩的到期词条提前到队首
      const examDate = S().profile.examDate;
      let examAdvance = 0;
      if (examDate) {
        const eq = E().examQueue(40, examDate);
        const extra = eq.map(x => x.w).filter(w => !queue.some(q => q.de === w));
        const extraItems = extra.map(w => E().entryOf(w, true)).filter(Boolean);
        examAdvance = extraItems.length;
        const cap = taskCtx && taskCtx.limit ? Math.min(back.budget, taskCtx.limit) : back.budget;
        queue = extraItems.slice(0, Math.round(cap * 0.5)).concat(queue).slice(0, cap);
      }
      if (!queue.length) {
        host.innerHTML = `<div class="card card-pad empty"><div class="big">▤</div>
          <strong>今日没有到期词条</strong><p>词库共 ${(window.LD_LEX || []).length} 词已进入复习周期。</p>
          ${orphans.length ? `<div class="hint" style="margin-top:10px">另有 <b>${orphans.length}</b> 个本机记录到期的词不在当前词库中（可能来自旧版词库或其他设备恢复的档案），它们不计入到期数，也不会出现在队列里。</div>
          <div class="btn-row" style="justify-content:center;margin-top:8px"><button class="btn btn-ghost" id="dropOrphans">清理这些过期记录（${orphans.length}）</button></div>` : ""}
          <div class="hint">今天的复习已经清空。可以预习新词、练一组听力，或查看错题巩固。</div>
          <div class="btn-row" style="justify-content:center;margin-top:14px">
            <button class="btn btn-primary" data-go="listening">练听力</button><button class="btn" data-go="notebook">复习错题</button><button class="btn btn-ghost" data-go="reading">做阅读</button></div></div>`;
        host.querySelectorAll("[data-go]").forEach(b => b.onclick = () => ctx.go(b.dataset.go));
        const drop = host.querySelector("#dropOrphans");
        if (drop) drop.onclick = () => {
          const n = window.LD.Store.dropOrphanCards();
          toast(`已清理 ${n} 条不在当前词库中的复习记录`, "ok");
          Mod.render(host, ctx);
        };
        return;
      }
      host.innerHTML = `
        <div class="page-head"><h1>单词练习</h1>
          ${taskCtx
            ? `<p>今日计划任务 · 本轮 ${queue.length} 张 · 预计 ${taskCtx.min} 分钟 · <button type="button" class="inline-link" id="exitTask">退出计划练习</button></p>
               <div class="hint">${taskCtx.text}。做完本轮会自动记入今日任务；中途离开会保留进度。</div>`
            : `<p>自由练习 · 今天 ${queue.length} 张，约 ${Math.max(1, Math.round(queue.length * 1.2))} 分钟 · 到期复习 ${due} 个 · 词库 ${lexiconCount} 词${orphans.length ? ` · <span class="tag tag-warn" title="本机有复习记录，但当前词库里没有这些词">另有 ${orphans.length} 条记录待清理</span>` : ""}${examDate && examAdvance > 0 ? ` · <span class="tag tag-blue">考试倒排已启用：${examAdvance} 词被提前</span>` : ""}</p>`}
          ${!taskCtx && back.deferred > 0 ? `<div class="hint vocab-backlog" style="margin-top:6px">按你设定的每日 ${S().profile.dailyMin || 30} 分钟，今天只排得下 ${back.budget} 张：${back.reviewSlots} 张复习 + ${back.newSlots} 个新词。<b>另有 ${back.deferred} 个到期词今天排不下</b>，它们仍会计入到期数并出现在后续队列里。<button type="button" class="inline-link" id="deferBacklog">把最不着急的 ${back.deferred} 个顺延两周</button></div>` : ""}</div>
        <details class="card card-pad vocab-why" style="margin-bottom:14px">
          <summary style="cursor:pointer;font-weight:600;font-size:14px">今天为什么练这 ${queue.length} 个词？</summary>
          <div class="hint" style="margin-top:10px">内容来源：内置人工编写 <b>${humanAuthored}</b> 条 · 自动结构校验（非人工审校）<b>${aiReviewedCount}</b> 条 · AI 辅助生成未人工审校 <b>${pendingReview}</b> 条。三个数字分开统计，自动校验不会减少待人工审校的数量。</div>
          <div class="grid g3" style="margin-top:12px">
            <div class="card card-pad stat"><div class="k">HLR 濒危</div><div class="v">${hlrDue.length}</div><div class="s">回忆概率低于 ${Math.round((S().cfg.retention || 0.9) * 100)}%</div></div>
            <div class="card card-pad stat"><div class="k">SM-2 到期</div><div class="v">${E().dueList().length}</div><div class="s">已到复习日期</div></div>
            <div class="card card-pad stat"><div class="k">自适应新词</div><div class="v">${queue.filter(q => !q.isDue).length}</div><div class="s">按等级与薄弱项加权</div></div>
          </div>
          ${hlrDue.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${hlrDue.slice(0, 4).map(x => `<span class="tag tag-warn">${x.w} · 回忆 ${x.p}%</span>`).join("")}</div>` : ""}
          <div class="hint">队列顺序：HLR 濒危词（回忆概率低于 ${Math.round((S().cfg.retention || 0.9) * 100)}%，最危急优先）→ SM-2 到期词 → 按当前等级与薄弱项加权抽取的新词${examDate && examAdvance > 0 ? `；考试倒排把 ${examAdvance} 个晚于考期的词提前` : ""}。答对会延长半衰期，答错则减半——所以明天的队列会随你今天的表现变化。「AI 辅助释义 · 未人工审校」表示该条释义没有人工语义复核；「自动结构校验 · 未人工审校」表示只通过规则检查；「人工编写 / 校订」才是人工内容。</div>
          <div class="hint" style="margin-top:6px">词库分布：${levelDistribution()}。等级为学习顺序参考（机器词条按词频估计，非官方 CEFR 认定）。</div>
        </details>
        <div class="grid" style="grid-template-columns:1fr 260px">
          <div class="card">
            <div class="vocab-stage" id="stage"></div>
            <div class="progress-line"><i id="pg" style="width:${idx / queue.length * 100}%"></i></div>
            <div style="padding:12px 18px 16px;display:flex;justify-content:space-between;color:var(--text-3);font-size:12.5px">
              <span id="leftHint">已学 ${idx} / ${queue.length}</span><span id="efHint"></span>
            </div>
          </div>
          <div class="card card-pad" style="align-self:flex-start">
            <h2 style="margin:0 0 8px;font-size:13.5px">本次回顾</h2>
            <div id="recap" class="hint">完成第一张卡片后显示。</div>
            <div class="divider"><span>今日数据</span></div>
            <div id="todayBox"></div>
          </div>
        </div>`;
      paintStage(host, ctx);
      if (done.length) paintRecap(host);
      paintToday(host);
      const defer = host.querySelector("#deferBacklog");
      if (defer) defer.onclick = () => {
        const n = E().deferDue(back.deferred, 14);
        toast(`已把 ${n} 个最不着急的到期词顺延两周；到期数会立即下降`, "ok");
        Mod.render(host, ctx);
      };
      const exitTask = host.querySelector("#exitTask");
      if (exitTask) exitTask.onclick = () => {
        if (window.LD.FirstWeek) window.LD.FirstWeek.clearContext();
        taskCtx = null;
        toast("已退出计划练习；本轮进度不会自动标记完成", "");
        Mod.render(host, ctx);
      };
    }
  };

  function paintToday(host) {
    const s = S();
    const todayLogs = s.log.filter(l => Date.now() - l.t < 86400000 && l.type === "vocab");
    const acc = todayLogs.length ? Math.round(todayLogs.filter(l => l.ok).length / todayLogs.length * 100) : 0;
    const due = E().dueCount();
    host.querySelector("#todayBox").innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">今日作答</span><b>${todayLogs.length}</b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">正确率</span><b>${acc}%</b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">今日分钟</span><b>${window.LD.Store.todayMinutes()}</b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">待复习</span><b style="color:${due ? "var(--warn)" : "var(--ok)"}">${due}</b></div>
      </div>`;
  }

  /* 德语复合词比中文更容易顶破卡片：先按可用宽度缩字号，缩到 22px 仍放不下才交给连字符断行 */
  function fitWord(stage) {
    const el = stage.querySelector(".vocab-word");
    if (!el) return;
    const fit = () => {
      if (!el.isConnected) return;
      el.style.fontSize = "";
      el.style.hyphens = "auto";
      el.style.overflowWrap = "normal";
      el.style.whiteSpace = "nowrap";
      const max = el.clientWidth;
      let fs = parseFloat(getComputedStyle(el).fontSize);
      /* 先缩到 22px 尝试单行；仍放不下就交给德语连字符断行，避免从单词中间硬切 */
      while (el.scrollWidth > max + 1 && fs > 22) {
        fs -= 1;
        el.style.fontSize = fs + "px";
      }
      const oneLine = el.scrollWidth <= max + 1;
      el.style.whiteSpace = "";
      if (!oneLine && el.scrollWidth > max + 1) el.style.overflowWrap = "anywhere";
    };
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(() => {});
  }

  function paintStage(host, ctx) {
    const stage = host.querySelector("#stage");
    if (idx >= queue.length) return finishRound(host, ctx);
    const c = queue[idx];
    flipped = false; t0 = Date.now();
    const artHtml = c.art && c.art !== "-" ? `<span class="vocab-art${genClsOf(c.art)}">${c.art}</span>` : "";
    // 记忆强度（HLR 回忆概率，Duolingo strength meter 思路）
    const hlrP = E().hlrRecall(c.de);
    const band = E().hlrBand(hlrP);
    const reason = c.isDue
      ? (hlrP > 0 && hlrP < Math.round((S().cfg.retention || 0.9) * 100) ? `入队原因：HLR 回忆概率 ${hlrP}%（低于 ${Math.round((S().cfg.retention || 0.9) * 100)}%）` : "入队原因：SM-2 到期复习")
      : "入队原因：当前等级适配 + 薄弱项加权的新词";
    const strengthHtml = hlrP > 0 ? `
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--text-3)">
        记忆强度
        <div class="dim-bar" style="width:130px;height:6px"><i style="width:${hlrP}%;background:${band.color}"></i></div>
        <b style="color:${band.color}">${hlrP}% · ${band.nm}</b>
      </div>` : "";
    const formLabel = c.formOf
      ? `<div class="hint" style="margin:4px 0 0">词形：${c.formOf} 的${c.formKind === "participle" ? "过去分词" : "复数"}${c.formKind === "plural" ? " · 原形将单独学习" : c.formKind === "plural-keep" ? " · 原形暂未单独收录" : ""}</div>`
      : "";
    stage.innerHTML = `
      <div class="vocab-meta" style="color:var(--text-3);font-size:12.5px">${c.lv} · ${posName(c.pos)} ${c.isDue ? `· <span class='tag tag-ok' title="${reason}">复习</span>` : `· <span class='tag' title="${reason}">新词</span>`} ${c.qa === "machine" ? '<span class="tag tag-warn" title="AI 辅助生成，释义与等级未经过人工语义审校">AI 辅助释义 · 未人工审校</span> <button type="button" class="inline-link" data-report-open>欢迎纠错</button>' : c.qa === "ai" ? '<span class="tag" title="通过结构脚本自动校验，并非人工语义审校；仍欢迎纠错">自动结构校验 · 未人工审校</span> <button type="button" class="inline-link" data-report-open>报错</button>' : '<button type="button" class="inline-link" data-report-open title="人工编写 / 校订词条">报错</button>'}${c.reg === "colloquial" ? ' <span class="tag tag-warn" title="口语 / 俚语用法，考试与正式写作不建议使用">口语 · 非正式</span>' : ""}${c.reg === "vulgar" ? ' <span class="tag tag-danger" title="粗俗用语，不会进入新词队列；查词时请谨慎使用">粗俗 · 不建议考试用</span>' : ""}</div>
      ${reportEcho(c.de)}
      <div class="vocab-word" lang="de" style="margin-top:10px">${artHtml}${c.de}</div>
      <div class="vocab-phon">${phonetic(c.de)}${phonetic(c.de) ? '<span class="phon-note">规则推导音标 · 非词典标音</span>' : ""}</div>
      ${formLabel}
      ${strengthHtml}
      <div id="reveal" style="display:none;width:100%;max-width:620px">
        <div class="vocab-zh">${c.zh}</div>
        ${c.ex ? `<div class="vocab-ex"><div class="de">${c.ex}</div><div class="zh">${c.exzh || ""}</div></div>` : `<div class="hint" style="margin-top:10px">暂无可靠例句${c.qa === "machine" ? "；AI 例句未通过校验时宁可不显示" : ""}。</div>`}
      </div>
      <div class="vocab-actions">
        <button class="btn" id="flipBtn">显示释义 (空格)</button>
        <button class="btn" id="sayBtn">${window.LD.icon("volume")} 发音</button>
      </div>
      <div id="rate" style="display:none" class="rate-bar">
        <button type="button" class="rate-btn" data-v="0" aria-keyshortcuts="1">完全不会 <kbd>1</kbd></button>
        <button type="button" class="rate-btn" data-v="1" aria-keyshortcuts="2">很吃力 <kbd>2</kbd></button>
        <button type="button" class="rate-btn" data-v="2" aria-keyshortcuts="3">想起来了 <kbd>3</kbd></button>
        <button type="button" class="rate-btn" data-v="3" aria-keyshortcuts="4">很轻松 <kbd>4</kbd></button>
      </div>
      <div class="vocab-report" id="reportBox" hidden>
        <div class="btn-row" role="group" aria-label="选择要反馈的字段">
          ${["释义", "例句", "等级", "音标", "词形"].map(f => `<button type="button" class="btn btn-sm" data-report="${f}">${f}</button>`).join("")}
        </div>
        <div class="hint" style="margin:6px 0 0">反馈只保存在本机，导出学习数据时会一并带走，方便后续人工校对。</div>
      </div>`;
    fitWord(stage);
    const flip = () => {
      flipped = true;
      host.querySelector("#reveal").style.display = "block";
      host.querySelector("#rate").style.display = "flex";
    };
    host.querySelector("#flipBtn").onclick = flip;
    host.querySelector("#sayBtn").onclick = () => speak(c.de);
    host._flip = flip; host._rate = null;
    stage.querySelectorAll("[data-report-open]").forEach(b => {
      b.setAttribute("aria-controls", "reportBox");
      b.setAttribute("aria-expanded", "false");
      b.onclick = e => {
        e.stopPropagation();
        const box = stage.querySelector("#reportBox");
        if (!box) return;
        box.hidden = !box.hidden;
        b.setAttribute("aria-expanded", box.hidden ? "false" : "true");
        if (!box.hidden) {
          box.scrollIntoView({ block: "nearest" });
          const first = box.querySelector("[data-report]");
          if (first) first.focus();
        }
      };
    });
    stage.querySelectorAll("[data-report]").forEach(b => {
      b.onclick = () => {
        const n = window.LD.Store.reportContent(c.de, [b.dataset.report]);
        b.disabled = true;
        b.textContent = b.dataset.report + " ✓";
        toast(`已记录「${b.dataset.report}」问题（本机共 ${n} 条反馈）；导出学习数据时会一并带走`, "ok");
      };
    });
    [...stage.querySelectorAll(".rate-btn")].forEach(b => {
      b.onclick = () => {
        const v = +b.dataset.v, ms = Date.now() - t0;
        E().rate(c.de, v);
        const ok = v >= 2;
        window.LD.Store.logAnswer({ type: "vocab", ability: "vocab", ok, ms, item: c.de, level: c.lv, skill: "v:" + c.de });
        /* 只有「学过又忘了」才算错题：新词自评不会只影响调度，不进错题本 */
        if (v === 0 && c.isDue) window.LD.Store.addWrong({ module: "单词", type: "vocab", wrong: c.de, right: `${c.art === "-" ? "" : c.art + " "}${c.de} — ${c.zh}`, source: c.ex || "", why: c.zh });
        done.push({ ...c, v, ms });
        idx++;
        if (taskCtx && window.LD.FirstWeek) {
          window.LD.FirstWeek.update(taskCtx, {
            progress: idx,
            data: Object.assign({}, taskCtx.data || {}, { vocab: { queue, idx, done, finished: idx >= queue.length } })
          });
        }
        host.querySelector("#pg").style.width = (idx / queue.length * 100) + "%";
        host.querySelector("#leftHint").textContent = `已学 ${idx} / ${queue.length}`;
        const n = E().nextDifficulty(done.map(d => ({ ok: d.v >= 2, ms: d.ms })));
        host.querySelector("#efHint").textContent = `自适应难度：L${n.level} · ${n.reason}`;
        paintRecap(host); paintToday(host);
        paintStage(host, ctx);
      };
    });
  }

  function paintRecap(host) {
    host.querySelector("#recap").innerHTML = done.slice(-6).reverse().map(d => `
      <div class="list-item" style="padding:7px 0">
        <span class="${d.v >= 2 ? "badge-v" : "badge-x"}" style="width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:12px;background:${d.v >= 2 ? "var(--ok-soft)" : "var(--danger-soft)"};color:${d.v >= 2 ? "var(--ok)" : "var(--danger)"}">${d.v >= 2 ? "✓" : "✕"}</span>
        <div class="main"><div class="t1">${d.art !== "-" ? `<span class="${genClsOf(d.art)}">${d.art}</span> ` : ""}${d.de}</div><div class="t2">${d.zh}</div></div>
        <button class="btn btn-sm" onclick="window.LD.SpeechUtil.say('${d.de.replace(/'/g, "")}')">${window.LD.icon("volume")}</button>
      </div>`).join("");
  }

  function finishRound(host, ctx) {
    const st = host.querySelector("#stage");
    const okN = done.filter(d => d.v >= 2).length;
    const ms = Math.round(done.reduce((a, d) => a + d.ms, 0) / 1000);
    if (!roundSaved) {
      window.LD.Store.addSession({ module: "vocab", ms: ms * 1000, count: done.length });
      roundSaved = true;
    }
    const run = taskCtx || (window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("vocab") : null);
    if (run && window.LD.FirstWeek) {
      window.LD.FirstWeek.update(run, { data: Object.assign({}, run.data || {}, { vocab: { queue, idx, done, finished: true } }) });
      window.LD.FirstWeek.evidence(run, "词汇自评");
    }
    const planned = !!(run && run.taskId);
    st.innerHTML = `
      <div style="text-align:center;padding:20px 0">
        <div class="fin-ico">${window.LD.icon("check")}</div>
        <h2 style="margin:10px 0 4px">本轮完成</h2>
        <div style="color:var(--text-3)">${done.length} 词 · 自评想起 ${okN} · 用时 ${Math.floor(ms / 60)} 分 ${ms % 60} 秒</div>
        <div style="color:var(--text-3);font-size:12.5px;margin-top:4px">今日已学 ${window.LD.Store.todayMinutes()} 分钟（会话制）</div>

        ${planned
          ? window.LD.FirstWeek.receipt(run, {
            summary: `词汇本轮完成 ${done.length} 词`,
            detail: `自评想起 ${okN} 词 · 用时 ${Math.floor(ms / 60)} 分 ${ms % 60} 秒`,
            evidence: "词汇自评",
            source: "vocab-round",
            label: "完成词汇任务",
            embedded: true
          })
          : `<div class="btn-row" style="justify-content:center;margin-top:18px">
              <button class="btn btn-primary" id="again">再来一轮</button>
              <button class="btn" id="toNote">查看错题本</button><button class="btn" id="toBoard">学情分析</button>
            </div>`}
      </div>`;
    const again = st.querySelector("#again");
    if (again) again.onclick = () => ctx.go("vocab");
    const toNote = st.querySelector("#toNote");
    if (toNote) toNote.onclick = () => ctx.go("notebook");
    const toBoard = st.querySelector("#toBoard");
    if (toBoard) toBoard.onclick = () => ctx.go("analytics");
  }

  /* 词性三色（der/die/das 小面积冠词标记；复数 die 会落到 f 色，属可接受的启发式） */
  function genClsOf(art) {
    return { der: " gen-m", die: " gen-f", das: " gen-n" }[String(art || "").toLowerCase()] || "";
  }
  const posMap = { n: "名词", v: "动词", adj: "形容词", adv: "副词", conj: "连词", prep: "介词", phrase: "短语" };
  const posName = p => posMap[p] || p || "";

  function levelDistribution() {
    const levels = (window.LD.Engine && LD.Engine.LEVELS) || ["A1", "A2", "B1", "B2", "C1", "C2"];
    const n = {};
    (window.LD_LEX || []).forEach(w => { n[w[4]] = (n[w[4]] || 0) + 1; });
    return levels.filter(l => n[l]).map(l => `${l} ${n[l]}`).join(" · ");
  }

  /* 音标：统一走 src/phonetics.js 的规则式 G2P，避免词卡与发音专项两套结果 */
  /* 外来词（Computer / Handy / Café / Restaurant…）不守德语拼读规则，规则推导会给出错音标。
     没把握时宁可不显示：含不接 h/k 的 c、含 y、é/è、或英法式词尾的词一律跳过 */
  const LOANWORD = /c(?![hk])|y|[éèêàç]|(?:aurant|ique|eur|ance|ence)$|^(?:jazz|job|jeans|team|fair|cool|okay|baby|garage|training|meeting|marketing|shopping)$/i;
  function phonetic(w) {
    if (!w) return "";
    if (LOANWORD.test(String(w).trim())) return "";
    try {
      if (window.LD.Phonetics && window.LD.Phonetics.wordPhones) {
        const p = window.LD.Phonetics.wordPhones(w).join("");
        return p ? "/" + p + "/" : "";
      }
    } catch (e) { /* G2P 失败时宁可留空，也不回退到字母映射 */ }
    return "";
  }

  /* 无德语语音包时只提示一次（会话级），避免点击无声被当成按钮故障 */
  let voiceHintTold = false;
  function sayVoiceHint() {
    if (voiceHintTold) return;
    /* 只在用户刚点过发音时提示；自动播放、页面初始化触发的发声不打扰 */
    const ua = navigator.userActivation;
    if (ua && !ua.isActive) return;
    voiceHintTold = true;
    try {
      window.LD.UI.toast("没有找到德语语音，无法发音。Windows：设置 → 时间和语言 → 语音 → 添加语音 → Deutsch，装好后刷新页面", "info");
    } catch (e) { /* toast 不可用时静默 */ }
  }

  /* 语音合成：rate 可调（听力模块的语速滑杆依赖此参数）；opts 支持指定音色/音高/播完回调/不清理队列 */
  function speak(text, rate, opts) {
    opts = opts || {};
    if (!("speechSynthesis" in window)) {
      if (opts.onend) opts.onend();
      return;
    }
    /* 无德语语音包时发声只会静默失败，先挡掉并给用户指引 */
    if (!opts.voice && deVoices().length === 0) {
      sayVoiceHint();
      if (opts.onend) opts.onend();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const reg = window.LD.UI.registerSpeech; const unreg = window.LD.UI.unregisterSpeech;
    if (reg) reg(u);
    const uEnd = u.onend, uErr = u.onerror;
    u.onend = e => { if (unreg) unreg(u); if (uEnd) uEnd.call(u, e); };
    u.onerror = e => { if (unreg) unreg(u); if (uErr) uErr.call(u, e); };
    u.lang = "de-DE";
    u.rate = rate || 0.92;
    u.pitch = opts.pitch != null ? opts.pitch : 1;
    if (opts.voice) u.voice = opts.voice;
    if (!opts.keepQueue) speechSynthesis.cancel();
    if (opts.onend) u.onend = opts.onend;
    speechSynthesis.speak(u);
  }

  /* 德语语音包探测：无德语 voice 时 TTS 实际发不出声（听力模块据此给出安装指引） */
  function deVoices() {
    if (!("speechSynthesis" in window)) return [];
    try { return (speechSynthesis.getVoices() || []).filter(v => /^de/i.test(v.lang || "")); }
    catch (e) { return []; }
  }

  window.LD.SpeechUtil = { say: speak, phonetic, deVoices };
  /* 报错闭环：该词曾被用户在词卡页报过错时，词卡显式回执，避免纠错石沉大海 */
  function reportEcho(de) {
    try {
      const s = S();
      const key = String(de || "").toLowerCase();
      const mine = (s.contentReports || []).filter(r => String(r.de || "").toLowerCase() === key);
      if (!mine.length) return "";
      const fields = [...new Set(mine.flatMap(r => r.fields || []))].join("、");
      return `<div class="hint" style="margin:4px 0 0">你曾反馈该词条的「${fields}」问题（${mine.length} 条，已存入学习数据导出）。</div>`;
    } catch (e) { return ""; }
  }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "单词练习", icon: "▤", group: "学习闭环", priority: "P0", order: 2, ds: "SM-2 间隔重复 + HLR 半衰期调度 + 自适应难度，图文卡片与发音" });
  window.LD.define("vocab", Mod);
  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }
})();
