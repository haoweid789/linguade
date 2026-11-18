/* LinguaDE · 图片导入小工具（LD.OCRUI）
   供各模块内嵌「从图片导入」入口复用：选图 → 压缩 → 调 LD.LLM.ocrGrade（三层降级）→ 返回结构化结果。
   用法：LD.OCRUI.pick({ mode: "grammar" }).then(r => { if (r) input.value = r.transcript; });
   隐私：图片只在用户点击后读取并上传，前端仅在内存持有。 */
(function () {
  const LD = (window.LD = window.LD || {});

  /* 压缩到最长边 1600px、JPEG 0.85，控制上传体积与 token 成本 */
  function compress(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        let w = img.width, h = img.height;
        const scale = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        try { resolve(cv.toDataURL("image/jpeg", 0.85)); }
        catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  /* 选图并识别；resolve 为 ocrGrade 的结果对象（失败/取消为 null） */
  function pick(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.setAttribute("capture", "environment");
      input.style.display = "none";
      document.body.appendChild(input);

      const done = v => { try { input.remove(); } catch (e) { } resolve(v); };

      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return done(null);
        if (!/^image\//.test(file.type)) {
          if (LD.UI) LD.UI.toast("请选择图片文件", "err");
          return done(null);
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (LD.UI) LD.UI.toast("正在识别图片……", "info");
          compress(reader.result)
            .then(url => LD.LLM.ocrGrade(url, opts.mode || "grammar", {
              level: LD.Store.s.profile.level,
              hint: opts.hint || ""
            }))
            .then(r => {
              if (!r || r.ok === false) {
                if (LD.UI) LD.UI.toast((r && r.message) || "识别失败", "err");
                return done(null);
              }
              done(r);
            })
            .catch(e => {
              if (LD.UI) LD.UI.toast("识别失败：" + e.message, "err");
              done(null);
            });
        };
        reader.readAsDataURL(file);
      };

      input.click();
    });
  }

  LD.OCRUI = { pick, compress };
})();