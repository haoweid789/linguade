/* LinguaDE · 应用启动器
 * 只负责「绑定外壳 + 订阅事件 + 渲染导航 + 进入初始路由」。
 * 路由与导航见 core/router.js，UI 见 core/ui.js，事件见 core/bus.js，模块清单元数据见 core/manifest.js。
 */
(function () {
  const LD = window.LD;
  const EV = LD.EVENTS;

  /* ============ 全局兜底：异步按钮/流式回调抛错时至少让用户看见 ============
     刻意不写 console.error —— 全站零控制台错误是回归断言的一部分。 */
  let lastFatalToast = 0;
  function noteAsyncError(e) {
    try {
      if (!LD.UI || !LD.UI.toast) return;
      if (Date.now() - lastFatalToast < 8000) return;
      lastFatalToast = Date.now();
      LD.UI.toast("有一个操作没有完成：" + String((e && (e.message || e.reason)) || "未知错误").slice(0, 60) + "（学习记录已保存的部分不受影响）", "err");
    } catch (err) { /* 兜底自身不能再抛 */ }
  }
  window.addEventListener("unhandledrejection", ev => noteAsyncError(ev.reason));

  /* 全局事件 → 即时反馈（事件名集中在 core/bus.js） */
  function bindFeedback() {
    LD.bus.on(EV.QUEST, e => {
      const q = e.detail || {};
      if (q.nm) LD.UI.toast(`每日任务完成：${q.nm} +${q.xp} XP`, "ok");
      LD.UI.updateChips();
    });
    LD.bus.on(EV.BADGE, e => {
      const b = e.detail || {};
      if (b.nm) LD.UI.toast(`解锁成就：${b.nm}`, "ok");
      LD.UI.updateChips();
    });
    LD.bus.on(EV.FREEZE, e => {
      const g = (e.detail || {}).gained || 1;
      LD.UI.toast(`❄ 获得连胜冻结 ×${g}（连续学习每满 7 天）`, "ok");
      LD.UI.updateChips();
    });
    LD.bus.on(EV.FREEZE_USE, () => {
      LD.UI.toast("❄ 连胜冻结已自动使用：昨天被豁免，连胜未断", "ok");
      LD.UI.updateChips();
    });
    LD.bus.on(EV.REVIVE, e => {
      const st = (e.detail || {}).streak;
      LD.UI.toast(`连胜已复活${st ? `：${st} 天` : ""}`, "ok");
      LD.UI.updateChips();
    });
  }

  /* 启动时接回云端进度（3.21.0 起覆盖回访设备）：
     ① 本机全新（无诊断、无流水）→ 直接恢复云端快照（原行为）；
     ② 本机有数据且曾登录过账号 → 拉取 → 字段级合并，确有新内容才整页刷新一次
        （合并幂等：刷新后二次合并必为 0/0，不会形成刷新循环）；
     ③ 未登录的老设备维持原状，启动不发同步请求。 */
  function restoreFromCloud() {
    return new Promise(resolve => {
      try {
        const s = LD.Store.s;
        const fresh = !s.diagnosed && !(s.log || []).length;
        if (!fresh && !localStorage.getItem("linguade.acct")) return resolve();
        if (!fresh && sessionStorage.getItem("linguade.cloudMerged")) return resolve();
        const doPull = () => {
          if (!LD.Backend || !LD.Backend.ready()) return resolve();
          if (fresh) {
            LD.Backend.pullSync().then(j => {
              if (j && j.snapshot && j.snapshot.diagnosed && LD.Store.restoreSnapshot(j.snapshot)) {
                LD.UI.toast("已恢复云端学习档案", "ok");
              }
              resolve();
            }).catch(() => resolve());
            return;
          }
          LD.Store.sync().then(r => {
            const m = (r && r.merge) || { added: 0, updated: 0 };
            if (m.added || m.updated) {
              try { sessionStorage.setItem("linguade.cloudMerged", m.added + "/" + m.updated); } catch (e) { }
              location.reload();          // bootApp 之前刷新，合并结果首屏即生效
              return;
            }
            resolve();
          }).catch(() => resolve());
        };
        /* 先探测一次：探测通过才尝试接回云端档案，避免把未部署 /api 的静态托管当成后端 */
        if (LD.Backend && LD.Backend.probeHealth) {
          LD.Backend.probeHealth(1800).then(doPull).catch(doPull);
        } else doPull();
        return;
      } catch (e) { resolve(); }
    });
  }

  function bootApp() {
    /* 启动合并后的反馈：reload 前写入的标记在这里消费，只提示一次 */
    try {
      const merged = sessionStorage.getItem("linguade.cloudMerged");
      if (merged) {
        sessionStorage.removeItem("linguade.cloudMerged");
        const parts = merged.split("/");
        LD.UI.toast(`已同步云端进度（新增 ${parts[0]} 条 · 更新 ${parts[1]} 条）`, "ok");
      }
    } catch (e) { /* sessionStorage 不可用时静默 */ }
    if (LD.Store.s.cfg.theme === "dark") document.documentElement.classList.add("dark");

    /* 后端就绪探测：后台跑一次并缓存；失败不影响任何功能（上层按离线口径展示） */
    try {
      if (LD.Backend && LD.Backend.probeHealth) {
        LD.Backend.probeHealth(1800).catch(() => {});
      }
    } catch (e) { /* 探测失败不影响启动 */ }

    const check = LD.validateModules();
    if (check.noRender.length || check.noGroup.length || check.noOrder.length) {
      console.warn("[LinguaDE] 模块注册不完整：", check);
    }

    LD.router.renderNav();   // 导航由注册表 + 清单渲染
    LD.UI.bindShell();
    LD.UI.bindSettings();
    LD.UI.bindReadingSerif();
    LD.UI.updateChips();
    bindFeedback();
    /* 初始路由：优先取 hash 深链（#/vocab 直达单词页），未诊断时仍强制入学测试 */
    const initial = LD.router.routeFromHash();
    LD.router.go(LD.Store.s.diagnosed ? (initial || "home") : "diagnose");
  }

  window.addEventListener("DOMContentLoaded", async () => {
    if (LD.Store.hydrate) await LD.Store.hydrate();
    // 部署形态需登录；file:// 单文件版与纯静态托管由 guard 直接放行
    const ok = LD.Auth ? await LD.Auth.guard() : true;
    if (!ok) return;
    await restoreFromCloud();
    bootApp();
  });

  /* ============ PWA：仅 http(s) 且非本地回环的部署形态启用 ============
     file:// 单文件版零请求零影响；localhost/127.x（开发与 e2e）直接跳过，
     避免 HEAD 探测 404 产生 console error 噪音（e2e 的零错误断言不容忍）。 */
  if (/^https?:$/.test(location.protocol) && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname || "")) {
    window.addEventListener("load", () => {
      const probe = (url) => fetch(url, { method: "HEAD" }).then(r => r.ok).catch(() => false);
      Promise.all([probe("manifest.webmanifest"), probe("sw.js")]).then(([hasMan, hasSw]) => {
        try {
          if (hasMan) {
            const man = document.createElement("link");
            man.rel = "manifest";
            man.href = "manifest.webmanifest";
            document.head.appendChild(man);
          }
          if (hasSw && "serviceWorker" in navigator) {
            navigator.serviceWorker.register("sw.js").catch(() => {});
          }
        } catch (e) { /* PWA 是增强能力，任何失败都不影响主流程 */ }
      });
    });
  }

  /* ============ 复习提醒：页面切后台时，若濒危词积压且距上次提醒超 2 小时则通知 ============ */
  let lastNotifyAt = 0;
  setInterval(() => {
    try {
      if (!LD.Store.s.cfg.notify) return;
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      if (!document.hidden) return;
      const due = LD.Engine.dueCount();
      if (due <= 0 || Date.now() - lastNotifyAt < 2 * 3600000) return;
      lastNotifyAt = Date.now();
      new Notification("LinguaDE 复习提醒", {
        body: `你有 ${due} 个词条到期待复习，花 5 分钟清掉最危险的一批。`,
        icon: "icon.svg"
      });
    } catch (e) { /* 提醒失败不影响主流程 */ }
  }, 5 * 60 * 1000);
})();
