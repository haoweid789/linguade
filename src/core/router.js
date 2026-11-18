/* LinguaDE · 路由层：路由分发 / 侧栏导航渲染 / 首页（总览）
 * 侧栏与首页的模块清单均来自 LD.modulesByGroup()（注册表 + 清单），不再手工维护。
 */
(function () {
  const LD = (window.LD = window.LD || {});
  const S = () => LD.Store.s;
  let curRoute = "home";

  /* 模块图标：统一线性 SVG（Lucide 风格路径）。未映射的路由回退到模块自带的字符图标。 */
  const ICON_PATHS = {
    diagnose: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27L7.76 16.24l1.8-5.41a2 2 0 0 1 1.27-1.27z"/>',
    vocab: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    grammar: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
    speech: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    listening: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    drill: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    weak: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    phonetics: '<path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3"/>',
    notebook: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M16 2v20M2 6h4M2 10h4M2 14h4M2 18h4"/>',
    analytics: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    plan: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    syntax: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    writing: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    reading: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    ocrgrade: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    sandbox: '<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.13A2 2 0 0 1 14 9.53V2"/><path d="M8.5 2h7M7 16h10"/>',
    interview: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    mockexam: '<path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/>',
    aipractice: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    german: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>'
  };
  function iconOf(m) {
    const p = ICON_PATHS[m.route];
    if (p) return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
    /* 模块元数据给的是图标名（如 sparkle）时走统一图标库，避免把名字当文字渲染进导航 */
    const byName = window.LD.icon ? window.LD.icon(m.icon) : "";
    return byName || (m.icon || "");
  }

  /* 移动端「学练」入口：不再把整个学习分组硬绑到词汇页 */
  const LEARN_ROUTES = ["vocab", "grammar", "chat", "speech", "listening", "drill", "reading", "writing", "weak", "phonetics"];
  function learnModules() {
    return LEARN_ROUTES.map(r => LD.Modules[r] ? Object.assign({ route: r }, LD.Modules[r]) : null).filter(Boolean);
  }
  function closeLearnSheet() {
    const sheet = document.getElementById("learnSheet");
    const mask = document.getElementById("learnMask");
    if (sheet) sheet.hidden = true;
    if (mask) mask.hidden = true;
    document.body.classList.remove("learn-sheet-open");
    const tab = document.querySelector('[data-mobile-route="learn"]');
    if (tab) tab.setAttribute("aria-expanded", "false");
  }
  function openLearnSheet() {
    const sheet = document.getElementById("learnSheet");
    const mask = document.getElementById("learnMask");
    const body = document.getElementById("learnSheetBody");
    if (!sheet || !body) return;
    const mods = learnModules();
    body.innerHTML = `<div class="learn-sheet-grid">${mods.map(m => `
      <a class="learn-sheet-item${m.route === curRoute ? " active" : ""}" href="#${m.route}" data-learn-route="${m.route}">
        <span class="learn-sheet-ic">${iconOf(m)}</span>
        <span class="learn-sheet-name">${m.label || m.route}</span>
        <span class="learn-sheet-desc">${m.ds || ""}</span>
      </a>`).join("")}</div>
      <button type="button" class="btn btn-ghost btn-block" id="learnAllBtn">打开全部模块与数据</button>`;
    sheet.hidden = false;
    if (mask) mask.hidden = false;
    document.body.classList.add("learn-sheet-open");
    const tab = document.querySelector('[data-mobile-route="learn"]');
    if (tab) tab.setAttribute("aria-expanded", "true");
    body.querySelectorAll("[data-learn-route]").forEach(a => a.onclick = e => {
      e.preventDefault();
      const route = a.dataset.learnRoute;
      closeLearnSheet();
      go(route);
    });
    const all = body.querySelector("#learnAllBtn");
    if (all) all.onclick = () => { closeLearnSheet(); const btn = document.getElementById("menuBtn"); if (btn) btn.click(); };
  }
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeLearnSheet(); });

  /* 最近 7 天学习时长日历（可视化连续性） */
  function weekCalendar() {
    const s = S();
    const out = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(d.getTime() - i * 86400000);
      const key = LD.Store.dayKey(dt);
      out.push(["日一二三四五六"[dt.getDay()], s.daily[key] || 0, i < 0]);
    }
    return out;
  }

  /* 连胜冻结 / 复活提示条（对标 Duolingo Streak Freeze & Revival） */
  function reviveHint(s) {
    const today = LD.Store.todayMinutes();
    if (today > 0) return "";
    if (s.revive && Date.now() < s.revive.until) {
      const hrs = Math.max(1, Math.ceil((s.revive.until - Date.now()) / 3600000));
      return `<div style="margin-top:10px;padding:9px 12px;border-radius:9px;background:var(--warn-soft);border:1px solid var(--warn);font-size:12.5px;line-height:1.7">
        <b>连胜复活窗口开启中</b>（约 ${hrs} 小时内有效）：完成今天的任意一次学习，即可恢复 ${s.revive.target} 天连胜。</div>`;
    }
    if (LD.Store.streakBeforeToday() === 0 && (s.bestStreak || 0) >= 3) {
      return `<div style="margin-top:10px;padding:9px 12px;border-radius:9px;background:var(--warn-soft);border:1px solid var(--warn);font-size:12.5px;line-height:1.7">
        ⚠ 连胜已中断（曾连续 ${s.bestStreak} 天）：今天开始学习即可触发复活，恢复中断前的连胜。</div>`;
    }
    const cur = LD.Store.streak();
    if (cur > 0) {
      return `<div style="margin-top:10px;padding:9px 12px;border-radius:9px;background:var(--panel-2);font-size:12.5px;color:var(--text-2)">
        今天还没学习 —— 连续 ${cur} 天的记录等你续上。</div>`;
    }
    return "";
  }

  /* 首页横幅外壳：图标 + 正文 + 一个动作 + 「今天不再提示」（按本地日期生效，次日重现） */
  function homeBanner(id, key, tone, icon, title, body, action) {
    if (LD.Store.bannerDismissed(key)) return "";
    return `<div class="card card-pad home-banner home-banner-${tone}" id="${id}" data-banner="${key}">
      <div class="banner-ic" aria-hidden="true">${icon}</div>
      <div class="banner-main"><div class="banner-title">${title}</div><div class="banner-body">${body}</div></div>
      <div class="banner-acts">${action}<button type="button" class="banner-dismiss" data-banner-close="${key}">今天不再提示</button><button type="button" class="banner-dismiss banner-dismiss-forever" data-banner-forever="${key}" title="以后都不再显示这条提醒">不再提醒</button></div>
    </div>`;
  }

  /* 距上次学习的天数（今天已学 = 0；从没学过 = null） */
  function daysAway() {
    const s = S();
    if (LD.Store.todayMinutes() > 0) return 0;
    for (let i = 1; i < 400; i++) {
      const key = LD.Store.dayKey(new Date(Date.now() - i * 86400000));
      if ((s.daily[key] || 0) > 0) return i;
    }
    return null;
  }

  /* 断学 ≥2 天回来：首屏换成「回归模式」，不再叠三块提醒 */
  function returnMode() {
    const away = daysAway();
    return away != null && away >= 3 ? away - 1 : 0;   // 返回的是「中间空了几天」
  }

  /* 未复习提醒：有到期词 + 昨天空窗 → 首页横幅拉回（回归模式下由首屏承担，不再重复） */
  function dueReminder() {
    let due = 0, back = null;
    try { due = LD.Engine.dueCount(); back = LD.Engine.backlogStats(); } catch (e) { return ""; }
    const gap = LD.Store.streakBeforeToday() === 0 && LD.Store.todayMinutes() === 0;
    if (due > 0 && gap && !returnMode()) {
      return homeBanner("dueBanner", "due", "warn", LD.icon("clock"),
        `你已隔日未复习 —— ${back ? back.due : due} 个词到了该复习的时候`,
        back ? `今天先做最急的 ${back.reviewSlots} 个${back.deferred > 0 ? `，其余 ${back.deferred} 个往后排（单词练习页可一键顺延）` : ""}。` : "",
        '<button class="btn btn-ghost" id="dueGoVocab">去复习</button>');
    }
    return "";
  }

  /* 内容包发现：清单由 build.py 注入，只列真实存在的文件；单文件版正文已内联。
     降噪（3.19.1）：只在「未打开过阅读、也未收过生词」时显示一次；导入后也不再提示 */
  function contentPackBanner() {
    if (!LD.ContentPacks) return "";
    const packs = LD.ContentPacks.available();
    if (!packs.length) return "";
    const vr = S().visited || {};
    if ((vr.reading || 0) > 0 || (vr.notebook || 0) > 0 || (vr.chat || 0) > 0) return "";
    if ((S().contentPacksImported || {})[packs[0].file]) return "";
    const mainPacks = packs.filter(p => (p.tier || "main") !== "optional");
    const optPacks = packs.filter(p => (p.tier || "main") === "optional");
    const total = packs.reduce((a, p) => a + (p.count || 0), 0);
    const single = !/^https?:$/.test(location.protocol) && packs.every(p => p.inline);
    const summary = mainPacks.map(p => `${p.label} ${p.count || 0}${p.kind === "speech" && p.withAudio ? `（真人录音 ${p.withAudio}）` : ""}`).join(" · ");
    const optSummary = optPacks.map(p => `${p.label} ${p.count || 0} 条`).join(" · ");
    const shortLicense = l => /Tatoeba/i.test(l) ? "Tatoeba CC BY 2.0 FR（音频逐条许可）" : l;
    const licenses = [...new Set(packs.map(p => shortLicense(p.license || "")).filter(Boolean))].join(" / ");
    /* 法务条款折叠到「来源与许可」里，不占学习者每天第一眼 */
    const licDetails = licenses ? `<details class="banner-license"><summary>来源与许可</summary><div class="banner-license-body">${licenses} · 详见「关于 LinguaDE」。</div></details>` : "";
    return homeBanner("packBanner", "pack", "info", LD.icon("pack"),
      `${single ? "单文件版已内置" : "发现"} ${packs.length} 个内容包${total ? ` · 共 ${total} 条` : ""}`,
      `<div>${summary}。${single ? "正文已随单文件打包，无需联网或配置后端。" : "导入后显示来源与许可。"}${optSummary ? `<div style="margin-top:6px;font-size:12.5px;color:var(--text-3)">可选包（按需下载，不进单文件体积）：${optSummary}</div>` : ""}</div>${licDetails}`,
      '<button class="btn btn-primary" id="importPacks">一键导入</button>');
  }

  /* B7 每日内容位：每日一句 + 每日听力（确定性轮换，纯展示不进复习队列） */
  function dailyCardsHtml() {
    if (!LD.Daily) return "";
    const ds = LD.Daily.today();
    const sent = LD.Daily.sentence(ds);
    if (!sent) return "";
    const lst = LD.Daily.listening(ds);
    const listenBlock = lst.length ? `
      <div class="card card-pad" style="margin-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0;font-size:14px">每日听力 <span class="tag">今日</span></h3>
          <button class="btn btn-sm" id="dailyListenPlay">播放</button>
        </div>
        <div id="dailyListenText" style="font-size:13px;color:var(--text-2);line-height:1.8;margin-top:6px">${lst.map(l => `<div>${l.de}</div>`).join("")}</div>
      </div>` : "";
    return `
      <div class="card card-pad" style="margin-top:10px" id="dailySentCard">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0;font-size:14px">每日一句 <span class="tag">今日</span></h3>
          <span style="display:flex;gap:6px">
            <button class="btn btn-sm" id="dailySay">发音</button>
            <button class="btn btn-sm" id="dailyFav">收藏</button>
          </span>
        </div>
        <div style="font-size:20px;font-weight:700;margin-top:8px">${sent.de}</div>
        <div style="font-size:13px;color:var(--text-3);margin-top:2px">${sent.zh}</div>
        <div style="font-size:13px;color:var(--text-2);margin-top:8px;line-height:1.7">${sent.ex}</div>
        <div style="font-size:12.5px;color:var(--text-3)">${sent.exzh}</div>
      </div>
      ${listenBlock}`;
  }

  /* 每日内容按钮事件绑定（home 渲染后调用） */
  function bindDailyCards() {
    if (!LD.Daily) return;
    const ds = LD.Daily.today();
    const say = document.getElementById("dailySay");
    if (say) say.onclick = () => {
      const sent = LD.Daily.sentence(ds);
      if (sent && window.LD.SpeechUtil) LD.SpeechUtil.say(sent.ex || sent.de);
    };
    const fav = document.getElementById("dailyFav");
    if (fav) fav.onclick = () => {
      const sent = LD.Daily.sentence(ds);
      if (!sent) return;
      const s = S();
      if ((s.wordbank || []).some(w => w.de === sent.de)) { LD.UI.toast("已在生词本", ""); return; }
      s.wordbank = s.wordbank || [];
      s.wordbank.unshift({ id: "d" + Date.now(), de: sent.de, zh: sent.zh, ctx: sent.ex, scene: "每日一句", t: Date.now(), known: false });
      LD.Store.save();
      LD.UI.toast("已加入生词本（每日一句）", "ok");
      if (fav) fav.textContent = "已收藏";
    };
    const lp = document.getElementById("dailyListenPlay");
    if (lp) lp.onclick = () => {
      const lst = LD.Daily.listening(ds);
      if (lst && window.LD.SpeechUtil) LD.SpeechUtil.say(lst.map(l => l.de).join(" ... "));
    };
  }

  function backupReminder() {
    const s = S();
    if (!s.updatedAt) return "";
    /* 学了不到 3 天、不到 50 题时还没什么可丢的，太早提醒只会被当成噪音 */
    const studyDays = Object.keys(s.daily || {}).filter(d => s.daily[d] > 0).length;
    const answers = (s.log || []).filter(x => x && !x.noXP).length;
    if (studyDays < 3 && answers < 50) return "";
    if (returnMode()) return "";
    const day = LD.Store.localBackupDay ? LD.Store.localBackupDay() : "";
    /* 本机快照每次保存都会刷成「今天」，而且它和主数据同样躺在浏览器里：
       清站点数据一起没。所以提醒只看「有没有把 JSON 导出到浏览器之外」。 */
    const exportedAt = s.lastExportAt || 0;
    const age = exportedAt ? Math.max(0, Math.floor((Date.now() - exportedAt) / 86400000)) : Infinity;
    if (age < 7) return "";
    /* 云端同步豁免（3.21 起自动推送）：已同步且 7 天内，数据本就已在云端，不再提示「只存本机」 */
    let lastSyncAt = 0;
    try { lastSyncAt = +(localStorage.getItem("linguade.lastSyncAt") || 0); } catch (e) { /* localStorage 不可用 */ }
    if (lastSyncAt && Date.now() - lastSyncAt < 7 * 86400000) return "";
    const message = `学习数据只存在这台设备的浏览器里${day ? `（最近一次本机快照 ${day}）` : ""}。`
      + (exportedAt
        ? `上次导出 JSON 是 ${new Date(exportedAt).toLocaleDateString("zh-CN")}，已超过 7 天。`
        : "还没有导出过 JSON：导出一次存到电脑，清浏览器数据或换设备都不会丢。");
    return homeBanner("backupBanner", "backup", "neutral", LD.icon("save"),
      "学习数据备份提醒", message,
      '<button class="btn btn-ghost" id="homeExportBackup">导出 JSON</button>');
  }

  function homeModuleCard(m, s) {
    const favorite = LD.Store.isFavorite(m.route);
    return `<div class="mod-card-wrap">
      <a class="card card-pad mod-card" href="#${m.route}" data-r="${m.route}" aria-label="打开${m.label || m.route}">
        <div class="ic" aria-hidden="true">${iconOf(m)}</div>
        <div class="nm">${m.label || m.route}</div>
        <div class="ds">${m.ds || m.desc || ""}</div>
        <div class="foot"><span class="tag ${m.priority === "P0" ? "tag-blue" : ""}">${m.priority || ""}</span>
        <span class="mod-use-count">${(s.visited[m.route] || 0) > 0 ? "已使用 " + s.visited[m.route] + " 次" : "未开始"}</span></div>
      </a>
      <button type="button" class="mod-favorite" data-favorite="${m.route}" aria-label="${favorite ? "取消收藏" : "收藏"}${m.label || m.route}" aria-pressed="${favorite}">${favorite ? "★" : "☆"}</button>
    </div>`;
  }

  /* 考试预警三档（距考倒计时到 30/14/7 天时渐进升级措辞，帮用户更早意识到覆盖度风险） */
  function examTierHint(days) {
    if (days == null) return "";
    const note = days <= 7
      ? "距考不到一周，队列会优先保最可能考到的部分——把时间用在错题和阅读上，收益最大。"
      : days <= 14
        ? "离考试只剩两周，建议把每日时间往单词和阅读上集中，其余模块先暂停。"
        : days <= 30
          ? "剩下的时间只够覆盖一部分词库，建议优先吃透高频词和错题，而不是贪多。"
          : "现在做决定还来得及——每日时间设置和考试日期都可以调整。";
    return `<div class="hint" style="margin:8px 0 0;color:var(--accent-text)">${note}</div>`;
  }

  /* 首页（总览）：先回答「今天学什么」，比赛信息、游戏化数据与全部模块收进折叠区 */
  const HOME = {
    title: "总览",
    desc: "",
    render(host, ctx) {
      const s = S();
      const vis = LD.Store.visitedCount();
      const all = LD.moduleList();
      const due = LD.Engine.dueCount();
      const back = LD.Engine.backlogStats();
      const todayCards = back.reviewSlots + back.newSlots;
      const pending = LD.Store.wrongPending().length;
      const m = LD.Engine.masterySummary();
      const lv = LD.Store.levelInfo();
      const examDate = s.profile.examDate;
      const daysLeft = examDate ? Math.max(0, Math.ceil((new Date(examDate + "T23:59:59") - new Date()) / 86400000)) : null;
      const quests = LD.Store.todayQuests();
      const tl = LD.Timeline ? LD.Timeline.status() : null;
      const fw = s.diagnosed && LD.Engine.firstWeekPlan ? LD.Engine.firstWeekPlan() : null;
      const planEntry = fw ? (fw.plan.find(d => d.date === LD.Store.dayKey()) || fw.plan[0] || null) : null;
      const planDone = planEntry ? LD.FirstWeek.count(planEntry) : 0;
      const nextTask = planEntry ? (planEntry.tasks.find(t => !LD.FirstWeek.isDone(t.id)) || planEntry.tasks[0]) : null;
      const nextRoute = nextTask ? LD.FirstWeek.route(nextTask.mod, nextTask) : "vocab";
      const routes = new Map(all.map(m => [m.route, m]));
      const recentModules = LD.Store.recentRoutes().map(r => routes.get(r)).filter(Boolean);
      const favoriteModules = (s.favorites || []).map(r => routes.get(r)).filter(Boolean);
      const gamify = s.cfg.gamify !== false;
      const todayMin = LD.Store.todayMinutes();
      const todayLabel = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
      const abilityRoutes = [
        ["vocab", "vocab", "词汇复习"], ["grammar", "grammar", "语法练习"],
        ["listening", "listening", "听力训练"], ["speaking", "speech", "口语练习"],
        ["reading", "reading", "阅读理解"], ["writing", "writing", "写作练习"]
      ];
      const practiced = new Set((s.log || []).filter(x => x && !x.noXP && x.ability).map(x => x.ability));
      const weakest = abilityRoutes.filter(x => practiced.has(x[0])).sort((a, b) => (s.ability[a[0]] || 0) - (s.ability[b[0]] || 0))[0];
      const recommendations = [];
      if (due > 0) recommendations.push({ route: "vocab", title: `做今天排得下的 ${todayCards} 张`, reason: back.deferred > 0 ? `到期 ${back.due} 个，按每日 ${back.budget} 张的预算先做最危急的 ${back.reviewSlots} 个复习 + ${back.newSlots} 个新词。` : "按当前复习队列排序，先处理即将遗忘的内容。", time: `约 ${Math.max(5, Math.round(todayCards * 1.2))} 分钟` });
      if (pending > 0) recommendations.push({ route: "notebook", title: `回顾 ${pending} 条未掌握错题`, reason: "把近期错误转成下一次练习目标。", time: "约 5 分钟" });
      if (weakest && !recommendations.some(x => x.route === weakest[1])) recommendations.push({ route: weakest[1], title: `练一组${weakest[2]}`, reason: "根据近期练习记录，优先补目前较弱的一项。", time: "约 10 分钟" });
      if (recommendations.length < 3) {
        const pool = [...favoriteModules, routes.get("vocab"), routes.get("listening"), routes.get("reading"), routes.get("speech")].filter(Boolean);
        for (const item of pool) {
          if (recommendations.length >= 3) break;
          if (recommendations.some(x => x.route === item.route)) continue;
          recommendations.push({ route: item.route, title: `继续${item.label || item.route}`, reason: favoriteModules.includes(item) ? "来自你收藏的常用模块。" : "用一组短练习保持学习节奏。", time: "约 10 分钟" });
        }
      }
      const primary = LD.primaryGroups();
      const totalModules = LD.moduleList().length;
      const aboutStats = [
        [String((window.LD_LEX || []).length), "词库词条"],
        [String(totalModules), "功能模块"],
        [(m.n ? m.avg : 0) + "%", "BKT 平均掌握度"],
        [daysLeft === null ? "未设置" : daysLeft + " 天", `距 ${s.profile.exam}`]
      ];
      const away = returnMode();
      const vocabTask = planEntry ? planEntry.tasks.find(t => t.mod === "vocab" && !LD.FirstWeek.isDone(t.id)) : null;
      const recoverCards = vocabTask && vocabTask.words ? vocabTask.words : Math.max(1, Math.min(back.reviewSlots || todayCards, 12));
      const reviveLine = (() => {
        if (!gamify || !away) return "";
        if (s.revive && Date.now() < s.revive.until) {
          const hrs = Math.max(1, Math.ceil((s.revive.until - Date.now()) / 3600000));
          return `<p class="home-revive">今天学任意一项，就能恢复 ${s.revive.target} 天连胜（还剩约 ${hrs} 小时）。</p>`;
        }
        return (s.bestStreak || 0) >= 3 ? `<p class="home-revive">今天学任意一项，就能恢复之前 ${s.bestStreak} 天的连胜。</p>` : "";
      })();
      const allDone = planEntry && planDone >= planEntry.tasks.length;
      const heroText = away
        ? `你离开了 ${away} 天，这很正常。先做 ${recoverCards} 张最急的词卡（约 ${Math.max(3, Math.round(recoverCards * 1.2))} 分钟），就算回到节奏了，其余的会往后排。`
        : planEntry
          ? `今天 ${planEntry.tasks.length} 项，约 ${planEntry.tasks.reduce((a, t) => a + t.min, 0)} 分钟，已完成 ${planDone} 项。${allDone ? "都完成了，可以休息或自由练习。" : ""}`
          : (recommendations.length ? "先从一项短练习开始。" : "今天没有到期复习；可以用一组短练习保持节奏。");
      const startRoute = away ? "vocab" : nextRoute;
      host.innerHTML = `
        <section class="home-hero card${away ? " home-hero-return" : ""}" aria-labelledby="homeTitle">
          <div class="home-hero-main">
            <div class="home-kicker">${todayLabel} · 目标 ${s.profile.exam}${daysLeft !== null ? ` · 距考试 ${daysLeft} 天` : ""}${examDate ? "" : ' · <button type="button" class="inline-link" id="openExamSetting">设置考试日期</button>'}</div>
            <h1 id="homeTitle">${away ? "欢迎回来" : "今天学什么"}</h1>
            <p>${heroText}</p>
            ${reviveLine}
            <div class="home-mobile-glance" aria-label="今日概览">
              <span><b>${todayCards}</b> 张词卡</span><span><b>${pending}</b> 错题</span><span><b>${todayMin}</b> 今日分钟</span>
            </div>
            <div class="home-hero-actions">
              <a class="btn btn-primary" id="homeStart" href="#${startRoute}" data-home-route="${startRoute}">${away ? `先做 ${recoverCards} 张` : (allDone ? "复习今日内容" : "开始下一项")}</a>
              <button class="btn btn-ghost" id="homeMoreBtn">更多数据与模块</button>
            </div>
          </div>
          <div class="hero-stats">
            <div class="hero-stat"><b>${todayCards}</b><span>今天的词卡</span>${back.deferred > 0 ? `<small>另有 ${back.deferred} 个排在之后</small>` : ""}</div>
            <div class="hero-stat"><b>${pending}</b><span>未掌握错题</span></div>
            <div class="hero-stat"><b>${todayMin}</b><span>今日已学分钟</span></div>
          </div>
        </section>

        ${dueReminder()}
        ${contentPackBanner()}
        ${backupReminder()}

        ${fw ? LD.FirstWeek.render(fw.plan, {
          id: "homeFirstWeek",
          title: "今日任务",
          subtitle: `按每日约 ${fw.daily} 分钟安排`
        }) : ""}
        ${dailyCardsHtml()}

        ${examDate ? `<div class="home-exam card">
          <div class="home-exam-days">${daysLeft}<small>天</small></div>
          <div style="flex:1;min-width:200px">
            <b>距 ${s.profile.exam} 考试还有 ${daysLeft} 天</b>
            <div class="hint" style="margin:2px 0 0">越临近考试，复习间隔越短，考后才会到期的词会提前复习。按每天 ${back.budget} 张，剩下 ${daysLeft} 天约能过 ${Math.min(100, Math.round(back.budget * daysLeft / Math.max(1, (window.LD_LEX || []).length) * 100))}% 的词库。<button type="button" class="inline-link" id="openExamSetting">调整考试日期</button></div>
            ${examTierHint(daysLeft)}
            ${daysLeft <= 30 ? `<div class="home-exam-acts"><button type="button" class="inline-link" data-home-route="mockexam">做一套全真模考</button><button type="button" class="inline-link" data-home-route="notebook">清错题本</button></div>` : ""}
          </div>
        </div>` : ""}

        ${recentModules.length ? `<section class="home-recent" aria-label="最近使用">
          <div class="home-section-head"><div><h2>最近使用</h2><p>回到上次练习过的模块。</p></div></div>
          <div class="recent-links">${recentModules.map(m => `<a class="recent-link" href="#${m.route}" data-home-route="${m.route}">${iconOf(m)}<span>${m.label || m.route}</span></a>`).join("")}</div>
        </section>` : ""}

        ${favoriteModules.length ? `<section class="home-favorites" aria-label="收藏模块">
          <div class="home-section-head"><div><h2>常用模块</h2><p>点击模块右上角的星标可调整收藏。</p></div></div>
          <div class="grid g3 mod-grid">${favoriteModules.map(m => homeModuleCard(m, s)).join("")}</div>
        </section>` : ""}

        <details class="home-more card" id="homeMore">
          <summary><span>更多数据与全部模块</span><span class="tag">${totalModules} 个模块</span></summary>
          <div class="home-more-body">
            ${gamify ? `<div class="grid g2">
              <div class="card card-pad">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                  <h3 style="margin:0;font-size:15px">今日任务</h3>
                  <span class="tag tag-blue">${quests.items.filter(q => q.done).length} / ${quests.items.length} 已完成</span>
                </div>
                ${quests.items.map(q => `
                  <div style="padding:9px 0;border-bottom:1px solid var(--line-soft)">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                      <span style="font-size:13.5px;${q.done ? "color:var(--text-3);text-decoration:line-through" : ""}">${LD.icon(q.ic)} ${q.text}</span>
                      <span style="flex-shrink:0;font-size:12px;color:${q.done ? "var(--ok)" : "var(--text-3)"}">${q.done ? `✓ +${q.xp} XP` : `${q.progress}/${q.target}`}</span>
                    </div>
                    <div class="progress-line" style="margin-top:7px;height:5px"><i style="width:${Math.min(100, q.progress / q.target * 100)}%;background:${q.done ? "var(--ok)" : ""}"></i></div>
                  </div>`).join("")}
                <div class="hint">每日任务零点轮换；完成后立即发放 XP 奖励。可在设置中隐藏游戏化元素。</div>
              </div>
              <div class="card card-pad">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                  <h3 style="margin:0;font-size:15px">学习节奏</h3>
                  <span class="tag">连续 ${LD.Store.streak()} 天${(s.freezes || 0) > 0 ? ` · ❄ ${s.freezes}` : ""}</span>
                </div>
                <div style="display:flex;gap:6px;justify-content:space-between">
                  ${weekCalendar().map(([d, min]) => `
                    <div style="flex:1;text-align:center">
                      <div style="font-size:12px;color:var(--text-3);margin-bottom:5px">${d}</div>
                      <div style="height:52px;border-radius:8px;background:${min > 0 ? "var(--grad)" : "var(--line-soft)"};display:grid;place-items:center;font-size:12px;color:${min > 0 ? "#fff" : "var(--text-3)"};font-weight:600">${min > 0 ? min + "′" : "—"}</div>
                    </div>`).join("")}
                </div>
                ${reviveHint(s)}
                <div class="divider"><span>经验值</span></div>
                <div style="display:flex;align-items:center;gap:12px">
                  <div style="font-size:26px;font-weight:700;color:var(--brand)">Lv.${lv.level}</div>
                  <div style="flex:1">
                    <div class="progress-line" style="margin-top:0"><i style="width:${lv.pct}%"></i></div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-3);margin-top:4px">
                      <span>${lv.xp} XP</span><span>${lv.maxed ? "已满级" : `距 Lv.${lv.level + 1} 还需 ${lv.next - lv.xp} XP`}</span>
                    </div>
                  </div>
                </div>
                <div class="hint">XP 只增不减 —— 它记录的是你的投入，不是一时的表现。${(s.freezes || 0) > 0 ? `连胜冻结 ❄ ${s.freezes} 次：断学时自动豁免一天。` : "连续学习每满 7 天获得 1 次连胜冻结（上限 3）。"}</div>
              </div>
            </div>` : `<div class="hint" style="margin:0">游戏化元素已在设置中关闭；这里只保留学习数据与全部模块。</div>`}

            ${tl && tl.stages.length ? `<div class="card card-pad" style="margin-top:14px;border-color:var(--brand)">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <span class="tag tag-blue">留德进度 ${tl.currentIdx + 1} / ${tl.totalStages}</span>
                <div style="flex:1;min-width:220px">
                  <div style="font-weight:600;font-size:14px">${tl.current ? tl.current.nm : ""} · <span style="color:var(--text-3);font-weight:400">${tl.current ? tl.current.months : ""}</span></div>
                  <div class="hint" style="margin:2px 0 0">下一步：${tl.next ? tl.next.task.text : "本阶段任务已完成"}</div>
                </div>
                <button class="btn btn-primary" id="toTimeline">查看路径</button>
              </div>
              <div class="progress-line" style="margin-top:10px;max-width:none"><i style="width:${tl.pct}%"></i></div>
            </div>` : ""}

            <div class="home-section-head home-modules-head">
              <h2>全部模块</h2>
              <span class="tag">已启用 ${vis.done} / ${vis.total} 个模块</span>
            </div>
            ${primary.map(g => `
              <div class="mod-group-title">${g.group}</div>
              <div class="grid g3 mod-grid mod-group">
                ${g.items.map(m => homeModuleCard(m, s)).join("")}
              </div>`).join("")}
          </div>
        </details>

        <details class="home-about card">
          <summary>关于 LinguaDE · 赛事信息 · 内容来源</summary>
          <div class="home-about-body">
            <h2>AI 多模态双语留学自适应学习陪伴系统</h2>
            <p class="hint" style="margin-top:6px">LinguaDE · 面向留德备考群体的多模态自适应学习陪伴系统 · 第十一届华为 ICT 大赛创新赛 · 赛题一</p>
            <div class="cover-tags" style="margin-top:12px">
              <span class="tag tag-blue">${(window.LD_LEX || []).length} 词条词库</span>
              <span class="tag">${(window.LD_GRAMMAR_LIBRARY || []).length} 句纠错句库</span>
              <span class="tag">${(window.LD_INTERVIEW_BANK || []).length} 道面试真题</span>
              <span class="tag ${LD.LLM.ready() ? "tag-ok" : "tag-warn"}">${LD.LLM.ready() ? "大模型已接入" : "离线规则引擎运行中"}</span>
            </div>
            <div class="grid g4" style="margin-top:14px">
              ${aboutStats.map(([v, k]) => `<div class="stat-tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("")}
            </div>
            <div class="hint" style="margin-top:14px;line-height:1.8">内容来源与许可：项目自编词条与讲解；德语词形与例句参考 English Wiktionary / kaikki（CC BY-SA 3.0）、Tatoeba（CC BY 2.0 FR）、de.wikipedia（CC BY-SA 4.0）；英中释义参考 ECDICT（MIT）。AI 辅助释义条目会标注可信状态（人工编写 / 自动结构校验 / AI 生成未人工审校），欢迎在词卡上报错；机器词条等级为词频估计，不代表官方 CEFR 认定。</div>
          </div>
        </details>`;
      [...host.querySelectorAll(".mod-card,[data-home-route]")].forEach(c => c.onclick = e => {
        e.preventDefault();
        if (c.id === "homeStart" && planEntry) {
          const t = away ? vocabTask : nextTask;
          if (t) LD.FirstWeek.launch(t, planEntry.date, "home");
        }
        ctx.go(c.dataset.r || c.dataset.homeRoute);
      });
      host.querySelectorAll("[data-favorite]").forEach(b => b.onclick = e => {
        e.stopPropagation();
        LD.Store.toggleFavorite(b.dataset.favorite);
        HOME.render(host, ctx);
      });
      const moreBtn = host.querySelector("#homeMoreBtn");
      if (moreBtn) moreBtn.onclick = () => {
        const box = host.querySelector("#homeMore");
        if (box) { box.open = true; box.scrollIntoView({ behavior: "smooth", block: "start" }); }
      };
      const examSetting = host.querySelector("#openExamSetting");
      if (examSetting) examSetting.onclick = () => {
        document.getElementById("settingsBtn").click();
        setTimeout(() => { const f = document.getElementById("cfgExamDate"); if (f) f.focus(); }, 250);
      };
      const tlGo = host.querySelector("#toTimeline");
      if (tlGo) tlGo.onclick = () => ctx.go("plan");
      bindDailyCards();
      if (fw) LD.FirstWeek.bind(host, {
        onToggle: id => {
          HOME.render(host, ctx);
          const row = host.querySelector('[data-fw-task="' + id + '"]');
          const again = row ? row.querySelector(".fw-check") : null;
          if (window.LD.FirstWeek.markRow) window.LD.FirstWeek.markRow(row);
          if (again) again.focus({ preventScroll: true });
        },
        onGo: route => ctx.go(route),
        returnTo: "home"
      });
      host.querySelectorAll("[data-banner-close]").forEach(b => b.onclick = () => {
        LD.Store.dismissBanner(b.dataset.bannerClose);
        const box = b.closest(".home-banner");
        if (box) box.remove();
        LD.UI.toast("今天不再提示，明天会重新出现", "ok");
      });
      host.querySelectorAll("[data-banner-forever]").forEach(b => b.onclick = () => {
        LD.Store.dismissBannerForever(b.dataset.bannerForever);
        const box = b.closest(".home-banner");
        if (box) box.remove();
        LD.UI.toast("已永久关闭这条提醒；需要恢复可在「设置 → 数据管理」中清除站点数据后重进", "ok");
      });
      const db = host.querySelector("#dueGoVocab");
      if (db) db.onclick = () => ctx.go("vocab");
      const backupBtn = host.querySelector("#homeExportBackup");
      if (backupBtn) backupBtn.onclick = () => {
        LD.Store.markExported();
        const blob = new Blob([LD.Store.exportData()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "linguade-export-" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        LD.UI.toast("学习数据已导出到下载目录", "ok");
        backupBtn.textContent = "已导出";
        backupBtn.disabled = true;
      };
      const ip = host.querySelector("#importPacks");
      if (ip) ip.onclick = () => {
        ip.disabled = true;
        ip.textContent = "导入中…";
        LD.ContentPacks.importAll((done, all) => { ip.textContent = `导入中 ${done}/${all}`; })
          .then(r => {
            LD.UI.toast(`已导入 ${r.imported} 条内容（去重后）`, "ok");
            ctx.go("home");
          })
          .catch(e => {
            ip.disabled = false;
            ip.textContent = "一键导入";
            LD.UI.toast("内容包导入失败：" + e.message, "err");
          });
      };
    }
  };

  /* 侧栏导航：主入口分组（3.25.0 起「更多工具」折叠组移除，nav:"more" 模块仅路由可达） */
  function navItem(m, cur) {
    return `<a class="nav-item${m.route === cur ? " active" : ""}" href="#${m.route}" data-route="${m.route}"${m.route === cur ? ' aria-current="page"' : ""}>
      <i>${iconOf(m)}</i><span>${m.label || m.route}</span>
      ${m.route === "notebook" ? '<b class="badge" id="badgeWrong">0</b>' : ""}
      ${(m.tags && m.tags.length) ? `<em class="tag-free">${m.tags[0]}</em>` : ""}
    </a>`;
  }

  function renderNav() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    sidebar.querySelectorAll(".nav-group,.nav-more,.nav-home").forEach(n => n.remove());
    const foot = sidebar.querySelector(".nav-foot");
    const homeLink = `<a class="nav-home${curRoute === "home" ? " active" : ""}" href="#home" data-route="home"${curRoute === "home" ? ' aria-current="page"' : ""}><i>◉</i><span>今天学什么</span></a>`;
    /* 诊断页正文已说明「完成后解锁」，侧栏不再重复一遍 */
    const lockNote = "";
    const primary = LD.primaryGroups();
    const html = (S().diagnosed ? homeLink : "") + lockNote + primary.map(g => `
      <div class="nav-group">
        <div class="nav-group-title">${g.group}</div>
        ${g.items.map(m => navItem(m, curRoute)).join("")}
      </div>`).join("");
    if (foot) foot.insertAdjacentHTML("beforebegin", html);
    else sidebar.insertAdjacentHTML("beforeend", html);
    document.querySelectorAll("[data-mobile-route]").forEach(a => a.onclick = e => {
      e.preventDefault();
      if (a.dataset.mobileRoute === "learn") { openLearnSheet(); return; }
      closeLearnSheet();
      go(a.dataset.mobileRoute);
    });
    const learnMask = document.getElementById("learnMask");
    if (learnMask) learnMask.onclick = closeLearnSheet;
    const learnClose = document.getElementById("learnClose");
    if (learnClose) learnClose.onclick = closeLearnSheet;
  }

  function go(route, payload) {
    /* 路由切换先收口一切发声（音频元素暂停 + speechSynthesis 取消），
       避免听力/跟读的录音或系统语音跨到下一页继续响 */
    if (LD.UI && LD.UI.pauseAllAudio) LD.UI.pauseAllAudio();
    closeLearnSheet();
    /* 入学诊断两端都锁：未完成 → 任何路由拉回测试；已完成 → 任何入口落回首页 */
    if (!S().diagnosed) route = "diagnose";
    else if (route === "diagnose") route = "home";
    curRoute = route || "home";
    syncHash();
    document.body.dataset.route = curRoute;
    const host = document.getElementById("view");
    const mod = route === "home" ? HOME : LD.Modules[route];
    if (!mod) { LD.UI.toast("模块未找到", "err"); return; }
    /* 移动端：任何导航都收起侧栏抽屉 */
    const sb = document.getElementById("sidebar");
    if (sb) sb.classList.remove("open");
    const nm = document.getElementById("navMask");
    if (nm) nm.classList.remove("show");
    const menu = document.getElementById("menuBtn");
    if (menu) menu.setAttribute("aria-expanded", "false");
    LD.Store.visit(route === "home" ? "diagnose" : route);
    host.classList.remove("view-enter");
    void host.offsetWidth;
    host.classList.add("view-enter");
    try {
      mod.render(host, { go: go, payload: payload || null });
    } catch (e) {
      console.error(e);
      host.innerHTML = `<div class="card card-pad" style="background:var(--danger-soft)">
        <h1 style="font-size:18px">这个页面没能打开</h1>
        <p style="margin:8px 0 0">本机学习记录里有一条数据不完整。可以先重试；若反复出现，请到「设置 → 数据管理」导出学习数据备份后，使用「恢复本地快照」回到上一次正常状态。</p>
        <div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="retryRender">重试</button>
        <button class="btn btn-ghost" id="gotoHome">回到今天学什么</button></div>
        <div class="hint" style="margin-top:10px" id="renderErrDetail"></div></div>`;
      const retry = host.querySelector("#retryRender");
      if (retry) retry.onclick = () => go(route, payload);
      const home = host.querySelector("#gotoHome");
      if (home) home.onclick = () => go("home");
      const detail = host.querySelector("#renderErrDetail");
      /* 技术信息用 textContent 写，避免异常文本里的内容被当成标记解析 */
      if (detail) detail.textContent = "技术信息（供反馈使用）：" + String(e && e.message || e).slice(0, 120);
    }
    [...document.querySelectorAll(".nav-item,.nav-home")].forEach(n => {
      const active = n.dataset.route === route;
      n.classList.toggle("active", active);
      if (active) n.setAttribute("aria-current", "page"); else n.removeAttribute("aria-current");
    });
    [...document.querySelectorAll("[data-mobile-route]")].forEach(n => {
      const key = n.dataset.mobileRoute;
      const active = key === "learn" ? LEARN_ROUTES.includes(route) : key === route;
      n.classList.toggle("active", active);
      if (active) n.setAttribute("aria-current", "page"); else n.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    LD.UI.updateChips();
    LD.bus.emit(LD.EVENTS.ROUTE, { route: route });
  }

  /* hash 深链：URL 反映当前页面，刷新 / 分享 / 前进后退都能回到同一页。
     go() 内用 replaceState 写 hash（不产生历史记录、不触发 hashchange）；
     hashchange 只处理「外部来源」的变化（手动改 URL、未拦截的锚点、后退）。 */
  function syncHash() {
    const h = "#" + curRoute;
    if (location.hash === h) return;
    try { history.replaceState(null, "", h); }
    catch (e) { /* file:// 或特殊环境不允许 replaceState 时忽略 */ }
  }
  function routeFromHash() {
    const r = decodeURIComponent((location.hash || "").slice(1));
    return r && (r === "home" || LD.Modules[r]) ? r : "";
  }
  window.addEventListener("hashchange", () => {
    const r = routeFromHash();
    if (r && r !== curRoute) go(r);
  });

  LD.router = { go, renderNav, current: () => curRoute, HOME, routeFromHash };
})();
