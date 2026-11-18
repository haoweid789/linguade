/* 模块 11 · 写作批改：Telc / TestDaF 题型 → 四维度评分 + 逐句批注 + 范文对照
   借鉴开源项目 deutsch-essay-evaluator 的评估思路（任务完成度 / 连贯性 / 词汇 / 语法），
   本地规则引擎可离线打分，配置大模型后升级为逐句精细批注。 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;

  const TASKS = [
    {
      id: "w1", exam: "Telc B1", type: "正式邮件", min: 80,
      title: "给语言班秘书处写一封邮件",
      prompt: "你报名了慕尼黑某语言中心的德语强化班，但开课时间与你大学注册冲突，需要改到下一期。请写一封正式邮件：说明情况、提出改期请求、询问手续与费用、留下联系方式。",
      points: ["说明冲突原因", "提出改期请求", "询问手续/费用", "结尾礼貌并留联系方式"],
      kw: [["überschneid", "konflikt", "leider", "grund"], ["umbuchen", "verschieben", "ändern", "verschiebung"],
        ["kosten", "gebühr", "unterlagen", "formular"], ["grüßen", "erreiche", "telefon", "mail", "kontakt"]],
      sample: "Sehr geehrte Damen und Herren,\n\nich habe mich für den Intensivkurs ab dem 3. Oktober angemeldet. Leider überschneidet sich der Kursbeginn mit meiner Immatrikulation an der Universität, die ich vor Ort persönlich erledigen muss.\n\nKönnten Sie mich bitte in den Kurs ab dem 7. November umbuchen? Ich möchte außerdem wissen, ob dadurch zusätzliche Kosten entstehen und welche Unterlagen Sie dafür brauchen.\n\nSie erreichen mich unter li.ming@example.com oder +49 151 12345678.\n\nMit freundlichen Grüßen\nLi Ming"
    },
    {
      id: "w2", exam: "TestDaF", type: "议论文", min: 180,
      title: "在线学习是否能取代课堂学习",
      prompt: "有人认为在线课程完全可以取代传统课堂。请就此发表看法，论述至少两个论据，并说明你的结论。",
      points: ["明确立场", "至少两个论据", "举例或数据支撑", "结论段"],
      kw: [["meinung", "ansicht", "ich bin der", "ich teile"], ["einerseits", "andererseits", "zudem", "außerdem", "erstens", "zweitens"],
        ["beispiel", "zum beispiel", "beispielsweise", "studie", "daten"], ["deshalb", "zusammenfassend", "daher", "fazit", "abschließend"]],
      sample: "Heutzutage lernen immer mehr Menschen online, und manche behaupten, dass digitale Kurse den Unterricht im Klassenzimmer vollständig ersetzen könnten. Ich teile diese Ansicht nur teilweise.\n\nEinerseits bietet das Lernen im Internet große Flexibilität: Man kann Zeit und Ort selbst bestimmen und spart den Weg zur Schule. Zudem sind hochwertige Materialien oft kostenlos verfügbar.\n\nAndererseits fehlt online das direkte Feedback. In der Diskussion mit anderen lernt man, seine Meinung zu begründen, und gerade beim Sprechen ist die Präsenz im Kurs kaum zu ersetzen.\n\nDeshalb bin ich der Meinung, dass Online-Kurse eine sinnvolle Ergänzung, aber kein vollständiger Ersatz sind."
    },
    {
      id: "w3", exam: "Telc B1", type: "论坛发帖", min: 100,
      title: "在留学生论坛分享租房经验",
      prompt: "你在慕尼黑找房花了两个月。请在留学生论坛发帖分享经验：遇到的困难、有效的渠道、给新生的建议。",
      points: ["描述困难", "给出渠道", "至少两条建议", "语气口语化"],
      kw: [["schwierig", "problem", "schwer", "anfang"], ["portal", "gruppe", "wohnungssuche", "wg-gesucht", "angebot"],
        ["tipp", "empfehl", "rat", "sollte", "am besten"], ["hallo", "ihr", "euch", "viel erfolg", "gruß"]],
      sample: "Hallo zusammen,\n\nich bin seit zwei Monaten in München und habe endlich eine Wohnung gefunden. Am Anfang war es wirklich schwierig: Die meisten Angebote waren innerhalb weniger Stunden weg, und ohne Schufa-Auskunft hatte ich kaum eine Chance.\n\nGeholfen hat mir vor allem eine Facebook-Gruppe für Studierende und das Portal wg-gesucht.de. Ich habe eine Mappe mit allen Unterlagen vorbereitet und auf jede Anzeige innerhalb von zehn Minuten geantwortet.\n\nMein Tipp an alle: Erstens, sucht frühzeitig, am besten drei Monate vorher. Zweitens, schreibt eine kurze Vorstellung auf Deutsch – das erhöht die Chance enorm.\n\nViel Erfolg!"
    },
    {
      id: "w4", exam: "TestDaF", type: "图表描述", min: 150,
      title: "描述在德中国留学生数量变化",
      prompt: "图表显示 2015 年约 30,000 名中国学生在德国高校注册，2020 年约 42,000 名，2025 年约 55,000 名。请描述趋势并分析可能原因。",
      points: ["数据描述", "趋势概括", "原因分析", "结构清晰"],
      kw: [["diagramm", "grafik", "zeigt", "zahl", "prozent"], ["gestiegen", "entwicklung", "zunahme", "verdoppelt", "trend"],
        ["ursache", "grund", "zurückzuführen", "liegt an", "weil"], ["zusammenfassend", "erstens", "zweitens", "deshalb", "abschließend"]],
      sample: "Das Diagramm zeigt die Entwicklung der Zahl chinesischer Studierender an deutschen Hochschulen zwischen 2015 und 2025.\n\nAusgehend von rund 30.000 Personen im Jahr 2015 ist die Zahl bis 2020 auf etwa 42.000 und bis 2025 auf circa 55.000 gestiegen. Damit hat sich die Zahl in zehn Jahren fast verdoppelt.\n\nDiese Entwicklung lässt sich vor allem auf zwei Ursachen zurückführen: Erstens sind die Studiengebühren an den meisten deutschen Hochschulen sehr niedrig, was den Standort attraktiv macht. Zweitens werden die Abschlüsse international anerkannt.\n\nZusammenfassend ist ein weiterer Anstieg zu erwarten, sofern die Rahmenbedingungen unverändert bleiben."
    },
    {
      id: "w5", exam: "DSH", type: "说明文", min: 150,
      title: "说明 APS 审核流程",
      prompt: "请向一位准备留德的同学说明 APS 审核是什么、为何需要、流程包含哪些步骤、如何准备。",
      points: ["定义", "必要性", "流程步骤", "准备建议"],
      kw: [["aps", "prüfstelle", "verfahren", "ist ein"], ["ohne", "nicht möglich", "pflicht", "voraussetzung", "müssen"],
        ["schritt", "ablauf", "zuerst", "danach", "schließlich"], ["vorbereitung", "empfehl", "üben", "wiederholen", "tipp"]],
      sample: "Die APS-Prüfung ist ein Verfahren der Akademischen Prüfstelle, das alle Bewerber aus China durchlaufen müssen, bevor sie sich an einer deutschen Hochschule bewerben können.\n\nSie dient dazu, die Echtheit der eingereichten Unterlagen zu überprüfen und die fachliche Eignung festzustellen. Ohne APS-Zertifikat ist eine Bewerbung in der Regel nicht möglich.\n\nDer Ablauf besteht aus drei Schritten: Zuerst reicht man die beglaubigten Dokumente ein, danach folgt ein schriftlicher Test oder ein etwa zwanzigminütiges Gespräch, und schließlich erhält man das Zertifikat.\n\nZur Vorbereitung empfiehlt es sich, die eigenen Studieninhalte auf Deutsch zu wiederholen und typische Fragen laut zu üben."
    },
    {
      id: "w6", exam: "Telc B1", type: "非正式邮件", min: 70,
      title: "给德国朋友写邀请邮件",
      prompt: "你的德国朋友 Tom 下个月来你的城市。请写一封非正式邮件：表达欢迎、提出两三项活动建议、询问他的到达时间与偏好。",
      points: ["欢迎", "活动建议", "询问到达信息", "du 称呼，语气亲切"],
      kw: [["schön", "freue", "willkommen", "kommst"], ["besichtigen", "besuchen", "fahren", "ausprobieren", "idee"],
        ["wann", "flug", "landest", "ankunft", "abhol"], ["du", "dir", "dich", "bis bald", "liebe"]],
      sample: "Hallo Tom,\n\nschön, dass du im nächsten Monat kommst! Ich freue mich schon sehr auf deinen Besuch.\n\nIch habe mir ein paar Ideen überlegt: Wir könnten am ersten Tag die Altstadt besichtigen, am zweiten Tag in die Berge fahren und abends ein typisches Restaurant ausprobieren. Wenn du lieber etwas anderes machen möchtest, sag mir einfach Bescheid.\n\nWann genau landest du? Schreib mir bitte deine Flugnummer, dann hole ich dich vom Flughafen ab.\n\nBis bald!\nLi Ming"
    }
  ];

  let curTask = TASKS[0], lastReport = null, draftTimer = null;

  const Mod = {
    title: "写作批改",
    desc: "Telc / TestDaF 写作题库，四维度评分（任务完成度·连贯性·词汇·语法）+ 逐句批注 + 范文对照",
    render(host, ctx) {
      window.LD.Store.visit("writing");
      host.innerHTML = `
        <div class="page-head"><h1>写作批改</h1>
          <p>参照 Telc / TestDaF 写作维度提供练习反馈；本地规则或大模型评价均为参考分，不代表官方考试成绩。${window.LD.LLM.ready() ? ' <span class="tag tag-ok">大模型辅助评价已启用</span>' : ' <span class="tag">本地规则反馈</span>'}</p></div>
        ${window.LD.FirstWeek ? window.LD.FirstWeek.notice(window.LD.FirstWeek.contextFor("writing")) : ""}
        <div class="grid" style="grid-template-columns:1fr 300px">
          <div class="card card-pad">
            <div class="iv-q">
              <div style="display:flex;gap:8px;margin-bottom:8px">
                <span class="tag tag-blue">${curTask.exam}</span><span class="tag">${curTask.type}</span>
                <span class="tag">建议 ${curTask.min} 词以上</span>
              </div>
              <div class="de" style="font-size:16px">${curTask.title}</div>
              <div class="zh" style="white-space:normal">${curTask.prompt}</div>
            </div>
            <div class="hint" style="margin-top:10px">评分要点：${curTask.points.join(" / ")}</div>
            <div class="hint">本地评分会检查关键词线索、篇幅、句子和段落结构；它不理解完整论证，分数不能换算为正式考试成绩。</div>
            <textarea id="wIn" style="margin-top:12px;min-height:230px;font-family:inherit;line-height:1.8"
              aria-label="德语作文正文" placeholder="用德语写作……写完点击「提交批改」"></textarea>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn-primary" id="wSubmit">提交批改</button>
              <button class="btn" id="wSample">查看范文</button>
              <button class="btn" id="wHumanSample" type="button">真人评分样本</button>
              <button class="btn" id="wClear">清空</button>
              <button class="btn" id="wImg" title="拍照/上传手写作文，自动识别转录">${window.LD.icon("camera")} 从图片导入</button>
              <span style="margin-left:auto;font-size:12.5px;color:var(--text-3)" id="wCount">0 词</span>
            </div>
            <div class="hint" id="wDraftState" role="status" aria-live="polite">草稿自动保存到本机</div>
            <div id="wOut"></div>
          </div>
          <div>
            <div class="card card-pad" style="margin-bottom:12px">
              <h2 style="margin:0 0 10px;font-size:13.5px">题库（${TASKS.length}）</h2>
              <div id="taskList"></div>
            </div>
            <div class="card card-pad" style="margin-bottom:12px">
              <h2 style="margin:0 0 10px;font-size:13.5px">历次成绩</h2>
              ${(S().writingHist || []).slice(-6).reverse().map((h, i) => `
                <div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line-soft);font-size:12.5px">
                  <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(h.task)}">${esc(h.task)}</span>
                  <b style="color:${h.total >= 75 ? "var(--ok)" : h.total >= 60 ? "var(--accent)" : "var(--danger)"}">${h.total}</b>
                  <span style="color:var(--text-3);flex-shrink:0">${new Date(h.t).toLocaleDateString("zh-CN")}</span>
                  <button class="btn btn-sm" type="button" data-history-i="${(S().writingHist || []).length - 1 - i}" ${h.text ? "" : "disabled title='旧记录没有保存作文正文'"}>查看</button>
                </div>`).join("") || `<div class="hint" style="margin:0">还没有批改记录 —— 同一题改写重交，可看到分数对比徽标。</div>`}
            </div>
            <div class="card card-pad">
              <h2 style="margin:0 0 10px;font-size:13.5px">评分维度说明</h2>
              <div style="font-size:12.5px;line-height:1.9;color:var(--text-2)">
                <div>· <b>任务完成度</b>：结合要点证据、篇幅与段落结构；本地估分会抑制关键词堆砌</div>
                <div>· <b>连贯性</b>：连接词密度与段落结构</div>
                <div>· <b>词汇</b>：词汇多样度（型例比）与高级表达</div>
                <div>· <b>语法</b>：逐句规则引擎检出的问题密度</div>
                <div class="hint">分数为辅助参考，正式考试以官方评分为准。</div>
              </div>
            </div>
          </div>
        </div>`;

      LD.UI.moduleTabs(host, [{ route: "writing", label: "写作批改" }, { route: "ocrgrade", label: "拍照批改", note: "手写识别" }], "writing");
      const tl = host.querySelector("#taskList");
      tl.innerHTML = TASKS.map((t, i) => `
        <div class="list-item" data-i="${i}" style="padding:9px 4px;cursor:pointer">
          <div class="main"><div class="t1" style="font-size:12.5px">${t.title}</div>
          <div class="t2">${t.exam} · ${t.type}</div></div>
        </div>`).join("");
      [...tl.children].forEach(c => c.onclick = () => {
        clearTimeout(draftTimer);
        saveDraft(input.value, host.querySelector("#wDraftState"));
        curTask = TASKS[+c.dataset.i];
        host.querySelector("#wIn").value = "";
        host.querySelector("#wOut").innerHTML = "";
        ctx.go("writing");
        // 重新渲染后回填选中题目
        setTimeout(() => { const el = document.querySelector('#taskList [data-i="' + c.dataset.i + '"]'); if (el) el.style.background = "var(--brand-soft)"; }, 0);
      });

      const input = host.querySelector("#wIn");
      input.value = (S().writingDrafts || {})[curTask.id] || "";
      input.addEventListener("input", () => {
        const n = input.value.trim().split(/\s+/).filter(Boolean).length;
        host.querySelector("#wCount").textContent = n + " 词";
        const state = host.querySelector("#wDraftState");
        if (state) state.textContent = "草稿自动保存中…";
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => saveDraft(input.value, state), 450);
      });
      input.addEventListener("blur", () => { clearTimeout(draftTimer); saveDraft(input.value, host.querySelector("#wDraftState")); });
      input.dispatchEvent(new Event("input"));
      host.querySelectorAll("[data-history-i]").forEach(b => b.onclick = () => {
        const h = S().writingHist[+b.dataset.historyI];
        if (!h || !h.text) return;
        clearTimeout(draftTimer);
        saveDraft(input.value, host.querySelector("#wDraftState"));
        const task = TASKS.find(t => t.title === h.task);
        if (task) curTask = task;
        ctx.go("writing");
        setTimeout(() => {
          const field = document.querySelector("#view #wIn");
          if (field) { field.value = h.text; field.dispatchEvent(new Event("input")); field.focus(); }
        }, 0);
      });
      host.querySelector("#wSubmit").onclick = () => submit(host, ctx);
      host.querySelector("#wSample").onclick = () => {
        host.querySelector("#wOut").innerHTML = `
          <div class="card card-pad" style="margin-top:14px;background:var(--panel-2)">
            <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">参考范文（${curTask.exam}）</div>
            <div class="de" style="font-size:14px;line-height:1.9;white-space:pre-wrap">${curTask.sample}</div>
          </div>`;
      };
      host.querySelector("#wHumanSample").onclick = async () => {
        const out = host.querySelector("#wOut");
        const button = host.querySelector("#wHumanSample");
        if (!window.LD.Backend.ready()) {
          out.innerHTML = `<div class="hint" role="status">真人评分语料需要连接 LinguaDE 后端；本地范文仍可直接查看。</div>`;
          return;
        }
        button.disabled = true;
        button.textContent = "正在读取…";
        out.innerHTML = `<div class="hint" role="status" aria-live="polite">正在从 MERLIN 人工评分语料库读取样本…</div>`;
        try {
          const result = await window.LD.Backend.listWritingSamples("", 1);
          const item = result && result.items && result.items[0];
          if (!item) throw new Error("语料库暂时没有可显示的写作样本");
          out.innerHTML = `<div class="card card-pad" style="margin-top:14px;background:var(--panel-2)">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
              <b>MERLIN 学习者写作样本</b><span class="tag tag-blue">人工 CEFR ${esc(item.level)}</span>
            </div>
            <div class="hint">这是 CEFR 人工评级，不是 TestDaF 官方分数；建议观察篇章表现，不要照抄。</div>
            <div class="de" style="font-size:14px;line-height:1.9;white-space:pre-wrap;margin-top:10px">${esc(item.text)}</div>
            <div class="hint" style="margin-top:12px">${esc(item.attribution)} · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">${esc(item.text_license)}</a> · <a href="${esc(item.source_url)}" target="_blank" rel="noopener noreferrer">查看来源</a></div>
          </div>`;
        } catch (error) {
          out.innerHTML = `<div class="hint" role="status">${esc(error.message || "暂时无法读取人工评分样本")}</div>`;
        } finally {
          button.disabled = false;
          button.textContent = "再看一篇真人评分样本";
        }
      };
      host.querySelector("#wClear").onclick = () => {
        input.value = ""; host.querySelector("#wOut").innerHTML = ""; host.querySelector("#wCount").textContent = "0 词";
        clearTimeout(draftTimer); delete S().writingDrafts[curTask.id]; window.LD.Store.save();
        host.querySelector("#wDraftState").textContent = "草稿已清除";
      };
      /* 从图片导入：拍照/上传手写作文 → 识别转录（mode=essay）→ 填入正文供校对后提交 */
      const wImg = host.querySelector("#wImg");
      if (wImg) wImg.onclick = () => {
        if (!window.LD.OCRUI) { toast("图片导入工具未加载", "err"); return; }
        window.LD.OCRUI.pick({ mode: "essay", hint: curTask.title }).then(r => {
          if (!r) return;
          input.value = r.transcript || "";
          input.dispatchEvent(new Event("input"));   // 触发词数统计
          toast("已识别转录，请校对后点「提交批改」", "ok");
        });
      };
    }
  };

  function saveDraft(text, statusEl) {
    const s = S();
    s.writingDrafts = s.writingDrafts || {};
    const value = String(text || "");
    if (value.trim()) s.writingDrafts[curTask.id] = value.slice(0, 20000);
    else delete s.writingDrafts[curTask.id];
    window.LD.Store.save();
    if (statusEl) statusEl.textContent = value.trim() ? `草稿已保存到本机 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "草稿自动保存到本机";
  }

  function submit(host, ctx) {
    const text = host.querySelector("#wIn").value.trim();
    const out = host.querySelector("#wOut");
    if (text.split(/\s+/).length < 12) { toast("请至少写一段完整的德语", "err"); return; }
    out.innerHTML = `<div class="hint">正在批改……</div>`;
    const local = localEvaluate(text, curTask);
    if (!window.LD.LLM.ready()) {
      out.innerHTML = reportHTML(local, text);
      bindReport(out, host, text);
      return;
    }
    const sys = `你是 Telc/TestDaF 德语写作阅卷专家。请严格按 JSON 输出，不要输出其它内容：
{"total":0-100,"task":分数,"coherence":分数,"vocab":分数,"grammar":分数,
 "strengths":["中文短语"],"issues":[{"sentence":"问题句原文","why":"中文讲解","fix":"修改建议"}],
 "advice":["中文建议"],"rewrite":"针对最弱段落的德语改写示范"}`;
    const body = `题目：${curTask.title}\n要求：${curTask.prompt}\n评分要点：${curTask.points.join("、")}\n\n学生作文：\n${text}`;
    window.LD.LLM.chat([{ role: "system", content: sys }, { role: "user", content: body }], { temperature: 0.3 })
      .then(t => {
        const j = window.LD.LLM.safeJSON(t);
        if (!j || typeof j !== "object") throw new Error("解析失败");
        const normalized = normalizeModelReport(j, local);
        lastReport = normalized;
        out.innerHTML = reportHTML(normalized, text);
        bindReport(out, host, text);
      })
      .catch(() => { out.innerHTML = reportHTML(local, text); bindReport(out, host, text); });
  }

  function normalizeModelReport(raw, fallback) {
    const score = key => Number.isFinite(Number(raw[key]))
      ? Math.max(0, Math.min(100, Math.round(Number(raw[key]))))
      : fallback[key];
    const task = score("task"), coherence = score("coherence"), vocab = score("vocab"), grammar = score("grammar");
    const total = Number.isFinite(Number(raw.total))
      ? Math.max(0, Math.min(100, Math.round(Number(raw.total))))
      : Math.round(task * .3 + coherence * .2 + vocab * .2 + grammar * .3);
    return {
      source: "llm", total, task, coherence, vocab, grammar,
      strengths: Array.isArray(raw.strengths) ? raw.strengths.filter(x => typeof x === "string").slice(0, 8) : [],
      issues: Array.isArray(raw.issues) ? raw.issues.filter(x => x && typeof x.sentence === "string" && typeof x.why === "string").slice(0, 8) : [],
      advice: Array.isArray(raw.advice) ? raw.advice.filter(x => typeof x === "string").slice(0, 8) : [],
      rewrite: typeof raw.rewrite === "string" ? raw.rewrite.slice(0, 2000) : ""
    };
  }

  /* ---------- 本地评分引擎 ---------- */
  function localEvaluate(text, task) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const sents = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 2);

    // 任务完成度：每个要点必须在完整句中出现；同一关键词反复堆叠不重复计分。
    const low = text.toLowerCase();
    const kwList = task.kw || [];
    const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 2);
    const tokensOf = value => value.toLowerCase().match(/[\p{L}äöüß]+/giu) || [];
    const sentenceTokens = sentences.map(tokensOf);
    const matches = (sentence, keyword) => {
      const k = keyword.toLowerCase().trim();
      if (!k) return false;
      // 多词短语按整词匹配；派生词词干允许后缀，但必须从词首开始。
      if (/\s/.test(k)) return (` ${sentence.toLowerCase().replace(/[^\p{L}äöüß]+/giu, " ")} `).includes(` ${k} `);
      return tokensOf(sentence).some(token => token === k || (k.length >= 5 && token.startsWith(k)));
    };
    const keyEvidence = kwList.map(list => {
      for (let i = 0; i < sentences.length; i++) {
        if (sentenceTokens[i].length < 5) continue;
        const keyword = list.find(k => matches(sentences[i], k));
        if (keyword) return { matched: true, keyword, sentence: sentences[i] };
      }
      return { matched: false, keyword: "", sentence: "" };
    });
    const keyHits = keyEvidence.map(x => x.matched ? 1 : 0);
    const hitRate = kwList.length ? keyHits.reduce((a, b) => a + b, 0) / kwList.length : 0.5;
    const lenRate = Math.min(1, words.length / task.min);
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const structure = Math.min(1, (Math.min(4, sentences.length) / 4 * 0.65) + (Math.min(3, paragraphs.length) / 3 * 0.35));
    const matchedTokens = new Set();
    kwList.flat().forEach(k => sentenceTokens.forEach(tokens => tokens.forEach(token => {
      if (token === k.toLowerCase() || (k.length >= 5 && token.startsWith(k.toLowerCase()))) matchedTokens.add(token);
    })));
    const matchedRatio = matchedTokens.size / Math.max(1, words.length);
    const shortSentenceRatio = sentences.length ? sentences.filter((_, i) => sentenceTokens[i].length < 5).length / sentences.length : 1;
    const stuffingPenalty = matchedRatio > 0.2 ? Math.min(0.55, (matchedRatio - 0.2) * 1.8) : 0;
    const taskScore = Math.round(Math.max(0, (hitRate * 0.4 + lenRate * 0.3 + structure * 0.3) * 100 - stuffingPenalty * 100 - shortSentenceRatio * 12));

    // 连贯性：连接词密度
    const connectives = ["und", "aber", "denn", "weil", "deshalb", "trotzdem", "außerdem", "zwar",
      "einerseits", "andererseits", "zudem", "daher", "damit", "obwohl", "wenn", "als", "nachdem",
      "zuerst", "dann", "schließlich", "zusammenfassend", "erstens", "zweitens"];
    const conCount = connectives.reduce((a, c) => a + (text.toLowerCase().match(new RegExp("\\b" + c + "\\b", "g")) || []).length, 0);
    const coherence = clamp(Math.round(40 + conCount / Math.max(1, sents.length) * 55), 20, 100);

    // 词汇：型例比（type-token ratio）+ 形容词副词占比
    const tokens = words.map(w => w.toLowerCase().replace(/[^\p{L}äöüß]/giu, "")).filter(Boolean);
    const win = Math.min(50, tokens.length);
    let ttrSum = 0, ttrN = 0;
    for (let i = 0; i + win <= tokens.length; i += Math.max(1, Math.floor(win / 2))) {
      ttrSum += new Set(tokens.slice(i, i + win)).size / win; ttrN++;
    }
    const ttr = ttrN ? ttrSum / ttrN : new Set(tokens).size / Math.max(1, tokens.length);
    const vocab = clamp(Math.round((ttr - 0.35) / 0.45 * 100), 20, 100);

    // 语法：逐句走规则引擎，统计问题密度
    let issues = [], bad = 0;
    sents.forEach(s => {
      const r = window.LD.LLM.localCheck(s + ".");
      const real = (r || []).filter(i => i && i.why);
      if (real.length) { bad++; issues.push({ sentence: s.slice(0, 90), why: real[0].why, fix: real[0].fix || "" }); }
    });
    const grammar = clamp(Math.round(100 - bad / Math.max(1, sents.length) * 130), 20, 100);

    const total = Math.round(taskScore * .3 + coherence * .2 + vocab * .2 + grammar * .3);

    return {
      source: "local", total, task: taskScore, coherence, vocab, grammar,
      coverage: task.points.map((point, i) => ({ point, ...keyEvidence[i] })),
      strengths: buildStrengths({ taskScore, coherence, vocab, grammar, words: words.length, conCount, taskMin: task.min }),
      issues: issues.slice(0, 6),
      advice: buildAdvice({ taskScore, coherence, vocab, grammar, words: words.length, conCount }),
      rewrite: issues.length ? issues[0].fix ? `${issues[0].sentence} → ${issues[0].fix}` : "建议重写首句，确保谓语动词位置正确。" : ""
    };
  }

  function buildStrengths(d) {
    const s = [];
    if (d.words >= d.taskMin) s.push(`字数达到 ${d.words} 词，篇幅达标`);
    if (d.conCount >= 4) s.push(`使用了 ${d.conCount} 处连接词，行文连贯`);
    if (d.vocab >= 70) s.push("词汇有一定多样性，避免大量重复");
    if (d.grammar >= 70) s.push("多数句子句法框架正确");
    if (!s.length) s.push("能够完成写作任务，具备基本表达能力");
    return s;
  }
  function buildAdvice(d) {
    const a = [];
    if (d.taskScore < 70) a.push("对照评分要点逐条检查，确保每个要点都在文中明确出现。");
    if (d.conCount < 4) a.push("增加 deshalb / außerdem / einerseits … andererseits 等连接词，提升连贯性得分。");
    if (d.vocab < 70) a.push("替换重复用词：把 gut 换成 sinnvoll / angemessen / vorteilhaft。");
    if (d.grammar < 70) a.push("重点检查动词位置与完成时助动词，这两类是扣分重灾区。");
    if (!a.length) a.push("整体达标，建议限时重做一遍以训练考试节奏。");
    return a;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

  function reportHTML(r, currentText) {
    const dims = [["任务完成度", r.task], ["连贯性", r.coherence], ["词汇", r.vocab], ["语法", r.grammar]];
    lastReport = r;
    /* 同题历史对比：上一份成绩 → 本份（首刷不显示徽标） */
    const prev = ((window.LD.Store.s.writingHist || []).filter(h => h.task === curTask.title).slice(-1)[0]) || null;
    const deltaHtml = prev ? `<span class="tag ${r.total >= prev.total ? "tag-ok" : "tag-warn"}" style="margin-left:8px">${r.total >= prev.total ? "↑" : "↓"} ${r.total - prev.total >= 0 ? "+" : ""}${r.total - prev.total} vs 上次 ${prev.total} 分</span>` : "";
    const compareHtml = prev && prev.text ? `<details class="writing-compare"><summary>展开对照上次作文（${new Date(prev.t).toLocaleDateString("zh-CN")}）</summary>
      <div class="grid g2" style="margin-top:10px"><div><b>上次</b><pre>${esc(prev.text)}</pre></div><div><b>本次</b><pre>${esc(currentText || "")}</pre></div></div></details>` : "";
    return `
      <div class="card" style="margin-top:14px;background:var(--panel-2)">
        <div class="card-pad">
          <div class="score-ring">
            <div id="wRing"></div>
            <div><div style="font-weight:600;font-size:16px">${r.total} 分 · ${grade(r.total)}${deltaHtml}</div>
              <div style="font-size:12.5px;color:var(--text-3)">批改引擎：${r.source === "llm" ? "大模型辅助评价" : "本地训练估分"} · 非官方成绩，未对照正式阅卷样本校准</div></div>
          </div>
          <div class="dims">
            ${dims.map(([n, v]) => `<div class="dim-row"><div class="n">${n}</div>
              <div class="dim-bar"><i style="width:${v}%"></i></div><div class="s">${v}</div></div>`).join("")}
          </div>
          ${(r.coverage || []).length ? `<div class="report-sec"><h2>本地规则找到的要点线索</h2><div class="hint">这里只显示关键词线索，不代表语义判断或人工确认。</div>
            ${r.coverage.map(c => `<div class="coverage-row"><span>${c.matched ? "✓" : "○"} ${esc(c.point)}</span><span class="tag ${c.matched ? "tag-ok" : "tag-warn"}">${c.matched ? `发现「${esc(c.keyword)}」` : "未发现预设关键词"}</span>${c.matched ? `<div class="de coverage-quote">${esc(c.sentence)}</div>` : ""}</div>`).join("")}</div>` : ""}
          ${compareHtml}
          ${(r.strengths || []).length ? `<div class="report-sec"><h2>表现亮点</h2>${r.strengths.map(s => `<p>· ${s}</p>`).join("")}</div>` : ""}
          ${(r.issues || []).length ? `<div class="report-sec"><h2>${window.LD.icon("pen")} 逐句批注</h2>
            ${r.issues.map(i => `<div class="corr-item" style="margin-top:8px"><div class="row">
              <span class="badge-x">✕</span><div style="flex:1">
              <div class="de wl-ctx" data-wctx="${wlAttr(i.sentence.slice(0, 120))}" style="font-size:13.5px">${wl(i.sentence)}</div>
              <div class="why">${esc(i.why)}${i.fix ? " ｜ 建议：" + `<span class="de wl-ctx" data-wctx="${wlAttr(i.fix.slice(0, 120))}">${wl(i.fix)}</span>` : ""}</div></div></div></div>`).join("")}</div>` : ""}
          <div class="report-sec"><h2>改进建议</h2>${(r.advice || []).map(s => `<p>· ${esc(s)}</p>`).join("")}</div>
          ${r.rewrite ? `<div class="report-sec"><h2>${window.LD.icon("pen")} 改写示范</h2><p class="de" style="font-size:14px;line-height:1.8">${esc(r.rewrite)}</p></div>` : ""}
          <div class="btn-row" style="margin-top:12px">
            <button class="btn" id="saveW">存入错题本</button>
            <button class="btn" id="sample2">对照范文</button>
          </div>
        </div>
      </div>`;
  }

  function bindReport(out, host, text) {
    const wRun = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("writing") : null;
    if (wRun) {
      window.LD.FirstWeek.update(wRun, { progress: 1 });
      window.LD.FirstWeek.evidence(wRun, "写作提交");
      out.insertAdjacentHTML("afterbegin", window.LD.FirstWeek.receipt(wRun, {
        summary: `写作已批改 · ${lastReport.total} 分`,
        detail: `${curTask.title} · 四维参考分`,
        evidence: "写作提交",
        source: "writing-round",
        label: "完成写作任务"
      }));
    }
    window.LD.Charts.ring(out.querySelector("#wRing"), lastReport.total,
      { size: 72, color: lastReport.total >= 75 ? "var(--ok)" : lastReport.total >= 60 ? "var(--accent)" : "var(--danger)" });
    if (window.LD.WordLink) window.LD.WordLink.bind(out, { mode: "popover", module: "写作批改", ctx: curTask.title });
    /* 历史入档：同题改写对比与长期曲线的数据源 */
    const st = window.LD.Store.s;
    st.writingHist = st.writingHist || [];
    st.writingHist.push({ t: Date.now(), task: curTask.title, total: lastReport.total, src: lastReport.source,
      dims: { task: lastReport.task, coherence: lastReport.coherence, vocab: lastReport.vocab, grammar: lastReport.grammar },
      text: String(text || "").slice(0, 12000) });
    if (st.writingHist.length > 50) st.writingHist = st.writingHist.slice(-50);
    window.LD.Store.save();
    window.LD.Store.logAnswer({
      type: "writing", ability: "writing", ok: lastReport.total >= 70, ms: 120000,
      item: curTask.title, skill: "write:" + curTask.id
    });
    window.LD.Store.addSession({ module: "writing", ms: 300000, count: 1 });
    (lastReport.issues || []).forEach(i => window.LD.Store.addWrong({
      module: "写作批改", type: "写作", wrong: i.sentence, right: i.fix || "", source: curTask.title, why: i.why
    }));
    out.querySelector("#saveW").onclick = () => {
      window.LD.Store.addWrong({
        module: "写作批改", type: "写作", wrong: text.slice(0, 200), right: curTask.sample.slice(0, 200),
        source: curTask.title, why: `总分 ${lastReport.total}｜` + (lastReport.advice || []).join("；")
      });
      toast("已存入错题本", "ok");
    };
    out.querySelector("#sample2").onclick = () => {
      out.insertAdjacentHTML("beforeend", `
        <div class="card card-pad" style="margin-top:12px">
          <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">参考范文</div>
          <div class="de" style="font-size:14px;line-height:1.9;white-space:pre-wrap">${esc(curTask.sample)}</div>
        </div>`);
    };
  }

  const grade = t => t >= 85 ? "优秀" : t >= 72 ? "良好" : t >= 60 ? "合格" : "需加强";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const wl = s => window.LD.WordLink ? window.LD.WordLink.linkHTML(s) : esc(s);
  const wlAttr = s => window.LD.WordLink ? window.LD.WordLink.attr(s) : "";
  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  window.LD.Writing = { evaluateLocal: localEvaluate };
  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "写作批改", icon: "pen", group: "沉淀与复盘", priority: "P0", order: 13, ds: "Telc/TestDaF 题型，四维度评分与逐句批注" });
  window.LD.define("writing", Mod);
  /* 写作题库导出：供「全真模考」写作节复用 */
  window.LD_WRITING_BANK = TASKS;
})();
