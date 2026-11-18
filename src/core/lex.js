/* LinguaDE · 轻量查词层
   顺序：词库精确命中 → 规则词形还原（只接受词库命中）→ 直连大模型释义（可选，带缓存）。
   未命中时不伪造词典释义；UI 会明确标注「AI 释义，待校对」。 */
(function () {
  const LD = (window.LD = window.LD || {});
  const CACHE_KEY = "linguade.lexCache.v1";
  let index = null;

  const clean = w => String(w == null ? "" : w)
    .replace(/^[^A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß-]+$/g, "");
  const fold = s => String(s || "").toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");

  function buildIndex() {
    index = { exact: Object.create(null), folded: Object.create(null) };
    (window.LD_LEX || []).forEach(row => {
      if (!row || !row[0]) return;
      const rec = {
        de: String(row[0]), art: row[1] || "", zh: row[2] || "",
        pos: row[3] || "", lvl: row[4] || "", ex: row[5] || "", exzh: row[6] || "",
        source: "lex"
      };
      const k = rec.de.toLowerCase();
      if (!index.exact[k]) index.exact[k] = rec;
      const f = fold(rec.de);
      if (!index.folded[f]) index.folded[f] = rec;
    });
  }

  /* 生成词形候选：名词复数/格、动词变位、ge- 分词；最终只接受词库命中 */
  function candidates(word) {
    const base = clean(word);
    if (!base) return [];
    const out = [base];
    const lower = base.toLowerCase();
    if (lower !== base) out.push(lower);

    const push = v => { if (v && v.length >= 3 && out.indexOf(v) < 0) out.push(v); };
    ["innen", "ern", "em", "en", "er", "es", "e", "n", "s", "st", "te", "ten", "test", "tet", "t"]
      .forEach(suf => {
        if (base.length > suf.length + 2 && lower.endsWith(suf)) push(base.slice(0, -suf.length));
      });

    /* 规则动词：studiert → studieren；geht → gehen */
    if (/t$/i.test(base)) {
      push(base.slice(0, -1) + "en");
      push(base.slice(0, -1) + "n");
    }
    if (/st$/i.test(base)) push(base.slice(0, -2) + "en");
    /* ge- 分词：gemacht → mach / machen */
    if (/^ge.+(t|en)$/i.test(base) && base.length > 5) {
      const stem = base.slice(2).replace(/(t|en)$/i, "");
      push(stem);
      push(stem + "en");
    }
    return out;
  }

  function lookup(word) {
    if (!index) buildIndex();
    const tries = candidates(word);
    for (const c of tries) {
      const hit = index.exact[String(c).toLowerCase()];
      if (hit) return hit;
    }
    for (const c of tries) {
      const hit = index.folded[fold(c)];
      if (hit) return hit;
    }
    return null;
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function getCache(word) {
    return readCache()[clean(word).toLowerCase()] || null;
  }
  function putCache(word, rec) {
    const all = readCache();
    all[clean(word).toLowerCase()] = Object.assign({}, rec, { t: Date.now() });
    const keys = Object.keys(all);
    if (keys.length > 300) {
      keys.sort((a, b) => (all[a].t || 0) - (all[b].t || 0));
      keys.slice(0, keys.length - 300).forEach(k => delete all[k]);
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch (e) { /* 配额满时静默 */ }
  }

  /* AI 释义仅在「直连大模型」已配置时启用；后端通道当前没有词典端点。
     失败/离线返回 null，UI 只展示“词库未收录”，不伪造释义。 */
  function lookupAsync(word) {
    const hit = lookup(word);
    if (hit) return Promise.resolve(hit);
    const cached = getCache(word);
    if (cached) return Promise.resolve(cached);
    if (!LD.LLM || !LD.LLM.ready || !LD.LLM.ready()) return Promise.resolve(null);

    const sys = `你是面向中国德语学习者的德汉词典。查询一个德语词，只输出严格 JSON：
{"de":"原形","art":"der/die/das 或 -","zh":"中文释义（不超过 20 字）","pos":"词性（n/v/adj/adv/…）","lvl":"A1/A2/B1/B2/C1/C2 估计","ex":"一句简短德语例句","exzh":"例句中文"}
不要输出 JSON 以外的文字；不确定的字段留空字符串，不要编造。`;
    return LD.LLM.chat([
      { role: "system", content: sys },
      { role: "user", content: clean(word) }
    ], { temperature: 0.2, timeout: 20000 })
      .then(txt => {
        const j = LD.LLM.safeJSON(txt);
        if (!j || !j.zh || typeof j.zh !== "string") return null;
        const rec = {
          de: j.de || clean(word), art: j.art || "", zh: j.zh,
          pos: j.pos || "", lvl: j.lvl || "", ex: j.ex || "", exzh: j.exzh || "",
          source: "ai"
        };
        putCache(word, rec);
        return rec;
      })
      .catch(() => null);
  }

  LD.Lex = { lookup, lookupAsync, clean, fold, rebuild: buildIndex };
})();
