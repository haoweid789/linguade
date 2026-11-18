/* 模块 8 · AI 模拟面试：APS 审核 / 入学面试真题追问 → 结构化评估报告 */
(function () {
  const S = () => window.LD.Store.s;
  let mode = "aps", list = [], idx = 0, answers = [], curQ = null, t0 = 0;

  const Mod = {
    title: "AI 模拟面试",
    desc: "APS 审核与入学面试真题 + 多轮追问，生成四维结构化评估报告",
    render(host, ctx) {
      window.LD.Store.visit("interview");
      host.innerHTML = `
        <div class="page-head"><h1>AI 模拟面试</h1>
          <p>覆盖 APS 审核面谈与语言中心入学面试两类场景，含追问链条与评估报告。</p></div>
        <div class="card card-pad" style="margin-bottom:14px">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--text-3)">面试类型</span>
            ${[["aps", "APS 审核面谈"], ["zulassung", "入学语言班面试"], ["mix", "混合模拟（推荐）"]].map(([k, n]) =>
        `<div class="scene-chip ${mode === k ? "active" : ""}" data-m="${k}">${n}</div>`).join("")}
            <button class="btn btn-primary" id="startBtn" style="margin-left:auto">开始面试（5 题）</button>
          </div>
        </div>
        <div id="stage"></div>
        <div id="history"></div>`;

      [...host.querySelectorAll("[data-m]")].forEach(c => c.onclick = () => { mode = c.dataset.m; paintHome(host, ctx); });
      host.querySelector("#startBtn").onclick = () => start(host, ctx);
      paintHome(host, ctx);
    }
  };

  function bank() {
    const B = window.LD_INTERVIEW_BANK || [];
    if (mode === "mix") return [...B.filter(x => x.role === "aps").slice(0, 3), ...B.filter(x => x.role === "zulassung").slice(0, 2)];
    return B.filter(x => x.role === mode);
  }

  function paintHome(host, ctx) {
    host.querySelectorAll("[data-m]").forEach(c => c.classList.toggle("active", c.dataset.m === mode));
    const hist = S().interviews;
    const host2 = host.querySelector("#history");
    host2.innerHTML = `
      <div class="card card-pad" style="margin-top:14px">
        <h2 style="margin:0 0 10px;font-size:13.5px">历史面试记录（${hist.length}）</h2>
        ${hist.length ? `<table class="tbl"><thead><tr><th>时间</th><th>类型</th><th>题量</th><th>总分</th><th>操作</th></tr></thead><tbody>
          ${hist.slice(0, 8).map(h => `<tr><td>${new Date(h.t).toLocaleString("zh-CN")}</td>
            <td>${h.mode === "aps" ? "APS 面谈" : h.mode === "zulassung" ? "入学面试" : "混合模拟"}</td>
            <td>${h.count}</td><td><b style="color:${h.total >= 75 ? "var(--ok)" : h.total >= 60 ? "var(--warn)" : "var(--danger)"}">${h.total}</b></td>
            <td><button class="btn btn-sm" data-view="${h.t}">查看报告</button></td></tr>`).join("")}
        </tbody></table>` : `<div class="empty"><div class="big">◌</div><strong>还没有面试记录</strong><p>第一次模拟大约需要 10 分钟，完成后这里会保存追问链与评估报告。</p></div>`}
      </div>`;
    host2.querySelectorAll("[data-view]").forEach(b => b.onclick = () => {
      const rec = hist.find(h => h.t === +b.dataset.view); if (rec) showReport(host, ctx, rec.report, rec);
    });
  }

  function start(host, ctx) {
    list = bank().slice(0, 5);
    idx = 0; answers = []; t0 = Date.now();
    paintQuestion(host, ctx);
  }

  function paintQuestion(host, ctx) {
    const stage = host.querySelector("#stage");
    if (idx >= list.length) return finish(host, ctx);
    curQ = list[idx];
    const keywords = keywordsOf(curQ);
    stage.innerHTML = `
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="tag tag-blue">第 ${idx + 1} / ${list.length} 题</span>
          <span class="tag">${curQ.cat}</span>
        </div>
        <div class="iv-q"><div class="de">${curQ.q}</div><div class="zh">${curQ.zh}</div></div>
        <div class="hint" style="margin-top:10px">${curQ.hint}</div>
        <textarea id="aIn" style="margin-top:12px" placeholder="用德语作答。写完后可点「评分要点」自检是否覆盖：${keywords.map(k => k.replace(/\|/g, "/")).join("、")}"></textarea>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-primary" id="submit">提交并下一题</button>
          <button class="btn" id="showSample">查看参考答案</button>
          <button class="btn" id="dictate">${window.LD.icon("mic")} 语音录入</button>
          <button class="btn" id="giveup">放弃本题</button>
        </div>
        <div id="sampleBox"></div>
      </div>`;
    const input = stage.querySelector("#aIn");
    stage.querySelector("#submit").onclick = () => {
      const a = input.value.trim();
      answers.push({ q: curQ.q, zh: curQ.zh, a, keywords, cid: curQ.id });
      idx++; paintQuestion(host, ctx);
    };
    stage.querySelector("#showSample").onclick = () => {
      stage.querySelector("#sampleBox").innerHTML = `
        <div class="card card-pad" style="margin-top:12px;background:var(--panel-2)">
          <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">参考回答</div>
          <div class="de" style="font-size:14.5px;line-height:1.8">${curQ.sample}</div>
          <div style="margin-top:10px;font-size:12.5px;color:var(--text-3)">评分要点：${curQ.points.join(" / ")}</div>
        </div>`;
    };
    stage.querySelector("#dictate").onclick = () => dictate(input, stage.querySelector("#dictate"));
    stage.querySelector("#giveup").onclick = () => { answers.push({ q: curQ.q, zh: curQ.zh, a: "", keywords, cid: curQ.id }); idx++; paintQuestion(host, ctx); };
  }

  function keywordsOf(q) {
    // 从参考答案中提取德文实词作为覆盖度关键词
    const stop = new Set(["ich", "die", "der", "das", "und", "ist", "bin", "habe", "weil", "für", "in", "mit", "zu", "von", "auf", "eine", "einen", "einem", "sehr", "auch", "mir", "mich", "sich", "dass", "war", "im", "am", "an", "es", "sie", "er", "man", "nicht", "noch", "schon", "gern"]);
    return (q.sample || "").toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/)
      .filter(w => w.length > 3 && !stop.has(w)).slice(0, 8);
  }

  function dictate(input, button) {
    if (window.LD.ASR && LD.ASR.canRecord()) {
      if (input._ldWhisper) {
        const h = input._ldWhisper; input._ldWhisper = null;
        if (button) button.textContent = "正在转写…";
        LD.ASR.stopAndTranscribe(h).then(r => { input.value = String(r.text || "").trim(); toast("Whisper 转写完成", "ok"); })
          .catch(e => toast("Whisper 转写失败：" + e.message, "err"))
          .finally(() => { if (button) button.innerHTML = window.LD.icon("mic") + " 语音录入"; });
        return;
      }
      LD.ASR.createRecorder().then(h => {
        input._ldWhisper = h; h.rec.start();
        if (button) button.textContent = "■ 点击结束";
        toast("正在录音（华为云/后端 Whisper 转写）；再次点击结束", "info");
        setTimeout(() => { if (input._ldWhisper === h) button.click(); }, 25000);
      }).catch(e => toast("无法访问麦克风：" + e.message, "err"));
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("当前浏览器不支持内置识别；可连接华为云/后端 Whisper，或直接用键盘作答。", "info"); input.focus(); return; }
    if (input._ldRecognition) { input._ldRecognition.stop(); input._ldRecognition = null; return; }
    const rec = new SR(); rec.lang = "de-DE"; rec.continuous = true; rec.interimResults = true;
    input._ldRecognition = rec;
    let acc = "";
    rec.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) acc += ev.results[i][0].transcript + " ";
      }
      input.value = acc.trim();
    };
    rec.onend = () => { input._ldRecognition = null; if (button) button.innerHTML = window.LD.icon("mic") + " 语音录入"; toast("录音结束", "ok"); };
    rec.onerror = e => toast("识别失败：" + e.error, "err");
    rec.start();
    if (button) button.textContent = "■ 点击结束";
    toast("请开始回答；再次点击按钮结束录音。", "info");
  }

  function finish(host, ctx) {
    const stage = host.querySelector("#stage");
    stage.innerHTML = `<div class="card card-pad" style="text-align:center;padding:40px 20px">
      <div class="fin-ico" style="color:var(--brand)">${window.LD.icon("chart")}</div><h3 style="margin:10px 0">正在生成评估报告……</h3>
      <div class="hint">${window.LD.LLM.ready() ? "大模型评估中" : "本地评估引擎计算中"}</div></div>`;
    window.LD.LLM.evaluateInterview(answers).then(rep => {
      const rec = {
        t: Date.now(), mode, count: answers.length, total: rep.total,
        report: rep, items: answers
      };
      S().interviews.unshift(rec); window.LD.Store.save();
      showReport(host, ctx, rep, rec);
      paintHome(host, ctx);
    });
  }

  function showReport(host, ctx, rep, rec) {
    const stage = host.querySelector("#stage");
    const dims = [["内容覆盖 vocab", rep.vocab], ["语法 grammar", rep.grammar], ["逻辑 logic", rep.logic], ["表达 delivery", rep.delivery]];
    window.LD.Store.addSession({ module: "interview", ms: rec ? 600000 : 600000, count: rec ? rec.count : 5 });
    stage.innerHTML = `
      <div class="card card-pad">
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
          <div id="ivRing"></div>
          <div style="flex:1;min-width:220px">
            <div style="font-weight:600;font-size:17px">面试评估报告 · ${ rec && rec.mode === "aps" ? "APS 面谈" : rec && rec.mode === "zulassung" ? "入学面试" : "混合模拟"}</div>
            <div style="color:var(--text-3);font-size:12.5px;margin-top:3px">共 ${rec ? rec.count : "-"} 题 · 评估引擎：${rep.source === "llm" ? "大模型" : "本地规则"}</div>
          </div>
        </div>
        <div class="dims" style="margin-top:16px">
          ${dims.map(([n, v]) => `<div class="dim-row"><div class="n">${n.split(" ")[0]}</div>
            <div class="dim-bar"><i style="width:${v}%"></i></div><div class="s">${v}</div></div>`).join("")}
        </div>
        <div class="grid g2" style="margin-top:16px">
          <div class="report-sec"><h2>表现亮点</h2>${(rep.strengths || []).map(s => `<p>· ${s}</p>`).join("")}</div>
          <div class="report-sec"><h2>⚠️ 主要风险</h2>${(rep.risks || []).map(s => `<p>· ${s}</p>`).join("")}</div>
        </div>
        <div class="report-sec"><h2>针对性改进建议</h2>${(rep.advice || []).map(s => `<p>· ${s}</p>`).join("")}</div>
        ${rep.rewrite ? `<div class="report-sec"><h2>✍️ 改写示范</h2><p class="de" style="font-size:14.5px">${rep.rewrite}</p></div>` : ""}
        <div class="btn-row" style="margin-top:14px">
          <button class="btn btn-primary" id="againBtn">再来一轮</button>
          <button class="btn" id="toChatBtn">到对话里继续练</button>
        </div>
      </div>
      <div class="card card-pad" style="margin-top:14px">
        <h2 style="margin:0 0 10px;font-size:13.5px">本题逐题回顾</h2>
        ${(rec.items || []).map(it => `<div class="list-item" style="align-items:flex-start">
          <div class="main"><div class="t1" style="font-size:13px">Q：${it.q}</div>
          <div class="t2" style="white-space:normal">A：${it.a || "（未作答）"}</div></div>
          <button class="btn btn-sm" data-copy="${encodeURIComponent(it.q)}">到对话</button></div>`).join("")}
      </div>`;
    window.LD.Charts.ring(host.querySelector("#ivRing"), rep.total, { size: 84, color: rep.total >= 75 ? "var(--ok)" : rep.total >= 60 ? "var(--accent)" : "var(--danger)" });
    stage.querySelector("#againBtn").onclick = () => ctx.go("interview");
    stage.querySelector("#toChatBtn").onclick = () => ctx.go("chat", { scene: "aps" });
    stage.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => ctx.go("chat", { scene: "aps", preset: decodeURIComponent(b.dataset.copy) }));
  }

  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "AI 模拟面试", icon: "◈", group: "场景实战", priority: "P1", order: 16, nav: "more", ds: "APS 与入学真题追问 + 结构化评估报告" });
  window.LD.define("interview", Mod);
})();
