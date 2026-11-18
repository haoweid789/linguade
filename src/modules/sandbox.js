/* 模块 · 算法沙盘：可复现的调度算法对比实验台
   用同一个确定性虚拟学生（seeded PRNG）同时驱动 HLR / SM-2 / Leitner / DSR 四套调度器，
   把「算法创新」从文字主张变成评委可亲自点击验证的交互证据。
   模拟规则见 engine.js §10 sandboxSim；同参数结果完全可复现。 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;

  const SPEEDS = [
    { k: "fast", nm: "容易遗忘", desc: "记忆半衰期短，需要高频复习" },
    { k: "mid", nm: "普通学习者", desc: "大多数人所在的区间" },
    { k: "slow", nm: "记忆型选手", desc: "半衰期长，间隔可以拉得很开" }
  ];   // 四套调度器（本项目 HLR + 三套对照）
  const ALGOS = [
    { k: "hlr", nm: "HLR 半衰期模型", color: "var(--chart-1)", ours: true, rule: "回忆概率 p = 2^(-Δ/h)；p 降到 90% 触发复习。答对半衰期增长（前两次 ×1.9，之后 ×2.0），答错减半。复现 Duolingo（Settles & Meeder, ACL 2016）。" },
    { k: "sm2", nm: "SM-2 间隔重复", color: "var(--chart-2)", rule: "SuperMemo 1987 原始规则：I(1)=1 天、I(2)=6 天、I(n)=I(n-1)×EF；EF 初始 2.5、下限 1.3；评分低于 3 重置。Anki 2006–2023 默认算法。" },
    { k: "leitner", nm: "Leitner 五盒系统", color: "var(--chart-4)", rule: "1972 年纸质闪卡系统数字化：五个盒子间隔 1/2/4/8/16 天，答对升盒、答错降回第一盒。同盒卡片一视同仁，不按卡片难度定时。" },
    { k: "fsrs", nm: "DSR 调度器（自研简化 · 思路同 FSRS）", color: "var(--chart-3)", rule: "稳定性 S / 难度 D / 可提取性 R 三参数：按目标保持率 R（左上方可拖动，70–97%）反推复习间隔 interval = S / FACTOR × (R^(1/DECAY) − 1)，答对时「难度越低、增益越大」地提升 S，答错则稳定性大幅回落并抬升 D。⚠ 这是教学演示的简化实现（无难度均值回归、参数为经验值），不代表真实 FSRS（Anki 2023 默认）的性能。" }
  ];

  let cfg = { seed: 42, days: 60, newPerDay: 5, speed: "mid", retention: 0.9 };
  let lastSim = null;

  const Mod = {
    title: "算法沙盘",
    desc: "可复现模拟 HLR / SM-2 / Leitner / DSR（自研简化）四种调度算法的记忆保持差异",
    render(host, ctx) {
      window.LD.Store.visit("sandbox");
      lastSim = E().sandboxSim(cfg);
      host.innerHTML = `
        <div class="page-head"><h1>算法沙盘 · 调度算法对比实验台</h1>
          <p>把「我们的调度算法更好」变成你可以亲自验证的结论：同一个虚拟学生、同一批词条、同一条随机序列，同时跑四套调度器（HLR / SM-2 / Leitner / DSR），比较记忆保持与复习负担。</p><p class="hint" style="margin:8px 0 0;color:var(--text-3)">注意：DSR 是教学演示的简化实现，不是 Anki 2023 默认的真 FSRS；结论仅供理解算法差异，不作为选型依据。</p></div>

        <div class="card card-pad" style="margin-bottom:14px">
          <h3 style="margin:0 0 10px;font-size:15px">实验参数</h3>
          <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
            <div>
              <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">虚拟学生遗忘速度</div>
              <div style="display:flex;gap:6px">
                ${SPEEDS.map(s => `<div class="scene-chip ${cfg.speed === s.k ? "active" : ""}" data-sp="${s.k}" title="${s.desc}">${s.nm}</div>`).join("")}
              </div>
            </div>
            <div>
              <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">每日新词</div>
              <div style="display:flex;gap:6px">
                ${[3, 5, 8].map(v => `<div class="scene-chip ${cfg.newPerDay === v ? "active" : ""}" data-nw="${v}">${v} 个</div>`).join("")}
              </div>
            </div>
            <div>
              <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">模拟时长</div>
              <div style="display:flex;gap:6px">
                ${[30, 60, 90].map(v => `<div class="scene-chip ${cfg.days === v ? "active" : ""}" data-dy="${v}">${v} 天</div>`).join("")}
              </div>
            </div>
            <div>
              <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">DSR 目标保持率 R（70–97%）</div>
              <div style="display:flex;align-items:center;gap:8px">
                <input type="range" id="retIn" min="70" max="97" step="1" value="${Math.round(cfg.retention * 100)}" style="width:150px">
                <b id="retVal" style="font-size:13px;min-width:38px">${Math.round(cfg.retention * 100)}%</b>
              </div>
            </div>
            <div>
              <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">随机种子（同种子结果完全一致）</div>
              <input type="number" id="seedIn" value="${cfg.seed}" style="width:90px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text)">
            </div>
            <button class="btn btn-primary" id="runBtn" style="align-self:flex-end">▶ 运行模拟</button>
          </div>
          <div class="hint">实验设定：共 100 个词条按每日新词量依次引入；每个词有隐藏的「词质」（决定记忆可达上限），调度器只能按自身规则决定复习时机；复习成功概率由真实记忆动力学 p = 2^(-Δ/s) 决定；每日复习量上限 40 题（超出记为积压放弃）。</div>
        </div>

        <div id="result"></div>`;
      bindChips(host, ctx);
      renderResult(host);
    }
  };

  function bindChips(host, ctx) {
    host.querySelectorAll("[data-sp]").forEach(c => c.onclick = () => { cfg.speed = c.dataset.sp; ctx.go("sandbox"); });
    host.querySelectorAll("[data-nw]").forEach(c => c.onclick = () => { cfg.newPerDay = +c.dataset.nw; ctx.go("sandbox"); });
    host.querySelectorAll("[data-dy]").forEach(c => c.onclick = () => { cfg.days = +c.dataset.dy; ctx.go("sandbox"); });
    const seedIn = host.querySelector("#seedIn");
    seedIn.addEventListener("change", () => { cfg.seed = +seedIn.value || 42; });
    const retIn = host.querySelector("#retIn");
    if (retIn) {
      retIn.addEventListener("input", () => {                   // 目标保持率实时联动（拖动即预览，点击运行生效）
        cfg.retention = (+retIn.value || 90) / 100;
        host.querySelector("#retVal").textContent = retIn.value + "%";
      });
    }
    host.querySelector("#runBtn").onclick = () => { lastSim = E().sandboxSim(cfg); renderResult(host); };
  }

  function renderResult(host) {
    const box = host.querySelector("#result");
    if (!box || !lastSim) return;
    const sim = lastSim, w = sim.worlds;
    const v = E().sandboxVerdict(sim);
    box.innerHTML = `
      <div class="hint" style="margin:0 0 12px">当前沙盘 DSR 目标保持率 R = <b>${Math.round(sim.cfg.retention * 100)}%</b> —— 间隔按 FSRS 论文的间隔公式 <code>interval = S / FACTOR × (R^(1/DECAY) − 1)</code> 从稳定性反推：R 越高复习越密（保持率越高），R 越低间隔越长（省复习但遗忘事故会上升）。真实学习中的 HLR 提醒阈值可在设置里调整。</div>
      <div class="grid g4" style="margin-bottom:14px">
        ${ALGOS.map(a => `
          <div class="card card-pad" style="${a.ours ? "border-color:var(--brand)" : ""}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <b style="font-size:14px;color:${a.color}">${a.nm}</b>
              ${a.ours ? '<span class="tag tag-blue">本项目</span>' : ""}
            </div>
            <div class="grid g2" style="gap:8px">
              ${[["总复习量", w[a.k].total + " 次", "全程累计"],
              ["平均记忆保持率", w[a.k].avgRetention + "%", "全库每日平均"],
              ["遗忘事故率", w[a.k].lapseRate + "%", "复习时已忘超一半"],
              ["峰值日负担", w[a.k].peak + " 题", "单日最多复习"],
              ["积压放弃", w[a.k].backlog + " 题", "超出每日上限"],
              ["平均日负担", w[a.k].avgDaily + " 题", "总量 ÷ 天数"]].map(([k, val, sub]) =>
        `<div style="padding:8px 10px;border-radius:8px;background:var(--panel-2)">
            <div style="font-size:12px;color:var(--text-3)">${k}</div>
            <div style="font-size:17px;font-weight:700">${val}</div>
            <div style="font-size:12px;color:var(--text-3)">${sub}</div>
          </div>`).join("")}
            </div>
            <div class="hint" style="margin-top:8px">${a.rule}</div>
          </div>`).join("")}
      </div>

      <div class="grid g2" style="margin-bottom:14px">
        <div class="card card-pad">
          <h2 style="margin:0 0 8px;font-size:13.5px">每日复习量曲线（题/天）</h2>
          <div id="chartRev"></div>
          <div style="display:flex;gap:14px;justify-content:center;margin-top:6px;font-size:12px">
            ${ALGOS.map(a => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${a.color};margin-right:4px"></i>${a.nm}</span>`).join("")}
          </div>
        </div>
        <div class="card card-pad">
          <h2 style="margin:0 0 8px;font-size:13.5px">每日全库平均记忆保持率（%）</h2>
          <div id="chartRet"></div>
          <div class="hint" style="text-align:center">保持率 = 当日全部已学词条按真实记忆动力学计算的平均回忆概率</div>
        </div>
      </div>

      <div class="card card-pad" style="margin-bottom:14px;border-color:var(--brand)">
        <h2 style="margin:0 0 8px;font-size:14px">实验结论（由本组实测数字自动生成）</h2>
        <div style="font-size:15px;font-weight:600;color:var(--brand);margin-bottom:6px">${v.headline}</div>
        <div style="font-size:13px;color:var(--text-2);line-height:1.9">${v.detail}</div>
        <div class="hint" style="margin-top:8px">${v.note}</div>
      </div>

      <div class="card card-pad">
        <h2 style="margin:0 0 8px;font-size:14px">如何读这组实验</h2>
        <div style="font-size:13px;color:var(--text-2);line-height:1.95">
          <div>· <b>为什么比较「保持率」而不只看复习量</b>：复习越少越省时间，但如果复习时内容已经忘光（遗忘事故率高），省下的时间会以「重新学」的形式还回去。三个指标的平衡才是调度质量。</div>
          <div>· <b> Leitner 的典型问题</b>：固定间隔不区分卡片难度与个人遗忘速度——难词和简单词同盒同等待遇，要么复习过早（浪费）、要么过晚（事故）。</div>
          <div>· <b>SM-2 的典型问题</b>：EF 是全局经验系数，无法感知「这个学生就是忘得快」；本实验中可见其复习时平均回忆概率明显偏低，即大量复习发生在遗忘之后。</div>
          <div>· <b>HLR 的思路</b>：为每个词独立估计半衰期 h，在 p 降到阈值前恰好安排复习——答对延长间隔、答错立即回收，天然自适应学生差异。</div>
          <div>· <b>DSR 的思路</b>：用「稳定性 S」统一表示记忆可保持时长，再让「难度 D」决定每次成功的增益——与 HLR 同属自适应路线，但显式建模了逐词的难度差异。</div>
          <div>· <b>可复现性</b>：随机种子固定时整场模拟逐位一致；更换种子或参数后结论可能变化，欢迎自行实验——这正是开源算法的可验证性。</div>
        </div>
      </div>`;
    drawLines(box.querySelector("#chartRev"), sim.series.map(s => ({ x: s.day, hlr: s.hlr, sm2: s.sm2, leitner: s.leitner, fsrs: s.fsrs })), ALGOS, "题");
    drawLines(box.querySelector("#chartRet"), sim.series.map(s => ({ x: s.day, hlr: s.retHlr, sm2: s.retSm2, leitner: s.retLeitner, fsrs: s.retFsrs })), ALGOS, "%");
  }

  /* 多系列 SVG 折线图（无第三方依赖） */
  function drawLines(el, data, algos, unit) {
    if (!el) return;
    const W = 520, H = 210, P = { l: 40, r: 10, t: 12, b: 24 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const n = data.length;
    const maxV = Math.max(10, ...data.flatMap(s => algos.map(a => s[a.k] || 0)));
    const px = i => P.l + (n <= 1 ? 0 : i / (n - 1) * iw);
    const py = v => P.t + ih - (unit === "%" ? v / 100 * ih : v / maxV * ih);
    let grid = "";
    const ticks = unit === "%" ? [0, 25, 50, 75, 100] : [0, Math.round(maxV / 2), Math.round(maxV)];
    ticks.forEach(t => {
      grid += `<line x1="${P.l}" y1="${py(t)}" x2="${W - P.r}" y2="${py(t)}" stroke="var(--line-soft)" stroke-width="1"/>
               <text x="${P.l - 6}" y="${py(t) + 4}" font-size="12" fill="var(--text-3)" text-anchor="end">${t}</text>`;
    });
    let paths = "";
    algos.forEach(a => {
      const pts = data.map((s, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(s[a.k] || 0).toFixed(1)}`).join("");
      paths += `<path d="${pts}" fill="none" stroke="${a.color}" stroke-width="2" stroke-linejoin="round"/>`;
    });
    const xLab = `<text x="${P.l}" y="${H - 6}" font-size="12" fill="var(--text-3)">第 1 天</text>
                  <text x="${W - P.r}" y="${H - 6}" font-size="12" fill="var(--text-3)" text-anchor="end">第 ${n} 天</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${grid}${paths}${xLab}</svg>`;
  }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "算法沙盘", icon: "zap", group: "智能内核", priority: "P1", order: 15, nav: "more", ds: "可复现模拟 HLR / SM-2 / Leitner / DSR 四种调度算法的记忆保持差异" });
  window.LD.define("sandbox", Mod);
})();
