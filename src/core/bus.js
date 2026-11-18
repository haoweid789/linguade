/* LinguaDE · 事件总线
 * 统一跨模块通信：模块之间不直接互相引用，只通过 LD.bus 收发事件。
 * 底层仍基于原生 CustomEvent，因此历史代码里的 window.addEventListener("ld:xxx") 完全兼容。
 */
(function () {
  const LD = (window.LD = window.LD || {});

  /* 事件名集中定义，避免字符串散落各处 */
  const EVENTS = {
    QUEST: "ld:quest",          // 每日任务完成
    BADGE: "ld:badge",          // 成就徽章解锁
    FREEZE: "ld:freeze",        // 获得连胜冻结
    FREEZE_USE: "ld:freezeuse", // 自动消耗冻结
    REVIVE: "ld:revive",        // 连胜复活
    XP: "ld:xp",                // 经验值变化
    WRONG: "ld:wrong",          // 错题沉淀
    ROUTE: "ld:route"           // 路由切换
  };

  function on(name, fn) {
    window.addEventListener(name, fn);
    return () => window.removeEventListener(name, fn);
  }

  function off(name, fn) {
    window.removeEventListener(name, fn);
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  LD.EVENTS = EVENTS;
  LD.bus = { on, off, emit };
})();