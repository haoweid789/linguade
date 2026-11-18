/* LinguaDE · UI 层：全局提示 / 顶栏状态 / 设置抽屉 / 外壳事件
 * 从原 main.js 抽出，供模块通过 LD.UI.toast(...) 调用。
 */
(function () {
  const LD = (window.LD = window.LD || {});
  const S = () => LD.Store.s;
  const fmtTime = t => t ? new Date(+t).toLocaleString("zh-CN") : "未知";

  /* 网络错误 → 白话（学习者界面永不出现裸 HTTP 状态码；管理员诊断页另有原始细节） */
  function netErr(e) {
    const m = String((e && e.message) || e || "");
    if (/Failed to fetch|NetworkError|Load failed|ERR_INTERNET|abort|timed? ?out|超时/i.test(m)) return "网络不通，或后端没有响应";
    if (/后端未配置大模型/.test(m)) return "后端还没有配置大模型";
    const http = m.match(/HTTP\s*(\d{3})/i);
    if (http) {
      const n = +http[1];
      if (n === 404) return "后端接口不存在（网站可能没有部署 /api）";
      if (n === 501) return "后端还没有配置大模型通道";
      if (n === 422) return "请求被后端拒绝（格式不对）";
      if (n === 400) return "请求被后端拒绝";
      if (n === 401 || n === 403) return "没有通过后端的身份验证";
      if (n >= 500) return "后端服务出错了，稍后再试";
      return "请求没有成功";
    }
    return m || "未知原因";
  }

  /* 全局发声注册表：路由切换/离开页面时统一收口（听力主修 bug 的收口点）。
     注册表只做"收口"，各项发声不合议时由各自的  onend 清理。 */
  const _activeAudios = new Set();
  const _activeSpeech = new Set();
  function registerAudio(a) { if (a) { _activeAudios.add(a); const done = () => _activeAudios.delete(a); try { a.addEventListener("ended", done); a.addEventListener("error", done); } catch (e) { /* 不支持 addEventListener 的音频桩忽略 */ } } }
  function unregisterAudio(a) { if (a) _activeAudios.delete(a); }
  function registerSpeech(u) { if (u) _activeSpeech.add(u); }
  function unregisterSpeech(u) { if (u) _activeSpeech.delete(u); }
  function pauseAllAudio() {
    _activeAudios.forEach(a => { try { a.pause(); } catch (e) { /* */ } });
    _activeAudios.clear();
    try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (e) { /* */ }
  }

  function toast(msg, type) {
    const wrap = document.getElementById("toastWrap");
    if (!wrap) return;
    const d = document.createElement("div");
    d.className = "toast " + (type || "info");
    d.textContent = msg;
    wrap.appendChild(d);
    setTimeout(() => { d.style.opacity = 0; d.style.transform = "translateX(20px)"; setTimeout(() => d.remove(), 300); }, 2600);
  }

  /* 线性 SVG 图标库（Lucide 风格路径，stroke 随 currentColor）。
     取代散落在按钮/徽章里的 emoji 字符；router.js 的导航图标另有同名映射。 */
  const ICON_PATHS = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/>',
    star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.02 3.25 1.18-6.88-5-4.87 6.91-1.01z"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    pack: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    sync: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27L7.76 16.24l1.8-5.41a2 2 0 0 1 1.27-1.27z"/>',
    gradcap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sunrise: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'
  };
  function icon(name, cls) {
    const p = ICON_PATHS[name];
    return p ? `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>` : "";
  }

  /* 阅读衬线实验开关：只换阅读页德语正文的字体（见 styles.css v5 段） */
  function bindReadingSerif() {
    const apply = on => document.body.classList.toggle("serif-reading", !!on);
    apply(S().cfg.serifReading);
    const el = document.getElementById("cfgSerif");
    if (!el) return;
    el.checked = !!S().cfg.serifReading;
    el.addEventListener("change", () => {
      S().cfg.serifReading = el.checked;
      LD.Store.save();
      apply(el.checked);
      toast(el.checked ? "阅读页已换用衬线正文" : "阅读页已恢复默认字体", "ok");
    });
  }

  /* 顶栏状态：连胜 / 等级 / 冻结 / 错题角标 / 模块就绪度 */
  function updateChips() {
    const gamify = S().cfg.gamify !== false;
    const streakVal = document.getElementById("streakVal");
    if (streakVal) streakVal.textContent = LD.Store.streak();

    const streakChip = document.getElementById("streakChip");
    if (streakChip) {
      streakChip.style.display = gamify && S().diagnosed ? "" : "none";
      const fr = S().freezes || 0;
      let fv = streakChip.querySelector("#freezeVal");
      if (fr > 0) {
        if (!fv) {
          fv = document.createElement("span");
          fv.id = "freezeVal";
          fv.style.marginLeft = "5px";
          streakChip.appendChild(fv);
        }
        fv.textContent = "❄" + fr;
        streakChip.title = `连续学习 ${LD.Store.streak()} 天 · 连胜冻结 ${fr} 次`;
      } else if (fv) fv.remove();
    }

    const lv = LD.Store.levelInfo();
    const chip = document.getElementById("levelChip");
    if (chip) {
      chip.style.display = gamify && S().diagnosed ? "" : "none";
      chip.textContent = `Lv.${lv.level} · ${lv.xp} XP`;
      chip.title = `目标 ${S().profile.exam} · 经验值只增不减`;
    }

    const badge = document.getElementById("badgeWrong");
    if (badge) {
      const n = LD.Store.wrongPending().length;
      badge.textContent = n;
      badge.style.display = n ? "" : "none";
    }

    const vis = LD.Store.visitedCount();
    const pct = Math.round(vis.done / vis.total * 100);
    const pctEl = document.getElementById("readyPct");
    const barEl = document.getElementById("readyBar");
    const countEl = document.getElementById("readyCount");
    if (pctEl) pctEl.textContent = pct + "%";
    if (barEl) barEl.style.width = pct + "%";
    if (countEl) {
      countEl.textContent = vis.done + "/" + vis.total;
      if (countEl.parentElement) countEl.parentElement.title = "已打开过的模块 / 全部模块";
    }
  }

  /* 链路状态徽标：显示后端 / 大模型 / 语音 / 缓存的可用性（打开设置时刷新） */
  function paintHealth() {
    const body = document.querySelector("#settingsDrawer .drawer-body");
    if (!body) return;
    let box = document.getElementById("healthBadges");
    if (!box) {
      box = document.createElement("div");
      box.id = "healthBadges";
      box.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px";
      body.insertBefore(box, body.firstChild);
    }
    if (!LD.Backend || !LD.Backend.ready()) {
      box.innerHTML = `<span class="tag tag-warn">未配置后端 · ${LD.LLM.ready() ? "浏览器直连大模型" : "离线规则引擎"}</span>`;
      return;
    }
    box.innerHTML = `<span class="tag">后端检测中…</span>`;
    LD.Backend.health().then(h => {
      const chip = (ok, nm) => `<span class="tag ${ok ? "tag-ok" : "tag-warn"}">${nm}${ok ? " ✓" : " ✕"}</span>`;
      box.innerHTML = chip(!!h.ok, "后端") + chip(!!h.llm, "大模型") +
        chip(!!h.asr, "语音转写") + chip(!!h.redis, "Redis 缓存");
    }).catch(e => {
      box.innerHTML = `<span class="tag tag-danger">后端不可达：${netErr(e)}</span>`;
    });
  }

  /* 设置抽屉：配置读取 / 回写 / 数据导出与重置 */
  function bindSettings() {
    const drawer = document.getElementById("settingsDrawer");
    const mask = document.getElementById("drawerMask");
    if (drawer) {
      /* 表单无障碍：.form-row 里 label 与控件没有 for/id 绑定，统一补 aria-label（屏幕阅读器可读） */
      drawer.querySelectorAll(".form-row").forEach(row => {
        const lab = row.querySelector("label");
        const ctrl = row.querySelector("input, select, textarea");
        if (lab && ctrl && !ctrl.getAttribute("aria-label")) {
          const txt = String(lab.textContent || "").replace(/\s+/g, " ").trim();
          if (txt) ctrl.setAttribute("aria-label", txt.replace(/\s*[▲▼?]*$/, ""));
        }
      });
    }
    const backupStatus = document.getElementById("backupStatus");
    const paintBackupStatus = () => {
      if (!backupStatus) return;
      const day = LD.Store.localBackupDay ? LD.Store.localBackupDay() : "";
      const exported = S().lastExportAt || 0;
      const protectedAt = Math.max(day ? new Date(day + "T00:00:00").getTime() : 0, exported);
      const age = protectedAt ? Math.max(0, Math.floor((Date.now() - protectedAt) / 86400000)) : Infinity;
      /* 3.21.0：展示最近云端同步时间（含作答自动推送），由 linguade:synced 事件驱动刷新 */
      let syncText = "";
      try {
        const lastSyncAt = +(localStorage.getItem("linguade.lastSyncAt") || 0);
        syncText = lastSyncAt ? `最近云端同步：${new Date(lastSyncAt).toLocaleString("zh-CN")}` : "尚未云端同步";
      } catch (e) { /* 隐私模式忽略 */ }
      if (!day && !exported) { backupStatus.textContent = `尚无每日快照；产生学习记录并再次保存后会自动建立。建议先导出一份 JSON。${syncText ? " · " + syncText : ""}`; return; }
      const snapshotText = day ? `最近本机快照：${day}` : "尚无每日快照";
      const exportText = exported ? `最近导出：${new Date(exported).toLocaleDateString("zh-CN")}` : "尚无浏览器之外的导出文件";
      backupStatus.textContent = (age >= 7
        ? `${snapshotText} · ${exportText}。建议现在导出 JSON 到浏览器之外。`
        : `${snapshotText} · ${exportText}。若清理浏览器站点数据，本地副本也可能被删除。`) + (syncText ? " · " + syncText : "");
    };
    document.addEventListener("linguade:synced", paintBackupStatus);

    const paintContentReports = () => {
      const box = document.getElementById("contentReportStatus");
      const row = document.getElementById("contentReportRow");
      const btn = document.getElementById("exportReportsBtn");
      if (!box) return;
      const n = (S().contentReports || []).length;
      box.textContent = n ? `词条纠错反馈：${n} 条（导出学习数据时一并带走）` : "词条纠错反馈：暂无";
      if (row) row.hidden = !n;
      if (btn) btn.onclick = () => {
        const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: n, reports: S().contentReports }, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "linguade-content-reports-" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast("纠错反馈已导出", "ok");
      };
    };

    const open = () => {
      const c = S().cfg, p = S().profile;
      document.getElementById("cfgName").value = p.name || "";
      document.getElementById("cfgExam").value = p.exam;
      document.getElementById("cfgLevel").value = p.level;
      document.getElementById("cfgDaily").value = p.dailyMin;
      document.getElementById("cfgExamDate").value = p.examDate || "";
      document.getElementById("cfgLang").value = p.lang;
      const retention = document.getElementById("cfgRetention");
      if (retention) { retention.value = Math.round((c.retention || 0.9) * 100); document.getElementById("cfgRetentionVal").textContent = retention.value + "%"; }
      if (LD.Auth) { LD.Auth.syncAccountUI(); LD.Auth.loadAdminSettings(); }
      const nf = document.getElementById("cfgNotify");
      if (nf) nf.checked = !!c.notify;
      const gf = document.getElementById("cfgGamify");
      if (gf) gf.checked = c.gamify !== false;
      paintContentReports();
      paintBackupStatus();
      paintHealth();
      drawer.classList.add("show");
      mask.classList.add("show");
    };
    const close = () => { drawer.classList.remove("show"); mask.classList.remove("show"); };
    document.getElementById("settingsBtn").onclick = open;
    document.getElementById("closeDrawer").onclick = close;
    mask.onclick = close;

    const bind = (id, key, obj) => {
      const el = document.getElementById(id);
      el.addEventListener("change", () => {
        const target = obj === "cfg" ? S().cfg : S().profile;
        target[key] = el.type === "number" ? +el.value : el.value;
        LD.Store.save();
        updateChips();
        toast("已保存", "ok");
      });
    };
    bind("cfgName", "name", "profile");
    bind("cfgExam", "exam", "profile");
    bind("cfgLevel", "level", "profile");
    document.getElementById("cfgLevel").addEventListener("change", () => {
      S().profile.levelTouched = true;
      LD.Store.save();
    });
    bind("cfgDaily", "dailyMin", "profile");
    bind("cfgLang", "lang", "profile");
    bind("cfgExamDate", "examDate", "profile");

    const retention = document.getElementById("cfgRetention");
    if (retention) retention.addEventListener("input", () => {
      document.getElementById("cfgRetentionVal").textContent = retention.value + "%";
      S().cfg.retention = (+retention.value || 90) / 100;
      LD.Store.save();
    });

    /* 学习提醒：请求浏览器通知权限（拒绝时如实提示并回退开关） */
    const notifyEl = document.getElementById("cfgNotify");
    if (notifyEl) {
      notifyEl.addEventListener("change", () => {
        if (!notifyEl.checked) { S().cfg.notify = false; LD.Store.save(); toast("提醒已关闭", "ok"); return; }
        if (!("Notification" in window)) { notifyEl.checked = false; toast("当前浏览器不支持通知", "err"); return; }
        if (Notification.permission === "granted") { S().cfg.notify = true; LD.Store.save(); toast("提醒已开启", "ok"); return; }
        Notification.requestPermission().then(p => {
          if (p === "granted") { S().cfg.notify = true; LD.Store.save(); toast("提醒已开启", "ok"); }
          else { notifyEl.checked = false; toast("通知权限被拒绝，未开启提醒", "err"); }
        });
      });
    }

    /* 游戏化开关：关闭后隐藏顶栏 XP/连胜、首页每日任务与周历 */
    const gamifyEl = document.getElementById("cfgGamify");
    if (gamifyEl) {
      gamifyEl.addEventListener("change", () => {
        S().cfg.gamify = gamifyEl.checked;
        LD.Store.save();
        updateChips();
        toast(gamifyEl.checked ? "已显示游戏化元素" : "已隐藏游戏化元素", "ok");
        if (LD.router && LD.router.current() === "home") LD.router.go("home");
      });
    }

    /* 导入：JSON（全量导出/云端快照）或 Anki TSV（front/back/source → 生词本） */
    const importBtn = document.getElementById("importBtn");
    const importFile = document.getElementById("importFile");
    if (importBtn && importFile) {
      importBtn.onclick = () => importFile.click();
      importFile.onchange = () => {
        const f = importFile.files && importFile.files[0];
        if (!f) return;
        const kind = /\.(tsv|txt)$/i.test(f.name) ? "tsv" : "json";
        const reader = new FileReader();
        reader.onload = () => {
          const r = LD.Store.importData(String(reader.result || ""), kind);
          if (!r.ok) { toast(r.error || "导入失败", "err"); return; }
          if (r.kind === "tsv") toast(`已导入 ${r.imported} 个生词`, "ok");
          else { toast("数据已恢复，正在刷新……", "ok"); setTimeout(() => location.reload(), 600); }
          importFile.value = "";
        };
        reader.onerror = () => toast("文件读取失败", "err");
        reader.readAsText(f, "utf-8");
      };
    }

    /* 从云端恢复：拉取最近一次同步快照（保留本机设置与设备标识） */
    const pullBtn = document.getElementById("pullBtn");
    if (pullBtn) pullBtn.onclick = () => {
      if (!LD.Backend || !LD.Backend.ready()) { toast("当前离线模式，未连到后端", "err"); return; }
      pullBtn.disabled = true;
      LD.Backend.pullSync().then(j => {
        pullBtn.disabled = false;
        /* 恢复也走合并：两边各学过的记录取并集，不再用一边覆盖另一边 */
        const merged = LD.Store.mergeStates(LD.Store.s, j.snapshot || {});
        if (!confirm(`云端与本机会合并：新增 ${merged.stats.added} 条 · 更新 ${merged.stats.updated} 条。\n\n本机设置与设备标识保留，任何一侧的学习记录都不会被删除。继续？`)) return;
        if (LD.Store.restoreSnapshot(merged.state)) { toast("已合并云端数据，正在刷新……", "ok"); setTimeout(() => location.reload(), 600); }
        else toast("快照格式异常，合并失败", "err");
      }).catch(e => { pullBtn.disabled = false; toast("恢复失败：" + e.message, "err"); });
    };

    document.getElementById("exportBtn").onclick = () => {
      LD.Store.markExported();
      const blob = new Blob([LD.Store.exportData()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "linguade-export-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      toast("学习数据已导出", "ok");
      if (backupStatus) backupStatus.textContent = `已在 ${new Date().toLocaleString("zh-CN")} 导出一份 JSON；请将文件保存在浏览器数据目录之外。`;
    };
    /* B9：全词库导出 Anki TSV */
    const exportTsvBtn = document.getElementById("exportTsvBtn");
    if (exportTsvBtn) exportTsvBtn.onclick = () => {
      const tsv = LD.Store.exportLexiconTSV();
      const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "linguade-lexicon-" + new Date().toISOString().slice(0, 10) + ".tsv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`词库已导出（${tsv.split("\n").length - 1} 词，可导入 Anki）`, "ok");
    };
    /* B9：LibreLingo 课程包导入 */
    const importLxYamlBtn = document.getElementById("importLxYamlBtn");
    const lxYamlFile = document.getElementById("lxYamlFile");
    if (importLxYamlBtn && lxYamlFile) {
      importLxYamlBtn.onclick = () => lxYamlFile.click();
      lxYamlFile.onchange = () => {
        const f = lxYamlFile.files && lxYamlFile.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          const r = LD.Store.importLibreLingoYaml(String(reader.result || ""));
          if (r.errors.length) toast(`导入完成：+${r.added} 新增 / ${r.skipped} 跳过 / ${r.errors.length} 行错误（缺 de/zh 或非法 genus）`, r.added ? "ok" : "err");
          else toast(`已导入 ${r.added} 词（跳过 ${r.skipped} 重复）`, "ok");
          lxYamlFile.value = "";
        };
        reader.onerror = () => toast("文件读取失败", "err");
        reader.readAsText(f, "utf-8");
      };
    }
    const backupBtn = document.getElementById("restoreLocalBackupBtn");
    if (backupBtn) backupBtn.onclick = async () => {
      if (!confirm("用最近一次本地自动快照覆盖当前学习数据？")) return;
      if (await LD.Store.restoreLocalBackup()) { toast("本地快照已恢复，正在刷新……", "ok"); setTimeout(() => location.reload(), 500); }
      else toast("没有可恢复的本地快照", "err");
    };
    document.getElementById("resetBtn").onclick = () => {
      if (confirm("确定清空全部学习数据？该操作不可恢复。")) {
        const oid = LD.Store.s.open_id;
        const cloud = (LD.Backend && LD.Backend.ready())
          ? LD.Store.resetCloud(oid).catch(() => {})
          : Promise.resolve();
        LD.Store.reset();
        cloud.then(() => location.reload());
      }
    };
  }

  /* 外壳事件：导航（事件委托，兼容注册表动态渲染）/ 品牌 / 主题 / 同步 / 快捷键 */
  function bindShell() {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebar.addEventListener("click", e => {
        const item = e.target.closest(".nav-item,.nav-home");
        if (item && item.dataset.route) { e.preventDefault(); closeNav(); LD.router.go(item.dataset.route); }
      });
    }
    const brand = document.querySelector(".brand");
    if (brand) {
      brand.onclick = () => LD.router.go("home");
      /* logo 是回首页的唯一入口，必须能用键盘到达并触发 */
      brand.setAttribute("role", "link");
      brand.setAttribute("tabindex", "0");
      brand.setAttribute("aria-label", "回到今天学什么");
      brand.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); LD.router.go("home"); }
      });
    }

    /* 移动端导航：汉堡开关 + 遮罩关闭（桌面端由 CSS 隐藏，逻辑无副作用） */
    const menuBtn = document.getElementById("menuBtn");
    const navMask = document.getElementById("navMask");
    if (menuBtn) menuBtn.onclick = () => {
      const open = sidebar && sidebar.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (navMask) navMask.classList.toggle("show", !!open);
    };
    if (navMask) navMask.onclick = closeNav;
    function closeNav() {
      if (sidebar) sidebar.classList.remove("open");
      if (navMask) navMask.classList.remove("show");
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    }

    const themeBtn = document.getElementById("themeBtn");
    if (themeBtn) themeBtn.onclick = () => {
      const dark = document.documentElement.classList.toggle("dark");
      S().cfg.theme = dark ? "dark" : "light";
      LD.Store.save();
    };
    const syncBtn = document.getElementById("syncBtn");
    if (syncBtn) syncBtn.onclick = () => {
      if (!LD.Backend || !LD.Backend.ready()) { toast("当前离线模式，未连到后端", "err"); return; }
      syncBtn.disabled = true;
      /* 同步已改为「先拉云端 → 字段级合并 → 推并集」：不再整档覆盖，也不需要冲突确认。
         手动点按属于明确意图，force 始终推送（启动自动合并才按增量省流量）。 */
      LD.Store.sync({ force: true }).then(r => {
        const m = (r && r.merge) || { added: 0, updated: 0 };
        toast(`已同步：合并云端记录（新增 ${m.added} 条 · 更新 ${m.updated} 条）`, "ok");
        if (m.added || m.updated) setTimeout(() => location.reload(), 700);
      }).catch(e => toast("同步失败：" + netErr(e), "err"))
        .finally(() => { syncBtn.disabled = false; });
    };

    document.addEventListener("keydown", e => {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
      if (LD.router.current() !== "vocab" || e.ctrlKey || e.metaKey || e.altKey) return;
      const view = document.getElementById("view");
      if (e.code === "Space") {
        const f = view.querySelector("#flipBtn");
        const rateBar = view.querySelector("#rate");
        if (f && !(rateBar && rateBar.style.display !== "none")) { e.preventDefault(); f.click(); }
        return;
      }
      /* 1–4 直接评分（翻面后生效；未翻面时先翻面，避免误评） */
      const k = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[e.code];
      if (k == null) return;
      const rateBar = view.querySelector("#rate");
      if (!rateBar) return;
      e.preventDefault();
      if (rateBar.style.display === "none") { const f = view.querySelector("#flipBtn"); if (f) f.click(); return; }
      const b = rateBar.querySelector('.rate-btn[data-v="' + k + '"]');
      if (b) b.click();
    });
  }

  /* 合并模块的页签：把重叠工具（透视/弱点/发音/拍照）收进同一入口 */
  function moduleTabs(host, tabs, active) {
    const html = `<div class="module-tabs" role="tablist" aria-label="相关模块">${tabs.map(t =>
      `<button type="button" class="module-tab${t.route === active ? " active" : ""}" data-tab="${t.route}" role="tab" aria-selected="${t.route === active}">${t.label}${t.note ? `<small>${t.note}</small>` : ""}</button>`
    ).join("")}</div>`;
    const head = host.querySelector(".page-head");
    if (head) head.insertAdjacentHTML("afterend", html);
    else host.insertAdjacentHTML("afterbegin", html);
    host.querySelectorAll("[data-tab]").forEach(b => { b.onclick = () => LD.router.go(b.dataset.tab); });
  }

  /* ---- 学习计划（3.20 / 3.22）：首页、诊断、计划页共用同一套任务与勾选 ----
     任务身份由引擎按「日期 + 内容」派生；勾选是自报完成，不等于能力掌握。
     勾选状态存主档案（可导出/云同步），localStorage 镜像只用于兼容旧页面。 */
  const FW_KEY = "linguade.planDone";
  const FW_CTX = "linguade.taskContext";
  const FW_RUN = "linguade.taskRun.v1";
  const fwEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function fwReadRun() {
    try {
      const v = JSON.parse(localStorage.getItem(FW_RUN) || "null");
      return v && typeof v === "object" ? v : null;
    } catch (e) { return null; }
  }
  function fwWriteRun(c) {
    if (!c) return;
    const raw = JSON.stringify(c);
    try { localStorage.setItem(FW_RUN, raw); } catch (e) { }
    try { sessionStorage.setItem(FW_CTX, raw); } catch (e) { }
  }
  function fwSpecTarget(task) {
    const n = task && task.spec && +task.spec.target;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  function fwDoneMap() {
    const out = {};
    const state = LD.Store && LD.Store.s;
    if (state && state.planDone) {
      Object.keys(state.planDone).forEach(k => { if (state.planDone[k] && state.planDone[k].done) out[k] = true; });
    }
    if (!Object.keys(out).length) {
      try {
        const v = JSON.parse(localStorage.getItem(FW_KEY) || "{}");
        if (v && typeof v === "object") Object.keys(v).forEach(k => { if (v[k] === true) out[k] = true; });
      } catch (e) { }
    }
    return out;
  }
  function fwIsDone(taskId) {
    if (LD.Store && LD.Store.isPlanTaskDone) return LD.Store.isPlanTaskDone(taskId);
    return !!fwDoneMap()[taskId];
  }
  function fwSetDone(taskId, done, src, meta) {
    const run = fwContext();
    if (done && run && run.taskId === taskId) fwClearContext();
    if (LD.Store && LD.Store.setPlanTaskDone) return LD.Store.setPlanTaskDone(taskId, done, src, meta);
    const map = fwDoneMap();
    if (done) map[taskId] = true; else delete map[taskId];
    try { localStorage.setItem(FW_KEY, JSON.stringify(map)); } catch (e) { }
    return !!done;
  }
  function fwDoneCount(day) {
    return (day.tasks || []).filter(t => t && t.id && fwIsDone(t.id)).length;
  }
  function fwDate(date) {
    const d = new Date(date + "T00:00:00");
    return { md: (d.getMonth() + 1) + "/" + d.getDate(), wd: "日一二三四五六"[d.getDay()] };
  }
  function fwRoute(mod, task) {
    return (task && task.route) || ({ speaking: "speech", review: "notebook" })[mod] || mod || "vocab";
  }
  function fwTaskRow(day, task) {
    const on = fwIsDone(task.id);
    const meta = (LD.Store && LD.Store.planTaskEntry) ? LD.Store.planTaskEntry(task.id) : null;
    const label = `${task.text} · ${task.min} 分钟`;
    const fromRound = !!(on && meta && meta.src === "vocab-round");
    return `<div class="fw-task${on ? " done" : ""}" data-fw-task="${fwEsc(task.id)}"${fromRound ? ' data-fw-src="vocab-round"' : ""}>
      <button type="button" class="fw-check" data-fw-toggle aria-pressed="${on}" aria-label="${on ? (fromRound ? "已完成（词汇练习记录）" : "取消完成") : "标记完成"}：${fwEsc(task.text)}">${on ? "✓" : "○"}</button>
      <span class="fw-task-text">${fwEsc(task.text)}</span>
      <span class="fw-task-min">${task.min}′</span>
      <button type="button" class="btn btn-sm" data-fw-go="${fwRoute(task.mod, task)}" data-fw-id="${fwEsc(task.id)}" aria-label="去完成：${fwEsc(label)}">去</button>
    </div>`;
  }
  function fwDay(day, opts) {
    opts = opts || {};
    const dt = fwDate(day.date);
    const today = (LD.Store && LD.Store.dayKey) ? LD.Store.dayKey() : new Date().toISOString().slice(0, 10);
    return `<section class="fw-day-card${day.date === today ? " today" : ""}" id="${opts.id || ""}" aria-label="${dt.md} 周${dt.wd} 的任务">
      <div class="fw-day-head"><b>${dt.md} 周${dt.wd}</b><span>${day.tasks.reduce((a, t) => a + t.min, 0)} 分钟</span></div>
      ${day.tasks.map(t => fwTaskRow(day, t)).join("")}
    </section>`;
  }
  function fwRender(plan, opts) {
    opts = opts || {};
    if (!Array.isArray(plan) || !plan.length) return "";
    const today = (LD.Store && LD.Store.dayKey) ? LD.Store.dayKey() : new Date().toISOString().slice(0, 10);
    const entry = plan.find(d => d.date === today) || plan[0];
    if (!entry) return "";
    const id = opts.id || "firstWeek";
    const doneN = plan.reduce((a, d) => a + fwDoneCount(d), 0);
    const total = plan.reduce((a, d) => a + d.tasks.length, 0);
    const allTodayDone = entry.tasks.length > 0 && fwDoneCount(entry) >= entry.tasks.length;
    const dayIndex = plan.findIndex(d => d.date === entry.date) + 1;
    const days = plan.map(d => {
      const dt = fwDate(d.date);
      const n = fwDoneCount(d);
      const cls = [d.date === today ? "today" : "", n >= d.tasks.length ? "done" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="fw-day${cls ? " " + cls : ""}" data-fw-day="${d.date}" title="${d.date} · ${n}/${d.tasks.length} 完成">
        <b>${dt.wd}</b><span>${dt.md}</span><i>${n}/${d.tasks.length}</i></button>`;
    }).join("");
    const compactWeek = !!(window.matchMedia && window.matchMedia("(max-width:680px)").matches);
    const weekDesktop = `<div class="fw-days fw-days-desktop" aria-label="本周安排">${days}</div>`;
    const weekMobile = `<details class="fw-week-mobile">
      <summary><span>本周安排</span><b>${doneN}/${total} · 第 ${dayIndex} 天</b></summary>
      <div class="fw-days">${days}</div>
    </details>`;
    const week = compactWeek ? weekMobile : weekDesktop;
    const full = opts.full
      ? `<div class="fw-week-grid">${plan.map(d => fwDay(d)).join("")}</div>`
      : `<div class="fw-today">
          <div class="fw-today-head"><b>今天 · ${fwDate(entry.date).md}</b><span>${entry.tasks.reduce((a, t) => a + t.min, 0)} 分钟</span></div>
          ${entry.tasks.map(t => fwTaskRow(entry, t)).join("")}
        </div>`;
    return `<section class="card card-pad first-week${opts.full ? " first-week-full" : ""}${allTodayDone ? " all-done" : ""}" id="${id}" aria-labelledby="${id}Title">
      <div class="home-section-head">
        <div><h2 id="${id}Title">${opts.title || "今日任务"}</h2><p>${opts.subtitle || "按诊断结果与每日时长生成。"}</p></div>
        <span class="tag tag-blue" data-fw-progress>本周 ${doneN} / ${total}</span>
      </div>
      ${opts.full ? "" : week}
      ${full}
      <div class="fw-foot">
        <span>${allTodayDone ? "今天的任务都完成了，可以休息或自由练习。" : ""}</span>
        <button type="button" class="btn btn-sm" data-fw-plan>${opts.full ? "在计划中查看本周" : "查看本周计划"}</button>
      </div>
    </section>`;
  }
  function fwContext() {
    const run = fwReadRun();
    let legacy = null;
    try {
      const c = JSON.parse(sessionStorage.getItem(FW_CTX) || "null");
      legacy = c && typeof c === "object" ? c : null;
    } catch (e) { legacy = null; }
    const legacyAt = legacy ? (Number.isFinite(+legacy.at) ? +legacy.at : Infinity) : 0;
    if (legacy && (!run || legacyAt > (+run.at || 0))) return legacy;
    return run || legacy;
  }
  function fwClearContext() {
    try { localStorage.removeItem(FW_RUN); } catch (e) { }
    try { sessionStorage.removeItem(FW_CTX); } catch (e) { }
  }
  function fwLaunch(task, date, returnTo) {
    if (!task || !task.id) return fwRoute(task && task.mod);
    const route = fwRoute(task.mod, task);
    const existing = fwReadRun();
    const same = existing && existing.taskId === task.id && existing.date === date
      && existing.status !== "done" && !fwIsDone(task.id);
    const run = same ? existing : {
      taskId: task.id,
      date,
      route,
      text: task.text,
      min: task.min,
      limit: task.mod === "vocab" ? (task.words || Math.max(4, Math.round(task.min / 1.2))) : null,
      reviewOnly: !!task.reviewOnly,
      spec: task.spec || null,
      target: fwSpecTarget(task) || 1,
      attemptId: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      startedAt: Date.now(),
      progress: 0,
      data: {},
      evidence: [],
      status: "active"
    };
    run.route = route;
    run.returnTo = returnTo || "home";
    run.at = Date.now();
    fwWriteRun(run);
    return route;
  }
  function fwContextFor(route) {
    const c = fwContext();
    if (!c) return null;
    if (c.date && LD.Store && c.date !== LD.Store.dayKey()) { fwClearContext(); return null; }
    if (route && c.route !== route) return null;
    return c;
  }
  function fwSaveContext(c) { fwWriteRun(c); }
  function fwUpdate(c, patch) {
    if (!c) return null;
    Object.assign(c, patch || {}, { at: Date.now() });
    fwWriteRun(c);
    return c;
  }
  function fwTarget(c) {
    if (c && Number.isFinite(+c.target) && +c.target > 0) return +c.target;
    const n = c && c.spec && +c.spec.target;
    if (Number.isFinite(n) && n > 0) return n;
    /* 兼容 3.22 旧上下文：“1 组（10 句）”取更大的数量作为本轮上限 */
    const nums = [...String((c && c.text) || "").matchAll(/(\d+)\s*(句|篇|题|轮|组)/g)].map(m => +m[1]);
    return nums.length ? Math.max(1, ...nums) : 1;
  }
  function fwBump(c) {
    if (!c) return 0;
    c.progress = (+c.progress || 0) + 1;
    c.at = Date.now();
    fwSaveContext(c);
    return c.progress;
  }
  function fwEvidence(c, label) {
    if (!c || !label) return;
    c.evidence = Array.isArray(c.evidence) ? c.evidence : [];
    if (!c.evidence.includes(label)) c.evidence.push(label);
    c.at = Date.now();
    fwSaveContext(c);
  }
  function fwEvidenceLabel(c) {
    const list = c && Array.isArray(c.evidence) ? c.evidence.filter(Boolean) : [];
    return list.length ? list.join("、") : "练习记录";
  }
  function fwNotice(c) {
    if (!c) return "";
    const progress = c.progress ? ` · 已完成 ${Math.min(c.progress, fwTarget(c))}/${fwTarget(c)}` : "";
    return `<div class="card card-pad fw-context" role="status">
      <div class="fw-context-main"><span class="tag tag-blue">今日计划任务</span><b>${fwEsc(c.text)}</b><span class="hint">约 ${c.min} 分钟${progress} · 暂时离开会保留进度</span></div>
      <button type="button" class="btn btn-sm" data-fw-exit>退出计划练习</button>
    </div>`;
  }
  /* 3.24：模块只有在达到任务目标、证据齐全时才会渲染确认入口——此刻直接记入今日任务，
     不再要求用户二次确认。不清理任务上下文：「返回今日任务」按钮仍走原确认流程（幂等），
     「撤销」把这条任务改回未完成。 */
  function fwAutoDone(c, source) {
    if (!c || !c.taskId || !LD.Store || !LD.Store.setPlanTaskDone) return false;
    if (LD.Store.isPlanTaskDone(c.taskId)) return true;
    LD.Store.setPlanTaskDone(c.taskId, true, source || "task-round", {
      attemptId: c.attemptId || "",
      evidence: Array.isArray(c.evidence) ? c.evidence : [],
      progress: +c.progress || 0,
      target: fwTarget(c)
    });
    return true;
  }
  function fwUndo(c) {
    return c && c.taskId ? `<button type="button" class="btn btn-ghost" data-fw-undo="${fwEsc(c.taskId)}">撤销完成</button>` : "";
  }
  function fwResult(c, source, opts) {
    opts = opts || {};
    if (!c) return "";
    const auto = opts.confirm !== false && fwAutoDone(c, source);
    const confirm = opts.confirm === false ? "" : `<button type="button" class="btn btn-primary" data-fw-confirm="${fwEsc(source)}" data-fw-attempt="${fwEsc(c.attemptId || "")}">已记入今日任务 · 返回</button>`;
    return `<div class="btn-row fw-result-actions">${confirm}${auto ? fwUndo(c) : `<button type="button" class="btn" data-fw-return>${fwEsc(opts.returnLabel || "先不标记，返回任务")}</button>`}</div>`;
  }
  function fwReceipt(c, opts) {
    opts = opts || {};
    if (!c) return "";
    const evidence = opts.evidence || fwEvidenceLabel(c);
    const auto = opts.confirm !== false && fwAutoDone(c, opts.source || "task-round");
    const confirm = opts.confirm === false ? "" : `<button type="button" class="btn btn-primary" data-fw-confirm="${fwEsc(opts.source || "task-round")}" data-fw-attempt="${fwEsc(c.attemptId || "")}">已记入今日任务 · 返回</button>`;
    return `<div class="${opts.embedded ? "fw-receipt fw-receipt-embedded" : "card card-pad fw-receipt"}" role="status" aria-label="本次任务回执">
      <div class="fw-receipt-head"><span class="tag tag-ok">${fwEsc(opts.title || "本次完成")}</span><b>${fwEsc(opts.summary || c.text)}</b></div>
      ${opts.detail ? `<div class="fw-receipt-detail">${opts.detail}</div>` : ""}
      <div class="fw-receipt-meta">证据：${fwEsc(evidence)} · 本轮 ${Math.min(+c.progress || 0, fwTarget(c))}/${fwTarget(c)}</div>
      <div class="btn-row fw-receipt-actions">${confirm}${auto ? fwUndo(c) : `<button type="button" class="btn" data-fw-return>${fwEsc(opts.returnLabel || "暂时离开，稍后继续")}</button>`}</div>
    </div>`;
  }
  function fwMarkDone(row) {
    if (!row || !row.classList) return;
    if (!("matchMedia" in window) || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      row.classList.add("fw-marked");
      setTimeout(() => row.classList.remove("fw-marked"), 500);
    }
  }
  function fwBind(host, handlers) {
    const findTask = id => {
      const s = LD.Store.s;
      const fw = s.firstWeek;
      if (!fw || !Array.isArray(fw.plan)) return null;
      for (const d of fw.plan) {
        const t = (d.tasks || []).find(x => x.id === id);
        if (t) return { day: d, task: t };
      }
      return null;
    };
    host.querySelectorAll("[data-fw-task]").forEach(row => {
      if (!row._fwInit) {
        row._fwInit = true;
        const ck0 = row.querySelector(".fw-check");
        if (ck0 && ck0.getAttribute("aria-pressed") === "true") fwMarkDone(row);
      }
      const toggle = e => {
        if (e.target.closest("[data-fw-go]")) return;
        const id = row.dataset.fwTask;
        const on = !fwIsDone(id);
        fwSetDone(id, on);
        row.classList.toggle("done", on);
        const check = row.querySelector(".fw-check");
        if (check) {
          check.textContent = on ? "✓" : "○";
          check.setAttribute("aria-pressed", on ? "true" : "false");
          check.setAttribute("aria-label", `${on ? "取消完成" : "标记完成"}：${row.querySelector(".fw-task-text").textContent}`);
        }
        if (handlers && handlers.onToggle) handlers.onToggle(id, on);
      };
      row.onclick = toggle;
    });
    host.querySelectorAll("[data-fw-go]").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const hit = findTask(b.dataset.fwId);
      if (!hit) return;
      const route = fwLaunch(hit.task, hit.day.date, (handlers && handlers.returnTo) || "home");
      if (handlers && handlers.onGo) handlers.onGo(route);
    });
    host.querySelectorAll("[data-fw-plan]").forEach(a => a.onclick = e => {
      e.preventDefault();
      try { sessionStorage.setItem("linguade.planFocus", (LD.Store && LD.Store.dayKey) ? LD.Store.dayKey() : ""); } catch (err) { }
      if (handlers && handlers.onGo) handlers.onGo("plan");
    });
    host.querySelectorAll("[data-fw-day]").forEach(a => a.onclick = e => {
      e.preventDefault();
      try { sessionStorage.setItem("linguade.planFocus", a.dataset.fwDay || ""); } catch (err) { }
      if (handlers && handlers.onGo) handlers.onGo("plan");
    });
  }
  /* 各学习模块共用：退出当前练习 / 不标记直接回任务 / 完成本轮后确认 */
  document.addEventListener("click", e => {
    const exit = e.target.closest("[data-fw-exit]");
    if (exit) {
      const c = fwContext();
      fwClearContext();
      if (LD.router) LD.router.go((c && c.route) || "home");
      return;
    }
    const back = e.target.closest("[data-fw-return]");
    if (back) {
      const c = fwContext();
      if (c && c.returnTo === "plan" && c.date) {
        try { sessionStorage.setItem("linguade.planFocus", c.date); } catch (err) { }
      }
      if (LD.router) LD.router.go((c && c.returnTo) || "home");
      return;
    }
    const undo = e.target.closest("[data-fw-undo]");
    if (undo) {
      if (LD.Store && LD.Store.setPlanTaskDone) LD.Store.setPlanTaskDone(undo.dataset.fwUndo, false, "self");
      undo.disabled = true;
      undo.textContent = "已撤销";
      const primary = undo.parentElement && undo.parentElement.querySelector("[data-fw-confirm]");
      if (primary) primary.remove();
      undo.insertAdjacentHTML("afterend", '<button type="button" class="btn" data-fw-return>返回任务</button>');
      if (LD.UI && LD.UI.toast) LD.UI.toast("已改回未完成", "ok");
      return;
    }
    const confirm = e.target.closest("[data-fw-confirm]");
    if (confirm) {
      const c = fwContext();
      if (!c) return;
      const attempt = confirm.dataset.fwAttempt || "";
      if (attempt && c.attemptId && attempt !== c.attemptId) {
        if (LD.UI && LD.UI.toast) LD.UI.toast("这条结果不属于当前任务，未标记完成", "err");
        return;
      }
      fwSetDone(c.taskId, true, confirm.dataset.fwConfirm || "task-round", {
        attemptId: c.attemptId || "",
        evidence: Array.isArray(c.evidence) ? c.evidence : [],
        progress: +c.progress || 0,
        target: fwTarget(c)
      });
      fwClearContext();
      if (LD.UI && LD.UI.toast) LD.UI.toast("已记入今日任务", "ok");
      if (c.returnTo === "plan" && c.date) {
        try { sessionStorage.setItem("linguade.planFocus", c.date); } catch (err) { }
      }
      if (LD.router) LD.router.go(c.returnTo || "home");
    }
  });
  LD.FirstWeek = {
    render: fwRender, day: fwDay, bind: fwBind, done: fwDoneMap, markRow: fwMarkDone,
    isDone: fwIsDone, setDone: fwSetDone, count: fwDoneCount,
    route: fwRoute, launch: fwLaunch, context: fwContext, clearContext: fwClearContext,
    contextFor: fwContextFor, notice: fwNotice, result: fwResult, receipt: fwReceipt,
    target: fwTarget, bump: fwBump, update: fwUpdate, evidence: fwEvidence,
    evidenceLabel: fwEvidenceLabel, attempt: c => c && c.attemptId
  };
  LD.UI = { toast, updateChips, bindSettings, bindShell, moduleTabs, netErr, bindReadingSerif,
             registerAudio, unregisterAudio, registerSpeech, unregisterSpeech, pauseAllAudio };
  LD.icon = icon;
})();
