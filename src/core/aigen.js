/* LinguaDE · AI 出题 / 讲解生成
   仅使用现有大模型通道（LD.LLM.chat）；未配置时明确返回 no-ai，不伪造内容。
   生成结果写入 contentPack（reading / grammar / lexicon），带 source=ai 与「待校对」标记。
   grounding 优先使用 Tatoeba 德中双语开放语料（contentPack.pairs，CC BY 2.0 FR）。 */
(function () {
  const LD = (window.LD = window.LD || {});
  const S = () => LD.Store.s;
  const LEVELS = ["A2", "B1", "B2", "C1", "C2"];
  const DOMAINS = ["留学事务", "租房与注册", "求职实习", "科技与工程", "环境与能源", "经济与商业", "医学与健康", "法律与政治", "人文与教育"];
  const GRAMMAR_POINTS = [
    { id: "verb-position", nm: "从句语序（weil / dass / obwohl）", level: "B1" },
    { id: "cases", nm: "四格与三格（静三动四）", level: "A2" },
    { id: "aux", nm: "完成时助动词 sein / haben", level: "A2" },
    { id: "passive", nm: "被动语态 werden + 分词", level: "B1" },
    { id: "relative", nm: "关系从句", level: "B1" },
    { id: "konjunktiv", nm: "虚拟式 II（愿望 / 假设）", level: "B2" },
    { id: "prepositions", nm: "介词搭配与固定搭配", level: "B1" },
    { id: "adjective", nm: "形容词词尾变化", level: "A2" },
    { id: "infinitive", nm: "带 zu 不定式", level: "B1" },
    { id: "connectors", nm: "连接词与逻辑衔接", level: "B2" }
  ];

  const isStr = v => typeof v === "string" && v.trim().length > 0;
  const clean = s => String(s == null ? "" : s).trim();

  function hash(s) {
    let h = 5381;
    const t = String(s || "");
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function uid(prefix, s) { return prefix + "-" + hash(s) + "-" + Date.now().toString(36); }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function ready() { return !!(LD.LLM && LD.LLM.ready && LD.LLM.ready()); }
  function fail(reason, message) { return { ok: false, reason, message }; }

  function pack() {
    const s = S();
    s.contentPack = s.contentPack || {};
    return s.contentPack;
  }

  function pairsFor(level, n) {
    const all = (pack().pairs || []).filter(p => p && p.de && p.zh);
    const same = all.filter(p => p.level === level);
    const pool = same.length ? same : all;
    return shuffle(pool.slice()).slice(0, n || 3);
  }

  function examplesFor(level, n) {
    const pairs = pairsFor(level, n);
    if (pairs.length) return pairs.map(p => `DE: ${p.de}\nZH: ${p.zh}`).join("\n\n");
    const ps = (window.LD_READING_PASSAGES || []);
    const out = [];
    ps.slice(0, 3).forEach(p => (p.paras || []).slice(0, 1).forEach(x => {
      if (x.de) out.push(`DE: ${x.de}\nZH: ${x.zh || "（无译文）"}`);
    }));
    return out.join("\n\n") || "（暂无开放语料，按主题原创）";
  }

  function pruneAI(arr, max) {
    const ai = arr.filter(x => x && x.source === "ai");
    if (ai.length <= max) return arr;
    const keep = new Set(ai.slice(-max).map(x => x.id));
    return arr.filter(x => !x || x.source !== "ai" || keep.has(x.id));
  }

  function parse(txt) {
    const j = LD.LLM.safeJSON ? LD.LLM.safeJSON(txt) : null;
    if (!j) throw new Error("模型未返回可解析 JSON");
    return j;
  }

  function normalizeReading(j, level, topic) {
    if (!j || !isStr(j.title) || !isStr(j.titleZh)) throw new Error("缺少标题");
    const paras = (Array.isArray(j.paras) ? j.paras : []).filter(x => x && isStr(x.de)).slice(0, 4);
    if (!paras.length) throw new Error("缺少段落");
    const headings = (Array.isArray(j.headings) ? j.headings : []).filter(isStr);
    if (headings.length !== paras.length) throw new Error("小标题数量与段落不一致");
    let headingAns = (Array.isArray(j.headingAns) ? j.headingAns : []).map(Number);
    if (headingAns.length !== paras.length) headingAns = paras.map((_, i) => i);
    headingAns = headingAns.map((v, i) => (v >= 0 && v < headings.length ? v : i));
    const tfng = (Array.isArray(j.tfng) ? j.tfng : []).filter(x => x && isStr(x.q) && ["richtig", "falsch", "nicht im Text"].includes(x.a)).slice(0, 4);
    const mcq = (Array.isArray(j.mcq) ? j.mcq : []).filter(x => x && isStr(x.q) && Array.isArray(x.opts) && x.opts.length >= 3 && Number.isInteger(Number(x.a)) && Number(x.a) >= 0 && Number(x.a) < x.opts.length).slice(0, 4);
    if (!tfng.length && !mcq.length) throw new Error("缺少题目");
    const words = (Array.isArray(j.words) ? j.words : []).filter(x => x && isStr(x.de)).slice(0, 8)
      .map(x => ({ de: clean(x.de), zh: clean(x.zh) }));
    const theme = clean(topic) || clean(j.theme) || "AI 生成";
    const id = uid("ai-r", j.title + "|" + paras.map(p => p.de).join("|"));
    return {
      id, lv: level, theme, title: clean(j.title), titleZh: clean(j.titleZh),
      src: "AI 生成 · 未人工审校", source: "ai", license: "AI-generated", t: Date.now(),
      paras: paras.map(x => ({ de: clean(x.de), zh: clean(x.zh) })),
      headings, headingZh: (Array.isArray(j.headingZh) ? j.headingZh : []).slice(0, headings.length).map(clean),
      headingAns, tfng: tfng.map(x => ({ q: clean(x.q), qzh: clean(x.qzh), a: x.a, why: clean(x.why) })),
      mcq: mcq.map(x => ({ q: clean(x.q), qzh: clean(x.qzh), opts: x.opts.map(clean), a: Number(x.a), why: clean(x.why) })),
      words
    };
  }

  async function generateReading(opts) {
    opts = opts || {};
    const level = LEVELS.includes(opts.level) ? opts.level : "B2";
    if (!ready()) return fail("no-ai", "AI 出题需要先在设置中配置大模型；离线时请使用已有题库。");
    const sys = `你是资深德语教师，为准备留德考试的中国学生编写原创阅读理解题。只输出严格 JSON，不要 Markdown：
{"title":"德语标题","titleZh":"中文标题","theme":"主题","paras":[{"de":"德语段落","zh":"中文翻译"}],"headings":["德语小标题1","德语小标题2"],"headingZh":["中文小标题1","中文小标题2"],"headingAns":[0,1],"tfng":[{"q":"德语陈述","qzh":"中文陈述","a":"richtig|falsch|nicht im Text","why":"中文依据"}],"mcq":[{"q":"德语问题","qzh":"中文问题","opts":["A","B","C"],"a":0,"why":"中文解析"}],"words":[{"de":"词","zh":"中文"}]}
规则：2 段，每段 2–3 句；语言符合 CEFR ${level}；headings/headingZh/headingAns 数量与段落数一致，headingAns 是段落对应的小标题下标；2 个 tfng、2 个 mcq，每题 3 个选项；words 选 4–6 个关键词；必须原创，不照抄参考句，不编造原文没有的细节；全部用简体中文讲解。`;
    const user = `等级：${level}\n主题：${clean(opts.topic) || "留德生活"}\n参考开放语料（只用于控制词汇与难度，不要照抄）：\n${examplesFor(level, 3)}`;
    try {
      const txt = await LD.LLM.chat([{ role: "system", content: sys }, { role: "user", content: user }], { temperature: 0.5, timeout: 60000 });
      const item = normalizeReading(parse(txt), level, opts.topic);
      const p = pack();
      p.reading = p.reading || [];
      if (p.reading.some(x => x && (x.id === item.id || (x.title === item.title && (x.paras || []).map(y => y.de).join("|") === item.paras.map(y => y.de).join("|"))))) {
        return fail("duplicate", "生成内容与已有题目重复，请换个主题再试。");
      }
      p.reading.push(item);
      p.reading = pruneAI(p.reading, 24);
      LD.Store.save();
      return { ok: true, item };
    } catch (e) {
      return fail("failed", "AI 生成失败：" + (e.message || e));
    }
  }

  function normalizeGrammar(j, point, level) {
    if (!j || !isStr(j.explain)) throw new Error("缺少讲解");
    const examples = (Array.isArray(j.examples) ? j.examples : []).filter(x => x && isStr(x.de)).slice(0, 4)
      .map(x => ({ de: clean(x.de), zh: clean(x.zh) }));
    const exercises = (Array.isArray(j.exercises) ? j.exercises : []).filter(x => x && isStr(x.q) && Array.isArray(x.opts) && x.opts.length >= 2 && Number.isInteger(Number(x.a)) && Number(x.a) >= 0 && Number(x.a) < x.opts.length).slice(0, 4)
      .map(x => ({ q: clean(x.q), opts: x.opts.map(clean), a: Number(x.a), why: clean(x.why) }));
    if (!exercises.length) throw new Error("缺少练习");
    const id = uid("ai-g", point + "|" + j.explain);
    return {
      id, point: clean(j.point) || point, level: LEVELS.includes(j.level) ? j.level : level,
      explain: clean(j.explain), examples, exercises,
      source: "ai", src: "AI 生成 · 未人工审校", license: "AI-generated", t: Date.now()
    };
  }

  async function generateGrammar(opts) {
    opts = opts || {};
    const point = clean(opts.point) || "从句语序";
    const level = LEVELS.includes(opts.level) ? opts.level : "B1";
    if (!ready()) return fail("no-ai", "AI 讲解需要先在设置中配置大模型；离线时可继续使用本地规则纠错。");
    const sys = `你是德语语法老师。只输出严格 JSON：
{"point":"知识点","level":"A2|B1|B2|C1|C2","explain":"中文讲解（80字内，先规则后例子）","examples":[{"de":"德语例句","zh":"中文"}],"exercises":[{"q":"德语填空或改错题","opts":["A","B","C"],"a":0,"why":"中文解析"}]}
规则：2–3 个例句；3 道练习，每题 3 个选项；讲解必须准确、面向中国学生；不要照抄参考语料；只输出 JSON。`;
    const user = `知识点：${point}\n等级：${level}\n参考语料（可借鉴话题，不要照抄）：\n${examplesFor(level, 2)}`;
    try {
      const txt = await LD.LLM.chat([{ role: "system", content: sys }, { role: "user", content: user }], { temperature: 0.35, timeout: 60000 });
      const item = normalizeGrammar(parse(txt), point, level);
      const p = pack();
      p.grammar = p.grammar || [];
      if (p.grammar.some(x => x && x.id === item.id)) return fail("duplicate", "该讲解已生成过，请换个知识点或等级。");
      p.grammar.push(item);
      p.grammar = pruneAI(p.grammar, 40);
      LD.Store.save();
      return { ok: true, item };
    } catch (e) {
      return fail("failed", "AI 讲解失败：" + (e.message || e));
    }
  }

  function normalizeVocab(j, level, domain) {
    const rows = (Array.isArray(j && j.items) ? j.items : []).filter(x => x && isStr(x.de) && isStr(x.zh)).slice(0, 10);
    if (!rows.length) throw new Error("没有可用词条");
    return rows.map(x => ({
      de: clean(x.de), art: clean(x.art) || "-", zh: clean(x.zh),
      pos: ["n", "v", "adj", "adv", "prep", "conj", "pron", "num", "phr"].includes(x.pos) ? x.pos : "n",
      lvl: LEVELS.includes(x.lvl) ? x.lvl : level,
      ex: clean(x.ex), exzh: clean(x.exzh),
      domain: clean(x.domain) || domain || "专业词汇",
      source: "ai", src: "AI 生成 · 未人工审校", license: "AI-generated", t: Date.now()
    }));
  }

  async function generateVocab(opts) {
    opts = opts || {};
    const level = LEVELS.includes(opts.level) ? opts.level : "B2";
    const domain = clean(opts.domain) || "留学事务";
    const count = Math.max(3, Math.min(10, Number(opts.count) || 5));
    if (!ready()) return fail("no-ai", "AI 扩词需要先在设置中配置大模型；离线时请使用已有词库。");
    const existing = new Set((window.LD_LEX || []).map(r => String(r[0] || "").toLowerCase()));
    const sys = `你是德语词汇老师，为中国留德学生编写 CEFR 分级词条。只输出严格 JSON：
{"items":[{"de":"德语词","art":"der|die|das|-","zh":"中文释义(<=15字)","pos":"n|v|adj|adv|prep|conj|pron|num|phr","lvl":"A2|B1|B2|C1|C2","ex":"德语例句(6-16词且含该词)","exzh":"例句中文","domain":"领域"}]}
规则：词条必须符合指定等级与领域；例句自然、贴近留德学习生活；不要编造不存在的词；只输出 JSON。`;
    const user = `等级：${level}\n领域：${domain}\n数量：${count}\n参考开放语料（不要照抄，只借语感）：\n${examplesFor(level, 3)}`;
    try {
      const txt = await LD.LLM.chat([{ role: "system", content: sys }, { role: "user", content: user }], { temperature: 0.45, timeout: 60000 });
      const rows = normalizeVocab(parse(txt), level, domain)
        .filter(x => !existing.has(x.de.toLowerCase()))
        .slice(0, count);
      if (!rows.length) return fail("duplicate", "生成的词条都已在词库中，请换个领域或等级。");
      const p = pack();
      p.lexicon = p.lexicon || [];
      const seen = new Set(p.lexicon.map(x => String(x.de || "").toLowerCase()));
      rows.forEach(x => { if (!seen.has(x.de.toLowerCase())) { p.lexicon.push(x); seen.add(x.de.toLowerCase()); } });
      p.lexicon = pruneAI(p.lexicon, 200);
      LD.Store.save();
      if (LD.Store.applyContentPack) LD.Store.applyContentPack();
      return { ok: true, items: rows };
    } catch (e) {
      return fail("failed", "AI 扩词失败：" + (e.message || e));
    }
  }

  LD.AIGen = {
    LEVELS, DOMAINS, GRAMMAR_POINTS, ready,
    generateReading, generateGrammar, generateVocab,
    pairsFor, examplesFor
  };
})();
