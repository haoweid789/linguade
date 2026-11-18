/* LinguaDE · 内容包发现
   dist 构建时由 tools/build.py 注入 window.LD_CONTENT_PACKS（清单）与
   window.LD_CONTENT_PACKS_INLINE（正文）。单文件版 file:// 也能一键导入，零外部请求。
   导入仍走 Store.importData("json")，与手动导入同一条路径。 */
(function () {
  const LD = (window.LD = window.LD || {});
  const S = () => LD.Store.s;

  function all() {
    return Array.isArray(window.LD_CONTENT_PACKS) ? window.LD_CONTENT_PACKS.filter(p => p && p.file) : [];
  }
  function imported(file) {
    return !!((S().contentPacksImported || {})[file]);
  }
  function available() {
    const inline = window.LD_CONTENT_PACKS_INLINE || {};
    const offline = !/^https?:$/.test(location.protocol);
    return all().filter(p => {
      if (imported(p.file)) return false;
      /* file:// 单文件版只列真正能零请求导入的包：未内联的（如德中双语句对）不在离线形态出现 */
      if (offline && !inline[p.file]) return false;
      return true;
    });
  }
  function mark(file) {
    const s = S();
    s.contentPacksImported = s.contentPacksImported || {};
    s.contentPacksImported[file] = true;
    LD.Store.save();
  }
  function load(meta) {
    const inline = window.LD_CONTENT_PACKS_INLINE || {};
    if (inline[meta.file]) {
      const r = LD.Store.importData(JSON.stringify(inline[meta.file]), "json");
      if (!r.ok) return Promise.reject(new Error(r.error || "导入失败"));
      mark(meta.file);
      return Promise.resolve(r);
    }
    return fetch(meta.file, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(txt => {
        const r = LD.Store.importData(txt, "json");
        if (!r.ok) throw new Error(r.error || "导入失败");
        mark(meta.file);
        return r;
      });
  }
  function importAll(onStep) {
    const items = available();
    let done = 0, imported = 0;
    return items.reduce((p, meta) => p.then(() =>
      load(meta).then(r => {
        done++;
        imported += r.imported || 0;
        if (onStep) onStep(done, items.length, meta, r);
      })
    ), Promise.resolve()).then(() => ({ packs: done, imported }));
  }

  LD.ContentPacks = { all, available, load, importAll };
})();
