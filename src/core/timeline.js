/* LinguaDE · 留德时间轴状态
   任务完成 = 本地学习痕迹自动点亮 或 用户手动勾选；不引入外部数据。 */
(function () {
  const LD = (window.LD = window.LD || {});
  const S = () => LD.Store.s;

  const AUTO = {
    "interview:aps": s => (s.interviews || []).some(x => x && x.mode === "aps"),
    "mockexam:any": s => (s.mockexams || []).length > 0,
    "examDate:set": s => !!(s.profile && s.profile.examDate),
    "writing:any": s => (s.writingHist || []).length > 0,
    "chat:wohnung": s => ((s.chats || {}).wohnung || []).length > 1,
    "chat:uni": s => ((s.chats || {}).uni || []).length > 1
  };

  function autoDone(task) {
    const fn = task && task.auto && AUTO[task.auto];
    if (!fn) return false;
    try { return !!fn(S()); } catch (e) { return false; }
  }

  function isDone(stage, i) {
    const task = stage && stage.tasks && stage.tasks[i];
    if (!task) return false;
    if (autoDone(task)) return true;
    return !!((S().timelineDone || {})[stage.id + ":" + i]);
  }

  function toggle(stageId, i) {
    const s = S();
    s.timelineDone = s.timelineDone || {};
    const k = stageId + ":" + i;
    s.timelineDone[k] = !s.timelineDone[k];
    LD.Store.save();
    return s.timelineDone[k];
  }

  function progress(stage) {
    const tasks = (stage && stage.tasks) || [];
    let done = 0;
    tasks.forEach((_, i) => { if (isDone(stage, i)) done++; });
    return { done, total: tasks.length, pct: tasks.length ? Math.round(done / tasks.length * 100) : 0 };
  }

  function status() {
    const stages = window.LD_TIMELINE || [];
    let currentIdx = stages.findIndex(st => progress(st).done < st.tasks.length);
    if (currentIdx < 0) currentIdx = Math.max(0, stages.length - 1);
    const current = stages[currentIdx] || null;
    let next = null;
    if (current) {
      for (let i = 0; i < current.tasks.length; i++) {
        if (!isDone(current, i)) { next = { stage: current, index: i, task: current.tasks[i] }; break; }
      }
    }
    const totalTasks = stages.reduce((a, st) => a + st.tasks.length, 0);
    const doneTasks = stages.reduce((a, st) => a + progress(st).done, 0);
    return {
      stages, currentIdx, current, next,
      doneStages: stages.filter(st => progress(st).done === st.tasks.length).length,
      totalStages: stages.length, doneTasks, totalTasks,
      pct: totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0
    };
  }

  LD.Timeline = { status, progress, isDone, toggle, autoDone };
})();
