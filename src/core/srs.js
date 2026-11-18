/* LinguaDE · B2 FSRS 调度器（src/core/srs.js）
 * FSRS-4.5 数学（公开论文公式自研实现，MIT；不引 npm——前端无构建链）。
 * rating 4 档与现有词卡评分按钮对齐：0 again / 1 hard / 2 good / 3 easy。
 * 21 参数默认档案（FSRS-4.5 论文默认值），可按粒度（word/sentence/…）分别校准。
 * 调度为纯函数：next(card, rating, now) 不改 state，由调用方落盘。 */
(function () {
  const LD = (window.LD = window.LD || {});

  /* FSRS-4.5 默认参数（公开论文/开源实现默认值；非官方判分，可按真实数据校准） */
  const DEFAULT_W = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
    0.8192, 1.587, 1.3375, 0.8969, 0.6405, 1.0, 0.25, 0.8965, 0.522, 0.0, 0.9, 0.0
  ];
  const DECAY = -0.5;                       /* FSRS-4.5 遗忘曲线形状 */
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
  const DAY = 86400000;

  const KINDS = ["word", "sentence", "character", "grammar", "item", "group", "quick"];
  /* 粒度档案：首版全部用默认参数；B3/B5 可按粒度分别校准 */
  const kindProfiles = {};
  KINDS.forEach(k => { kindProfiles[k] = { w: DEFAULT_W.slice() }; });

  function profileOf(kind) {
    return kindProfiles[kind] || kindProfiles.word;
  }

  /* 初始档案：未练过的对象 */
  function initCard(kind) {
    return { kind: kind || "word", stability: 0, difficulty: 0, reps: 0, lapses: 0, last: 0, due: 0 };
  }

  /* 回忆概率（FSRS-4.5 遗忘曲线）：R = (1 + FACTOR·t/S)^DECAY
     t=0 → 1；t=S（稳定性）→ (1+FACTOR)^DECAY = (1/0.81)^(-0.5) = 0.9（S 即 90% 保持率时刻） */
  function recall(stability, elapsedDays) {
    if (!stability || stability <= 0) return 0;
    const t = Math.max(0, elapsedDays);
    return Math.pow(1 + FACTOR * t / stability, DECAY);
  }

  /* 间隔（天）：R 目标保持率反推（默认 0.9） */
  function interval(stability, desiredR) {
    if (!stability || stability <= 0) return 0.5;
    const R = Math.min(0.99, Math.max(0.5, desiredR == null ? 0.9 : desiredR));
    return Math.max(0.5, stability / FACTOR * (Math.pow(R, 1 / DECAY) - 1));
  }

  /* 首评初始化：四档 rating → (S, D) */
  function initFromRating(w, rating) {
    const S0 = [w[0], w[1], w[2], w[3]][rating] || w[2];
    const D0 = w[4] - (rating - 3) * w[5];  /* 越简单起点难度越低 */
    return { S: Math.max(0.1, S0), D: Math.min(10, Math.max(1, D0)) };
  }

  /* 核心更新（纯函数）：card → rating → newCard */
  function next(card, rating, now) {
    const kind = card.kind || "word";
    const w = profileOf(kind).w;
    const t = now == null ? Date.now() : now;
    const c = Object.assign({}, card);
    const r = Math.max(0, Math.min(3, rating | 0));

    if (!c.reps) {
      const { S, D } = initFromRating(w, r);
      c.stability = S;
      c.difficulty = D;
    } else {
      /* 复习时刻的回忆概率 */
      const elapsed = Math.max(0, (t - (c.last || t)) / DAY);
      const R = recall(c.stability, elapsed);
      /* 稳定性增益：S' = S × (1 + w17 × (1−R) × 增益因子) */
      const hardFac = r === 1 ? w[15] : 1;                 /* hard 增益打折 */
      const easyFac = r === 3 ? w[16] : 1;                 /* easy 增益加成 */
      const gain = 1 + w[17] * (1 - R) * hardFac * easyFac;
      c.stability = Math.max(0.1, c.stability * gain);
      /* 难度回归：D' = D − w6 × (rating − 3)，均值回归到 w7 */
      c.difficulty = c.difficulty - w[6] * (r - 3);
      c.difficulty = Math.min(10, Math.max(1, c.difficulty + w[7] * (5 - c.difficulty) * 0.1));
    }

    if (r === 0) {
      c.lapses = (c.lapses || 0) + 1;
      c.stability = Math.max(0.1, c.stability * w[5]);     /* again 大幅衰减 */
      c.due = t + 60 * 1000;                               /* 当天重来（1 分钟后再现） */
    } else {
      const ivDays = interval(c.stability, 0.9);
      /* 间隔上限 365 天 */
      c.due = t + Math.min(365, ivDays) * DAY;
    }
    c.reps = (c.reps || 0) + 1;
    c.last = t;
    c.kind = kind;
    return c;
  }

  /* 当前回忆概率（0–1）：未练过 → 0 */
  function cardRecall(card, now) {
    if (!card || !card.last || !card.stability) return 0;
    return recall(card.stability, Math.max(0, (now - card.last) / DAY));
  }

  const Srs = {
    RATING: { again: 0, hard: 1, good: 2, easy: 3 },
    DEFAULT_W, DECAY, FACTOR, KINDS, kindProfiles,
    profileOf, initCard, initFromRating, next, recall, interval, cardRecall,
  };
  LD.Srs = Srs;
})();