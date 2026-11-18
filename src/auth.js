/* LinguaDE · 账号门禁 + 管理员配置
 * 只在能连到同源 /api 的部署形态启用：file:// 单文件版与纯静态托管照旧免登录。
 * 登录态由服务端 HttpOnly Cookie 维护，前端只保存账号展示信息。
 */
(function () {
  const LD = window.LD;
  let me = null;
  let mode = "login";
  let registerOpen = true;
  let booted = false;

  /* file:// 单文件版没有同源后端：相对路径会被解析成 file:///.../api/...，
     fetch 直接报 "URL scheme file is not supported"。这里提前拒绝，不发请求。 */
  const API_OK = /^https?:$/.test(location.protocol);
  const $ = id => document.getElementById(id);
  const api = (path, opts = {}) => !API_OK
    ? Promise.reject(new Error("单文件版离线运行，未连接后端"))
    : fetch(path, {
    credentials: "same-origin",
    headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {}),
    ...opts
  });

  function msg(text, bad) {
    const el = $("authMsg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = bad ? "var(--danger,#d03050)" : "var(--text-2)";
  }

  function paintMode() {
    const isReg = mode === "register";
    $("authSubmit").textContent = isReg ? "注册并进入" : "登录";
    $("authSwitch").textContent = isReg ? "已有账号？登录" : "没有账号？注册";
    $("authInviteRow").hidden = !isReg;
    $("authSub").textContent = isReg ? "创建账号后即可使用全部功能" : "请登录后继续";
    $("authSwitch").hidden = isReg ? false : !registerOpen;
    $("authPass").autocomplete = isReg ? "new-password" : "current-password";
    msg("");
  }

  function showGate(state) {
    registerOpen = !!(state && state.register_open);
    mode = state && state.accounts_exist ? "login" : "register";
    paintMode();
    $("authGate").hidden = false;
    setTimeout(() => { const el = $(mode === "register" ? "authUser" : "authUser"); if (el) el.focus(); }, 50);
  }

  async function guard() {
    if (!/^https?:$/.test(location.protocol)) return true;   // file:// 单文件版
    /* 本地开发与 e2e 跳过账号探测：静态服务器没有 /api，404 会在控制台留下噪音 */
    if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/.test(location.hostname || "")) return true;
    let state;
    try {
      const r = await api("/api/auth/state");
      if (!r.ok) return true;                                 // 没有后端 → 不拦
      state = await r.json();
    } catch (e) {
      return true;                                            // 后端不可达 → 不拦
    }
    try {
      const r = await api("/api/auth/me");
      if (r.ok) {
        me = await r.json();
        if (me.authenticated === false) {
          me = null;
          showGate(state);
          return false;
        }
        if (LD.Store && me.open_id) {
          const prev = localStorage.getItem("linguade.acct");
          if (prev && prev !== me.open_id) LD.Store.reset();   // 换账号：不继承别人的学习数据
          LD.Store.s.open_id = me.open_id;
          LD.Store.s.diagnosed = !!me.diagnosed;               // 诊断状态以服务端为准
          LD.Store.save();
          localStorage.setItem("linguade.acct", me.open_id);
        }
        syncAccountUI();
        return true;
      }
    } catch (e) { /* 未登录 */ }
    showGate(state);
    return false;
  }

  async function submit() {
    const btn = $("authSubmit");
    const body = {
      username: $("authUser").value.trim(),
      password: $("authPass").value
    };
    if (mode === "register") body.invite = $("authInvite").value.trim();
    btn.disabled = true;
    msg("处理中…");
    try {
      const r = await api("/api/auth/" + (mode === "register" ? "register" : "login"), {
        method: "POST", body: JSON.stringify(body)
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { msg(data.detail || ("请求失败：" + r.status), true); return; }
      me = data;
      if (LD.Store && data.open_id) { LD.Store.s.open_id = data.open_id; LD.Store.save(); }
      location.reload();                                      // 重新走一遍 guard，带着会话进站
    } catch (e) {
      msg("网络异常，请稍后重试", true);
    } finally {
      btn.disabled = false;
    }
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (e) { /* 忽略 */ }
    location.reload();
  }

  async function markDiagnosed() {
    try { await api("/api/auth/diagnosed", { method: "POST" }); } catch (e) { /* 离线时忽略，下次登录以服务端为准 */ }
  }

  async function resetDiagnosed() {
    if (!me) return true;
    try {
      const r = await api("/api/auth/diagnosed/reset", { method: "POST" });
      if (!r.ok) { window.LD.UI.toast("服务端未接受重测请求，请稍后重试", "err"); return false; }
      me.diagnosed = false;
      return true;
    } catch (e) { window.LD.UI.toast("无法连接账号服务，暂时不能重置账号诊断状态", "err"); return false; }
  }

  function syncAccountUI() {
    const name = $("acctName"), badge = $("acctBadge"), out = $("logoutBtn"), box = $("adminBox");
    if (name) name.textContent = me ? me.username : "未登录";
    if (badge) badge.textContent = me ? (me.is_admin ? "管理员" : "学习者") : "";
    if (out) out.hidden = !me;
    if (box) box.hidden = !(me && me.is_admin);
  }

  async function loadAdminSettings() {
    if (!me || !me.is_admin) return;
    const out = $("llmTestOut");
    if (out) out.textContent = "";
    try {
      const r = await api("/api/admin/settings");
      if (!r.ok) return;
      const s = await r.json();
      $("cfgApiBase").value = s.llm_base_url || "";
      $("cfgModel").value = s.llm_model || "";
      $("cfgApiStyle").value = s.llm_api_style || "openai";
      $("cfgApiVersion").value = s.llm_api_version || "2024-02-15-preview";
      syncApiStyleUI();
      $("cfgApiKey").value = "";
      $("cfgApiKey").placeholder = s.llm_key_set ? "已保存 " + s.llm_api_key + "（留空不修改）" : "只保存到服务器，不回显原文";
      $("cfgOcrBase").value = s.ocr_base_url || "";
      $("cfgOcrProject").value = s.ocr_project_id || "";
      $("cfgOcrAk").value = "";
      $("cfgOcrAk").placeholder = s.ocr_ak ? "已保存 " + s.ocr_ak + "（留空不修改）" : "留空表示不修改";
      $("cfgOcrSk").value = "";
      $("cfgOcrSk").placeholder = s.ocr_sk ? "已保存 " + s.ocr_sk + "（留空不修改）" : "留空表示不修改";
      $("cfgAsrBase").value = s.asr_base_url || "";
      $("cfgAsrKey").value = "";
      $("cfgAsrKey").placeholder = s.asr_key_set ? "已保存 " + s.asr_api_key + "（留空不修改）" : "服务无鉴权可留空";
    } catch (e) { /* 读取失败不阻断界面 */ }
  }

  async function saveAdminSettings() {
    const payload = {
      llm_base_url: $("cfgApiBase").value.trim(),
      llm_model: $("cfgModel").value.trim(),
      llm_api_style: $("cfgApiStyle").value,
      llm_api_version: $("cfgApiVersion").value.trim(),
      ocr_base_url: $("cfgOcrBase").value.trim(),
      ocr_project_id: $("cfgOcrProject").value.trim(),
      asr_base_url: $("cfgAsrBase").value.trim()
    };
    const secrets = {
      llm_api_key: $("cfgApiKey").value.trim(),
      ocr_ak: $("cfgOcrAk").value.trim(),
      ocr_sk: $("cfgOcrSk").value.trim(),
      asr_api_key: $("cfgAsrKey").value.trim()
    };
    Object.keys(secrets).forEach(k => { if (secrets[k]) payload[k] = secrets[k]; });
    const btn = $("admSave");
    if (btn) btn.disabled = true;
    try {
      const r = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { LD.UI.toast(data.detail || "保存失败", "err"); return; }
      const a = data.active || {};
      const parts = [a.llm ? "大模型配置已保存" : "大模型未填齐"];
      if (a.ocr_hw) parts.push("华为 OCR 已就绪");
      if (a.asr) parts.push("语音转写已配置");
      LD.UI.toast("已保存：" + parts.join(" · ") + (a.llm ? "；请点「测试连接」验证模型" : ""), "ok");
      loadAdminSettings();
    } catch (e) {
      LD.UI.toast("网络异常，保存失败", "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* 三种接口类型的输入提示与 Azure 版本行 */
  function syncApiStyleUI() {
    const sel = $("cfgApiStyle"), base = $("cfgApiBase"), model = $("cfgModel");
    if (!sel || !base || !model) return;
    const style = sel.value || "openai";
    const row = $("rowApiVersion");
    if (row) row.hidden = style !== "azure";
    const hint = $("apiStyleHint");
    if (style === "azure") {
      base.placeholder = "https://<resource>.openai.azure.com";
      model.placeholder = "Azure deployment 名，如 gpt-4o";
      if (hint) hint.textContent = "Azure：服务地址填资源 Endpoint；模型名填 deployment 名；API 版本默认 2024-02-15-preview。";
    } else if (style === "custom") {
      base.placeholder = "完整对话地址，如 https://…/v1/chat/completions";
      model.placeholder = "供应商控制台里的模型名 / 部署名";
      if (hint) hint.textContent = "自定义：地址原样请求，不会自动补 /chat/completions；适合华为云 MaaS 部署地址或自建网关。";
    } else {
      base.placeholder = "https://api.example.com/v1（也可直接填完整 /chat/completions 地址）";
      model.placeholder = "如 deepseek-chat / qwen-max / gpt-4o-mini";
      if (hint) hint.textContent = "OpenAI 兼容：地址填到 /v1 即可，系统自动补 /chat/completions；已带完整路径也能识别。";
    }
  }

  async function testLlm() {
    const btn = $("llmTest"), out = $("llmTestOut");
    if (!out) return;
    out.style.color = "var(--text-3)";
    out.textContent = "正在调用模型…（最多 20 秒）";
    if (btn) btn.disabled = true;
    try {
      const r = await api("/api/admin/llm-test", { method: "POST", body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        out.style.color = "var(--danger)";
        out.textContent = "测试失败：" + (j.detail || ("HTTP " + r.status));
        return;
      }
      if (j.ok) {
        out.style.color = "var(--ok)";
        out.textContent = `连接成功 · ${j.style || "openai"} · ${j.model || "默认模型"} · ${j.latency_ms || 0} ms · 回复：${j.reply || "（空）"}`
          + (j.hint ? " ｜ " + j.hint : "");
      } else {
        out.style.color = "var(--danger)";
        const stage = j.stage === "config" ? "配置不完整" : "请求失败";
        out.textContent = `${stage}：${j.message || "未知错误"}` + (j.hint ? " ｜ " + j.hint : "");
      }
    } catch (e) {
      out.style.color = "var(--danger)";
      out.textContent = "网络异常：" + e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bind() {
    const gate = $("authGate");
    if (!gate) return;
    $("authSubmit").onclick = submit;
    $("authSwitch").onclick = () => { mode = mode === "register" ? "login" : "register"; paintMode(); };
    $("authPass").addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    $("authUser").addEventListener("keydown", e => { if (e.key === "Enter") $("authPass").focus(); });
    $("logoutBtn").onclick = logout;
    $("admSave").onclick = saveAdminSettings;
    const testBtn = $("llmTest");
    if (testBtn) testBtn.onclick = testLlm;
    const styleSel = $("cfgApiStyle");
    if (styleSel) { styleSel.onchange = syncApiStyleUI; syncApiStyleUI(); }
  }

  window.addEventListener("DOMContentLoaded", bind);

  LD.Auth = {
    guard,
    me: () => me,
    isAdmin: () => !!(me && me.is_admin),
    syncAccountUI,
    markDiagnosed,
    resetDiagnosed,
    loadAdminSettings,
    saveAdminSettings,
    logout
  };
})();
