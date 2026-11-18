/* LinguaDE · C1 定级测评内核（src/core/placement.js）
 * 分层抽样 + 逐层判定 + 词汇量估算，纯函数，不改 state。
 * 版本 placement-v1；判定规则与抽样配额见 docs/Spec/C1-CEFR定级测评/SPEC.md。
 * 对外口径：参考级别 / 估算，不是官方 CEFR 认定。 */
(function () {
  const LD = (window.LD = window.LD || {});

  const VERSION = 1;
  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  /* 词汇段配额：每层 2–4 题，合计 20 */
  const VOCAB_QUOTA = { A1: 3, A2: 4, B1: 4, B2: 4, C1: 3, C2: 2 };
  /* 语法段：A1–C1 各 6 题，合计 30 */
  const GRAMMAR_PER_LEVEL = 6;
  /* 某层达到该正确率记为「通过」 */
  const PASS_RATE = 0.67;
  /* 参考级别上限（语法点最高到 C2，但本产品只承诺到 C1 的参考结论） */
  const MAX_LEVEL = "C1";

  /* ---------- 伪随机（确定性） ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seedFor(dateKey, openId) {
    return hashStr(String(dateKey || "") + "|" + String(openId || ""));
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- 词汇池 ---------- */
  /* 只取实词（n/v/adj）：功能词（prep/conj/pron/interj）释义多义，做不了四选一。
     题干含「；」的多义词也排除，避免两个选项都说得通。 */
  function contentWords() {
    const raw = (window.LD_LEX || []).filter(x => x && typeof x[0] === "string" && x[0]);
    return raw.filter(x => {
      const pos = x[3], zh = String(x[2] || "");
      return (pos === "n" || pos === "v" || pos === "adj") && zh && zh.length <= 16 && zh.indexOf("；") < 0;
    });
  }
  /* 各层实词条数：词汇量估算的分母 */
  function layerCounts(words) {
    const pool = words || contentWords();
    const c = {};
    LEVELS.forEach(l => c[l] = 0);
    pool.forEach(w => { const lv = String(w[4] || "").toUpperCase(); if (c[lv] != null) c[lv]++; });
    return c;
  }
  function lemma(w) {
    const gen = w[1];
    return (w[3] === "n" && gen && gen !== "-") ? gen + " " + w[0] : w[0];
  }

  /* ---------- 词汇段抽题 ---------- */
  /* 每题：题干词 + 4 个中文释义（正确 1 + 同词性相邻层干扰 3） */
  function pickVocab(rng, pool) {
    const words = pool || contentWords();
    const used = new Set();
    const out = [];
    LEVELS.forEach(lv => {
      const quota = VOCAB_QUOTA[lv] || 0;
      if (!quota) return;
      const sameLv = words.filter(w => String(w[4] || "").toUpperCase() === lv);
      const picked = shuffle(sameLv, rng).slice(0, quota);
      picked.forEach(w => {
        if (used.has(w[0])) return;
        used.add(w[0]);
        const zh = String(w[2]);
        /* 干扰项：同词性、相邻层优先；不够时放宽到同词性任意层 */
        const near = LEVELS.filter(l => l !== lv && Math.abs(LEVELS.indexOf(l) - LEVELS.indexOf(lv)) === 1);
        const far = LEVELS.filter(l => l !== lv && near.indexOf(l) < 0);
        const pickDistractor = (list) => {
          const cand = shuffle(words.filter(x =>
            x[3] === w[3] && list.indexOf(String(x[4] || "").toUpperCase()) >= 0 &&
            String(x[2]) !== zh && !used.has(x[0]) &&
            out.every(o => o.de !== x[0])
          ), rng);
          return cand[0] || null;
        };
        const distractors = [];
        const first = pickDistractor(near);
        if (first) distractors.push(String(first[2]));
        if (distractors.length < 3) {
          const extra = shuffle(words.filter(x =>
            x[3] === w[3] && String(x[2]) !== zh && !used.has(x[0]) &&
            distractors.indexOf(String(x[2])) < 0 && out.every(o => o.de !== x[0])
          ), rng);
          extra.forEach(x => { if (distractors.length < 3 && distractors.indexOf(String(x[2])) < 0) distractors.push(String(x[2])); });
        }
        const opts = shuffle([zh].concat(distractors.slice(0, 3)), rng);
        out.push({ lv, de: w[0], lemma: lemma(w), zh, pos: w[3], opts, a: opts.indexOf(zh) });
      });
    });
    return out;
  }

  /* ---------- 语法段抽题 ---------- */
  /* 题库按 lv 分组；某层不足 6 题时取全部（当前 A1–C1 各 6 题，不触发） */
  function pickGrammar(rng, bank) {
    const items = bank || (window.LD_PLACEMENT_GRAMMAR || []);
    const out = [];
    ["A1", "A2", "B1", "B2", "C1"].forEach(lv => {
      const same = items.filter(x => x.lv === lv);
      shuffle(same, rng).slice(0, GRAMMAR_PER_LEVEL).forEach(x => {
        out.push({ lv, point: x.point || "", q: x.q, opts: x.opts.slice(), a: x.a, why: x.why || "" });
      });
    });
    return out;
  }

  /* ---------- 组装整卷 ---------- */
  function build(seed, pool) {
    const rng = mulberry32(seed >>> 0);
    return { v: VERSION, seed: seed >>> 0, vocab: pickVocab(rng, pool), grammar: pickGrammar(rng) };
  }

  /* ---------- 判分 ---------- */
  /* answers: { v: {index: pickedIndex}, g: {index: pickedIndex} } */
  function grade(paper, answers) {
    const vAns = (answers && answers.v) || {}, gAns = (answers && answers.g) || {};
    const layers = LEVELS.map(lv => {
      const idx = [];
      (paper.vocab || []).forEach((q, i) => { if (q.lv === lv) idx.push(i); });
      const n = idx.length, ok = idx.filter(i => vAns[i] === (paper.vocab[i] || {}).a).length;
      return { lv, n, ok, acc: n ? ok / n : 0 };
    }).filter(x => x.n > 0);
    const grammar = [];
    ["A1", "A2", "B1", "B2", "C1"].forEach(lv => {
      const idx = [];
      (paper.grammar || []).forEach((q, i) => { if (q.lv === lv) idx.push(i); });
      const n = idx.length, ok = idx.filter(i => gAns[i] === (paper.grammar[i] || {}).a).length;
      if (n) grammar.push({ lv, n, ok, acc: ok / n });
    });
    return { layers, grammar };
  }

  /* ---------- 定级 ---------- */
  /* 参考级别 = 最高的通过层；保守取词汇与语法中较低者 */
  function decide(result) {
    const counts = layerCounts();
    const layers = (result && result.layers) || [];
    const grammar = (result && result.grammar) || [];
    const idxOf = lv => LEVELS.indexOf(lv);

    const vocabLayer = layers.filter(x => x.acc >= PASS_RATE && idxOf(x.lv) <= idxOf(MAX_LEVEL))
      .reduce((best, x) => (!best || idxOf(x.lv) > idxOf(best.lv) ? x : best), null);
    const grammarLayer = grammar.filter(x => x.acc >= PASS_RATE && idxOf(x.lv) <= idxOf(MAX_LEVEL))
      .reduce((best, x) => (!best || idxOf(x.lv) > idxOf(best.lv) ? x : best), null);

    const vLevel = vocabLayer ? vocabLayer.lv : "A1";
    const gLevel = grammarLayer ? grammarLayer.lv : "A1";
    const level = idxOf(vLevel) <= idxOf(gLevel) ? vLevel : gLevel;

    /* 词汇量估算：Σ(该层正确率 × 该层词库条数)，
       封顶到词库实词总数——这是「认识库里多少词」，不是学习者的绝对词汇量 */
    let est = 0, floor = 0, poolTotal = 0;
    LEVELS.forEach(l => { poolTotal += counts[l] || 0; });
    layers.forEach(x => {
      const c = counts[x.lv] || 0;
      est += c * x.acc;
      if (idxOf(x.lv) < idxOf(level)) floor += c;
    });
    const vocabEst = Math.min(poolTotal, Math.round(est / 100) * 100);
    const band = Math.max(200, Math.round(vocabEst * 0.15 / 100) * 100);

    return {
      v: VERSION,
      level,
      vocabEst,
      vocabRange: [Math.max(0, vocabEst - band), vocabEst + band],
      vocabFloor: floor,
      grammarLevel: gLevel,
      vocabLevel: vLevel,
      vocabPassed: !!vocabLayer,
      grammarPassed: !!grammarLayer,
      counts,
      layers, grammar
    };
  }

  LD.Placement = {
    VERSION, LEVELS, VOCAB_QUOTA, GRAMMAR_PER_LEVEL, PASS_RATE, MAX_LEVEL,
    mulberry32, seedFor, contentWords, layerCounts, build, grade, decide
  };
})();