/* LinguaDE · C2 阶段成效报告（src/core/report.js）
 * 指标全部取自已落盘数据（log / daily / fsrs / bkt / wrong / placement / profile），不新增采集。
 * 口径 report-v1：掌握词 = FSRS 稳定性 ≥ 21 天；初步掌握 = ≥ 7 天；正确率基于最近 4000 条作答。
 * 对比基线：profile.lastReport 存上一次生成的紧凑快照；首次报告不给对比，明说「本次为基线」。
 * 顶部固定声明：过程数据，非考试分数；参数为默认档案，待真实数据校准。 */
(function () {
  const LD = (window.LD = window.LD || {});

  const VERSION = 1;
  const WORD_MASTER_DAYS = 21;   /* 稳定性 ≥ 21 天 ≈ 3 周内不忘 */
  const WORD_SEEN_DAYS = 7;      /* 初步掌握 */
  const LOG_WINDOW = 4000;       /* log 超限自动裁剪后的分析窗口 */
  const DAY = 86400000;

  /* ---------- 工具 ---------- */
  function dayKeyOf(d) {
    const S = window.LD.Store;
    return S && S.dayKey ? S.dayKey(d) : d.toISOString().slice(0, 10);
  }
  function daysAgoKey(n) {
    const d = new Date(Date.now() - n * DAY);
    d.setHours(0, 0, 0, 0);
    return dayKeyOf(d);
  }
  function fmtInt(n) { return Number(n || 0).toLocaleString("zh-CN"); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function sign(n) { return (n > 0 ? "+" : "") + n; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- 采集（只读） ---------- */
  function collect() {
    const s = window.LD.Store.s;
    const E = window.LD.Engine;
    const daily = s.daily || {};
    const days = Object.keys(daily).filter(k => (daily[k] || 0) > 0);
    const minTotal = days.reduce((a, k) => a + (daily[k] || 0), 0);
    const sumWin = n => {
      let t = 0;
      for (let i = 0; i < n; i++) t += daily[daysAgoKey(i)] || 0;
      return t;
    };

    const log = (s.log || []).slice(-LOG_WINDOW);
    const inWin = (r, from, to) => {   /* [from, to] 天前，0 = 今天 */
      const k = dayKeyOf(new Date(r.t || 0));
      for (let i = from; i <= to; i++) if (k === daysAgoKey(i)) return true;
      return false;
    };
    const accOf = list => ({ n: list.length, ok: list.filter(r => r.ok).length });
    const accAll = accOf(log);
    const acc7 = accOf(log.filter(r => inWin(r, 0, 6)));
    const accPrev7 = accOf(log.filter(r => inWin(r, 7, 13)));

    const fsrs = s.fsrs || {};
    let built = 0, seen = 0, mastered = 0;
    Object.keys(fsrs).forEach(id => {
      const c = fsrs[id];
      if (!c || c.kind !== "word") return;
      built++;
      if ((c.stability || 0) >= WORD_SEEN_DAYS) seen++;
      if ((c.stability || 0) >= WORD_MASTER_DAYS) mastered++;
    });

    const m = E && E.masterySummary ? E.masterySummary() : { n: 0, avg: 0, mastered: 0 };
    const wrong = s.wrong || [];
    const pl = s.profile.placement || null;
    const Store = window.LD.Store;

    return {
      v: VERSION,
      at: Date.now(),
      daysUsed: days.length,
      firstDay: s.profile.createdAt ? dayKeyOf(new Date(s.profile.createdAt)) : "",
      streak: Store && Store.streak ? Store.streak() : 0,
      bestStreak: s.bestStreak || 0,
      minTotal, min7: sumWin(7), min28: sumWin(28),
      answers: { all: accAll.n, ok: accAll.ok, n7: acc7.n, ok7: acc7.ok, nPrev7: accPrev7.n, okPrev7: accPrev7.ok },
      vocab: { built, seen, mastered, due: E && E.dueCount ? E.dueCount() : 0 },
      bkt: { n: m.n, avg: m.avg, mastered: m.mastered },
      wrong: { total: wrong.length, mastered: wrong.filter(w => w && w.mastered).length },
      placement: pl ? { level: pl.level, vocabEst: pl.vocabEst, range: pl.vocabRange, at: pl.at } : null
    };
  }

  /* ---------- 与上次报告的对比（逐项，只有上次存在的项才有 Δ） ---------- */
  const DELTA_KEYS = [
    ["daysUsed", "学习天数", "天"],
    ["minTotal", "累计时长", "分钟"],
    ["answers.ok", "累计答对", "题"],
    ["vocab.mastered", "掌握词", "词"],
    ["vocab.seen", "初步掌握词", "词"],
    ["bkt.mastered", "掌握知识点", "个"],
    ["wrong.mastered", "错题已掌握", "条"]
  ];
  function getIn(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function deltas(snap, prev) {
    if (!prev) return [];
    return DELTA_KEYS.map(([path, label, unit]) => {
      const cur = getIn(snap, path), old = getIn(prev, path);
      if (typeof cur !== "number" || typeof old !== "number") return null;
      return { label, unit, diff: cur - old, cur, old };
    }).filter(Boolean);
  }

  /* ---------- Markdown ---------- */
  function toMarkdown(snap, prev) {
    const d = new Date(snap.at);
    const date = d.toISOString().slice(0, 10);
    const L = [];
    L.push("# LinguaDE 学习报告 · " + date);
    L.push("");
    L.push("> 过程数据，非考试分数；调度参数为默认档案，待真实数据校准。");
    L.push("> 口径（report-v1）：「掌握词」= FSRS 稳定性 ≥ " + WORD_MASTER_DAYS + " 天；「初步掌握」= ≥ " + WORD_SEEN_DAYS +
      " 天；正确率基于最近 " + LOG_WINDOW + " 条作答记录；时长来自每日学习记录（分钟）。");
    L.push("");
    L.push("## 总览");
    L.push("- 学习天数：" + fmtInt(snap.daysUsed) + " 天（首次使用：" + (snap.firstDay || "未知") + "）");
    L.push("- 连续学习：" + fmtInt(snap.streak) + " 天（历史最长 " + fmtInt(snap.bestStreak) + " 天）");
    L.push("- 累计时长：" + fmtInt(snap.minTotal) + " 分钟（近 7 天 " + fmtInt(snap.min7) + " / 近 28 天 " + fmtInt(snap.min28) + "）");
    L.push("");
    L.push("## 词汇");
    L.push("- FSRS 建卡：" + fmtInt(snap.vocab.built) + " 词");
    L.push("- 初步掌握（≥" + WORD_SEEN_DAYS + " 天）：" + fmtInt(snap.vocab.seen) + " 词");
    L.push("- 掌握（≥" + WORD_MASTER_DAYS + " 天）：" + fmtInt(snap.vocab.mastered) + " 词");
    L.push("- 当前到期待复习：" + fmtInt(snap.vocab.due) + " 词");
    L.push(snap.placement
      ? "- 分级测评（" + new Date(snap.placement.at).toISOString().slice(0, 10) + "）：参考级别 " + snap.placement.level +
        " · 词汇量估算约 " + fmtInt(snap.placement.vocabEst) + "（区间 " + fmtInt(snap.placement.range[0]) + "–" + fmtInt(snap.placement.range[1]) + "）"
      : "- 分级测评：未测（学情分析页可发起，给参考级别与词汇量估算）");
    L.push("");
    L.push("## 作答与正确率");
    const accAll = pct(snap.answers.ok, snap.answers.all);
    const acc7 = pct(snap.answers.ok7, snap.answers.n7);
    const accPrev = pct(snap.answers.okPrev7, snap.answers.nPrev7);
    L.push("- 累计作答：" + fmtInt(snap.answers.all) + " 题，正确率 " + accAll + "%");
    L.push(snap.answers.n7
      ? "- 近 7 天：" + fmtInt(snap.answers.n7) + " 题，正确率 " + acc7 + "%（前 7 天 " + accPrev + "%，" +
        (snap.answers.nPrev7 ? "趋势 " + sign(acc7 - accPrev) + " 个百分点" : "前 7 天无作答") + "）"
      : "- 近 7 天：无作答记录");
    L.push("");
    L.push("## 知识点与错题");
    L.push(snap.bkt.n
      ? "- 知识点：" + fmtInt(snap.bkt.n) + " 个，平均掌握概率 " + snap.bkt.avg + "%，已达 95% 阈值 " + fmtInt(snap.bkt.mastered) + " 个"
      : "- 知识点：暂无记录（句法纠错等模块会产生知识点）");
    L.push("- 错题本：" + fmtInt(snap.wrong.total) + " 条（已标记掌握 " + fmtInt(snap.wrong.mastered) + " 条）");
    L.push("");
    const dl = deltas(snap, prev);
    L.push("## 对比基线");
    if (dl.length) {
      L.push("- 较上次报告（" + new Date(prev.at).toISOString().slice(0, 10) + "）：");
      dl.forEach(x => L.push("  - " + x.label + "：" + fmtInt(x.old) + " → " + fmtInt(x.cur) + "（" + sign(x.diff) + " " + x.unit + "）"));
    } else {
      L.push("- 首次报告：本次数值将作为下次的对比基线（生成时间 " + date + "）。");
    }
    L.push("");
    return L.join("\n");
  }

  /* ---------- 生成并存档（唯一带副作用的入口） ---------- */
  /* 快照本身就是一小组数字，原样存档即可让 DELTA_KEYS 的路径对 prev 同样成立 */
  function buildAndStore() {
    const s = window.LD.Store.s;
    const snap = collect();
    const prev = s.profile.lastReport || null;
    const md = toMarkdown(snap, prev);
    s.profile.lastReport = {
      v: VERSION, at: snap.at,
      daysUsed: snap.daysUsed, firstDay: snap.firstDay,
      streak: snap.streak, bestStreak: snap.bestStreak,
      minTotal: snap.minTotal, min7: snap.min7, min28: snap.min28,
      answers: snap.answers,
      vocab: snap.vocab,
      bkt: snap.bkt,
      wrong: snap.wrong,
      placement: snap.placement
    };
    window.LD.Store.save();
    return { snap, prev, md };
  }

  LD.Report = {
    VERSION, WORD_MASTER_DAYS, WORD_SEEN_DAYS, LOG_WINDOW, DELTA_KEYS,
    collect, deltas, toMarkdown, buildAndStore, esc, fmtInt, pct
  };
})();