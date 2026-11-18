/* LinguaDE · 学习路径状态
   9 个单元的任务全部映射到现有模块的作答流水；检查点从现有词库抽题。
   解锁规则：检查点达到 pass 分才解锁下一单元。CEFR 仅为内容分级参考，不是认证。 */
(function () {
  const LD = (window.LD = window.LD || {});
  const S = () => LD.Store.s;
  const PASS = 70;

  const units = () => window.LD_PATH || [];
  const unitOf = id => units().find(u => u.id === id) || null;

  function isPassed(id) {
    const u = unitOf(id);
    const rec = (S().path || {})[id];
    const pass = u && u.checkpoint ? (u.checkpoint.pass || PASS) : PASS;
    return !!(rec && rec.score >= pass);
  }

  function unlocked(index) {
    if (index <= 0) return true;
    const prev = units()[index - 1];
    return !!prev && isPassed(prev.id);
  }

  function countTask(task) {
    const s = S();
    const logs = s.log || [];
    if (!task) return 0;
    if (task.type === "interview") return (s.interviews || []).length;
    if (task.type === "mockexam") return (s.mockexams || []).length;
    if (task.type === "vocab" && task.level) {
      return logs.filter(l => l.type === "vocab" && l.level === task.level).length;
    }
    if (task.type === "speaking") return logs.filter(l => l.ability === "speaking").length;
    return logs.filter(l => l.type === task.type).length;
  }

  function taskState(unit) {
    return (unit.tasks || []).map(t => {
      const n = Math.min(t.target || 1, countTask(t));
      return Object.assign({}, t, { n, done: n >= (t.target || 1) });
    });
  }

  function unitProgress(unit, index) {
    const tasks = taskState(unit);
    const done = tasks.filter(t => t.done).length;
    return {
      tasks, done, total: tasks.length,
      pct: tasks.length ? Math.round(done / tasks.length * 100) : 0,
      passed: isPassed(unit.id),
      unlocked: index == null ? true : unlocked(index)
    };
  }

  function currentIndex() {
    const us = units();
    let i = us.findIndex((u, idx) => unlocked(idx) && !isPassed(u.id));
    if (i < 0) i = Math.max(0, us.length - 1);
    return i;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* 检查点：从同级别词库抽 10 个词，正确中文 + 两个干扰项 */
  function checkpointQuestions(unit, n) {
    const level = unit && unit.checkpoint ? unit.checkpoint.level : "A1";
    const all = (window.LD_LEX || []).filter(r => r && r[0] && r[2]);
    let pool = all.filter(r => r[4] === level);
    if (pool.length < 4) pool = all.slice();
    const count = n || (unit.checkpoint && unit.checkpoint.count) || 10;
    const picked = shuffle(pool.slice()).slice(0, count);
    return picked.map(row => {
      const correct = row[2];
      const distractorPool = all
        .filter(r => r[2] && r[2] !== correct)
        .map(r => r[2]);
      const uniq = [...new Set(distractorPool)];
      shuffle(uniq);
      const opts = shuffle([correct].concat(uniq.slice(0, 2)));
      return { de: row[0], art: row[1] || "", opts, a: opts.indexOf(correct) };
    });
  }

  function score(unit, questions, answers) {
    if (!questions || !questions.length) return 0;
    let ok = 0;
    questions.forEach((q, i) => { if (answers[i] === q.a) ok++; });
    return Math.round(ok / questions.length * 100);
  }

  function saveResult(id, sc) {
    const s = S();
    s.path = s.path || {};
    s.path[id] = { score: sc, t: Date.now() };
    LD.Store.save();
    return isPassed(id);
  }

  function status() {
    const us = units();
    const passed = us.filter(u => isPassed(u.id)).length;
    return {
      units: us, passed, total: us.length,
      pct: us.length ? Math.round(passed / us.length * 100) : 0,
      currentIdx: currentIndex()
    };
  }

  /* 本单元词表：优先关键词命中，其次同等级人工词条（有例句优先） */
  function unitWords(unit, n) {
    n = n || 10;
    const all = (window.LD_LEX || []).filter(r => r && r[0] && r[2]);
    const picked = [], seen = new Set();
    const names = window.LD_LEX_NAME_WORDS || new Set();
    (unit.keywords || []).forEach(k => {
      const hit = all.find(r => r[0].toLowerCase() === String(k).toLowerCase());
      if (hit && !seen.has(hit[0].toLowerCase()) && !names.has(hit[0].toLowerCase())) {
        seen.add(hit[0].toLowerCase());
        picked.push(hit);
      }
    });
    if (picked.length < n) {
      const machine = window.LD_LEX_MACHINE || new Set();
      const pool = all.filter(r => r[4] === unit.level && !seen.has(r[0].toLowerCase())
        && !machine.has(r[0].toLowerCase()) && !names.has(r[0].toLowerCase()));
      pool.sort((a, b) => (b[5] ? 1 : 0) - (a[5] ? 1 : 0));
      for (const r of pool) {
        if (picked.length >= n) break;
        picked.push(r);
        seen.add(r[0].toLowerCase());
      }
    }
    return picked.slice(0, n);
  }

  LD.Path = { units, isPassed, unlocked, taskState, unitProgress, currentIndex, checkpointQuestions, score, saveResult, status, unitWords, PASS };
})();
