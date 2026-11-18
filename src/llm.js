/* LinguaDE · 大模型适配层 + 本地规则引擎
   - 配置了 API：OpenAI 兼容 /chat/completions（对话 / 纠错 / 面试评估）
   - 未配置或请求失败：自动降级为本地规则引擎，保证离线可用 */
(function () {
  const cfg = () => window.LD.Store.s.cfg;

  const ready = () => { const c = cfg(); return !!(c.apiBase && c.apiKey); };
  /* 后端通道（FastAPI /api/ai/*）是否可用 */
  const backendReady = () => !!(window.LD.Backend && LD.Backend.ready());
  /* 任一 AI 通道可用（后端优先，其次浏览器直连） */
  const aiReady = () => backendReady() || ready();

  function chat(messages, opts) {
    opts = opts || {};
    const c = cfg();
    const body = {
      model: c.model || "gpt-4o-mini",
      messages,
      temperature: opts.temperature != null ? opts.temperature : 0.7,
      stream: false
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 45000);
    return fetch(c.apiBase.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(j => {
        clearTimeout(timer);
        const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!txt) throw new Error("空响应");
        return txt.trim();
      })
      .catch(e => { clearTimeout(timer); throw e; });
  }

  /* ============ 本地规则纠错（离线兜底） ============ */
  function localCheck(sentence) {
    const R = window.LD_RULES;
    const issues = [];
    const nouns = new Set((window.LD_LEX || []).filter(x => String(x[3] || "").toLowerCase() === "n").map(x => x[0]));
    ["Hausaufgabe", "Freund", "Wohnung", "Universität", "Prüfung", "Semester", "Seminar", "Bibliothek",
      "Forschung", "Antrag", "Zeugnis", "Bewerbung", "Zulassung", "Versicherung", "Internet", "Frage",
      "Zeit", "Kaffee", "Musik", "Geschichte", "Physik", "Wetter", "Auto", "Bus", "Arbeit", "Stadt"
    ].forEach(n => nouns.add(n));

    const lower = sentence.toLowerCase();
    const cands = Object.create(null);

    // A. 词典规则
    R.dict.forEach(r => {
      if (r.id === "ok" || !r.why) return;
      if (r.p.test(sentence)) {
        cands[hash(r.why + r.idx)] = {
          type: ruleTypeOf(r.why),
          why: r.why,
          sev: r.sev || "warn",
          wrong: (sentence.match(r.p) || [""])[0],
          fix: ""
        };
      }
    });

    // B. 结构检查
    R.checks.forEach(chk => {
      let res = [];
      try { res = chk.run(sentence, { nouns }) || []; } catch (e) { console.warn("规则异常", chk.name, e); }
      res.forEach(one => {
        if (!one || (!one.wrong && !one.why)) return;
        cands[hash(chk.name + one.why + (one.wrong || ""))] = {
          type: one.type || chk.name,
          why: one.why,
          wrong: one.wrong || "",
          fix: one.fix || "",
          sev: "warn"
        };
      });
    });

    Object.keys(cands).forEach(k => issues.push(cands[k]));
    /* 闸门：剔除「改法与原文一致」的假阳性（哪怕来自句法/语序规则也一并清掉） */
    return issues.filter(i => !(i.fix && i.wrong && i.fix.trim() === i.wrong.trim()));
  }

  function ruleTypeOf(why) {
    if (/首字母/.test(why)) return "正字法";
    if (/助动词|haben|sein/.test(why)) return "助动词";
    if (/语序|句末|第三位/.test(why)) return "语序";
    if (/格|第四格|第三格|第二格/.test(why)) return "格变化";
    if (/否定|kein/.test(why)) return "否定";
    if (/搭配|不够正式|第二格/.test(why)) return "搭配";
    return "综合";
  }

  function hash(s) { return s; }

  /* ============ 对外：语法纠错 ============ */
/* 语法纠错：① 后端 → ② 直连大模型 → ③ 本地规则，逐级降级 */
  function correct(sentence) {
    if (!sentence || !sentence.trim()) return Promise.resolve({ issues: [], source: "none" });
    if (backendReady()) {
      return LD.Backend.correct(sentence)
        .then(j => ({ issues: j.issues || [], source: "backend" }))
        .catch(() => directCorrect(sentence));
    }
    return directCorrect(sentence);
  }

  function directCorrect(sentence) {
    if (!ready()) return Promise.resolve({ issues: localCheck(sentence), source: "local" });
    const sys = `你是德语语法纠错引擎。输入一句德语，输出严格的 JSON 数组（不要任何解释文字），每项：
{"type":"错误类型","wrong":"原文中的错误片段","fix":"修改后的片段","why":"中文讲解（不超过40字）"}
 若无错误返回 []。仅纠正德语问题，保持用户的表达意图。`;
    return chat([
      { role: "system", content: sys },
      { role: "user", content: sentence }
    ], { temperature: 0.2 })
      .then(txt => {
        const arr = safeJSON(txt);
        if (!Array.isArray(arr)) throw new Error("解析失败");
        return { issues: arr, source: "llm" };
      })
      .catch(() => ({ issues: localCheck(sentence), source: "local" }));
  }

  function localCheckSync(s) { return localCheck(s); }

  /* ============ 对话回复 ============ */
  /* 场景对话：① 后端 → ② 直连大模型 → ③ 本地规则 */
  function reply(scene, history, text) {
    const local = localReply(scene, text);
    if (backendReady()) {
      const hist = (history || [])
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role, content: m.content }));
      return LD.Backend.chat(scene.id || "aps", hist, text)
        .then(j => splitTip(j.reply || "", local.t))
        .catch(() => directReply(scene, history, text, local));
    }
    return directReply(scene, history, text, local);
  }

  function directReply(scene, history, text, local) {
    if (!ready()) return Promise.resolve({ text: local.r, tip: local.t, source: "local" });
    return chat([
      { role: "system", content: scene.sys },
    ].concat(history.slice(-8)).concat([{ role: "user", content: text }]), { temperature: 0.8 })
      .then(t => splitTip(t, local.t))
      .catch(() => ({ text: local.r, tip: local.t, source: "local" }));
  }

  function splitTip(txt, fallbackTip) {
    // 允许模型以 "---" 分割德语回复与中文点评
    const parts = txt.split(/\n?---+\n?/);
    if (parts.length > 1) return { text: parts[0].trim(), tip: parts.slice(1).join("\n").trim(), source: "llm" };
    return { text: txt.trim(), tip: fallbackTip, source: "llm" };
  }

  function localReply(scene, text) {
    const lowers = (text || "");
    const topic = String(text || "").match(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'-]{4,}/g);
    const stop = new Set(["nicht", "keine", "einen", "einer", "einem", "diese", "dieser", "dieses", "haben", "wurde", "würde", "kannst", "können", "bitte", "danke", "heute", "morgen"]);
    const salient = topic ? topic.find(w => !stop.has(w.toLowerCase())) : "";
    const seed = Array.from(String(text || "")).reduce((n, c) => n + c.charCodeAt(0), 0);
    const matchedFollowups = [
      `Sie erwähnen${salient ? ` „${salient}“` : " ein wichtiges Thema"}. Können Sie das mit einem konkreten Beispiel erklären?`,
      `Was ist für Sie${salient ? ` bei „${salient}“` : " dabei"} am wichtigsten? Begründen Sie Ihre Antwort mit „weil“.`,
      `Können Sie noch einen Grund oder eine Folge${salient ? ` zu „${salient}“` : " dazu"} ergänzen?`
    ];
    for (const r of scene.replies) {
      if (r.m.test(lowers)) return {
        r: `${r.r}\n\n${matchedFollowups[seed % matchedFollowups.length]}`,
        t: (r.t ? r.t + " ｜ " : "") + "离线场景规则回应，不是大模型回答。"
      };
    }
    const followups = [
      `Sie erwähnen${salient ? ` „${salient}“` : " ein wichtiges Thema"}. Können Sie Ihre Situation mit einem konkreten Beispiel erklären? Versuchen Sie dabei einen Satz mit „weil“.`,
      `Das klingt nach einem interessanten Punkt${salient ? ` zu „${salient}“` : ""}. Was ist für Sie daran am wichtigsten? Antworten Sie zuerst mit Ihrer Meinung und begründen Sie sie danach.`,
      `Lassen Sie uns das genauer üben${salient ? `: Was bedeutet „${salient}“ in Ihrer Situation` : ""}? Ergänzen Sie bitte noch einen Grund oder ein Beispiel.`
    ];
    return { r: followups[seed % followups.length], t: "离线句型练习：这条回应由本地规则生成，不是大模型回答。" };
  }

  /* ============ 中文 → 德语（对话室中文输入） ============ */
  /* ① 后端 /api/ai/translate → ② 直连大模型 → ③ 明确拒绝（不伪造译文） */
  function translateZh(text) {
    const src = String(text || "").trim();
    if (!src) return Promise.reject(new Error("没有可翻译的内容"));
    if (backendReady()) {
      return LD.Backend.translate(src)
        .then(j => {
          const t = String((j && j.text) || "").trim();
          if (!t) throw new Error("后端未返回译文");
          return t;
        })
        .catch(err => directTranslate(src).catch(() => {
          throw new Error("AI 翻译通道不可用（后端 " + err.message + "）");
        }));
    }
    return directTranslate(src);
  }

  function directTranslate(src) {
    if (!ready()) return Promise.reject(new Error("离线模式未配置 AI 通道"));
    const sys = `你是面向中国德语学习者的翻译引擎。把用户的中文翻译成自然、口语化的德语，只输出德语译文，不要解释、不要加引号或代码块。
如果原文已经是德语，原样返回；不要编造原文没有的信息。`;
    return chat([{ role: "system", content: sys }, { role: "user", content: src }], { temperature: 0.2, timeout: 30000 })
      .then(t => {
        const out = String(t || "").trim();
        if (!out) throw new Error("模型未返回译文");
        return out;
      });
  }

  /* ============ 面试评估 ============ */
/* 面试评估：① 后端 → ② 直连大模型 → ③ 本地规则 */
  function evaluateInterview(items) {
    const dims = LocalInterviewEval(items);
    if (backendReady()) {
      return LD.Backend.interviewEvaluate(items)
        .then(j => { if (!j || j.total == null) throw new Error("响应异常"); j.source = "backend"; return j; })
        .catch(() => directEvaluate(items, dims));
    }
    return directEvaluate(items, dims);
  }

  function directEvaluate(items, dims) {
    if (!ready()) return Promise.resolve(dims);
    const sys = `你是 APS 审核与德国高校面试评估专家。依据问答记录输出严格 JSON：
{"total":0-100,"vocab":分数,"grammar":分数,"logic":分数,"delivery":分数,
  "strengths":["中文短语"],"risks":["中文短语"],"advice":["中文建议"],"rewrite":"针对最弱一题的德语改写示范"}
 不要输出 JSON 以外的内容。`;
    const body = items.map((it, i) => `Q${i + 1}: ${it.q}\nA${i + 1}: ${it.a}`).join("\n\n");
    return chat([{ role: "system", content: sys }, { role: "user", content: body }], { temperature: 0.3 })
      .then(txt => { const j = safeJSON(txt); if (!j) throw new Error("解析失败"); j.source = "llm"; return j; })
      .catch(() => dims);
  }

  function LocalInterviewEval(items) {
    const E = window.LD.Engine;
    let totalQ = 0, covered = 0, lenSum = 0, concrete = 0;
    items.forEach(it => {
      const a = (it.a || "").trim();
      if (!a) return;
      totalQ++;
      lenSum += a.split(/\s+/).length;
      const hit = E.hitRatio(a, it.keywords || []);
      covered += hit;
      if (/\d|weil|zum Beispiel|beispielsweise|und zwar|deshalb/i.test(a)) concrete++;
    });
    if (!totalQ) return { total: 0, src: "local" };
    const avgLen = lenSum / totalQ;
    const coverage = Math.round(covered / totalQ * 100);
    const logic = clamp(Math.round(concrete / totalQ * 60 + coverage * 0.4), 10, 100);
    const delivery = clamp(Math.round(Math.min(100, avgLen * 5.5)), 15, 100); // 句长 → 表达充分度
    const vocab = clamp(Math.round(coverage * 0.7 + Math.min(40, avgLen * 2)), 10, 100);
    const ab = window.LD.Store.s.ability;
    const grammar = clamp(Math.round((ab.grammar || 50) * 0.7 + coverage * 0.3), 10, 100);
    const total = Math.round(vocab * .25 + grammar * .3 + logic * .25 + delivery * .2);
    return {
      total, vocab, grammar, logic, delivery, source: "local",
      strengths: buildStrengths({ vocab, grammar, logic, delivery, coverage, avgLen }),
      risks: buildRisks({ vocab, grammar, logic, delivery, coverage, avgLen }),
      advice: buildAdvice({ vocab, grammar, logic, delivery, coverage, avgLen }),
      rewrite: " Bitte ergänzen Sie konkrete Zahlen und einen Grund mit „weil“ oder „deshalb“."
    };
  }

  function buildStrengths(d) {
    const s = [];
    if (d.coverage >= 70) s.push("问题要点覆盖完整，没有跑题");
    if (d.avgLen >= 35) s.push("回答有实质内容，信息量充足");
    if (d.logic >= 70) s.push("能使用因果或举例结构支撑观点");
    if (!s.length) s.push("能够开口表达，具备基本交流能力");
    return s;
  }
  function buildRisks(d) {
    const r = [];
    if (d.coverage < 50) r.push("有较多问题要点被略过，容易被追问打穿");
    if (d.avgLen < 22) r.push("回答过短，缺少支撑细节");
    if (d.grammar < 55) r.push("语法错误偏高，重点丢分在句法框架");
    if (d.logic < 55) r.push("缺少逻辑连接词，听起来像背答案");
    if (!r.length) r.push("个别专业术语发音还需打磨");
    return r;
  }
  function buildAdvice(d) {
    const a = ["先用 20 秒说结论，再用一个具体例子展开——这是 APS 最吃香的回答节奏。"];
    if (d.grammar < 70) a.push("把「weil / deshalb / obwohl」三个连词练到条件反射，从句语序错误能降一半。");
    if (d.logic < 70) a.push("每个回答固定套一层结构：Erstens … Zweitens … Deshalb …");
    if (d.coverage < 70) a.push("针对本题再写一遍 40 词以内的德语提纲，录音三遍直到脱稿。");
    return a;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, Math.round(v))); }

  function safeJSON(txt) {
    if (!txt) return null;
    let s = txt.trim();
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const l = s.indexOf("["), b = s.indexOf("{");
    let start = -1;
    if (l >= 0 && (b < 0 || l < b)) start = l; else if (b >= 0) start = b;
    if (start < 0) return null;
    const open = s[start], close = open === "[" ? "]" : "}";
    const end = s.lastIndexOf(close);
    if (end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
  }

  /* ============ 阅读段落解析（直连大模型；失败时由阅读模块本地降级） ============ */
  function parseParagraph(text) {
    if (!ready()) return Promise.reject(new Error("未配置大模型"));
    const sys = `你是德语阅读老师。把一段德语拆成易读的结构，只输出严格 JSON：
{"translation":"整段中文翻译","sentences":[{"de":"拆分后的德语句子","zh":"该句中文","structure":"成分/从句提示（中文，20字内）"}],"grammar":[{"point":"语法点","explain":"中文讲解（40字内）","example":"德语例子"}]}
不要输出 JSON 以外的文字；不要逐词翻译，不要编造原文没有的信息。`;
    return chat([{ role: "system", content: sys }, { role: "user", content: text }],
      { temperature: 0.2, timeout: 45000 })
      .then(txt => {
        const j = safeJSON(txt);
        if (!j || !j.translation) throw new Error("解析失败");
        j.source = "llm";
        return j;
      });
  }

  /* ============ 图像识别与批改：① 后端视觉 LLM → ② 直连视觉模型 → ③ 本地提示 ============ */
  const VISION_PROMPTS = {
    grammar: "你是德语语法批改专家。用户上传手写或打印的德语文本照片。请 1) 逐字转录原文；2) 找出语法/拼写/标点错误并给出修改与中文讲解。只输出 JSON：{\"transcript\":\"...\",\"confidence\":0.0-1.0,\"corrections\":[{\"orig\":\"...\",\"fixed\":\"...\",\"type\":\"...\",\"explain\":\"中文讲解\"}],\"comments\":\"中文总评\",\"suggestions\":[\"建议\"]}。无法辨认处标注 [难以辨认]，不要编造。",
    exercise: "你是德语练习批改老师。用户上传练习册或作业照片。请 1) 转录题目与作答；2) 判定对错；3) 给出正确答案与中文讲解。只输出 JSON：{\"transcript\":\"...\",\"confidence\":0.0-1.0,\"items\":[{\"question\":\"...\",\"answer\":\"...\",\"verdict\":\"正确|部分正确|错误\",\"correct\":\"...\",\"explain\":\"...\"}],\"score\":{\"overall\":0-100},\"comments\":\"...\",\"suggestions\":[\"...\"]}。无法辨认处标注 [难以辨认]。",
    essay: "你是 Telc/TestDaF 德语写作阅卷专家。用户上传手写作文照片。请 1) 逐句转录；2) 四维评分并给逐句批注与升格建议。只输出 JSON：{\"transcript\":\"...\",\"confidence\":0.0-1.0,\"score\":{\"overall\":0-100,\"task\":0-100,\"coherence\":0-100,\"vocab\":0-100,\"grammar\":0-100},\"corrections\":[{\"orig\":\"...\",\"fixed\":\"...\",\"type\":\"...\",\"explain\":\"...\"}],\"comments\":\"...\",\"suggestions\":[\"...\"],\"sample\":\"德语示范段落\"}。无法辨认处标注 [难以辨认]。"
  };

  function ocrGrade(imageDataUrl, mode, meta) {
    if (!imageDataUrl) return Promise.resolve({ ok: false, reason: "no-image", message: "请先选择或拍摄一张图片。" });
    if (backendReady()) {
      return LD.Backend.ocrGrade(imageDataUrl, mode, meta)
        .then(j => Object.assign({ ok: true }, j))
        .catch(() => directVision(imageDataUrl, mode, meta));
    }
    return directVision(imageDataUrl, mode, meta);
  }

  function directVision(imageDataUrl, mode, meta) {
    if (!ready()) {
      return Promise.resolve({
        ok: false, reason: "no-ai",
        message: "图像识别与批改需要 AI 通道：请在后端配置支持图片输入的视觉大模型（LINGUADE_LLM_*），或在「设置」中填写支持视觉的 LLM 地址与 Key。手写体无法仅靠本地规则识别。"
      });
    }
    const c = cfg();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    const body = {
      model: c.model || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: VISION_PROMPTS[mode] || VISION_PROMPTS.grammar },
        { role: "user", content: [
          { type: "text", text: "请按系统要求处理这张德语图片。" + (meta && meta.level ? " 学习者水平：" + meta.level + "。" : "") },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ] }
      ]
    };
    return fetch(c.apiBase.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(j => {
        const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        const parsed = safeJSON(txt);
        if (!parsed) throw new Error("模型未返回可解析的 JSON");
        parsed.ok = true;
        parsed.source = "direct-vision";
        parsed.mode = mode;
        return parsed;
      })
      .catch(e => {
        const friendly = window.LD.UI && window.LD.UI.netErr ? window.LD.UI.netErr(e) : String(e && e.message || e);
        return { ok: false, reason: "failed", message: "图像批改失败：" + friendly };
      })
      .finally(() => clearTimeout(timer));
  }

  window.LD.LLM = { ready, aiReady, backendReady, chat, correct, reply, translateZh, evaluateInterview, parseParagraph, ocrGrade, localCheck: localCheckSync, safeJSON, ruleTypeOf };
})();
