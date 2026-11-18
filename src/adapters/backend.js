/* LinguaDE · 后端适配层（LD.Backend）
 * 把可选的 FastAPI 后端接起来：未配置后端地址时 ready() 为 false，上层自动降级。
 * 接口与 backend/app/schemas.py 对齐。
 */
(function () {
  const LD = (window.LD = window.LD || {});
  const cfg = () => LD.Store.s.cfg;
  const base = () => String(cfg().backend || "").replace(/\/+$/, "");
  /* 后端就绪状态：只认「探测结果」，不认协议正则。
     显式配置了后端地址（或 nginx 反代同源部署、且已探测通过）才算 ready；
     file:// 与纯静态托管（无 /api 或 /api 不可达）一律不谎称"后端可用"。 */
  const probeState = { at: 0, ok: null };           // ok: null 未知 | true | false
  let caps = null;                                  // 健康检查带回的能力（tts/asr），避免向未启用的通道发请求
  const PROBE_TTL = 60000, PROBE_FAIL_TTL = 300000; // 成功 60s 内有效；失败缓存 5 分钟避免风暴
  /* 同源 + 本地回环（e2e 静态服务器 / 本地静态托管）通常没有 /api：探测只会拿到 404 并污染控制台，
     直接判为「无后端」。用 docker-compose 在 localhost 起整站、确实有 /api 时，请在设置里显式填写
     后端地址（ready() 会直接信任，不再探测）。与 src/auth.js 的本地主机跳过同口径。 */
  const LOOPBACK_HOST = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\]|::1)$/i;
  function probeHealth(timeoutMs) {
    /* 短路也必须把结论写进 probeState：否则 healthState() 永远停在 "unknown"，
       依赖「探测完成后重渲染」的页面（如口语测评的 checking 态）会无限重渲染直到渲染进程崩溃。 */
    const settle = ok => { probeState.at = Date.now(); probeState.ok = ok; if (!ok) caps = null; return ok; };
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve(settle(false));
    if (!base() && LOOPBACK_HOST.test(location.hostname || "")) return Promise.resolve(settle(false));
    const now = Date.now();
    if (probeState.ok !== null && now - probeState.at < (probeState.ok ? PROBE_TTL : PROBE_FAIL_TTL)) {
      return Promise.resolve(probeState.ok);
    }
    const t = withTimeout(timeoutMs || 1800);
    return fetch(base() + "/api/health", { signal: t.signal })
      .then(r => {
        if (!(r && r.ok)) return false;
        return r.json().then(j => {
          caps = { tts: !!(j && j.tts && j.tts.ready), asr: !!(j && j.asr) };
          return true;
        }).catch(() => true);
      })
      .catch(() => false)
      .then(ok => { t.done(); probeState.at = Date.now(); probeState.ok = ok; if (!ok) caps = null; return ok; });
  }
  const healthState = () => {
    if (base()) return "configured";                 // 显式配置了后端地址：信任用户，请求失败会如实报错
    if (!/^https?:$/.test(location.protocol)) return "off";
    return probeState.ok === true ? "ok" : probeState.ok === false ? "off" : "unknown";
  };
  /* 就绪 = 显式配置了地址，或（同源 + 最近一次探测通过） */
  const ready = () => !!base() || healthState() === "ok";
  /* 后端契约必填的设备标识（backend/app/schemas.py 各请求模型均要求 open_id） */
  const oid = () => (LD.Store && LD.Store.s && LD.Store.s.open_id) || "";

  function withTimeout(timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return { signal: ctrl.signal, done: () => clearTimeout(timer) };
  }

  /* 把 FastAPI 的错误体压成一句可读的话（detail 可能是字符串或 422 数组） */
  function detailOf(j) {
    if (!j) return "";
    let d = j.detail || j.message || "";
    if (Array.isArray(d)) d = d.map(x => (x && (x.msg || x.type)) || "").filter(Boolean).join("; ");
    return String(d).slice(0, 180);
  }

  function json(path, body, timeout) {
    const t = withTimeout(timeout || 20000);
    return fetch(base() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: t.signal
    }).then(async r => {
      if (!r.ok) {
        let d = "";
        try { d = detailOf(await r.json()); } catch (e) { /* 非 JSON 错误体 */ }
        throw new Error("HTTP " + r.status + (d ? " · " + d : ""));
      }
      return r.json();
    }).finally(t.done);
  }

  function get(path, timeout) {
    const t = withTimeout(timeout || 5000);
    return fetch(base() + path, { signal: t.signal })
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).finally(t.done);
  }

  /* 健康检查：{ ok, database, redis, llm, llm_model, llm_style, asr } */
  function health() { return get("/api/health", 4000); }

  /* 同源反代（nginx）或显式配置了后端地址时才有 /api 可言；本机随机端口的静态服务器
     （e2e / 开发预览）没有 /api，自动请求只会留下 404/501 控制台噪音（e2e 零错误断言依赖此口径）。 */
  function hasApi() {
    if (base()) return true;
    const host = location.hostname || "";
    if (!/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/.test(host)) return true;
    const port = location.port || (location.protocol === "https:" ? "443" : "80");
    return port === "80" || port === "443" || port === "8080";
  }

  /* 页面加载时是否值得自动请求语料库：本机静态服务器（e2e / 开发预览）没有 /api，
     自动探测只会留下 404 噪音；显式配置了后端地址或线上部署则照常请求。 */
  function contentAutoLoad() {
    return ready() && hasApi();
  }

  /* 可公开读取的许可学习语料；音频单独请求，避免列表接口传输 BLOB。 */
  function listWritingSamples(level, limit) {
    const query = new URLSearchParams();
    if (level) query.set("level", level);
    query.set("limit", String(Math.max(1, Math.min(30, limit || 10))));
    return get("/api/content/writing?" + query.toString(), 12000);
  }
  function listListeningAssets(limit) {
    return get("/api/content/listening?limit=" + encodeURIComponent(Math.max(1, Math.min(50, limit || 30))), 12000);
  }

  /* 语法纠错：{ source:"llm"|"fallback"|"none", issues:[...] } */
  function correct(text) {
    return json("/api/ai/correct", { text }, 40000).then(j => {
      if (!j) throw new Error("空响应");
      if (j.source === "none") throw new Error("后端未配置大模型");
      if (!Array.isArray(j.issues)) throw new Error("响应格式异常");
      if (j.source === "fallback") throw new Error(j.message || "后端降级");
      return j;
    });
  }

  /* 场景对话：{ reply }；persona 为对话室人设 id（后端可选增强） */
  function chat(sceneId, history, text, persona) {
    return json("/api/ai/chat", { open_id: oid(), scene_id: sceneId, history: history || [], text, persona: persona || "" }, 45000);
  }

  /* 中文 → 德语：{ text }（对话室中文输入；未配置大模型时后端返回 501） */
  function translate(text) {
    return json("/api/ai/translate", { text }, 30000).then(j => {
      if (!j || typeof j.text !== "string") throw new Error("响应格式异常");
      return j;
    });
  }

  /* 面试评估：四维评分 JSON */
  function interviewEvaluate(items) {
    return json("/api/ai/interview/evaluate", { open_id: oid(), items }, 45000);
  }

  /* 语音转写：multipart 上传，返回 { text, confidence } */
  function transcribe(blob, filename) {
    const fd = new FormData();
    fd.append("file", blob, filename || "speech.webm");
    const t = withTimeout(60000);
    return fetch(base() + "/api/ai/speech/transcribe", { method: "POST", body: fd, signal: t.signal })
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).finally(t.done);
  }

  /* 场景对话（流式 SSE）：onDelta(delta, full) 增量回调；resolve 为完整文本 */
  function chatStream(sceneId, history, text, onDelta, persona) {
    const t = withTimeout(60000);
    return fetch(base() + "/api/ai/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open_id: oid(), scene_id: sceneId, history: history || [], text: text, persona: persona || "" }),
      signal: t.signal
    }).then(async r => {
      if (!r.ok) {
        let d = "";
        try { d = detailOf(await r.json()); } catch (e) { /* 非 JSON 错误体 */ }
        throw new Error("HTTP " + r.status + (d ? " · " + d : ""));
      }
      if (!r.body || !r.body.getReader) throw new Error("当前环境不支持流式响应");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "", full = "";
      const pump = () => reader.read().then(({ done, value }) => {
        if (done) return full;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        parts.forEach(p => {
          const line = p.replace(/^data:\s?/, "");
          if (!line || line === "[DONE]") return;
          try {
            const j = JSON.parse(line);
            if (j.delta) { full += j.delta; if (onDelta) onDelta(j.delta, full); }
          } catch (e) { /* 忽略不完整分片 */ }
        });
        return pump();
      });
      return pump();
    }).finally(t.done);
  }

  /* 图像识别 + 批改：imageDataUrl 形如 data:image/jpeg;base64,...
   mode: grammar(语法纠错) | exercise(练习批改) | essay(写作批改) */
  function ocrGrade(imageDataUrl, mode, meta) {
    const t = withTimeout(120000);
    return fetch(imageDataUrl).then(r => r.blob()).then(blob => {
      const fd = new FormData();
      const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      fd.append("file", blob, "capture." + ext);
      fd.append("mode", mode || "grammar");
      fd.append("meta", JSON.stringify(meta || {}));
      return fetch(base() + "/api/ocr/grade", { method: "POST", body: fd, signal: t.signal })
        .then(r => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        });
    }).finally(t.done);
  }

  /* 学习数据同步：{ ok, user_id, imported }（payload 自带 open_id + snapshot） */
  function sync(payload) { return json("/api/sync", payload, 30000); }

  /* 音素级评估（后端可选通道 3.7.0）：通道 rule（默认）/ acoustic（外部声学服务）。
     失败即抛错 —— 调用方回落本地规则通道（src/phonetics.js），主流程不受影响 */
  function phonemeAssess(ref, hyp, meta) {
    return json("/api/ai/phoneme/assess", { open_id: oid(), ref, hyp, meta: meta || {} }, 20000);
  }

  /* 知识追踪预测（后端可选通道 3.7.0）：通道 bkt（默认，与前端同口径）/ dkt（外部深度模型服务） */
  function ktPredict(skill, history) {
    return json("/api/ai/kt/predict", { open_id: oid(), skill, history: history || [] }, 20000);
  }

  /* 云端快照拉取：换设备时恢复学习数据 → Store.restoreSnapshot(j.snapshot) */
  function pullSync() {
    return get("/api/sync?open_id=" + encodeURIComponent(oid()), 15000).then(j => {
      if (!j || !j.ok || !j.snapshot) throw new Error(j && j.message ? j.message : "云端暂无可恢复的快照");
      return j;
    });
  }

  /* 发音合成（POST /api/tts → blob URL）：后端未启用（501）或失败一律返回 null，
     上层回落浏览器 TTS；同句结果缓存在内存（上限 200 条，淘汰时回收 objectURL） */
  const ttsCache = new Map();
  async function tts(text) {
    if (!ready() || !hasApi()) return null;   // 本机静态服务器没有 /api，POST 只会留下 501 噪音
    if (caps && caps.tts === false) return null;   // 健康检查已说明 TTS 未启用，直接回落浏览器语音
    const key = String(text || "").trim();
    if (!key) return null;
    if (ttsCache.has(key)) return ttsCache.get(key);
    try {
      const t = withTimeout(20000);
      const r = await fetch(base() + "/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: key }),
        signal: t.signal
      });
      t.done();
      if (!r.ok) {
        if (r.status === 501) caps = Object.assign({}, caps, { tts: false });
        return null;
      }
      const blob = await r.blob();
      if (!/^audio\//.test(blob.type)) return null;
      const url = URL.createObjectURL(blob);
      if (ttsCache.size >= 200) {
        const oldest = ttsCache.keys().next().value;
        const oldUrl = ttsCache.get(oldest);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        ttsCache.delete(oldest);
      }
      ttsCache.set(key, url);
      return url;
    } catch (e) { return null; }
  }

  LD.Backend = { ready, base, health, healthState, probeHealth, contentAutoLoad, listWritingSamples, listListeningAssets, correct, chat, chatStream, translate, interviewEvaluate, transcribe, ocrGrade, sync, pullSync, phonemeAssess, ktPredict, tts };
})();
