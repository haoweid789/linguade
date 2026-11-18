/* LinguaDE · 数据层：本地持久化 + 学习记忆模型
   说明：原型阶段数据落在浏览器本地；配置后端地址后可通过 LD.sync() 推送到 FastAPI。 */
(function () {
  const KEY = "linguade.v1";
  const DB_NAME = "linguade.local.v1";
  const DB_STORE = "snapshots";

  const DEF = {
    version: 4,
    updatedAt: 0,
    lastExportAt: 0,
    profile: {
      name: "学习者", exam: "TestDaF", level: "B1", levelTouched: false, dailyMin: 30, lang: "bilingual",
      examDate: "",           // 考试日期：驱动 fitToExam 倒排调度
      placement: null,        // C1 分级测评 {level, vocabEst, vocabRange, layers, grammar, at}；null = 未测
      createdAt: Date.now()
    },
    open_id: "",          // 设备标识：后端契约必填字段（chat / interview / sync）
    cfg: { apiBase: "", apiKey: "", model: "", backend: "", theme: "light", llmOn: false, notify: false, retention: 0.9, gamify: true, serifReading: false },
    cards: {},          // 旧 SM-2 档案（v4 起只读，保留给沙盘/兼容；调度走 fsrs）
    fsrs: {},           // B2 FSRS 调度档案：word/句/字符/… 粒度 -> {kind, stability, difficulty, reps, lapses, last, due}
    notes: {},          // B2 note 注册表：id -> {kind, ref, createdAt}
    log: [],            // 逐题作答流水
    wrong: [],          // 错题本
    wordbank: [],       // 对话生词本：{id, de, ctx, scene, zh, t, known}
    sessions: [],       // 每次学习会话
    daily: {},          // { date: minutes }
    ability: { vocab: 50, grammar: 50, listening: 40, speaking: 40, reading: 50, writing: 45 },
    chats: {},          // sceneId -> messages（消息带 sid 标识所属对话轮次）
    chatActive: {},     // sceneId -> {sid, startedAt}：当前未结束的对话会话
    chatReports: [],    // 对话课后报告：{id, sid, scene, turns, errorTypes, repeats, newWords, dims, next…}
    chatPersona: "strict", // 对话室人设：strict 严谨外教 / buddy 日常语伴 / slow 慢速入门 / travel 旅行德语
    chatVoice: "",      // 对话室朗读音色（voiceURI；空 = 系统默认德语）
    timelineDone: {},   // 留德时间轴手动勾选：{ "stageId:taskIndex": true }
    path: {},           // 学习路径检查点：{ unitId: {score, t} }
    interviews: [],     // 模拟面试记录
    speeches: [],       // 口语测评记录
    plan: null,         // 自适应学习计划
    planBase: null,     // 28 天基础排期；7/14/28 天与首页首周都从这里切片
    firstWeek: null,    // 诊断后生成的首周计划 {version, generatedAt, sig, daily, focus, plan:[7 天]}
    planDone: {},       // 任务完成：{taskId: {done, at}}；随导出/云同步，旧版布尔值自动迁移
    xp: 0,              // 经验值（只增不减：进度指标，非能力指标——Duolingo 设计原则）
    quests: null,       // 每日任务 {date, items:[{id,nm,ic,target,mod,xp,progress,done}]}
    diagnosed: false,   // 是否完成入学诊断
    visited: {},        // 模块访问计数（就绪度用）
    freezes: 0,         // 连胜冻结次数（每连续 7 天 +1，上限 3，断连胜时自动消耗）
    freezeEarnedAt: 0,  // 已发放冻结时的连胜值（防止重复发放）
    bestStreak: 0,      // 历史最长连胜
    revive: null,       // 断连胜复活窗口 {target, until}
    badges: [],         // 已解锁成就徽章 id
    mockexams: [],      // 全真模考记录（mockexam 模块写入）
    writingHist: [],    // 写作批改历史（题目→分数曲线，支撑同题改写对比）
    writingDrafts: {},  // 按题目保存的写作草稿
    favorites: [],      // 首页收藏模块路由
    recentModules: [],  // 最近使用的模块路由（最新在前）
    contentPack: null,  // 已导入的内容包（如 {speech:[{id,de,hasAudio}]}，来自 tools/content_pipeline.py）
    contentPacksImported: {},  // 部署形态已导入的内容包文件名（避免首页重复提示）
    contentReports: []  // 用户提交的词条纠错反馈：{de, fields, t}
  };

  /* 设备标识：首次访问生成并立即落盘（后端契约的 open_id 必填字段） */
  function ensureOpenId(state) {
    if (!state.open_id || state.open_id.length < 6) {
      state.open_id = "ld-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
    return state.open_id;
  }

  let state = null;

  let backupDbPromise = null;
  function openBackupDb() {
    if (backupDbPromise) return backupDbPromise;
    if (!window.indexedDB) return Promise.resolve(null);
    backupDbPromise = new Promise(resolve => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return backupDbPromise;
  }
  function idbGet(key) {
    return openBackupDb().then(db => !db ? null : new Promise(resolve => {
      try { const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key); req.onsuccess = () => resolve(req.result || null); req.onerror = () => resolve(null); }
      catch (e) { resolve(null); }
    }));
  }
  function idbPut(key, value) {
    return openBackupDb().then(db => !db ? false : new Promise(resolve => {
      try { const tx = db.transaction(DB_STORE, "readwrite"); tx.objectStore(DB_STORE).put(value, key); tx.oncomplete = () => resolve(true); tx.onerror = tx.onabort = () => resolve(false); }
      catch (e) { resolve(false); }
    }));
  }
  function migrate(parsed) {
    const data = Object.assign({}, DEF, parsed || {});
    ["profile", "cfg", "ability"].forEach(k => {
      const value = parsed && parsed[k];
      data[k] = Object.assign({}, DEF[k], value && typeof value === "object" && !Array.isArray(value) ? value : {});
    });
    ["cards", "daily", "chats", "chatActive", "timelineDone", "path", "visited", "contentPacksImported", "writingDrafts", "readingDone", "planDone", "fsrs", "notes"].forEach(k => {
      if (!data[k] || typeof data[k] !== "object" || Array.isArray(data[k])) data[k] = {};
    });
    /* B2 迁移：v3（HLR 调度）→ v4（FSRS）。HLR 档案换算为 FSRS 初始档案：
       stability ≈ h / ln2（半衰期→时间常数），difficulty 固定 5（无历史难度信息），
       reps/lapses 沿用 correct/wrong，last 沿用，due 由 last + 现有节奏推（不晚于 last+1 天）。
       旧 SM-2 cards 原样保留（只读）。迁移幂等：已有 fsrs 档案不覆盖。 */
    if (!(parsed && parsed.version >= 4)) {
      const Srs = window.LD && window.LD.Srs;
      const src = (parsed && parsed.hlr) || {};
      const now = Date.now();
      Object.keys(src).forEach(w => {
        if (data.fsrs[w]) return;                       // 幂等：已迁过不覆盖
        const h = src[w];
        if (!h || !Number.isFinite(+h.h) || !Number.isFinite(+h.last)) return;
        const S = Math.min(365, Math.max(0.5, +h.h / Math.LN2));
        data.fsrs[w] = {
          kind: "word",
          stability: S,
          difficulty: 5,
          reps: +h.correct || 0,
          lapses: +h.wrong || 0,
          last: +h.last,
          due: Math.min(now, +h.last + 86400000)
        };
      });
      data.version = 4;
    }
    /* 不把 DEF.planDone 的引用带进解析结果，避免一次迁移污染后续默认档案 */
    data.planDone = Object.assign({}, data.planDone);
    Object.keys(data.planDone).forEach(k => {
      const v = data.planDone[k];
      if (v === true) data.planDone[k] = { done: true, at: 0 };
      else if (!v || typeof v !== "object" || Array.isArray(v)) delete data.planDone[k];
      else data.planDone[k] = {
        done: !!v.done,
        at: Number.isFinite(+v.at) ? +v.at : 0,
        src: typeof v.src === "string" && v.src ? v.src : "self",
        attemptId: typeof v.attemptId === "string" ? v.attemptId : "",
        evidence: Array.isArray(v.evidence) ? v.evidence.filter(x => typeof x === "string").slice(0, 8) : [],
        progress: Number.isFinite(+v.progress) ? +v.progress : 0,
        target: Number.isFinite(+v.target) ? +v.target : 0
      };
    });
    ["log", "wrong", "wordbank", "sessions", "chatReports", "interviews", "speeches", "badges", "mockexams", "writingHist", "favorites", "recentModules", "contentReports"].forEach(k => {
      if (!Array.isArray(data[k])) data[k] = [];
    });
    /* 元素级清洗：一条坏记录就足以让整个模块白屏（旧版本导出再导入、云端恢复、手工改过
       localStorage 都会留下这种形状）。只丢坏元素，不动好数据。 */
    ["favorites", "recentModules", "badges"].forEach(k => { data[k] = data[k].filter(x => typeof x === "string" && x); });
    ["log", "wrong", "wordbank", "sessions", "chatReports", "interviews", "speeches", "mockexams", "writingHist", "contentReports"].forEach(k => {
      data[k] = data[k].filter(x => x && typeof x === "object" && !Array.isArray(x));
    });
    data.log = data.log.filter(x => Number.isFinite(+x.t));
    Object.keys(data.cards).forEach(w => {
      const c = data.cards[w];
      if (!c || typeof c !== "object" || Array.isArray(c) || !Number.isFinite(+c.due)) delete data.cards[w];
      else { c.reps = +c.reps || 0; c.ok = +c.ok || 0; c.bad = +c.bad || 0; c.lapses = +c.lapses || 0; c.ef = Number.isFinite(+c.ef) ? +c.ef : 2.5; c.iv = +c.iv || 0; if (!Array.isArray(c.history)) c.history = []; }
    });
    /* B2 档案清洗：fsrs 元素级校验（坏元素只丢该条，不动好数据） */
    Object.keys(data.fsrs).forEach(w => {
      const c = data.fsrs[w];
      if (!c || typeof c !== "object" || Array.isArray(c) ||
          !Number.isFinite(+c.stability) || !Number.isFinite(+c.last) || !Number.isFinite(+c.due)) {
        delete data.fsrs[w];
      } else {
        c.kind = typeof c.kind === "string" && c.kind ? c.kind : "word";
        c.difficulty = Number.isFinite(+c.difficulty) ? +c.difficulty : 5;
        c.reps = +c.reps || 0; c.lapses = +c.lapses || 0;
      }
    });
    if (data.hlr != null) {
      if (typeof data.hlr !== "object" || Array.isArray(data.hlr)) data.hlr = {};
      Object.keys(data.hlr).forEach(w => {
        const h = data.hlr[w];
        if (!h || typeof h !== "object" || !Number.isFinite(+h.h) || !Number.isFinite(+h.last)) delete data.hlr[w];
      });
      /* 3.24 HLR 调参（initH 1 → 3.5）：旧档案的半衰期按同一比例放大一次，
         否则老用户的积压不会因为调参而消失 */
      if (!(parsed && parsed.hlrV2)) {
        Object.keys(data.hlr).forEach(w => { data.hlr[w].h = Math.min(365, Math.max(0.5, +data.hlr[w].h * 3.5)); });
      }
    }
    data.hlrV2 = true;
    Object.keys(data.daily).forEach(d => {
      const v = +data.daily[d];
      data.daily[d] = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    });
    data.mockexams.forEach(m => {
      if (!m.pct || typeof m.pct !== "object") m.pct = { lesen: 0, hoeren: 0, schreiben: 0, sprechen: 0 };
      ["lesen", "hoeren", "schreiben", "sprechen"].forEach(k => { if (!Number.isFinite(+m.pct[k])) m.pct[k] = 0; });
      if (!Number.isFinite(+m.overall)) m.overall = 0;
    });
    data.interviews.forEach(it => {
      if (!Number.isFinite(+it.count)) it.count = Array.isArray(it.qs) ? it.qs.length : 0;
      if (!Number.isFinite(+it.total)) it.total = Number.isFinite(+it.score) ? +it.score : 0;
    });
    if (data.contentPack != null && (typeof data.contentPack !== "object" || Array.isArray(data.contentPack))) data.contentPack = null;
    data.lastExportAt = Number.isFinite(+data.lastExportAt) ? +data.lastExportAt : 0;
    /* bestStreak 是独立字段：旧快照里没有它，会出现「连续 90 天 · 最长 0 天」的自相矛盾 */
    if (!Number.isFinite(+data.bestStreak) || +data.bestStreak <= 0) {
      const days = Object.keys(data.daily).filter(d => data.daily[d] > 0).sort();
      let run = 0, best = 0, prev = null;
      days.forEach(d => {
        const contiguous = prev && (new Date(d) - new Date(prev)) === 86400000;
        run = contiguous ? run + 1 : 1;
        if (run > best) best = run;
        prev = d;
      });
      data.bestStreak = best;
    }
    data.version = 4;
    return data;
  }

  /* 3.20 的勾选只写在 linguade.planDone 镜像里；升级后把旧布尔值并入主档案，
     之后由主档案负责导出与云同步，镜像仅保留给旧页面/外部脚本读取。 */
  function importLegacyPlanDone(next) {
    try {
      const raw = localStorage.getItem("linguade.planDone");
      if (!raw) return;
      const legacy = JSON.parse(raw);
      if (!legacy || typeof legacy !== "object") return;
      Object.keys(legacy).forEach(k => {
        if (legacy[k] === true && !next.planDone[k]) next.planDone[k] = { done: true, at: 0 };
      });
    } catch (e) { /* 旧镜像损坏不影响主档案 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = migrate(parsed);
        importLegacyPlanDone(state);
        ensureOpenId(state);
        return state;
      }
    } catch (e) { console.warn("读取本地数据失败，使用默认档案", e); }
    state = JSON.parse(JSON.stringify(DEF));
    state.hlrV2 = true;
    importLegacyPlanDone(state);
    ensureOpenId(state);
    return state;
  }

  function save() {
    state.version = 4;
    state.updatedAt = Date.now();
    const serialized = JSON.stringify(state);
    let previous = null;
    try { previous = localStorage.getItem(KEY); } catch (e) { }
    let ok = false;
    try {
      localStorage.setItem(KEY, serialized);
      ok = true;
    } catch (e) {
      /* 配额写满：过去只留一行 console.warn，用户界面一切正常但数据悄悄不再增长 */
      console.warn("保存失败", e);
      try {
        if (!Store._quotaWarned && window.LD && LD.UI && LD.UI.toast) {
          Store._quotaWarned = 1;
          LD.UI.toast("浏览器本地存储已写满，新的学习记录没能保存。请到「设置 → 数据管理」导出 JSON 备份，或清理生词本 / 对话历史后重试。", "err");
        }
      } catch (e2) { }
    }
    /* 每日滚动备份与 IndexedDB 镜像都在主键写成功之后再做：
       否则配额满时备份先抛，主键也一起被堵；两份「保险」还会停在不同时刻。 */
    if (ok) {
      try {
        const legacy = {};
        Object.keys(state.planDone || {}).forEach(k => {
          if (state.planDone[k] && state.planDone[k].done) legacy[k] = true;
        });
        localStorage.setItem("linguade.planDone", JSON.stringify(legacy));
      } catch (e) { /* 镜像失败不影响主档案 */ }
      try {
        const day = today();
        if (previous && localStorage.getItem("linguade.backup.day") !== day) {
          localStorage.setItem("linguade.backup.v1", previous);
          localStorage.setItem("linguade.backup.day", day);
          idbPut("daily", { day, data: previous });
        }
      } catch (e) { /* 备份失败不影响主数据 */ }
      idbPut("current", { savedAt: state.updatedAt, data: serialized });
    }
    return ok;
  }

  /* 本地日期 key(YYYY-MM-DD)：按「首次启动时固定的时区」折算，而不是按此刻的系统时区。
     否则从国内飞到德国（+8 → +1）那天，today() 会算出一个未来日期、连胜直接归零。 */
  function refTzOffset() {
    const now = new Date().getTimezoneOffset();
    const p = state && state.profile;
    if (!p || typeof p !== "object") return now;
    if (!Number.isFinite(p.tzOffset)) p.tzOffset = now;
    return p.tzOffset;
  }
  const dayKey = d => {
    const t = d || new Date();
    return new Date(t.getTime() - refTzOffset() * 60000).toISOString().slice(0, 10);
  };
  const today = () => dayKey();

  /* 3.21.0 云端自动同步：作答后 debounce 推送本设备快照（pagehide 兜底）。
     只推不拉：不打断当前学习；两台设备即便短暂互相覆盖快照，
     下次启动的 sync() 会做字段级并集合并，任何一侧的记录都不会丢。 */
  let pushTimer = null, pushDirty = false;

  /* 记录最近一次云端同步时间（设置 → 数据管理 展示；不入快照、不参与合并） */
  function markSynced() {
    try {
      localStorage.setItem("linguade.lastSyncAt", String(Date.now()));
      document.dispatchEvent(new CustomEvent("linguade:synced"));
    } catch (e) { /* 隐私模式等场景静默，不影响主流程 */ }
  }

  /* 导出校验和：FNV-1a 32 位，够用来发现截断/手改，不是加密签名 */
  /* B9：YAML 标量去引号（"..." / '...' → 原文） */
  function unq(v) {
    const s = String(v == null ? "" : v).trim();
    if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) return s.slice(1, -1);
    return s;
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  const Store = {
    get s() { return state || load(); },
    load, save,
    dayKey, today,
    reset() { state = JSON.parse(JSON.stringify(DEF)); state.hlrV2 = true; save(); },
    hydrate() {
      return idbGet("current").then(row => {
        if (!row || !row.data) return false;
        let local = null;
        try { local = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { }
        if (!local || (+row.savedAt > +(local.updatedAt || 0))) {
          try {
            state = migrate(JSON.parse(row.data));
            importLegacyPlanDone(state);
            localStorage.setItem(KEY, JSON.stringify(state));
            return true;
          } catch (e) { }
        }
        return false;
      });
    },
    restoreLocalBackup() {
      try {
        const raw = localStorage.getItem("linguade.backup.v1");
        if (raw) { state = migrate(JSON.parse(raw)); save(); return Promise.resolve(true); }
      } catch (e) { }
      return idbGet("daily").then(row => {
        if (!row || !row.data) return false;
        try { state = migrate(JSON.parse(row.data)); save(); return true; } catch (e) { return false; }
      });
    },
    localBackupDay() {
      try { return localStorage.getItem("linguade.backup.day") || ""; } catch (e) { return ""; }
    },
    /* 首页横幅「今天不再提示」：按本地日期记录，次日自动重新出现；
       「不再提醒（永久）」：写下永久关闭标记，除非用户手动清；记录在浏览器本地 */
    bannerDismissed(key) {
      try { return localStorage.getItem("linguade.banner." + key) === today() || localStorage.getItem("linguade.bannerforever." + key) === "1"; } catch (e) { return false; }
    },
    dismissBanner(key) {
      try { localStorage.setItem("linguade.banner." + key, today()); } catch (e) { }
    },
    dismissBannerForever(key) {
      try { localStorage.setItem("linguade.bannerforever." + key, "1"); } catch (e) { }
    },
    /* 计划任务完成是用户自报状态，不是能力掌握；取消勾选以较新时间覆盖旧状态 */
    isPlanTaskDone(taskId) {
      const e = Store.s.planDone && Store.s.planDone[taskId];
      return !!(e && e.done);
    },
    planTaskEntry(taskId) {
      return (Store.s.planDone && Store.s.planDone[taskId]) || null;
    },
    /* src 记录完成来源；meta 保存 attemptId / evidence / progress，供回执与跨端审计 */
    setPlanTaskDone(taskId, done, src, meta) {
      if (!taskId) return false;
      Store.s.planDone = Store.s.planDone || {};
      const prev = Store.s.planDone[taskId] || {};
      Store.s.planDone[taskId] = {
        done: !!done,
        at: Date.now(),
        src: done ? (src || "self") : "self",
        attemptId: done && meta && meta.attemptId ? String(meta.attemptId) : (done ? prev.attemptId || "" : ""),
        evidence: done && meta && Array.isArray(meta.evidence) ? meta.evidence.filter(x => typeof x === "string").slice(0, 8) : (done ? prev.evidence || [] : []),
        progress: done && meta && Number.isFinite(+meta.progress) ? +meta.progress : (done ? prev.progress || 0 : 0),
        target: done && meta && Number.isFinite(+meta.target) ? +meta.target : (done ? prev.target || 0 : 0)
      };
      save();
      if (Store.autoPushSchedule) Store.autoPushSchedule();
      return !!done;
    },
    planDayDone(day) {
      const tasks = (day && day.tasks) || [];
      return tasks.filter(t => Store.isPlanTaskDone(t.id)).length;
    },
    markExported() { Store.s.lastExportAt = Date.now(); save(); },
    reportContent(de, fields) {
      const s = Store.s;
      const key = String(de || "").toLowerCase();
      const hit = s.contentReports.find(r => r.de.toLowerCase() === key && r.fields.join(",") === fields.join(","));
      if (!hit) {
        s.contentReports.unshift({ de, fields, t: Date.now() });
        if (s.contentReports.length > 200) s.contentReports.length = 200;
        save();
      }
      return s.contentReports.length;
    },
    toggleFavorite(route) {
      const s = Store.s;
      if (!Array.isArray(s.favorites)) s.favorites = [];
      const i = s.favorites.indexOf(route);
      if (i >= 0) s.favorites.splice(i, 1); else s.favorites.unshift(route);
      save();
      return i < 0;
    },
    isFavorite(route) { return (Store.s.favorites || []).includes(route); },
    recentRoutes() { return (Store.s.recentModules || []).slice(0, 6); },

    /* ---- 每日时长 ---- */
    addMinutes(n) {
      const d = today();
      const s = Store.s;
      const firstToday = (s.daily[d] || 0) === 0;
      const before = Store.streakBeforeToday();          // 不含今天的连胜
      /* ---- 断连胜复活窗口（对标 Duolingo Streak Revival）：曾连续 ≥3 天者，3 天内可复活 ---- */
      if (before === 0 && (s.bestStreak || 0) >= 3 && !s.revive) {
        s.revive = { target: s.bestStreak, until: Date.now() + 3 * 86400000 };
      }
      s.daily[d] = (s.daily[d] || 0) + n;
      /* ---- 复活触发：今天首次学习且此前已断连胜，把中断日补记为冻结日，恢复连胜数字 ---- */
      if (firstToday && before === 0 && s.revive && Date.now() < s.revive.until) {
        for (let i = 1; i < 400; i++) {
          const key = dayKey(new Date(Date.now() - i * 86400000));
          if ((s.daily[key] || 0) > 0) break;
          s.daily[key] = 1;                              // 补记为冻结日（1 分钟占位）
        }
        const revived = Store.streak();
        s.revive = null;
        s.revivedCount = (s.revivedCount || 0) + 1;
        try { window.dispatchEvent(new CustomEvent("ld:revive", { detail: { streak: revived } })); } catch (e) { }
      }
      /* ---- 冻结发放：连续学习每满 7 天 +1（上限 3，支持回放补发） ---- */
      const cur = Store.streak();
      if (cur > (s.bestStreak || 0)) s.bestStreak = cur;
      if (cur >= 7 && (s.freezes || 0) < 3) {
        const beforeF = s.freezes || 0;
        while (cur - (s.freezeEarnedAt || 0) >= 7 && (s.freezes || 0) < 3) {
          s.freezes = (s.freezes || 0) + 1;
          s.freezeEarnedAt = (s.freezeEarnedAt || 0) + 7;
        }
        if ((s.freezes || 0) > beforeF) {
          try { window.dispatchEvent(new CustomEvent("ld:freeze", { detail: { freezes: s.freezes, gained: (s.freezes || 0) - beforeF } })); } catch (e) { }
        }
      }
      if (s.revive && cur >= s.revive.target) s.revive = null;   // 已凭实力追平
      /* ---- 冻结自动消耗（复活已处理过的 gap 不会再触发） ---- */
      Store.consumeFreezeIfNeeded();
      Store.checkBadges();
      save();
    },
    /* 不含今天的连胜（用于复活判断） */
    streakBeforeToday() {
      const s = Store.s;
      let n = 0;
      for (let i = 1; i < 400; i++) {
        const key = dayKey(new Date(Date.now() - i * 86400000));
        if ((s.daily[key] || 0) > 0) n++;
        else break;
      }
      return n;
    },
    /* 冻结自动消耗：在检测到「昨天空缺、前天有学、今天开始学」时扣 1 次 */
    consumeFreezeIfNeeded() {
      const s = Store.s;
      if ((s.freezes || 0) <= 0) return false;
      const d = new Date();
      const key = k => dayKey(new Date(d.getTime() - k * 86400000));
      const y = (s.daily[key(1)] || 0) === 0;            // 昨天空缺
      const by = (s.daily[key(2)] || 0) > 0;             // 前天有学
      const t = (s.daily[key(0)] || 0) > 0;              // 今天已学
      if (y && by && t) {
        s.freezes -= 1;
        s.freezeUsedLog = s.freezeUsedLog || [];
        s.freezeUsedLog.push(key(1));
        save();
        try { window.dispatchEvent(new CustomEvent("ld:freezeuse", { detail: { date: key(1) } })); } catch (e) { }
        return true;
      }
      return false;
    },
    todayMinutes() { const s = Store.s; return s.daily[today()] || 0; },
    streak() {
      const s = Store.s;
      let n = 0;
      const d = new Date();
      const used = s.freezeUsedLog || [];
      for (let i = 0; i < 400; i++) {
        const key = dayKey(new Date(d.getTime() - i * 86400000));
        if ((s.daily[key] || 0) > 0) { n++; continue; }
        if (i === 0) continue;                          // 今天尚未学习：连胜延续到今天之前
        if (used.indexOf(key) >= 0) { n++; continue; }  // 该日已被连胜冻结豁免
        break;
      }
      return n;
    },

    /* ---- 访问足迹（模块就绪度）：以注册表为准，避免新增模块后清单失同步 ---- */
    visit(route) {
      const s = Store.s;
      s.visited[route] = (s.visited[route] || 0) + 1;
      if (route && route !== "diagnose") {
        s.recentModules = (s.recentModules || []).filter(r => r !== route);
        s.recentModules.unshift(route);
        s.recentModules = s.recentModules.slice(0, 8);
      }
      save();
      Store.checkBadges();
    },
    /* 清理「本机有复习记录、词库里已没有该词」的孤儿卡片（词库改版 / 换设备恢复旧快照后会残留） */
    dropOrphanCards() {
      const s = Store.s;
      const inLex = (window.LD && LD.Engine && LD.Engine.lexSet)
        ? LD.Engine.lexSet() : new Set((window.LD_LEX || []).map(w => w[0]));
      let n = 0;
      Object.keys(s.cards || {}).forEach(w => { if (!inLex.has(w)) { delete s.cards[w]; n++; } });
      Object.keys(s.hlr || {}).forEach(w => { if (!inLex.has(w)) delete s.hlr[w]; });
      save();
      return n;
    },
    visitedCount() {
      const mods = (window.LD && LD.Modules && Object.keys(LD.Modules).length)
        ? Object.keys(LD.Modules)
        : ["diagnose", "vocab", "grammar", "chat", "speech", "listening", "drill",
           "syntax", "writing", "reading", "notebook", "analytics", "plan", "interview",
           "weak", "sandbox"];
      /* 诊断是一次性入口：完成后不计入「模块就绪度」，否则分母永远是 19 */
      const visible = mods.filter(m => !(m === "diagnose" && Store.s.diagnosed));
      const done = visible.filter(m => ((Store.s.visited || {})[m] || 0) > 0).length;
      return { done, total: visible.length };
    },

  /* ---- 学习流水 ---- */
  logAnswer(rec) {
    const s = Store.s;
    rec.t = rec.t || Date.now();
    s._lastHour = new Date(rec.t).getHours();
    s.log.push(rec);
    if (s.log.length > 6000) s.log = s.log.slice(-4000);
    // 能力值在线更新（指数平滑）
    if (rec.ability) {
      const a = s.ability;
      const delta = rec.ok ? 1.2 : -1.6;
      a[rec.ability] = Math.max(5, Math.min(99, Math.round((a[rec.ability] || 50) + delta)));
    }
    // BKT 知识追踪：以知识点为单位更新掌握概率
    if (rec.skill && window.LD.Engine) {
      window.LD.Engine.bktUpdate(rec.skill, !!rec.ok);
    }
    // HLR 半衰期记忆模型：单词词条按作答结果更新记忆半衰期
    if (rec.skill && rec.skill.indexOf("v:") === 0 && window.LD.Engine && window.LD.Engine.hlrUpdate) {
      window.LD.Engine.hlrUpdate(rec.skill.slice(2), !!rec.ok);
    }
    // XP 经验值：只增不减（进度指标而非能力指标）；诊断等过程性作答可带 noXP 跳过
    if (!rec.noXP) {
      const gain = rec.ok ? 10 : 2;
      Store.addXp(gain);
    }
    // 每日任务进度
    Store.questProgress(rec);
    Store.checkBadges();
    save();
    Store.autoPushSchedule();      // 云端自动同步：作答即排队推送（debounce 20s）
  },

  /* ---- XP / 等级（对标 Duolingo：XP 只增不减） ---- */
  /* 3.24：原 10 档 5600 XP 约两周即满级。延长到 30 档（约 4–5 个月持续学习），前 10 档不变 */
  LEVELS: [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5600,
    7200, 9000, 11000, 13200, 15600, 18200, 21000, 24000, 27200, 30600,
    34200, 38000, 42000, 46200, 50600, 55200, 60000, 65000, 70200, 75600],
  addXp(n) {
    const s = Store.s;
    s.xp = (s.xp || 0) + Math.max(0, Math.round(n));
    return s.xp;
  },
  levelInfo() {
    const s = Store.s;
    const xp = s.xp || 0;
    const th = Store.LEVELS;
    let lv = 1;
    for (let i = 0; i < th.length; i++) if (xp >= th[i]) lv = i + 1;
    const maxed = lv >= th.length;
    const cur = th[lv - 1] || 0;
    const next = maxed ? cur + 1500 : th[lv];
    return { xp, level: lv, cur, next, maxed, pct: maxed ? 100 : Math.round((xp - cur) / (next - cur) * 100) };
  },

  /* ---- 每日任务（对标 Duolingo Daily Quests：目标梯度理论，可见的进度条） ---- */
  QUEST_POOL: [
    { id: "q_vocab", nm: "词汇达人", ic: "▤", text: "完成 15 次单词练习", target: 15, mod: "vocab", xp: 60 },
    { id: "q_grammar", nm: "精益求精", ic: "pen", text: "句法纠错 3 句", target: 3, mod: "grammar", xp: 40 },
    { id: "q_speak", nm: "开口练习", ic: "◔", text: "完成 3 次口语类训练（对话/跟读）", target: 3, mod: "speaking", xp: 50 },
    { id: "q_reading", nm: "阅读进阶", ic: "▣", text: "完成 1 次阅读理解", target: 1, mod: "reading", xp: 40 },
    { id: "q_writing", nm: "笔耕不辍", ic: "pen", text: "完成 1 次写作批改", target: 1, mod: "writing", xp: 40 },
    { id: "q_review", nm: "温故知新", ic: "✕", text: "在错题本重练 5 条", target: 5, mod: "notebook", xp: 30 }
  ],
  todayQuests() {
    const s = Store.s;
    const d = today();
    if (!s.quests || s.quests.date !== d) {
      // 按日期确定性抽取 3 个任务（同一天内不变，跨天轮换）
      let seed = 0;
      for (let i = 0; i < d.length; i++) seed = (seed * 31 + d.charCodeAt(i)) % 9973;
      const pool = Store.QUEST_POOL.slice();
      const items = [];
      for (let k = 0; k < 3 && pool.length; k++) {
        const pick = pool.splice(seed % pool.length, 1)[0];
        seed = (seed * 7 + 13) % 9973;
        items.push(Object.assign({}, pick, { progress: 0, done: false }));
      }
      s.quests = { date: d, items };
      save();
    }
    return s.quests;
  },
  questProgress(rec) {
    const q = Store.todayQuests();
    if (!q || !rec) return;
    const typeMap = { vocab: "vocab", grammar: "grammar", speech: "speaking", chat: "speaking", listening: "speaking", reading: "reading", writing: "writing", notebook: "notebook" };
      q.items.forEach(it => {
        if (it.done) return;
        if (typeMap[rec.type] === it.mod) it.progress += 1;
        if (it.progress >= it.target) {
          it.done = true;
          Store.addXp(it.xp);
          try { window.dispatchEvent(new CustomEvent("ld:quest", { detail: it })); } catch (e) { }
        }
      });
      if (q.items.every(it => it.done)) Store.s._questsPerfect = 1;
      save();
  },

    /* ---- 错题库 ---- */
    addWrong(item) {
      const s = Store.s;
      const norm = v => String(v || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
      const duplicate = s.wrong.find(w => norm(w.module) === norm(item.module) && norm(w.type) === norm(item.type) && norm(w.wrong) === norm(item.wrong) && !w.mastered);
      if (duplicate) {
        duplicate.times = (duplicate.times || 0) + 1;
        duplicate.lastSeenAt = Date.now();
        if (item.why) duplicate.why = item.why;
        save();
        return duplicate;
      }
      item.id = "w" + Date.now() + Math.random().toString(36).slice(2, 6);
      item.t = Date.now();
      item.mastered = false;
      item.times = 0;
      s.wrong.unshift(item);
      if (s.wrong.length > 800) s.wrong = s.wrong.slice(0, 600);
      save();
      return item;
    },
    wrongPending() { return Store.s.wrong.filter(w => !w.mastered); },

    /* ---- 对话生词本（对标 ISSEN conversation-anchored vocab：词 + 来源句子一起记） ---- */
    addWord(entry) {
      const s = Store.s;
      const de = (entry.de || "").trim();
      if (!de) return null;
      const dup = s.wordbank.find(w => w.de.toLowerCase() === de.toLowerCase());
      if (dup) {
        dup.ctx = entry.ctx || dup.ctx;
        if (entry.zh) dup.zh = entry.zh;
        dup.t = Date.now();
        save();
        return dup;
      }
      const item = {
        id: "v" + Date.now() + Math.random().toString(36).slice(2, 6),
        de, ctx: entry.ctx || "", scene: entry.scene || "", zh: entry.zh || "",
        kind: entry.kind || "word",   // word 单词 / sentence 整句（对话室「保存当前句」）
        t: Date.now(), createdAt: Date.now(), known: false
      };
      s.wordbank.unshift(item);
      if (s.wordbank.length > 400) s.wordbank = s.wordbank.slice(0, 300);
      save();
      return item;
    },
    removeWord(id) {
      const s = Store.s;
      s.wordbank = s.wordbank.filter(w => w.id !== id);
      save();
    },
    toggleWordKnown(id) {
      const s = Store.s;
      const it = s.wordbank.find(w => w.id === id);
      if (it) { it.known = !it.known; save(); }
      return it;
    },
    toggleWrong(id) {
      const s = Store.s;
      const it = s.wrong.find(w => w.id === id);
      if (it) { it.mastered = !it.mastered; save(); Store.checkBadges(); }
      return it;
    },
    reviewWrong(id, ok) {
      const s = Store.s;
      const it = s.wrong.find(w => w.id === id);
      if (it) {
        it.times = (it.times || 0) + 1;
        if (ok && it.times >= 2) it.mastered = true;
        save();
        Store.checkBadges();
      }
    },

    /* ---- 会话 ---- */
    addSession(rec) {
      const s = Store.s;
      rec.t = rec.t || Date.now();
      s.sessions.push(rec);
      if (s.sessions.length > 500) s.sessions = s.sessions.slice(-300);
      Store.addMinutes(Math.max(1, Math.round((rec.ms || 0) / 60000)));
      save();
    },

  /* ---- 成就徽章（对标 Duolingo Streak Milestones / Achievements）
     ic 存图标名（LD.icon 渲染为线性 SVG，v5 起不再用 emoji 字符） ---- */
  BADGES: [
    { id: "first", nm: "初学第一步", ic: "sparkle", desc: "完成第一次作答", test: s => s.log.length >= 1 },
    { id: "s3", nm: "连胜 3 天", ic: "flame", desc: "连续学习 3 天", test: s => Store.streak() >= 3 },
    { id: "s7", nm: "连胜一周", ic: "calendar", desc: "连续学习 7 天", test: s => Store.streak() >= 7 },
    { id: "s14", nm: "连胜两周", ic: "flame", desc: "连续学习 14 天", test: s => Store.streak() >= 14 },
    { id: "s30", nm: "连胜满月", ic: "trophy", desc: "连续学习 30 天", test: s => Store.streak() >= 30 },
    { id: "s60", nm: "连胜两月", ic: "trophy", desc: "连续学习 60 天", test: s => Store.streak() >= 60 },
    { id: "s100", nm: "百日打卡", ic: "gem", desc: "连续学习 100 天", test: s => Store.streak() >= 100 },
    { id: "w50", nm: "词汇 50", ic: "book", desc: "学过 50 个词条", test: s => Object.keys(s.cards).length >= 50 },
    { id: "w200", nm: "词汇 200", ic: "book", desc: "学过 200 个词条", test: s => Object.keys(s.cards).length >= 200 },
    { id: "w500", nm: "词汇 500", ic: "book", desc: "学过 500 个词条", test: s => Object.keys(s.cards).length >= 500 },
    { id: "explorer", nm: "模块探索者", ic: "compass", desc: "体验 8 个功能模块", test: s => Store.visitedCount().done >= 8 },
    { id: "allround", nm: "全能选手", ic: "gradcap", desc: "全部模块都体验过", test: s => Store.visitedCount().done >= Store.visitedCount().total },
    { id: "night", nm: "夜猫子", ic: "moon", desc: "在 22:00–04:00 间学习", test: s => { const h = s._lastHour; return h >= 22 || (h >= 0 && h <= 4); } },
    { id: "early", nm: "早起鸟", ic: "sunrise", desc: "在 05:00–08:00 间学习", test: s => { const h = s._lastHour; return h >= 5 && h < 8; } },
    { id: "cleaner", nm: "错题清道夫", ic: "check", desc: "把错题本全部练到掌握", test: s => s.wrong.length > 0 && s.wrong.every(w => w.mastered) },
    { id: "speak10", nm: "口语新星", ic: "mic", desc: "完成 10 次口语类训练", test: s => s.log.filter(l => l.ability === "speaking").length >= 10 },
    { id: "listen20", nm: "听力达人", ic: "headphones", desc: "完成 20 次听力训练", test: s => s.log.filter(l => l.ability === "listening").length >= 20 },
    { id: "quizmaster", nm: "任务大师", ic: "target", desc: "单日完成全部每日任务", test: s => (s._questsPerfect || 0) >= 1 },
    { id: "reviver", nm: "不屈连胜", ic: "star", desc: "成功复活一次断掉的连胜", test: s => (s.revivedCount || 0) >= 1 }
  ],
  badgeList() {
    const s = Store.s;
    return Store.BADGES.map(b => Object.assign({}, b, { got: (s.badges || []).indexOf(b.id) >= 0 }));
  },
  checkBadges() {
    const s = Store.s;
    s.badges = s.badges || [];
    let unlocked = null;
    Store.BADGES.forEach(b => {
      if (s.badges.indexOf(b.id) < 0) {
        try { if (b.test(s)) { s.badges.push(b.id); unlocked = unlocked || b; } } catch (e) { }
      }
    });
    if (unlocked) {
      save();
      try { window.dispatchEvent(new CustomEvent("ld:badge", { detail: unlocked })); } catch (e) { }
    }
    return unlocked;
  },

    /* ---- 导出 / 导入 ---- */
    /* 导出带版本号与 FNV-1a 校验和：导入时能发现文件被改动或截断 */
    exportData() {
      const copy = JSON.parse(JSON.stringify(Store.s));
      delete copy._export;
      const body = JSON.stringify(copy);
      copy._export = {
        app: "LinguaDE", version: copy.version || 3, exportedAt: Date.now(),
        checksum: "fnv1a:" + fnv1a(body)
      };
      return JSON.stringify(copy, null, 2);
    },
    /* 生词本 → Anki 兼容 TSV（可直接导入 Anki / Memrise） */
    exportWordbankTSV() {
      const head = "front\tback\tsource";
      const rows = Store.s.wordbank.map(w =>
        [w.de, w.zh || "", (w.ctx || "").replace(/[\t\n]/g, " ")].join("\t"));
      return head + "\n" + rows.join("\n");
    },
    /* B9：全词库 → Anki 兼容 TSV（front=词头+冠词，back=中文（词性），tags=CEFR，第 4 列例句）。
       导入 Anki 后即为完整牌组；.apkg 批量生成用 tools/anki_apkg.py 离线打包。 */
    exportLexiconTSV() {
      const LEX = window.LD_LEX || [];
      const clean = v => String(v == null ? "" : v).replace(/[\t\n\r]/g, " ").trim();
      const head = "front\tback\ttags\tsource";
      const rows = LEX.map(x => {
        const [de, art, zh, pos, cefr, ex] = x;
        const front = (art && art !== "-" ? art + " " : "") + clean(de);
        const back = clean(zh) + (pos ? "（" + pos + "）" : "");
        const tags = [cefr || "", "lingopack"].filter(Boolean).join(" ");
        return [front, back, tags, clean(ex)].join("\t");
      });
      return head + "\n" + rows.join("\n");
    },
    /* B9：LibreLingo 课程包（words: YAML 子集）→ 并入生词本。
       返回 {added, skipped, errors}；幂等按 de 去重（addWord 语义）；坏行计入 errors 不中断。 */
    importLibreLingoYaml(text) {
      const out = { added: 0, skipped: 0, errors: [] };
      const lines = String(text || "").split(/\r?\n/);
      let inWords = false, cur = null;
      const flush = () => {
        if (!cur) return;
        const de = (cur.de || "").trim();
        const zh = (cur.zh || "").trim();
        if (!de) { out.errors.push("缺 de：" + JSON.stringify(cur).slice(0, 60)); cur = null; return; }
        if (!zh) { out.errors.push("缺 zh：" + de); cur = null; return; }
        /* 幂等：先查已有（大小写不敏感），重复直接 skipped，不调 addWord（避免覆盖 ctx） */
        const dup = (Store.s.wordbank || []).some(w => w.de.toLowerCase() === de.toLowerCase());
        if (dup) { out.skipped++; cur = null; return; }
        const r = Store.addWord({ de, zh, ctx: (cur.ex || "").trim(), scene: "LibreLingo", t: Date.now(), known: false });
        if (r) out.added++; else out.skipped++;
        cur = null;
      };
      for (const raw of lines) {
        const line = raw.replace(/\r$/, "");
        if (/^words:\s*$/.test(line)) { inWords = true; continue; }
        if (!inWords) continue;
        if (/^\S/.test(line) && !/^ /.test(line)) { flush(); inWords = false; continue; }   // 顶层新键 → 结束 words 块
        const m = line.match(/^  - de:\s*(.*)$/);
        if (m) { flush(); cur = { de: unq(m[1]) }; continue; }
        const k = line.match(/^    (zh|genus|cefr|ex|ex_de|ex_zh):\s*(.*)$/);
        if (k && cur) {
          if (k[1] === "zh" || k[1] === "ex") cur[k[1]] = unq(k[2]);
          if (k[1] === "genus" && !["der", "die", "das", "-"].includes(unq(k[2]))) out.errors.push("非法 genus：" + unq(k[2]));
        }
      }
      flush();
      return out;
    },
    /* 学习记录 → CSV（Excel 可直接打开，带 BOM） */
    exportLogCSV() {
      const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const head = ["时间", "类型", "能力项", "结果", "题目", "技能点", "耗时ms"].map(q).join(",");
      const rows = Store.s.log.map(l => [
        new Date(l.t).toLocaleString("zh-CN"), l.type || "", l.ability || "",
        l.ok ? "正确" : "错误", l.item || "", l.skill || "", l.ms || 0
      ].map(q).join(","));
      return "\uFEFF" + head + "\n" + rows.join("\n");
    },

    /* 清空云端档案（配合「清空重置」：否则刷新后快照会把诊断完成状态恢复回来） */
    resetCloud(open_id) {
      const base = String(Store.s.cfg.backend || "").replace(/\/$/, "");
      const oid = encodeURIComponent(open_id || Store.s.open_id);
      return fetch(base + "/api/sync?open_id=" + oid, { method: "DELETE" })
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    },
    /* ---- 云端快照：可恢复的学习数据全量视图（剔除凭据与设备标识） ---- */
    snapshot() {
      const c = JSON.parse(JSON.stringify(Store.s));
      delete c.cfg;                                   // apiBase/apiKey/backend 不上云
      delete c.open_id;                               // 设备标识不上云
      c.log = (c.log || []).slice(-500);              // 体积护栏：最近 500 条
      c.sessions = (c.sessions || []).slice(-100);
      c._snapAt = Date.now();
      return c;
    },
    /* 用快照/导出 JSON 恢复本地数据：保留当前设置与设备标识 */
    restoreSnapshot(data) {
      if (!data || typeof data !== "object") return false;
      const keepCfg = state.cfg, keepOid = state.open_id;
      const clean = Object.assign({}, data);
      const cloudAt = +data._snapAt || 0;
      delete clean._export;
      delete clean._snapAt;
      state = migrate(clean);
      /* 恢复后本机就是云端那份数据：把时间戳带回来，否则下次同步的冲突提示永久失效 */
      state._snapAt = cloudAt || Date.now();
      state.cfg = keepCfg;
      state.open_id = keepOid;
      ensureOpenId(state);
      save();
      return true;
    },
    /* 导入统一入口：.json（全量导出/云端快照）或 Anki TSV（front\tback\tsource → 生词本） */
    importData(raw, kind) {
      if (kind === "tsv") {
        const lines = String(raw || "").split(/\r?\n/).filter(l => l.trim());
        let n = 0;
        lines.forEach((l, i) => {
          if (i === 0 && /^front\tback/.test(l)) return;   // 跳过表头
          const [de, zh, ctx] = l.split("\t");
          if (de && de.trim() && Store.addWord({ de: de.trim(), zh: (zh || "").trim(), ctx: (ctx || "").trim() })) n++;
        });
        return { ok: true, kind: "tsv", imported: n };
      }
      let data = null;
      try { data = JSON.parse(raw); } catch (e) { return { ok: false, error: "JSON 解析失败：" + e.message }; }
      if (data && data._export && data._export.checksum) {
        const copy = Object.assign({}, data);
        delete copy._export;
        const sum = "fnv1a:" + fnv1a(JSON.stringify(copy));
        if (sum !== data._export.checksum) {
          return { ok: false, error: "校验和不匹配：导出文件可能被修改或截断，已拒绝导入" };
        }
      }
      /* 内容包（tools/content_pipeline.py 产物）：并入 contentPack，跟读池即时扩容 */
      if (data && data.pack === "speech" && Array.isArray(data.items)) {
        const items = data.items.filter(i => i && i.de && typeof i.de === "string").map(i => Object.assign({}, i, {
          audioUrl: i.hasAudio && i.audioLicense && !/NC/i.test(i.audioLicense) ? `https://audio.tatoeba.org/sentences/deu/${encodeURIComponent(i.id)}.mp3` : ""
        }));
        if (!items.length) return { ok: false, error: "内容包为空或格式无效" };
        /* 内容包结构校验：每条至少带 id+de；audioLicense 非 NC/ND 是已有红线 */
        if (items.some(i => i.hasAudio && /NC|ND/i.test(i.audioLicense || ""))) return { ok: false, error: "内容包含 NC/ND 授权音频，已拒绝导入" };
        const s = Store.s;
        s.contentPack = s.contentPack || {};
        const seen = new Set((s.contentPack.speech || []).map(i => i.id));
        s.contentPack.speech = (s.contentPack.speech || []).concat(items.filter(i => !seen.has(i.id)));
        save();
        return { ok: true, kind: "pack", imported: items.length };
      }
      /* 内容包 · 合成音源（tools/tts_supply.py 产物）：按文本 hash id 关联发音，
         并入 contentPack.audio 槽位（不进 speech 池，避免把合成音频混进 Tatoeba 实人录音链） */
      if (data && data.pack === "audio" && Array.isArray(data.items)) {
        const items = data.items.filter(i => i && i.id && i.text && i.file);
        if (!items.length) return { ok: false, error: "合成音源包为空或格式无效" };
        if (/NC|ND/i.test(data.license || "")) return { ok: false, error: "合成音源包授权含 NC/ND，已拒绝导入" };
        const s = Store.s;
        s.contentPack = s.contentPack || {};
        const seen = new Set((s.contentPack.audio || []).map(i => String(i.id)));
        const fresh = [];
        items.forEach(i => {
          const k = String(i.id);
          if (!seen.has(k)) { seen.add(k); fresh.push(i); }
        });
        s.contentPack.audio = (s.contentPack.audio || []).concat(fresh);
        save();
        return { ok: true, kind: "pack", imported: fresh.length };
      }
      /* 内容包 · Tatoeba 德中双语（tools/knowledge_ingest.py 产物）：供 AI 出题 grounding */
      if (data && data.pack === "pairs" && Array.isArray(data.items)) {
        const items = data.items.filter(i => i && i.id && i.de && i.zh);
        if (!items.length) return { ok: false, error: "双语包为空或格式无效" };
        const s = Store.s;
        s.contentPack = s.contentPack || {};
        const seen = new Set((s.contentPack.pairs || []).map(i => String(i.id)));
        const fresh = [];
        items.forEach(i => {
          const k = String(i.id);
          if (!seen.has(k)) { seen.add(k); fresh.push(i); }
        });
        s.contentPack.pairs = (s.contentPack.pairs || []).concat(fresh);
        save();
        return { ok: true, kind: "pack", imported: fresh.length };
      }
      /* 内容包 · AI/人工语法讲解：并入 contentPack.grammar */
      if (data && data.pack === "grammar" && Array.isArray(data.items)) {
        const items = data.items.filter(i => i && i.id && i.explain);
        if (!items.length) return { ok: false, error: "语法包为空或格式无效" };
        const s = Store.s;
        s.contentPack = s.contentPack || {};
        const seen = new Set((s.contentPack.grammar || []).map(i => String(i.id)));
        const fresh = [];
        items.forEach(i => {
          const k = String(i.id);
          if (!seen.has(k)) { seen.add(k); fresh.push(i); }
        });
        s.contentPack.grammar = (s.contentPack.grammar || []).concat(fresh);
        save();
        return { ok: true, kind: "pack", imported: fresh.length };
      }
      /* 内容包 · 阅读（tools/reading_pipeline.py 产物）：并入 contentPack，阅读池即时扩容 */
      if (data && data.pack === "reading" && Array.isArray(data.items)) {
        const items = data.items.filter(i => i && i.id && Array.isArray(i.paras));
        if (!items.length) return { ok: false, error: "阅读包为空或格式无效" };
        const s = Store.s;
        s.contentPack = s.contentPack || {};
        const seen = new Set((s.contentPack.reading || []).map(i => i.id));
        s.contentPack.reading = (s.contentPack.reading || []).concat(items.filter(i => !seen.has(i.id)));
        save();
        return { ok: true, kind: "pack", imported: items.length };
      }
      /* 内容包 · 词库册（tools/lexicon_enrich.py 产物）：并入 contentPack 并即时扩容内存词表。
         红线：无中文释义的条目不入库（此处二次兜底，产物已由脚本质检） */
      if (data && data.pack === "lexicon" && Array.isArray(data.items)) {
        const items = data.items.filter(i => i && i.de && i.zh);
        if (!items.length) return { ok: false, error: "词库册为空或格式无效（无中文释义的条目不入库）" };
        const s = Store.s;
        s.contentPack = s.contentPack || {};
        const seen = new Set((s.contentPack.lexicon || []).map(i => String(i.de || "").toLowerCase()));
        s.contentPack.lexicon = (s.contentPack.lexicon || []).concat(items.filter(i => !seen.has(String(i.de).toLowerCase())));
        save();
        applyContentPack();
        return { ok: true, kind: "pack", imported: items.length };
      }
      if (!data || typeof data !== "object" || (!data.profile && !data.cards && !data.log)) {
        return { ok: false, error: "不是有效的 LinguaDE 导出文件（缺少 profile/cards/log）" };
      }
      Store.restoreSnapshot(data);
      return { ok: true, kind: "json", imported: 1 };
    },

    /* ---- 字段级合并：两台设备各自学过的东西取并集，不再整档覆盖 ----
       规则：学习记录按「条目标识 + 时间」取较新者；计数类取 max；单值档案保持本机。
       卡片没有 last 字段，用「history 最后时间 / due - iv 天」近似最后一次练习时间。 */
    mergeStates(mine, theirs) {
      const a = migrate(JSON.parse(JSON.stringify(mine || {})));
      const b = migrate(JSON.parse(JSON.stringify(theirs || {})));
      const lastT = c => {
        const h = (c && c.history) || [];
        const ht = h.reduce((m, x) => Math.max(m, Number(x && x.t) || 0), 0);
        const iv = Math.max(0, +c.iv || 0);
        return Math.max(ht, (+c.due || 0) - iv * 86400000);
      };
      const out = a;
      let added = 0, updated = 0;

      /* 词卡 / HLR：按词取「更晚练习过」的那份 */
      Object.keys(b.cards || {}).forEach(w => {
        const cur = out.cards[w], nxt = b.cards[w];
        if (!cur) { out.cards[w] = nxt; added++; return; }
        if (lastT(nxt) > lastT(cur)) { out.cards[w] = nxt; updated++; }
      });
      out.hlr = out.hlr || {};
      Object.keys(b.hlr || {}).forEach(w => {
        const cur = out.hlr[w], nxt = b.hlr[w];
        if (!cur) { out.hlr[w] = nxt; added++; return; }
        if ((+nxt.last || 0) > (+cur.last || 0) || ((+nxt.last || 0) === (+cur.last || 0) && +nxt.correct > +cur.correct)) { out.hlr[w] = nxt; updated++; }
      });
      /* B2 FSRS 档案：按词取「更晚练习过」的那份（口径同 cards） */
      Object.keys(b.fsrs || {}).forEach(w => {
        const cur = out.fsrs[w], nxt = b.fsrs[w];
        if (!cur) { out.fsrs[w] = nxt; added++; return; }
        if ((+nxt.last || 0) > (+cur.last || 0)) { out.fsrs[w] = nxt; updated++; }
      });
      /* B2 note 注册表：按 id 取并集（先到先得，不覆盖已有） */
      Object.keys(b.notes || {}).forEach(id => {
        if (!out.notes[id]) { out.notes[id] = b.notes[id]; }
      });

      /* 学习流水：按 (时间, 类型, 题目) 去重后合并 */
      const seenLog = new Set();
      out.log = (a.log || []).concat(b.log || [])
        .filter(x => x && Number.isFinite(+x.t))
        .sort((x, y) => +y.t - +x.t)
        .filter(x => { const k = x.t + "|" + (x.type || "") + "|" + (x.item || ""); if (seenLog.has(k)) return false; seenLog.add(k); return true; })
        .slice(0, 6000);

      /* 错题 / 生词：按语义键取较新，掌握标记取并集 */
      const mergeBy = (key, keyOf, doneFlag) => {
        const map = new Map();
        (a[key] = (a[key] || [])).concat(b[key] || []).forEach(x => {
          const k = keyOf(x);
          const cur = map.get(k);
          if (!cur || (+x.t || 0) > (+cur.t || 0)) {
            map.set(k, doneFlag && cur && cur[doneFlag] ? Object.assign({}, x, { [doneFlag]: true }) : x);
            if (cur) updated++; else added++;
          } else if (doneFlag && x[doneFlag] && !cur[doneFlag]) cur[doneFlag] = true;
        });
        out[key] = [...map.values()].sort((x, y) => (+y.t || 0) - (+x.t || 0));
      };
      mergeBy("wrong", x => (x.module || "") + "|" + (x.type || "") + "|" + (x.wrong || ""), "mastered");
      mergeBy("wordbank", x => String(x.de || "").toLowerCase(), "known");
      ["sessions", "chatReports", "interviews", "speeches", "mockexams", "writingHist", "contentReports"].forEach(k =>
        mergeBy(k, x => String(x.t || "") + "|" + (x.id || x.prompt || x.scene || ""), ""));

      /* 打卡分钟：同一天取较大值，避免两台设备相加把一天算成几十小时 */
      Object.keys(b.daily || {}).forEach(d => {
        const v = Math.max(+out.daily[d] || 0, +b.daily[d] || 0);
        if (v) out.daily[d] = v;
      });

      ["favorites", "recentModules", "badges"].forEach(k => {
        out[k] = [...new Set([...(a[k] || []), ...(b[k] || [])])];
      });
      Object.keys(b.visited || {}).forEach(r => { out.visited[r] = Math.max(+out.visited[r] || 0, +b.visited[r] || 0); });
      ["timelineDone", "path", "readingDone", "chatActive"].forEach(k => {
        out[k] = Object.assign({}, b[k] || {}, out[k] || {});
      });
      /* 计划勾选按每项最后操作时间合并：取消勾选也会以较新时间传播，
         不会被另一台设备上较旧的“已完成”永久覆盖；云端较新的同键也必须计入增量。 */
      const minePlan = a.planDone || {}, theirsPlan = b.planDone || {};
      let planChanged = false;
      out.planDone = {};
      const planKeys = new Set([...Object.keys(minePlan), ...Object.keys(theirsPlan)]);
      planKeys.forEach(k => {
        const mine = minePlan[k], theirs = theirsPlan[k];
        const mineAt = +((mine && mine.at) || 0), theirsAt = +((theirs && theirs.at) || 0);
        const pick = !mine ? theirs : !theirs ? mine : (mineAt >= theirsAt ? mine : theirs);
        if (!pick) return;
        if (!mine || !theirs || JSON.stringify(pick) !== JSON.stringify(mine)) planChanged = true;
        out.planDone[k] = pick;
      });
      /* 计划本体也随快照同步：优先保留“已勾选任务重合最多”的一份，
         重合度相同再取生成时间较新的；避免另一台设备把今天的任务键整体换掉。 */
      const planOverlap = p => {
        if (!p || !Array.isArray(p.plan)) return -1;
        const done = out.planDone || {};
        return p.plan.reduce((n, d) => n + (d.tasks || []).filter(t => t && done[t.id]).length, 0);
      };
      const choosePlan = (mine, theirs) => {
        if (!mine) return theirs || null;
        if (!theirs) return mine;
        const sm = planOverlap(mine), st = planOverlap(theirs);
        if (sm !== st) return sm > st ? mine : theirs;
        const tm = +mine.generatedAt || 0, tt = +theirs.generatedAt || 0;
        return tt > tm ? theirs : mine;
      };
      const chosenFw = choosePlan(a.firstWeek, b.firstWeek);
      if (chosenFw && chosenFw !== a.firstWeek) { out.firstWeek = chosenFw; planChanged = true; }
      const chosenBase = choosePlan(a.planBase, b.planBase);
      if (chosenBase && chosenBase !== a.planBase) { out.planBase = chosenBase; planChanged = true; }
      if (planChanged) updated++;

      ["xp", "freezes", "bestStreak", "_questsPerfect", "lastExportAt"].forEach(k => {
        out[k] = Math.max(+a[k] || 0, +b[k] || 0);
      });
      const qa = a.quests, qb = b.quests;
      out.quests = (qb && (!qa || (qb.date || "") > (qa.date || ""))) ? qb : qa;

      /* 内容包：取条目更多的一份，避免把已导入的包合并丢 */
      const packSize = p => (p && typeof p === "object") ? Object.keys(p).reduce((n, k) => n + ((p[k] || []).length), 0) : 0;
      if (packSize(b.contentPack) > packSize(a.contentPack)) out.contentPack = b.contentPack;

      out._snapAt = Math.max(+a._snapAt || 0, +b._snapAt || 0);
      if (Number.isFinite(+b.updatedAt)) out.updatedAt = Math.max(+a.updatedAt || 0, +b.updatedAt);
      return { state: out, stats: { added, updated } };
    },

    /* 推送快照到云端（手动同步 / 启动合并 / 作答自动推送共用）。
       keepalive=true 供 pagehide 兜底；浏览器限制 64KB，大快照自动退化为普通请求。 */
    pushSnapshot(snapshot, stats, keepalive) {
      const base = String(Store.s.cfg.backend || "").replace(/\/$/, "");   // 空 = 与站点同源
      /* file:// 且没有填写后端绝对地址：相对路径会解析成 file:///.../api/sync 并报错，直接拒绝 */
      if (!base && !/^https?:$/.test(location.protocol)) {
        return Promise.reject(new Error("单文件版离线运行，未配置后端地址"));
      }
      return fetch(base + "/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: keepalive === true && JSON.stringify(snapshot).length < 60000,
        body: JSON.stringify({
          open_id: Store.s.open_id,
          profile: Store.s.profile, ability: Store.s.ability,
          log: (snapshot.log || []).slice(-200),
          snapshot
        })
      }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json().then(j => Object.assign(j, { merge: stats })); });
    },

    /* 与后端同步（可选）：先拉取云端 → 字段级合并 → 推送合并结果，双设备不再互相覆盖。
       opts.force=true（手动同步 / 诊断完成）始终推送；启动自动合并只在
       「云端为空或合并有增量」时才推，避免每次回访都上传整份快照。 */
    sync(opts) {
      const base = String(Store.s.cfg.backend || "").replace(/\/$/, "");   // 空 = 与站点同源
      if (!base && !/^https?:$/.test(location.protocol)) {
        return Promise.reject(new Error("单文件版离线运行，未配置后端地址"));
      }
      /* 先读云端：读到就合并（并集）再推；读不到（首次同步 / 后端不可达）就推本机 */
      return fetch(base + "/api/sync?open_id=" + encodeURIComponent(Store.s.open_id), {
        credentials: "same-origin", headers: { "Content-Type": "application/json" }
      }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => {
        const cloud = j && j.ok && j.snapshot ? j.snapshot : null;
        let stats = { added: 0, updated: 0 };
        if (cloud) {
          const merged = Store.mergeStates(Store.s, cloud);
          stats = merged.stats;
          if (stats.added || stats.updated) {
            const keepCfg = state.cfg, keepOid = state.open_id;
            state = merged.state;
            state.cfg = keepCfg;          // 本机设置与设备标识不上云、也不被云覆盖
            state.open_id = keepOid;
            ensureOpenId(state);
            save();
          }
        }
        if (!(opts && opts.force) && cloud && !stats.added && !stats.updated) {
          markSynced();
          return { ok: true, merge: stats };
        }
        return Store.pushSnapshot(Store.snapshot(), stats).then(r => { markSynced(); return r; });
      });
    },

    /* 作答后调用：20s 静默窗口内的多次作答只推一次 */
    autoPushSchedule() {
      pushDirty = true;
      if (pushTimer) return;
      pushTimer = setTimeout(() => { pushTimer = null; Store.autoPushFlush(false); }, 20000);
    },
    /* 立即推送待同步内容（测试 / 切后台 / 页面关闭兜底）。未登录或离线静默跳过。 */
    autoPushFlush(keepalive) {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      if (!pushDirty) return Promise.resolve({ skipped: true });
      let authed = false;
      try { authed = !!localStorage.getItem("linguade.acct"); } catch (e) { }
      if (!authed) return Promise.resolve({ skipped: true });
      return Store.pushSnapshot(Store.snapshot(), { added: 0, updated: 0 }, keepalive === true)
        .then(r => { pushDirty = false; markSynced(); return r; })
        .catch(() => { pushDirty = true; return { skipped: true }; });
    },
  };

  /* 词库册内容包 → 内存词表（幂等）：使所有 window.LD_LEX 读取点自动受益。
     词库册两条通路都能用——① tools/lexicon_enrich.py 直接产 src/data/lexicon-8.js（内联、零操作）；
     ② 作为独立内容包导入（部署形态可一键导入 dist/content-pack-lexicon.json）。 */
  function applyContentPack() {
    const extra = (state && state.contentPack && state.contentPack.lexicon) || [];
    if (!extra.length) return;
    const base = window.LD_LEX || [];
    const seen = new Set(base.map(w => String(w[0] || "").toLowerCase()));
    const add = extra
      .filter(w => w && w.de && !seen.has(String(w.de).toLowerCase()))
      .map(w => [w.de, w.art || "—", w.zh || "", w.pos || "", w.lvl || "", w.ex || "", w.exzh || ""]);
    if (add.length) window.LD_LEX = base.concat(add);
    if (window.LD && window.LD.Lex && window.LD.Lex.rebuild) window.LD.Lex.rebuild();
  }

  window.LD = window.LD || {};
  window.LD.Store = Store;
  load();
  applyContentPack();                      // 启动即挂载已持久化的词库册（刷新不丢）
  window.LD.Store.applyContentPack = applyContentPack;

  /* 自动推送兜底：切到后台或页面关闭前，把还没推出去的作答冲掉 */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { try { Store.autoPushFlush(false); } catch (e) { } }
  });
  window.addEventListener("pagehide", () => { try { Store.autoPushFlush(true); } catch (e) { } });
})();
