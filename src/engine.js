/* LinguaDE · 自适应学习与测评引擎
   1) SM-2 简化间隔重复（单词/错题复习调度）
   2) 难度动态调整（依据正确率、作答耗时、错题类型）
   3) 薄弱点诊断与能力画像
   4) 口语三维评分（重音 / 语调 / 流利度）
====================================================================== */
(function () {
  const S = () => window.LD.Store.s;

  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const lvIndex = l => Math.max(0, LEVELS.indexOf(l));

  /* ============ 1. 间隔重复 (SM-2 简化) ============ */
  function getCard(word) {
    const s = S();
    return s.cards[word] || { ef: 2.5, iv: 0, due: Date.now(), reps: 0, lapses: 0, ok: 0, bad: 0, history: [] };
  }

  function rate(word, q) {
    // q: 0 完全不会 / 1 想起来了但很难 / 2 一般 / 3 轻松
    const s = S();
    const c = Object.assign({}, getCard(word));
    c.reps += 1;
    c.history.push({ t: Date.now(), q });

    if (q >= 2) {
      c.ok += 1;
      if (c.iv === 0) c.iv = q === 3 ? 1 : 0.5;
      else c.iv = c.iv * c.ef * (q === 3 ? 1.15 : 1.0);
      c.ef = Math.max(1.3, Math.min(2.5, c.ef + (0.1 - (3 - q) * (0.08 + (3 - q) * 0.02))));
    } else {
      c.bad += 1;
      c.lapses += 1;
      c.iv = 0;                 // 当天重新出现
      c.ef = Math.max(1.3, c.ef - 0.2);
    }
    c.iv = Math.min(c.iv, 180); // 上限 180 天
    c.due = Date.now() + c.iv * 86400000;
    s.cards[word] = c;
    /* B2：同一作答同步写 FSRS 档案（主调度）；SM-2 cards 保留只读给沙盘/兼容 */
    const Srs = window.LD && window.LD.Srs;
    if (Srs) {
      s.fsrs = s.fsrs || {};
      const cur = s.fsrs[word] || Srs.initCard("word");
      s.fsrs[word] = Srs.next(cur, q, Date.now());
      s.notes = s.notes || {};
      if (!s.notes[word]) s.notes[word] = { kind: "word", ref: word, createdAt: Date.now() };
    }
    window.LD.Store.save();
    return c;
  }

  const dueList = () => {
    const s = S(), inLex = lexSet();
    return Object.keys(s.cards).filter(w => (s.cards[w].due || 0) <= Date.now() && inLex.has(w));
  };
  /* 孤儿卡片：本机有复习记录、但当前词库里已经没有这个词（词库改版、换设备恢复旧快照、
     手动改过 localStorage 都会造成）。它们既不该算进「到期复习」，也不该被静默丢掉。 */
  const orphanDue = () => {
    const s = S(), inLex = lexSet();
    return Object.keys(s.cards).filter(w => (s.cards[w].due || 0) <= Date.now() && !inLex.has(w));
  };
  const newCount = () => {
    const inLex = lexSet();
    return LEX().length - Object.keys(S().cards).filter(w => inLex.has(w)).length;
  };

  /* ============ 2. 词库访问 ============ */
  const LEX = () => window.LD_LEX || [];
  let _lexSet = null, _lexSetSize = -1;
  function lexSet() {
    const lex = LEX();
    if (!_lexSet || _lexSetSize !== lex.length) {
      _lexSet = new Set(lex.map(w => w[0]));
      _lexSetSize = lex.length;
    }
    return _lexSet;
  }
  const LEVEL_CAP = { A1: 1.0, A2: 0.85, B1: 0.6, B2: 0.25, C1: 0.15, C2: 0.1 }; // 起点越低，A1 权重越大

  function levelWeight(wordLevel, started, target) {
    const d = lvIndex(wordLevel) - lvIndex(started);
    if (d > 1) return 0.05;                // 远超当前水平：偶尔混入，但不该占据队列
    if (d < -1) return 0.4;                 // 过于简单
    return 1.0;
  }

  /* 每日预算：由「设置 → 每日分钟」推导（约 1.2 分钟/张），下限 20、上限 120。
     写死 20 会让到期词把新词名额挤成 0 —— 见 docs/ux-report-3.17.0.md。 */
  function dailyBudget() {
    const min = (S().profile && S().profile.dailyMin) || 30;
    return Math.max(20, Math.min(120, Math.round(min / 1.2)));
  }

  /* 到期词最多占 70% 预算，剩余名额留给新词 */
  function splitBudget(size) {
    const dueAll = mergedDue();
    if (dueAll.length <= size) return { dueAll, reviewSlots: dueAll.length, newSlots: size - dueAll.length };
    const reviewSlots = Math.max(1, size - Math.round(size * 0.3));
    return { dueAll, reviewSlots, newSlots: size - reviewSlots };
  }

  function mergedDue() {
    const s = S();
    /* B2：FSRS 到期（主调度口径）——word 粒度按 due 升序；HLR 仅作补充（迁移期重叠兜底） */
    const Srs = window.LD && window.LD.Srs;
    const inLex = lexSet();
    const fsrsDue = Srs
      ? Object.keys(s.fsrs || {})
          .filter(w => s.fsrs[w] && (s.fsrs[w].due || 0) <= Date.now() && inLex.has(w))
          .sort((a, b) => (s.fsrs[a].due || 0) - (s.fsrs[b].due || 0))
      : [];
    const hlrDue = hlrDueList().map(x => x.w);
    const due = dueList().sort((a, b) => (s.cards[a].due || 0) - (s.cards[b].due || 0));
    return [...new Set([...fsrsDue, ...hlrDue, ...due])];
  }

  /* 今日队列的真实负担：预算、到期总数、今天排不下的（顺延）数量 */
  function backlogStats() {
    const budget = dailyBudget();
    const sp = splitBudget(budget);
    return { budget, due: sp.dueAll.length, reviewSlots: sp.reviewSlots, newSlots: sp.newSlots, deferred: Math.max(0, sp.dueAll.length - sp.reviewSlots) };
  }

  /* 把今天排不下的到期词按「最不危急优先」顺延 N 天：到期数即时下降，用户可自助瘦身 */
  function deferDue(count, days) {
    const s = S();
    const dueAll = mergedDue();
    const n = Math.max(0, Math.min(count || 0, dueAll.length));
    const targets = dueAll.slice(dueAll.length - n);
    const shift = (days || 14) * 86400000;
    targets.forEach(w => {
      const c = s.cards[w];
      if (c && Number.isFinite(c.due)) c.due += shift;
      const h = s.hlr && s.hlr[w];
      if (h && Number.isFinite(h.last)) h.last += shift;
    });
    window.LD.Store.save();
    return targets.length;
  }

  /* 内容状态：human（人工校订）/ ai（AI 辅助自动复核）/ machine（待人工复核）。
     首卡人工优先只认 human；ai 与 machine 都还不算人工校订。 */
  function qaOfHead(head) {
    const key = String(head).toLowerCase();
    if (window.LD_LEX_REVIEWED && window.LD_LEX_REVIEWED.has(key)) return "human";
    if (!window.LD_LEX_MACHINE || !window.LD_LEX_MACHINE.has(key)) return "human";
    if (window.LD_LEX_AI_REVIEWED && window.LD_LEX_AI_REVIEWED.has(key)) return "ai";
    return "machine";
  }

  /* 今日学习队列：HLR 濒临遗忘词（优先）+ 到期复习 + 自适应新词
     opts.reviewOnly：考前突击等场景只取到期复习，不再混入新词 */
  function buildQueue(size, opts) {
    const budget = dailyBudget();
    size = Math.max(1, Math.min(size || budget, budget));
    const reviewOnly = !!(opts && opts.reviewOnly);
    const s = S();
    // 合并去重：HLR 濒危词在前，SM-2 到期词随后；只取预算内的复习名额
    const { dueAll, reviewSlots } = splitBudget(size);
    const dueMerged = dueAll.slice(0, reviewOnly ? size : reviewSlots);
    const need = reviewOnly ? 0 : Math.max(0, size - dueMerged.length);
    const seen = new Set(dueAll);
    const names = window.LD_LEX_NAME_WORDS || new Set();
    /* 新词队列排除：已标注的复数变体（原形单独学）、纯专名（Ali / Rom）、粗口辱骂词（register=vulgar） */
    const pool = LEX().filter(w => !seen.has(w[0]) && w[8] !== "plural"
      && !names.has(String(w[0]).toLowerCase()) && w[9] !== "vulgar");

    const weightOf = w => {
      const card = s.cards[w[0]];
      if (card) return 0;
      let base = levelWeight(w[4], s.profile.level, s.profile.exam);
      // 有可靠例句的词优先（例句是词卡的第二释义）
      if (!w[5]) base *= 0.6;
      // 薄弱领域加权
      if (w[4] === "B1" && s.ability.grammar < 55) base *= 1.1;
      return base;
    };
    const isMachine = w => qaOfHead(w[0]) !== "human";

    /* 带权不放回抽样（对一个子池抽 count 张） */
    const draw = (sub, count) => {
      const wts = sub.map(weightOf);
      const idx = sub.map((_, i) => i);
      let total = wts.reduce((a, b) => a + b, 0);
      const out = [];
      for (let k = 0; k < count && total > 0; k++) {
        let r = Math.random() * total, acc = 0, chosen = -1;
        for (let i = 0; i < idx.length; i++) {
          acc += wts[idx[i]];
          if (r <= acc) { chosen = i; break; }
        }
        if (chosen < 0) break;
        out.push(sub[idx[chosen]]);
        total -= wts[idx[chosen]];
        idx.splice(chosen, 1);
      }
      return out;
    };

    /* 新词分两阶段：先抽人工校对词条（待复核禁入前段，首日牌面必须是可信词）；
       人工池不足时再补 AI 辅助词条，并在词卡上标注复核状态 */
    const manual = pool.filter(w => !isMachine(w));
    const machine = pool.filter(isMachine);
    const firstDraw = Math.min(need, Math.ceil(need / 2), manual.length);
    const picked = draw(manual, firstDraw);
    if (picked.length < need) picked.push(...draw(machine, need - picked.length));
    /* 若人工池仍剩余而机器池被抽干（低等级小池），补回人工 */
    if (picked.length < need) {
      const used = new Set(picked.map(w => w[0]));
      picked.push(...draw(manual.filter(w => !used.has(w[0])), need - picked.length));
    }

    const q = dueMerged.map(w => entryOf(w, true)).concat(picked.map(w => entryOf(w[0], false)));
    return q.filter(Boolean).slice(0, size);
  }

  function entryOf(word, isDue) {
    const lex = LEX().find(x => x[0] === word);
    const c = getCard(word);
    return lex ? {
      de: lex[0], art: lex[1], zh: lex[2], pos: lex[3], lv: lex[4], ex: lex[5], exzh: lex[6],
      formOf: lex[7] || "", formKind: lex[8] || "", reg: lex[9] || "",
      qa: qaOfHead(lex[0]),
      isDue, reps: c.reps, ok: c.ok, bad: c.bad, ef: +c.ef.toFixed(2)
    } : null;
  }

  /* ============ 2.5 半衰期记忆模型 HLR（Half-Life Regression）============
     借鉴 Duolingo 公开论文（Settles & Meeder, ACL 2016）的间隔重复调度：
     回忆概率随「距上次练习的天数 Δ」指数衰减：p = 2^(-Δ/h)
     h 为该词在记忆中的半衰期（天）。核心规则：
       - 答对：半衰期增长（记忆增强），前两次 ×1.9、之后 ×2.0
       - 答错：半衰期减半（记忆衰退），下限 0.5 天
       - 最佳练习时机：p 降到阈值以下（≈ 遗忘临界点），优先复习最濒临遗忘的词
     Duolingo 在 1300 万用户词条上验证：较 Leitner 固定规则预测误差降低 45%+。 */
  /* 3.24 调参：90% 阈值下「再次到期 ≈ 0.152h」。旧常数（initH 1 / growLate 1.35）
     让答对 5 次的词 1.4 天就又到期，词量一大复习就永远做不完（docs/ux-report-3.23-longterm.md §3.1）。
     现在首次答对后约 1 天、之后约 2 / 4 / 8 / 15 / 30 天再见，接近常见间隔重复节奏。 */
  const HLR = { initH: 3.5, growOk: 1.9, growLate: 2.0, dropWrong: 0.5, minH: 0.5, maxH: 365, dueAt: 0.9 };

  function hlrState(word) {
    const s = S();
    s.hlr = s.hlr || {};
    if (!s.hlr[word]) s.hlr[word] = { h: HLR.initH, correct: 0, wrong: 0, last: 0 };
    return s.hlr[word];
  }

  function hlrUpdate(word, ok) {
    const s = S();
    s.hlr = s.hlr || {};
    const st = hlrState(word);
    if (ok) {
      st.correct += 1;
      const g = st.correct <= 2 ? HLR.growOk : HLR.growLate;
      st.h = Math.min(HLR.maxH, st.h * g);
    } else {
      st.wrong += 1;
      st.h = Math.max(HLR.minH, st.h * HLR.dropWrong);
    }
    st.last = Date.now();
    window.LD.Store.save();
    return st;
  }

  /* 当前回忆概率（%）：Δ 为距上次练习天数 */
  function hlrRecall(word) {
    const st = hlrState(word);
    if (!st.last) return 0;                       // 未练过：无记忆强度
    const deltaDays = Math.max(0, (Date.now() - st.last) / 86400000);
    return Math.round(Math.pow(2, -deltaDays / st.h) * 100);
  }

  /* 到期（濒临遗忘）的词：按回忆概率升序，最危急的排最前 */
  function hlrDueList() {
    const s = S();
    const hlr = s.hlr || {};
    const inLex = lexSet();
    return Object.keys(hlr)
      .filter(w => hlr[w].last > 0 && inLex.has(w))
      .map(w => ({ w, p: hlrRecall(w), h: hlr[w].h }))
      .filter(x => x.p < ((S().cfg && S().cfg.retention) || HLR.dueAt) * 100)
      .sort((a, b) => a.p - b.p);
  }

  /* 记忆强度分档（Duolingo strength meter 风格） */
  function hlrBand(p) {
    if (p >= 90) return { nm: "很牢固", color: "var(--ok)" };
    if (p >= 70) return { nm: "尚可", color: "#7bb3f0" };
    if (p >= 50) return { nm: "开始遗忘", color: "var(--warn)" };
    return { nm: "急需复习", color: "var(--danger)" };
  }

  /* ============ 3. 难度动态调整 ============ */
  /* 输入：近 n 次作答记录；输出 1–5 档难度 + 建议 */
  function nextDifficulty(records) {
    if (!records || !records.length) return { level: 2, reason: "暂无历史数据，从中间难度起步" };
    const recent = records.slice(-10);
    const acc = recent.filter(r => r.ok).length / recent.length;
    const avgMs = recent.reduce((a, r) => a + (r.ms || 0), 0) / recent.length;
    let level = 2;
    if (acc >= 0.85 && avgMs < 6000) level = 4;
    else if (acc >= 0.7) level = 3;
    else if (acc >= 0.5) level = 2;
    else level = 1;
    let reason;
    if (acc >= 0.85 && avgMs < 6000) reason = "正确率高且反应快，上调难度并缩短复习间隔";
    else if (acc >= 0.7) reason = "表现稳定，维持中等难度并缓慢加量";
    else if (acc >= 0.5) reason = "波动明显，回到巩固题型并增加例句提示";
    else reason = "错误偏多，下调难度、回到高频基础词并缩短每次训练量";
    return { level, reason, acc: +(acc * 100).toFixed(0), avgMs: Math.round(avgMs) };
  }

  /* ============ 4. 薄弱点画像 ============ */
  function weakPoints() {
    const s = S();
    const recentLog = s.log.slice(-120);
    const byType = {};
    recentLog.forEach(r => {
      const k = r.type || "综合";
      byType[k] = byType[k] || { n: 0, ok: 0 };
      byType[k].n++;
      if (r.ok) byType[k].ok++;
    });
    const list = Object.keys(byType).map(k => ({
      key: k, total: byType[k].n,
      acc: Math.round(byType[k].ok / byType[k].n * 100)
    })).sort((a, b) => a.acc - b.acc);

    const ability = s.ability;
    const abilitySorted = Object.keys(ability).map(k => ({ key: k, v: ability[k] })).sort((a, b) => a.v - b.v);
    return { byType: list, weakest: abilitySorted.slice(0, 3), ability };
  }

  function radarData() {
    const a = S().ability;
    const map = { vocab: "词汇", grammar: "语法", reading: "阅读", listening: "听力", speaking: "口语", writing: "写作" };
    return Object.keys(a).map(k => ({ key: map[k] || k, value: a[k] }));
  }

  /* ============ 5. 口语三维评分 ============ */
  /* 输入：参考文本 ref 与识别结果 hyp
     维度：重音 stress、语调 intonation、流利度 fluency ---- 均为启发式，定位为辅助参考分 */
  function scoreSpeech(ref, hyp, meta) {
    meta = meta || {};
    const norm = t => (t || "").toLowerCase().replace(/[.,!?;:"„“”]/g, "").replace(/\s+/g, " ").trim();
    const A = norm(ref).split(" ").filter(Boolean);
    const B = norm(hyp).split(" ").filter(Boolean);
    if (!B.length) return null;

    // 词错率 WER（Levenshtein）
    const dist =lev(A, B);
    const wer = dist / Math.max(1, A.length);
    const accuracy = Math.max(0, 100 - Math.round(wer * 100));

    // 完整性：覆盖参考词的比例
    const setB = new Set(B);
    const coverage = Math.round(A.filter(w => setB.has(w)).length / Math.max(1, A.length) * 100);

    // 流利度：语速（词/分钟）+ 停顿次数 + 填充词 + 最长停顿（B8 扩展，纯信号计算）
    const sec = Math.max(1, (meta.ms || 6000) / 1000);
    const wpm = Math.round(B.length / (sec / 60));
    const FILLERS = ["äh", "ähm", "öhm", "also", "und"];
    const fillers = B.filter(w => FILLERS.includes(w)).length;
    const longestPauseMs = Math.max(0, +meta.longestPauseMs || 0);
    const wpmTag = wpm < 60 ? "过慢" : wpm < 90 ? "偏慢" : wpm <= 130 ? "适中" : "偏快";
    let fluency = 100 - Math.abs(110 - wpm) * 0.55;
    if (wpm < 60) fluency -= 12;
    if (meta.pauses > B.length * 0.5) fluency -= 10;
    if (fillers >= 2) fluency -= Math.min(9, Math.floor(fillers / 2) * 3);
    if (longestPauseMs > 2000) fluency -= 5;
    fluency = clamp(Math.round(fluency), 20, 100);

    // 重音：德语词重音多在首音节，以识别出的长词/多音节词比例 + 准确度合成
    const poly = B.filter(w => w.length >= 6).length;
    const stressSeed = Math.min(30, poly * 4);
    let stress = Math.round(accuracy * 0.65 + stressSeed);
    stress = clamp(stress, 20, 100);

    // 语调：句末升降由标点与句长启发式推断，随机扰动很小以保证可复现
    const q = /\?$/.test((ref || "").trim());
    let intonation = Math.round(accuracy * 0.6 + coverage * 0.25 + (q ? 12 : 6));
    intonation = clamp(intonation, 20, 100);

    const total = Math.round(accuracy * 0.4 + fluency * 0.25 + stress * 0.2 + intonation * 0.15);

    /* 音素级定位（3.6.0）：规则式 G2P + 音素序列对齐，指出具体哪个音发错
       （GOP 思路，Witt 2000 / Hu 2015；浏览器本地实现参考 guettli/pp） */
    let phonemes = null;
    try { if (window.LD.Phonetics) phonemes = window.LD.Phonetics.compare(ref, hyp); } catch (e) { }

    /* 内容分 / 发音分拆分（2026-11）：
       内容分 = 词错率 WER + 流利度；发音分 = 音素错误率近似。
       手动输入没有声学证据，发音分置空；置信度随识别通道变化。 */
    const channel = meta.channel || "unknown";
    const contentScore = Math.round(accuracy * 0.7 + fluency * 0.3);
    let pronScore = phonemes ? Math.max(0, 100 - phonemes.per) : null;
    if (channel === "manual" || channel === "acoustic-unavailable") pronScore = null;
    const scoredTotal = pronScore == null ? contentScore : Math.round(contentScore * 0.6 + pronScore * 0.4);
    const confidence = channel === "acoustic" ? "高 · 声学评估"
      : channel === "whisper" ? "中高 · 后端转写"
      : channel === "browser" ? "中 · 浏览器识别"
      : channel === "manual" ? "低 · 手动文本" : "中 · 未标注通道";

    return {
      accuracy, fluency, stress, intonation, total: scoredTotal, wpm,
      coverage, phonemes, contentScore, pronScore, confidence, channel,
      fillers, wpmTag, longestPauseMs,
      pronSource: pronScore == null ? "" : "text-g2p",
      grade: scoredTotal >= 85 ? "优秀" : scoredTotal >= 70 ? "良好" : scoredTotal >= 55 ? "合格" : "需加强",
      advice: speechAdvice({ accuracy, fluency, stress, intonation, coverage, wpm, pronScore, channel, fillers, wpmTag, longestPauseMs })
    };
  }

  function speechAdvice(d) {
    const tips = [];
    if (d.accuracy < 70) tips.push("单词识别率偏低，先把句中的实词逐个读准，再连读整句。");
    if (d.fluency < 70) tips.push(`语速约 ${d.wpm} 词/分钟（${d.wpmTag || "未知"}），德语自然语速约 110–140 词/分钟，建议跟读原文音频训练节奏。`);
    if (d.fillers >= 3) tips.push(`检测到 ${d.fillers} 个填充词（äh/ähm/also 等）：先想好再说，用 0.5 秒的静音代替口头禅。`);
    if (d.longestPauseMs > 2000) tips.push(`最长停顿 ${(d.longestPauseMs / 1000).toFixed(1)} 秒：按意群换气，逗号处短停即可，避免长时间空白。`);
    if (d.stress < 70) tips.push("注意德语词重音多落在第一个音节，长词尤其明显（如 Univer-si-tät）。");
    if (d.intonation < 70) tips.push("疑问句句末上扬、陈述句句末下降，AUDIOLINGUAL 影子跟读可快速改善语调。");
    if (d.pronScore != null && d.pronScore < 70) tips.push("音素序列与参考发音差距较大：先用 0.75× 速度逐词跟读，再回到原速。");
    if (d.channel === "manual") tips.push("本次为手动文本评分：只评价内容与用词，不评价你的实际发音。");
    if (!tips.length) tips.push("整体表现不错，建议把本句加入跟读库中，隔两天再录一次做对照。");
    return tips;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  /* ============ 6. 文本相似度 / 关键词命中（诊断与面试用） ============ */
  function hitRatio(text, keywords) {
    const t = (text || "").toLowerCase();
    if (!keywords.length) return 0;
    const n = keywords.filter(k => t.includes(k.toLowerCase())).length;
    return n / keywords.length;
  }

  /* ============ 7. 学习计划生成 ============ */
  /* 依据：薄弱能力项 × 每日可用时长 × 到期复习量 × 考试阶段，生成未来 N 天的日程
     考试阶段模式（对标 Prepilingo 的六模式，简化为四阶段）：
       > 60 天  基础期（Comprehensive）—— 新词为主，稳步推进
       30–60 天 强化期（Focused）—— 主攻薄弱项，加大专项权重
       7–30 天  冲刺期（Sprint）—— 复习为主，压缩新词量
       ≤ 7 天   考前突击（Final Push）—— 只复习错题与高频词，考前 briefing */
  function examPhase(examDate) {
    if (!examDate) return { key: "regular", nm: "常规模式", desc: "未设置考试日期，按均衡节奏推进" };
    const exam = new Date(examDate + "T00:00:00").getTime();
    const now = Date.now();
    if (!exam || exam <= now) return { key: "regular", nm: "常规模式", desc: "考试日期已过或未设置，按均衡节奏推进" };
    const daysLeft = Math.ceil((exam - now) / 86400000);
    if (daysLeft > 60) return { key: "comprehensive", nm: "基础期", desc: "距考 60 天以上：新词与基础技能稳步推进，不追速度", daysLeft };
    if (daysLeft > 30) return { key: "focused", nm: "强化期", desc: "距考 30–60 天：向薄弱项倾斜，专项训练权重上调", daysLeft };
    if (daysLeft > 7) return { key: "sprint", nm: "冲刺期", desc: "距考 7–30 天：以复习和错题重练为主，压缩新词量", daysLeft };
    return { key: "final", nm: "考前突击", desc: "距考 7 天以内：只过高频词与错题本，停学新内容", daysLeft };
  }

  /* 任务 ID 由「日期 + 模块 + 文案 + 分钟」派生：计划重排后旧勾选不会错绑到别的任务；
     文案和时长不变时，多次渲染与刷新仍指向同一任务。 */
  function planHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }
  function planTaskId(date, task) {
    return "p_" + planHash(date + "|" + task.mod + "|" + task.text + "|" + task.min);
  }
  /* 按权重切分每日预算，确保各项分钟之和严格等于目标（不留“30 分钟排成 46 分钟”） */
  function splitMinutes(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const out = weights.map(w => Math.max(1, Math.floor(total * w / sum)));
    let rest = total - out.reduce((a, b) => a + b, 0);
    let i = out.length - 1;
    while (rest > 0) { out[i] += 1; rest--; i = (i - 1 + out.length) % out.length; }
    return out;
  }

  function makePlan(days) {
    days = days || 28;
    const s = S();
    const weak = weakPoints().weakest.map(w => w.key);
    const daily = Math.max(10, s.profile.dailyMin || 30);
    const nameMap = { vocab: "词汇", grammar: "语法", reading: "阅读", listening: "听力", speaking: "口语", writing: "写作" };
    const phase = examPhase(s.profile.examDate);
    /* 每天已固定排一条词汇任务；薄弱项里的 vocab 再排一次就成了「一天背两次词」。
       去掉 vocab 后不足两项时，用语法 / 阅读 / 听力补齐。 */
    const focus = [...new Set([...weak.filter(k => k !== "vocab"), "grammar", "reading", "listening"])].slice(0, 2);
    const beginner = ["A1", "A2"].includes(s.profile.level);

    const slots = {
      vocab: ["新词 15 个＋复习", "例句听写 5 句"],
      grammar: ["句法纠错 8 句", "从句语序专项 5 题"],
      reading: [beginner ? "阅读理解 1 篇" : "阅读理解 1 篇（限时）", "精读划长难句 1 篇"],
      listening: ["影子跟读 1 组（10 句）", "听写填空 6 题"],
      speaking: ["跟读评分 5 句", "德语对话室 1 次（至少 3 轮对话）"],
      writing: ["主题写作 150 词", "用词典回暖错题 5 条"]
    };
    /* 每日 100% 预算：
       常规日 = 词汇 40% + 主薄弱 35% + 次薄弱 25%
       复盘日 = 词汇 40% + 主薄弱 35% + 周复盘 25%（复盘替换次薄弱）
       考前 7 天 = 词汇 25% + 主薄弱 30% + 次薄弱 20% + 考前简报 25% */
    const final = phase.key === "final";
    const weights = final ? [0.25, 0.3, 0.2, 0.25] : [0.4, 0.35, 0.25];
    const plan = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const date = (window.LD.Store && window.LD.Store.dayKey) ? window.LD.Store.dayKey(d) : d.toISOString().slice(0, 10);
      const reviewDay = !final && i % 7 === 6;
      const mins = splitMinutes(daily, weights);
      const vocabMin = mins[0];
      const vocabWords = Math.max(4, Math.round(vocabMin / 1.2));
      const tasks = [];
      const specFor = (mod, text) => {
        if (mod === "vocab") return { mode: "vocab", target: vocabWords, minAnswered: vocabWords, evidence: "词汇自评" };
        if (mod === "reading") return { mode: "reading", target: 1, minAnswered: 1, timed: /限时/.test(text), evidence: "阅读作答" };
        if (mod === "listening") {
          if (/影子跟读/.test(text)) return { mode: "shadow", target: 10, minAnswered: 10, evidence: "跟读评分" };
          if (/听写填空/.test(text)) return { mode: "dictation", target: 6, minAnswered: 6, evidence: "听写作答" };
          if (/整句听写/.test(text)) return { mode: "diktat", target: 6, minAnswered: 6, evidence: "听写作答" };
          if (/对话/.test(text)) return { mode: "dialog", target: 1, minAnswered: 1, evidence: "对话作答" };
          return { mode: "repeat", target: 5, minAnswered: 5, evidence: "复述评分" };
        }
        if (mod === "speaking") {
          if (/对话室/.test(text)) return { mode: "chat", target: 3, minAnswered: 3, evidence: "对话报告" };
          return { mode: "speech", target: 5, minAnswered: 5, evidence: "口语评分" };
        }
        if (mod === "grammar") {
          const n = /8\s*句/.test(text) ? 8 : /5\s*题/.test(text) ? 5 : 1;
          return { mode: "grammar", target: n, minAnswered: n, evidence: "语法诊断" };
        }
        if (mod === "writing") return { mode: "writing", target: 1, minAnswered: 1, evidence: "写作提交" };
        if (mod === "review") return { mode: "review", target: 1, minAnswered: 1, evidence: "复盘确认" };
        if (mod === "mockexam") return { mode: "mockexam", target: 1, minAnswered: 1, evidence: "模考记录" };
        return { mode: mod, target: 1, minAnswered: 1, evidence: "练习完成" };
      };
      const vocabTask = {
        mod: "vocab",
        text: final ? `考前复习 ${vocabWords} 个到期词（停学新词）` : `词汇练习 ${vocabWords} 张（到期优先）`,
        min: vocabMin,
        words: vocabWords,
        reviewOnly: final
      };
      vocabTask.spec = specFor("vocab", vocabTask.text);
      tasks.push(vocabTask);
      const focusCount = final ? 2 : (reviewDay ? 1 : 2);
      /* 冲刺期（距考 7–30 天）每周一次模考，替换当天的次薄弱项 */
      const mockDay = phase.key === "sprint" && !reviewDay && i % 7 === 3;
      for (let k = 0; k < focusCount; k++) {
        if (mockDay && k === 1) {
          const t = { mod: "mockexam", route: "mockexam", text: "全真模考 1 套（限时，可分节做）", min: mins[k + 1] };
          t.spec = specFor("mockexam", t.text);
          tasks.push(t);
          continue;
        }
        const f = focus[k] || focus[0];
        const pool = slots[f] || slots.vocab;
        const text = pool[i % pool.length];
        /* 口语槽里的“对话室”要落到 chat，不能一律映射到跟读评分 */
        const t = { mod: f, route: f === "speaking" && text.includes("对话室") ? "chat" : "", text, min: mins[k + 1] };
        t.spec = specFor(f, text);
        tasks.push(t);
      }
      if (final) {
        const t = { mod: "review", text: "考前 briefing：过一遍错题本与高频词，早睡不熬夜", min: mins[3] };
        t.spec = specFor("review", t.text);
        tasks.push(t);
      } else if (reviewDay) {
        const t = { mod: "review", text: "本周复盘：重做错题本中未掌握的条目", min: mins[2] };
        t.spec = specFor("review", t.text);
        tasks.push(t);
      }
      tasks.forEach(t => { t.id = planTaskId(date, t); });
      plan.push({ date, week: Math.floor(i / 7) + 1, tasks, focus: focus.map(f => nameMap[f] || f) });
    }
    return { version: 5, generatedAt: Date.now(), days, daily, phase, focus: focus.map(f => nameMap[f] || f), plan };
  }

  /* 计划单一数据源：先生成 28 天基础排期，7 / 14 / 28 天都从同一份数组切片。
     这样首页首周、计划页周期切换和跨端合并看到的是同一批任务，不会每次渲染重抽。 */
  function planBase(force) {
    const s = S();
    const sig = [s.profile.level, s.profile.dailyMin, s.profile.examDate, s.profile.exam].join("|");
    const today = (window.LD.Store && window.LD.Store.dayKey) ? window.LD.Store.dayKey() : new Date().toISOString().slice(0, 10);
    const base = s.planBase;
    const valid = base && base.version === 5 && base.sig === sig && Array.isArray(base.plan)
      && base.plan.length >= 28
      && base.plan.every(d => Array.isArray(d.tasks) && d.tasks.every(t => t && t.id && t.spec))
      && base.plan.some(d => d.date === today);
    if (!force && valid) return base;
    const p = makePlan(28);
    s.planBase = { version: 5, generatedAt: Date.now(), sig, daily: p.daily, phase: p.phase, focus: p.focus, plan: p.plan };
    if (window.LD.Store && window.LD.Store.save) window.LD.Store.save();
    return s.planBase;
  }
  function planForDays(days, force) {
    const base = planBase(force);
    const n = Math.max(1, Math.min(28, +days || 7));
    return {
      version: 5,
      generatedAt: base.generatedAt,
      days: n,
      daily: base.daily,
      phase: base.phase,
      focus: base.focus,
      plan: base.plan.slice(0, n)
    };
  }
  /* 首周缓存保留给旧页面；内容来自同一份 planBase，不再单独 makePlan(7) */
  function firstWeekPlan(force) {
    const s = S();
    const base = planBase(force);
    const fw = {
      version: 5,
      generatedAt: base.generatedAt,
      sig: base.sig,
      daily: base.daily,
      focus: base.focus,
      plan: base.plan.slice(0, 7)
    };
    const old = s.firstWeek;
    if (force || !old || old.generatedAt !== fw.generatedAt || old.sig !== fw.sig) {
      s.firstWeek = fw;
      if (window.LD.Store && window.LD.Store.save) window.LD.Store.save();
      return fw;
    }
    return old;
  }
  function todayPlan() {
    const fw = firstWeekPlan();
    const today = (window.LD.Store && window.LD.Store.dayKey) ? window.LD.Store.dayKey() : new Date().toISOString().slice(0, 10);
    return { firstWeek: fw, entry: fw.plan.find(d => d.date === today) || fw.plan[0] || null };
  }

  /* ============ 8. BKT 贝叶斯知识追踪 ============
     经典四参数模型：pInit(初始掌握概率) / pTransit(学习转移) / pSlip(会但做错) / pGuess(不会但蒙对)
     对任意知识点 k：
       P(known|correct) = P(k)(1-slip) / [P(k)(1-slip) + (1-P(k))·guess]
       P(known|wrong)   = P(k)·slip / [P(k)·slip + (1-P(k))(1-guess)]
     学习转移：P(k) ← P(k) + (1-P(k))·pTransit
     可解释输出：掌握概率、预测下次正确率、是否达到 95% 掌握阈值。 */
  const BKT = { pInit: 0.18, pTransit: 0.16, pSlip: 0.09, pGuess: 0.22 };

  function bktState(skill) {
    const s = S();
    s.bkt = s.bkt || {};
    if (s.bkt[skill] == null) s.bkt[skill] = BKT.pInit;
    return s.bkt[skill];
  }

  function bktUpdate(skill, ok) {
    const s = S();
    s.bkt = s.bkt || {};
    let p = s.bkt[skill] == null ? BKT.pInit : s.bkt[skill];
    const { pSlip, pGuess, pTransit } = BKT;
    if (ok) {
      const num = p * (1 - pSlip);
      p = num / (num + (1 - p) * pGuess);
    } else {
      const num = p * pSlip;
      p = num / (num + (1 - p) * (1 - pGuess));
    }
    p = p + (1 - p) * pTransit;              // 学习转移
    s.bkt[skill] = Math.min(0.995, Math.max(0.01, p));
    (s.bktN = s.bktN || {})[skill] = (s.bktN[skill] || 0) + 1;
    window.LD.Store.save();
    return s.bkt[skill];
  }

  /* 预测该知识点下一次作答正确的概率 */
  function bktPredict(skill) {
    const p = bktState(skill);
    return Math.round((p * (1 - BKT.pSlip) + (1 - p) * BKT.pGuess) * 100);
  }

  /* 全库掌握度分布：用于学情页与首页总览 */
  function masterySummary() {
    const s = S();
    const bkt = s.bkt || {};
    const keys = Object.keys(bkt);
    if (!keys.length) return { n: 0, avg: 0, mastered: 0, bands: [0, 0, 0, 0, 0] };
    const bands = [0, 0, 0, 0, 0];     // 0-20 / 20-40 / 40-60 / 60-80 / 80-100
    let sum = 0, mastered = 0;
    keys.forEach(k => {
      const v = bkt[k];
      sum += v;
      if (v >= 0.95) mastered++;
      bands[Math.min(4, Math.floor(v * 5))]++;
    });
    return { n: keys.length, avg: Math.round(sum / keys.length * 100), mastered, bands };
  }

  /* ============ 9. 考试倒排调度 fitToExam ============
     借鉴 spaced-repetition-lite：设考试日为 D，若某词条的下次复习晚于 D，
     则把复习日期压缩到 D 之前，并随 D 临近缩短间隔；考试前一天安排「最后一遍」。
     对留德场景（TestDaF/DSH 有明确考期）是真正有用的差异化能力。 */
  function fitToExam(dueTs, examDate) {
    if (!examDate) return { due: dueTs, adjusted: false };
    const exam = new Date(examDate + "T00:00:00").getTime();
    const now = Date.now();
    if (!exam || exam <= now) return { due: dueTs, adjusted: false };
    const day = 86400000;
    const daysLeft = Math.ceil((exam - now) / day);
    // 该词条复习间隔
    let iv = Math.max(1, Math.round((dueTs - now) / day));
    if (dueTs <= exam) return { due: dueTs, adjusted: false, daysLeft };
    // 压缩：保证考试前至少再见 1 次，临近时缩短
    let target;
    if (daysLeft <= 3) target = exam - day;                            // 考前一天最后一遍
    else if (daysLeft <= 10) target = now + Math.min(iv, Math.floor(daysLeft / 2)) * day;
    else target = now + Math.min(iv, daysLeft - 3) * day;
    return { due: Math.min(exam - day, Math.max(now + day, target)), adjusted: true, daysLeft, compressed: Math.round(iv * 1) };
  }

  /* 考试模式下的今日队列：到期 + 被倒排压缩进来的词条 */
  function examQueue(size, examDate) {
    const s = S();
    const list = Object.keys(s.cards).map(w => {
      const c = s.cards[w];
      const fit = fitToExam(c.due || Date.now(), examDate);
      return { w, due: fit.due, adjusted: fit.adjusted };
    }).filter(x => x.due <= Date.now() + 86400000)
      .sort((a, b) => a.due - b.due);
    return list.slice(0, size || 30);
  }

  /* ============ 10. 算法沙盘：可复现的调度算法对比模拟 ============
     用同一个确定性虚拟学生（seeded PRNG，同参数结果完全可复现）同时驱动四套调度器：
       - HLR 半衰期模型（本项目，复现 Duolingo Settles & Meeder, ACL 2016）
       - SM-2（SuperMemo 1987 原始规则：I(1)=1, I(2)=6, I(n)=I(n-1)×EF，EF∈[1.3,2.5]，q<3 重置）
       - Leitner 五盒系统（1972：间隔 1/2/4/8/16 天，答错降回第一盒）
       - DSR 三参数（自研简化，思路同 FSRS；稳定性 S / 难度 D，无难度均值回归，参数为经验值）
     每个词条有隐藏的「词质 h_true」（决定其记忆可达上限与初始稳定性），
     调度器只能按自己的规则决定何时复习；复习成功概率由真实记忆动力学
     p = 2^(-Δ/s) 决定（s 随成功复习增强、随失败衰减）。
     输出：总复习量 / 平均记忆保持率 / 遗忘事故率 / 峰值日负担 / 积压放弃。 */

  /* DSR 间隔：由稳定性 S 与目标保持率 R 反推下次复习天数（R=0.9 ⇒ S；R 高 ⇒ 更密） */
  function fsrsInterval(s, r) {
    const R = clamp(r || FSRS_DESIRED_R, 0.5, 0.99);
    return Math.max(0.5, s / FSRS_FACTOR * (Math.pow(R, 1 / FSRS_DECAY) - 1));
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const LEITNER_INTERVAL = [1, 2, 4, 8, 16];   // Leitner 五盒复习间隔（天）
  const HLR_DUE_AT = 0.9;                       // 回忆概率降到 90% 即触发复习
  const FSRS_DESIRED_R = 0.9;                   // DSR 默认目标保持率（此设定下间隔 ≈ 稳定性 S）
  /* DSR 间隔公式（沿用 FSRS 论文形式，自研简化实现）：interval = S / FACTOR × (R^(1/DECAY) − 1)
     FACTOR = 0.9^(1/DECAY) − 1；DECAY = −0.5（FSRS-4.5 遗忘曲线形状）
     性质：R=0.9 时 interval = S；R 越高间隔越短（复习越密），R 越低间隔越长。 */
  const FSRS_DECAY = -0.5;
  const FSRS_FACTOR = Math.pow(0.9, 1 / FSRS_DECAY) - 1;
  const SCHED = ["hlr", "sm2", "leitner", "fsrs"];   // 沙盘对比的调度器集合
  const SCHED_NM = { hlr: "HLR 半衰期模型", sm2: "SM-2", leitner: "Leitner 五盒", fsrs: "DSR 调度器（简化）" };
  const RET_KEY = { hlr: "retHlr", sm2: "retSm2", leitner: "retLeitner", fsrs: "retFsrs" };

  function sandboxSim(opts) {
    opts = opts || {};
    const seed = opts.seed == null ? 42 : opts.seed;
    const days = Math.max(10, opts.days || 60);
    const newPerDay = Math.max(1, opts.newPerDay || 5);
    const n = Math.max(10, opts.n || 100);
    const cap = opts.cap || 40;                 // 每日复习量上限（真实用户每日承受能力）
    const speed = opts.speed || "mid";          // fast / mid / slow：虚拟学生遗忘速度
    const retention = clamp(opts.retention || FSRS_DESIRED_R, 0.7, 0.97);  // 沙盘 DSR 目标保持率
    const rng = mulberry32(seed);
    const expSample = mean => -Math.log(1 - rng()) * mean;
    const H = speed === "fast" ? { base: 1.2, scale: 2.2 }
      : speed === "slow" ? { base: 3.5, scale: 11 }
        : { base: 2.0, scale: 5.5 };

    // 词条：隐藏词质 h_true → 初始稳定性与可达上限
    const words = [];
    for (let i = 0; i < n; i++) {
      const hTrue = H.base + expSample(H.scale);
      words.push({ id: i, hTrue, s0: hTrue * 0.4, sCap: hTrue * 6, introduced: Math.floor(i / newPerDay) });
    }

    const mkWorld = () => ({
      st: words.map(w => ({ s: w.s0, last: -1, n: 0, ef: 2.5, iv: 0, reps: 0, box: 0, d: 5 })),
      total: 0, peak: 0, backlog: 0, recallSum: 0, reviewN: 0, lapses: 0, retentionSum: 0, retentionN: 0
    });
    const worlds = { hlr: mkWorld(), sm2: mkWorld(), leitner: mkWorld(), fsrs: mkWorld() };
    const series = [];
    const retToday = { hlr: 0, sm2: 0, leitner: 0 };

    for (let day = 0; day < days; day++) {
      const dayN = { day: day + 1, hlr: 0, sm2: 0, leitner: 0, fsrs: 0, retHlr: 0, retSm2: 0, retLeitner: 0, retFsrs: 0 };
      SCHED.forEach(key => {
        const wd = worlds[key];
        const due = [];
        for (let i = 0; i < words.length; i++) {
          const w = words[i], st = wd.st[i];
          if (w.introduced > day) continue;
          if (st.last < 0) { if (w.introduced <= day) due.push({ i, pri: 0 }); continue; }
          const delta = day - st.last;
          if (key === "hlr") {
            // 回忆概率降到阈值以下才复习：Δ >= s·log2(1/0.9)
            if (delta >= st.s * Math.log2(1 / HLR_DUE_AT)) due.push({ i, pri: -delta / st.s });
          } else if (key === "sm2") {
            if (delta >= sm2Iv(st)) due.push({ i, pri: -delta / Math.max(1, sm2Iv(st)) });
          } else if (key === "leitner") {
            if (delta >= LEITNER_INTERVAL[st.box]) due.push({ i, pri: st.box });
          } else {
            /* DSR：按「目标保持率」反推下次复习间隔（FSRS 论文公式形式），而非固定 0.9 */
            const iv = fsrsInterval(st.s, retention);
            if (delta >= iv) due.push({ i, pri: -delta / iv });
          }
        }
        due.sort((a, b) => a.pri - b.pri);       // 最紧急的优先（Leitner 即低盒优先）
        const today = due.slice(0, cap);
        wd.backlog += Math.max(0, due.length - cap);
        today.forEach(({ i }) => {
          const w = words[i], st = wd.st[i];
          const delta = Math.max(0, day - st.last);
          const p = st.last < 0 ? 1 : Math.pow(2, -delta / st.s);
          const ok = rng() < p;
          if (ok) st.s = Math.min(st.s * (st.n <= 1 ? HLR.growOk : HLR.growLate), w.sCap);
          else st.s = Math.max(HLR.minH, st.s * HLR.dropWrong);
          st.n += 1; st.last = day;
          /* 各调度器按自己的规则更新内部状态 */
          if (key === "sm2") {
            const q = ok ? 4 : 2;                                   // 二值结果映射 SM-2 的 0–5 评分
            st.reps = q < 3 ? 0 : st.reps + 1;
            st.ef = Math.max(1.3, Math.min(2.5, st.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))));
            st.iv = st.reps === 0 ? 1 : st.reps === 1 ? 6 : Math.max(1, st.iv * st.ef);
          } else if (key === "leitner") {
            st.box = ok ? Math.min(4, st.box + 1) : 0;              // 答错降回第一盒
          } else if (key === "fsrs") {
            // DSR 三参数（自研简化，非真 FSRS）：稳定性 S、难度 D(1–10)
            const r = Math.pow(2, -delta / st.s);                  // 复习时刻的回忆概率
            if (ok) {
              const dFac = (11 - st.d) / 10;                       // 难度越低，稳定性增益越大
              st.s = Math.min(w.sCap, st.s * (1 + 0.7 * dFac * (1 - r) + 0.25));
              st.d = Math.max(1, st.d - 0.2);
            } else {
              st.s = Math.max(0.5, st.s * 0.4);                    // 遗忘 → 稳定性大幅回落
              st.d = Math.min(10, st.d + 0.9);
            }
          }
          wd.total += 1; wd.reviewN += 1; wd.recallSum += p;
          if (p < 0.5) wd.lapses += 1;           // 复习时真实回忆概率已不足一半 = 遗忘事故
        });
        wd.peak = Math.max(wd.peak, today.length);
        dayN[key] = today.length;
        // 当日全库平均真实保持率
        let sum = 0, cnt = 0;
        for (let i = 0; i < words.length; i++) {
          const w = words[i], st = wd.st[i];
          if (w.introduced > day) continue;
          const delta = Math.max(0, day - st.last);
          sum += st.last < 0 ? 0 : Math.pow(2, -delta / st.s);
          cnt += 1;
        }
        const ret = cnt ? Math.round(sum / cnt * 100) : 0;
        wd.retentionSum += cnt ? sum / cnt : 0;
        wd.retentionN += 1;
        dayN[RET_KEY[key]] = ret;
      });
      series.push(dayN);
    }

    const out = {};
    SCHED.forEach(key => {
      const w = worlds[key];
      out[key] = {
        total: w.total,
        avgDaily: +(w.total / days).toFixed(1),
        peak: w.peak,
        backlog: w.backlog,
        lapses: w.lapses,
        lapseRate: w.reviewN ? Math.round(w.lapses / w.reviewN * 100) : 0,
        avgRecall: w.reviewN ? Math.round(w.recallSum / w.reviewN * 100) : 0,
        avgRetention: w.retentionN ? Math.round(w.retentionSum / w.retentionN * 100) : 0
      };
    });
    return { cfg: { seed, days, newPerDay, n, cap, speed, retention }, worlds: out, series };
  }

  /* SM-2 当前间隔（内部状态：iv 天 / ef / reps） */
  function sm2Iv(st) {
    if (st.reps === 0) return 1;
    if (st.reps === 1) return 6;
    return Math.max(1, st.iv * st.ef);
  }

  /* 沙盘结论：基于实测数字自动生成，不写死结论 */
  function sandboxVerdict(sim) {
    const w = sim.worlds, keys = SCHED;
    const names = SCHED_NM;
    const minTotal = Math.min.apply(null, keys.map(x => w[x].total));
    const maxRet = Math.max.apply(null, keys.map(x => w[x].avgRetention));
    const minLapse = Math.min.apply(null, keys.map(x => w[x].lapseRate));
    const lines = [];
    keys.forEach(k => {
      const tags = [];
      if (w[k].total === minTotal) tags.push("总复习量最少");
      if (w[k].avgRetention === maxRet) tags.push("平均保持率最高");
      if (w[k].lapseRate === minLapse) tags.push("遗忘事故率最低");
      lines.push({ k, nm: names[k], tags });
    });
    const best = lines.find(l => l.tags.length >= 2) || lines[0];
    const detail = keys.map(k =>
      `${names[k]}：复习 ${w[k].total} 次 · 保持率 ${w[k].avgRetention}% · 遗忘事故 ${w[k].lapseRate}%`).join("；");
    return {
      headline: `本组参数下 ${best.nm} 综合表现最优`,
      detail,
      note: "对比结论随「学生遗忘速度 / 每日新词量 / 模拟时长」参数变化——这正是固定间隔算法（Leitner）与经验公式（SM-2）难以自适应不同学习者的原因。Duolingo 在 1300 万词条上验证：HLR 类模型较固定规则预测误差降低 45% 以上（Settles & Meeder, ACL 2016）；Anki FSRS 的公开 benchmark 亦显示较 SM-2 可再省 20–30% 复习量。"
    };
  }

  window.LD.Engine = {
    rate, getCard, dueList, buildQueue, entryOf, nextDifficulty,
    dailyBudget, backlogStats, deferDue, mergedDue,
    weakPoints, radarData, scoreSpeech, hitRatio, makePlan, planBase, planForDays, firstWeekPlan, todayPlan, planTaskId, LEVELS,
    bktUpdate, bktState, bktPredict, masterySummary, fitToExam, examQueue, BKT,
    examPhase, hlrUpdate, hlrState, hlrRecall, hlrDueList, hlrBand, HLR, orphanDue, lexSet,
    sandboxSim, sandboxVerdict, mulberry32, fsrsInterval, FSRS_DECAY, FSRS_FACTOR,
    /* B2 FSRS 调度查询（7 粒度统一入口；word 已由 rate 自动维护） */
    fsrsCard: (id, kind) => (S().fsrs || {})[id] || (window.LD.Srs ? window.LD.Srs.initCard(kind || "word") : null),
    fsrsDue: kind => {
      const Srs = window.LD && window.LD.Srs;
      if (!Srs) return [];
      const s = S();
      return Object.keys(s.fsrs || {})
        .filter(id => s.fsrs[id] && (!kind || s.fsrs[id].kind === kind) && (s.fsrs[id].due || 0) <= Date.now())
        .sort((a, b) => (s.fsrs[a].due || 0) - (s.fsrs[b].due || 0));
    },
    fsrsRecall: id => {
      const Srs = window.LD && window.LD.Srs;
      return Srs ? Srs.cardRecall((S().fsrs || {})[id], Date.now()) : 0;
    },
    registerNote: (id, kind, ref) => {
      const s = S();
      s.notes = s.notes || {};
      if (!s.notes[id]) s.notes[id] = { kind: kind || "word", ref: ref || id, createdAt: Date.now() };
      s.fsrs = s.fsrs || {};
      if (!s.fsrs[id]) {
        const Srs = window.LD && window.LD.Srs;
        s.fsrs[id] = Srs ? Srs.initCard(kind || "word") : { kind: kind || "word", stability: 0, difficulty: 0, reps: 0, lapses: 0, last: 0, due: 0 };
      }
      window.LD.Store.save();
      return s.fsrs[id];
    },
    /* 全站唯一的「待复习」口径：FSRS 到期（主）∪ HLR 濒危（迁移兜底）∪ SM-2 到期（只读兼容） */
    dueCount: () => mergedDue().length
  };
})();
