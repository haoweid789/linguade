/* LinguaDE · 划词公共层
   - quick 模式：保留对话原有「点词即收藏」行为
   - popover 模式：阅读/听力/写作用，先展示词条卡片，再决定是否收藏
   词条来自 LD.Lex；未命中只提示，不伪造释义。 */
(function () {
  const LD = (window.LD = window.LD || {});
  const WORD_RE = /([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{2,})/g;
  const STOP = new Set(("der die das den dem des ein eine einen einem einer eines und oder aber weil dass ich du er sie es wir ihr mich dich sich mir dir uns euch mein dein sein unser euer nicht kein keine mit von zu im am an auf für aus bei nach vor über unter durch gegen ohne um ist bin bist sind seid war waren habe hast hat haben hatte hatten wird werden wurde wurden").split(" "));

  let pop = null;

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const attr = s => esc(s).replace(/'/g, "&#39;");

  function linkHTML(text, opts) {
    opts = opts || {};
    const s = String(text == null ? "" : text);
    let out = "", last = 0, m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(s))) {
      out += esc(s.slice(last, m.index));
      const word = m[1];
      if (opts.skipCommon !== false && STOP.has(word.toLowerCase())) out += esc(word);
      else out += `<span class="wlink" data-w="${attr(word)}" title="点击查词">${esc(word)}</span>`;
      last = m.index + word.length;
    }
    out += esc(s.slice(last));
    return out;
  }

  function contextOf(sp, opts) {
    const box = sp.closest("[data-wctx]");
    if (box) return box.getAttribute("data-wctx") || "";
    const msg = sp.closest(".msg");
    if (msg) return msg.textContent.replace(/💡[\s\S]*$/, "").trim().slice(0, 120);
    return (opts && opts.ctx) || "";
  }

  function bind(root, opts) {
    if (!root || !root.addEventListener) return;
    if (root._ldWlHandler) root.removeEventListener("click", root._ldWlHandler);
    root._ldWlHandler = e => {
      const sp = e.target && e.target.closest ? e.target.closest(".wlink") : null;
      if (!sp || !root.contains(sp)) return;
      e.stopPropagation();
      handle(sp, opts || {});
    };
    root.addEventListener("click", root._ldWlHandler);
  }

  function handle(sp, opts) {
    const word = sp.getAttribute("data-w");
    if (!word) return;
    if (opts.mode === "quick") {
      const hit = LD.Lex ? LD.Lex.lookup(word) : null;
      const item = LD.Store.addWord({
        de: word, zh: hit ? hit.zh : "", ctx: contextOf(sp, opts),
        scene: opts.scene || opts.module || ""
      });
      if (item) toast(`已收藏「${item.de}」${hit && hit.zh ? " · " + hit.zh : ""}到生词本`, "ok");
      else toast("收藏失败", "err");
      return;
    }
    openCard(sp, word, opts);
  }

  function openCard(sp, word, opts) {
    closeCard();
    const rec = LD.Lex ? LD.Lex.lookup(word) : null;
    pop = document.createElement("div");
    pop.className = "ld-word-pop";
    pop.id = "ldWordPop";
    pop.dataset.word = word;
    pop.innerHTML = `
      <div class="ld-word-hd">
        <div style="min-width:0">
          <div class="ld-word-title de">${esc(word)}</div>
          <div class="ld-word-meta" id="ldWordMeta">${rec ? sourceTag(rec) : "查词中…"}</div>
        </div>
        <button class="btn btn-sm" id="ldWordClose" title="关闭">✕</button>
      </div>
      <div id="ldWordBody"></div>
      <div class="ld-word-acts" id="ldWordActs"></div>`;
    document.body.appendChild(pop);
    position(sp);
    renderCard(rec, word, sp, opts);

    const close = pop.querySelector("#ldWordClose");
    if (close) close.onclick = closeCard;
    if (!rec && LD.Lex && LD.Lex.lookupAsync) {
      LD.Lex.lookupAsync(word).then(r => {
        if (pop && pop.dataset.word === word) renderCard(r, word, sp, opts);
      });
    }

    setTimeout(() => {
      document.addEventListener("click", outside, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("scroll", closeCard, true);
      window.addEventListener("resize", closeCard);
    }, 0);
  }

  function sourceTag(rec) {
    if (rec.source === "ai") return '<span class="tag tag-warn">AI 释义 · 未人工审校</span>';
    return '<span class="tag tag-ok">词库</span>';
  }

  function renderCard(rec, word, sp, opts) {
    if (!pop) return;
    const meta = pop.querySelector("#ldWordMeta");
    const body = pop.querySelector("#ldWordBody");
    const acts = pop.querySelector("#ldWordActs");
    if (!rec) {
      if (meta) meta.textContent = "词库未收录";
      if (body) body.innerHTML = `<div class="hint" style="margin:0">${LD.LLM && LD.LLM.ready() ? "AI 释义暂不可用，可稍后再试。" : "配置直连大模型后可查 AI 释义；也可以先加入生词本。"}</div>`;
    } else {
      if (meta) meta.innerHTML = sourceTag(rec) + (rec.lvl ? ` <span class="tag">${esc(rec.lvl)}</span>` : "");
      const genCls = { der: "gen-m", die: "gen-f", das: "gen-n" }[String(rec.art || "").toLowerCase()] || "";
      const title = rec.art && rec.art !== "-" ? `<span class="${genCls}">${esc(rec.art)}</span> ${esc(rec.de)}` : esc(rec.de);
      if (body) body.innerHTML = `
        <div class="ld-word-zh">${esc(rec.zh || "暂无释义")}</div>
        ${rec.pos ? `<div class="ld-word-pos">${esc(rec.pos)}</div>` : ""}
        ${rec.ex ? `<div class="ld-word-ex de">${esc(rec.ex)}</div>${rec.exzh ? `<div class="ld-word-exzh">${esc(rec.exzh)}</div>` : ""}` : ""}
        <div class="hint" style="margin:0 0 2px">${title}</div>`;
    }
    if (acts) acts.innerHTML = `
      <button class="btn btn-primary btn-sm" id="ldWordAdd">加入生词本</button>
      <button class="btn btn-sm" id="ldWordSay">${LD.icon("volume")} 发音</button>`;
    const add = acts && acts.querySelector("#ldWordAdd");
    if (add) add.onclick = () => {
      const item = LD.Store.addWord({
        de: word, zh: rec ? rec.zh : "", ctx: contextOf(sp, opts),
        scene: (opts && (opts.module || opts.scene)) || ""
      });
      if (item) toast(`已收藏「${item.de}」到生词本`, "ok");
      else toast("收藏失败", "err");
      closeCard();
    };
    const say = acts && acts.querySelector("#ldWordSay");
    if (say) say.onclick = () => {
      if (LD.SpeechUtil && LD.SpeechUtil.say) LD.SpeechUtil.say(rec && rec.de ? rec.de : word);
      else toast("当前浏览器不支持发音", "err");
    };
  }

  function position(sp) {
    if (!pop) return;
    const r = sp.getBoundingClientRect();
    const w = 300, h = 230, gap = 8;
    if (window.innerWidth <= 680) {
      pop.style.left = "8px";
      pop.style.right = "8px";
      pop.style.bottom = "8px";
      pop.style.top = "auto";
      return;
    }
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - gap);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function outside(e) {
    if (!pop) return;
    if (pop.contains(e.target)) return;
    if (e.target && e.target.closest && e.target.closest(".wlink")) return;
    closeCard();
  }
  function onKey(e) { if (e.key === "Escape") closeCard(); }

  function closeCard() {
    if (pop) { pop.remove(); pop = null; }
    document.removeEventListener("click", outside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", closeCard, true);
    window.removeEventListener("resize", closeCard);
  }

  function toast(m, t) { if (LD.UI && LD.UI.toast) LD.UI.toast(m, t); }

  LD.WordLink = { linkHTML, bind, attr, close: closeCard };
})();
