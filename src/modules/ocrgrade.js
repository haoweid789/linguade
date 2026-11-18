/* 模块 · 拍照批改：手写/印刷德语照片 → 识别转录 → 语法纠错 / 练习批改 / 写作批改
   路线见 docs/ocr-research.md：视觉 LLM 一体化（转录 + 批改一次完成），三层降级复用 LD.LLM.ocrGrade。
   隐私：图像仅在用户主动提交时上传，服务端不落盘；前端仅内存持有。 */
(function () {
  const S = () => window.LD.Store.s;

  const MODES = [
    { k: "grammar", nm: "语法纠错", hint: "手写 / 打印的德语句子或段落" },
    { k: "exercise", nm: "练习批改", hint: "练习册、作业照片（含作答）" },
    { k: "essay", nm: "写作批改", hint: "Telc / TestDaF 作文照片" }
  ];

  let mode = "grammar", imageDataUrl = "", lastResult = null;

  const Mod = {
    title: "拍照批改",
    desc: "手写/印刷德语照片 → 识别转录 → 语法纠错 / 练习批改 / 写作批改",
    render(host, ctx) {
      window.LD.Store.visit("ocrgrade");
      /* 三状态徽标：检测中 / 已就绪 / 未连接 —— 绝不写一个不存在的"就绪" */
      const aiTagHtml = () => {
        const hs = (window.LD.Backend && LD.Backend.healthState) ? LD.Backend.healthState() : "off";
        if (hs === "configured" || hs === "ok") return `<span class="tag tag-ok" id="ocrAiTag" style="margin-left:auto">${window.LD.LLM.backendReady() ? "云端视觉大模型已就绪" : "直连视觉模型已就绪"}</span>`;
        if (hs === "unknown") return `<span class="tag" id="ocrAiTag" style="margin-left:auto">正在检测后端…</span>`;
        if (window.LD.LLM.ready()) return `<span class="tag tag-ok" id="ocrAiTag" style="margin-left:auto">直连视觉模型已就绪</span>`;
        return `<span class="tag tag-warn" id="ocrAiTag" style="margin-left:auto">未连接后端 · 手写识别不可用</span>`;
      };
      host.innerHTML = `
        <div class="page-head"><h1>拍照批改</h1>
          <p>把写在纸上的德语拍下来：一次调用同时完成「识别转录 + 批改」。手写体依赖 AI 通道（后端视觉大模型，或你在「设置」中直连的视觉模型）。</p></div>

        <div class="card card-pad" style="margin-bottom:14px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
            <span style="font-size:12px;color:var(--text-3)">批改类型</span>
            ${MODES.map(m => `<div class="scene-chip ${mode === m.k ? "active" : ""}" data-mode="${m.k}" title="${m.hint}">${m.nm}</div>`).join("")}
            ${aiTagHtml()}
          </div>
          <div class="upload-zone">
            <div class="upload-icon" aria-hidden="true">▧</div>
            <div class="upload-title">拍照或选择一张德语图片</div>
            <div class="hint">建议：光线充足、纸张平整、只拍一段文字，识别率更高。</div>
            <div class="btn-row">
              <label class="btn btn-primary" style="cursor:pointer">${window.LD.icon("camera")} 拍照 / 选择图片
                <input type="file" id="ocrFile" accept="image/*" capture="environment" style="display:none">
              </label>
              <button class="btn" id="ocrRun" disabled>开始识别与批改</button>
              <button class="btn btn-ghost" id="ocrClear">清空</button>
            </div>
            <div id="ocrPreview" class="hint">尚未选择图片。</div>
          </div>
        </div>

        <div id="ocrOut"></div>

        <div class="card card-pad" style="background:var(--panel-2)">
          <div class="hint" style="margin:0">识别结果会给出「转录原文」供你校对；若转录有误，可直接编辑后点『按校正文本重新批改』（走纯文本纠错，更快更准）。图片仅在本次请求中传输，服务端不落盘。</div>
        </div>`;

      host.querySelectorAll("[data-mode]").forEach(c => c.onclick = () => { mode = c.dataset.mode; ctx.go("ocrgrade"); });
      const input = host.querySelector("#ocrFile");
      input.onchange = () => pickImage(host, input.files && input.files[0]);
      host.querySelector("#ocrRun").onclick = () => run(host);
      host.querySelector("#ocrClear").onclick = () => { imageDataUrl = ""; lastResult = null; ctx.go("ocrgrade"); };
      /* 探测完成后刷新徽标（用户在全站任一入口进入本页也可能赶上探测竞态） */
      if (window.LD.Backend && LD.Backend.probeHealth) {
        LD.Backend.probeHealth(1800).then(() => {
          const tag = host.querySelector("#ocrAiTag");
          if (tag) tag.outerHTML = aiTagHtml();
        }).catch(() => {});
      }
    }
  };

  /* 选图 → 压缩 → 预览 */
  function pickImage(host, file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("请选择图片文件", "err"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      compress(reader.result).then(url => {
        imageDataUrl = url;
        host.querySelector("#ocrPreview").innerHTML = `
          <div style="display:flex;gap:12px;align-items:center">
            <img src="${url}" style="max-height:120px;border-radius:8px;border:1px solid var(--line)">
            <div style="font-size:12.5px;color:var(--text-2)">${esc(file.name)} · 已压缩至适合识别的大小<br>点击「开始识别与批改」上传。</div>
          </div>`;
        host.querySelector("#ocrRun").disabled = false;
      });
    };
    reader.readAsDataURL(file);
  }

  /* 压缩复用 LD.OCRUI.compress（单一实现，避免多处重复） */
  function compress(dataUrl) {
    return window.LD.OCRUI ? LD.OCRUI.compress(dataUrl) : Promise.resolve(dataUrl);
  }

  function run(host) {
    if (!imageDataUrl) { toast("请先选择图片", "err"); return; }
    const out = host.querySelector("#ocrOut");
    const btn = host.querySelector("#ocrRun");
    btn.disabled = true;
    out.innerHTML = `<div class="card card-pad"><div class="hint" style="margin:0">正在识别与批改……（视觉模型通常需要数秒）</div></div>`;
    window.LD.LLM.ocrGrade(imageDataUrl, mode, { level: S().profile.level })
      .then(r => { lastResult = r; paintResult(host, r, false); })
      .catch(e => { out.innerHTML = `<div class="card card-pad" style="background:var(--danger-soft)">批改失败：${esc(e.message)}</div>`; })
      .finally(() => { btn.disabled = false; });
  }

  function paintResult(host, r, corrected) {
    const out = host.querySelector("#ocrOut");
    if (!r || r.ok === false) {
      out.innerHTML = `
        <div class="card card-pad" style="border-color:var(--accent)">
          <div style="font-weight:600;margin-bottom:6px">暂时无法批改</div>
          <div class="hint" style="margin:0">${esc((r && r.message) || "未获得结果")}</div>
        </div>`;
      return;
    }

    const conf = r.confidence == null ? "" : `<span class="tag ${r.confidence >= 0.8 ? "tag-ok" : "tag-warn"}">识别置信度 ${Math.round(r.confidence * 100)}%</span>`;
    const srcTag = `<span class="tag">${r.source === "vision-llm" ? "后端视觉大模型" : r.source === "direct-vision" ? "直连视觉模型" : "AI"}</span>`;
    const score = (r.score && r.score.overall != null) ? `
      <div class="card card-pad stat" style="margin-bottom:10px">
        <div class="k">综合评分</div>
        <div class="v">${r.score.overall}<small> / 100</small></div>
        <div class="s">${dims(r.score)}</div>
      </div>` : "";

    const corr = (r.corrections || []).map((c, i) => `
      <div class="list-item" style="padding:9px 0;align-items:flex-start">
        <span class="tag tag-danger" style="flex-shrink:0">${esc(c.type || "错误")}</span>
        <div class="main" style="margin-left:8px">
          <div class="t1 de" style="font-size:13px"><s style="color:var(--danger)">${esc(c.orig)}</s> → <b style="color:var(--ok)">${esc(c.fixed)}</b></div>
          <div class="t2">${esc(c.explain || "")}</div>
        </div>
        <button class="btn btn-sm" data-keep="${i}" title="加入错题本">✕</button>
      </div>`).join("");

    const items = (r.items || []).map(it => {
      const ok = it.verdict === "正确";
      return `<div class="list-item" style="padding:9px 0;align-items:flex-start">
        <span class="tag ${ok ? "tag-ok" : "tag-warn"}" style="flex-shrink:0">${esc(it.verdict || "")}</span>
        <div class="main" style="margin-left:8px">
          <div class="t1" style="font-size:13px">${esc(it.question || "")}</div>
          <div class="t2 de">作答：${esc(it.answer || "")}${it.correct ? ` ｜ 正确：<b>${esc(it.correct)}</b>` : ""}</div>
          <div class="t2">${esc(it.explain || "")}</div>
        </div></div>`;
    }).join("");

    out.innerHTML = `
      <div class="card card-pad" style="margin-bottom:14px;border-color:var(--brand)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <div style="font-weight:600">识别与批改结果</div>
          <div style="display:flex;gap:6px">${conf}${srcTag}${corrected ? '<span class="tag tag-blue">按校正文本重批</span>' : ""}</div>
        </div>
        ${score}
        <h2 style="margin:10px 0 6px;font-size:13.5px">转录原文（可编辑校对）</h2>
        <textarea id="ocrTranscript" class="de" style="width:100%;min-height:90px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text)">${esc(r.transcript || "")}</textarea>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn btn-sm" id="ocrRecorrect">按校正文本重新批改</button>
          <button class="btn btn-sm" id="ocrCopyWords">转录生词存入生词本</button>
        </div>
        ${r.comments ? `<div class="divider"><span>总评</span></div><div style="font-size:13px;line-height:1.9;color:var(--text-2)">${esc(r.comments)}</div>` : ""}
        ${(r.suggestions || []).length ? `<div class="divider"><span>改进建议</span></div>
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.9;color:var(--text-2)">${r.suggestions.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        ${r.sample ? `<div class="divider"><span>德语示范</span></div><div class="de" style="font-size:13px;line-height:1.9;color:var(--text-2);white-space:pre-wrap">${esc(r.sample)}</div>` : ""}
      </div>
      ${corr ? `<div class="card card-pad" style="margin-bottom:14px"><h2 style="margin:0 0 6px;font-size:13.5px">逐条修改（点右侧 ✕ 可加入错题本）</h2>${corr}</div>` : ""}
      ${items ? `<div class="card card-pad"><h2 style="margin:0 0 6px;font-size:13.5px">逐题判定</h2>${items}</div>` : ""}`;

    host.querySelectorAll("[data-keep]").forEach(b => b.onclick = () => {
      const c = (r.corrections || [])[+b.dataset.keep];
      if (!c) return;
      window.LD.Store.addWrong({ module: "拍照批改", type: c.type || "语法", wrong: c.orig || "", right: c.fixed || "", why: c.explain || "" });
      toast("已加入错题本", "ok");
    });

    const rc = host.querySelector("#ocrRecorrect");
    if (rc) rc.onclick = () => {
      const t = (host.querySelector("#ocrTranscript").value || "").trim();
      if (!t) { toast("转录为空", "err"); return; }
      rc.disabled = true;
      window.LD.LLM.correct(t).then(res => {
        const r2 = Object.assign({}, r, {
          transcript: t,
          corrections: res.issues || [],
          comments: (r.comments || "") + "（已按你校正后的文本重新批改）"
        });
        paintResult(host, r2, true);
      }).catch(e => toast("重批失败：" + e.message, "err")).finally(() => { rc.disabled = false; });
    };

    const cw = host.querySelector("#ocrCopyWords");
    if (cw) cw.onclick = () => {
      const t = host.querySelector("#ocrTranscript").value || "";
      const words = [...new Set(t.match(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{3,}/g) || [])].slice(0, 20);
      let n = 0;
      words.forEach(w => { if (window.LD.Store.addWord({ de: w, ctx: t.slice(0, 120), scene: "ocr" })) n++; });
      toast(n ? `已收录 ${n} 个生词` : "没有可收录的生词", n ? "ok" : "info");
    };
  }

  const DIM_NM = { task: "任务完成度", coherence: "连贯性", vocab: "词汇", grammar: "语法" };
  const dims = s => Object.keys(DIM_NM).filter(k => s[k] != null).map(k => `${DIM_NM[k]} ${s[k]}`).join(" · ");

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toast(m, t) { window.LD.UI && window.LD.UI.toast(m, t); }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "拍照批改", icon: "▨", group: "沉淀与复盘", priority: "P0", order: 98, nav: "more", ds: "拍照/上传手写德语 → 识别转录 → 语法纠错 / 练习批改 / 写作批改" });
  window.LD.define("ocrgrade", Mod);
})();