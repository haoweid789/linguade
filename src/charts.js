/* LinguaDE · 轻量 SVG 图表（无外部依赖，离线可用） */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const el = (n, attrs, children) => {
    const e = document.createElementNS(NS, n);
    Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
    (children || []).forEach(c => e.appendChild(c));
    return e;
  };
  const txt = (x, y, s, o) => {
    const t = el("text", Object.assign({ x, y, fill: "currentColor", "font-size": 12 }, o || {}));
    t.textContent = s; return t;
  };

  /* 折线趋势图 */
  function line(elHost, data, opt) {
    opt = opt || {};
    const W = opt.w || 520, H = opt.h || 180, pad = { l: 34, r: 12, t: 14, b: 24 };
    /* v 为 null 表示当天无数据：不画点、断开折线，而不是当成 0 画出一个假暴跌 */
    const vals = data.map(d => d.v).filter(v => v != null && Number.isFinite(+v));
    const max = Math.max(100, ...vals), min = 0;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const x = i => pad.l + (data.length === 1 ? iw / 2 : i * iw / (data.length - 1));
    const y = v => pad.t + ih - (v - min) / (max - min) * ih;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H });
    // 网格
    for (let g = 0; g <= 4; g++) {
      const v = min + (max - min) * g / 4, yy = y(v);
      svg.appendChild(el("line", { x1: pad.l, y1: yy, x2: W - pad.r, y2: yy, stroke: "var(--line)", "stroke-width": 1 }));
      svg.appendChild(txt(pad.l - 6, yy + 3, Math.round(v), { "text-anchor": "end", opacity: .55 }));
    }
    if (vals.length) {
      const has = d => d.v != null && Number.isFinite(+d.v);
      const runs = [];
      let cur = [];
      data.forEach((d, i) => {
        if (has(d)) cur.push(i);
        else if (cur.length) { runs.push(cur); cur = []; }
      });
      if (cur.length) runs.push(cur);
      runs.forEach(run => {
        const pts = run.map(i => `${x(i)},${y(data[i].v)}`).join(" ");
        if (run.length > 1) {
          svg.appendChild(el("polyline", { points: pts, fill: "none", stroke: "var(--brand)", "stroke-width": 2, "stroke-linejoin": "round" }));
          const area = `${x(run[0])},${pad.t + ih} ${pts} ${x(run[run.length - 1])},${pad.t + ih}`;
          svg.appendChild(el("polygon", { points: area, fill: "var(--brand)", opacity: .1, stroke: "none" }));
        }
      });
      data.forEach((d, i) => { if (has(d)) svg.appendChild(el("circle", { cx: x(i), cy: y(d.v), r: 3, fill: "var(--brand)" })); });
    } else {
      svg.appendChild(txt(W / 2, H / 2, "暂无数据", { "text-anchor": "middle", opacity: .5 }));
    }
    // x 轴标签（首/中/尾）
    [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i && data.length).forEach(i => {
      if (data[i]) svg.appendChild(txt(x(i), H - 6, data[i].k, { "text-anchor": "middle", opacity: .55 }));
    });
    elHost.innerHTML = ""; elHost.appendChild(svg);
  }

  /* 雷达图 */
  function radar(elHost, data, opt) {
    opt = opt || {};
    const W = opt.w || 260, H = opt.h || 220, cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) / 2 - 30;
    const n = data.length;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H });
    if (!n) { elHost.innerHTML = "<div class='empty'>暂无数据</div>"; return; }
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];

    [0.25, 0.5, 0.75, 1].forEach(k => {
      const p = data.map((_, i) => pt(i, R * k).join(",")).join(" ");
      svg.appendChild(el("polygon", { points: p, fill: "none", stroke: "var(--line)", "stroke-width": 1 }));
    });
    data.forEach((d, i) => {
      const [ax, ay] = pt(i, R);
      svg.appendChild(el("line", { x1: cx, y1: cy, x2: ax, y2: ay, stroke: "var(--line)", "stroke-width": 1 }));
      const [lx, ly] = pt(i, R + 15);
      svg.appendChild(txt(lx, ly + 3, d.key, { "text-anchor": "middle", "font-size": 12, opacity: .7 }));
    });
    const poly = data.map((d, i) => pt(i, R * Math.max(.04, d.value / 100)).join(",")).join(" ");
    svg.appendChild(el("polygon", { points: poly, fill: "var(--brand)", opacity: .22, stroke: "var(--brand)", "stroke-width": 2 }));
    data.forEach((d, i) => {
      const [px, py] = pt(i, R * Math.max(.04, d.value / 100));
      svg.appendChild(el("circle", { cx: px, cy: py, r: 3, fill: "var(--brand)" }));
    });
    elHost.innerHTML = ""; elHost.appendChild(svg);
  }

  /* 柱状图 */
  function bars(elHost, data, opt) {
    opt = opt || {};
    const W = opt.w || 520, H = opt.h || 180, pad = { l: 30, r: 10, t: 12, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...data.map(d => d.v));
    const bw = Math.max(8, Math.min(38, iw / Math.max(1, data.length) - 8));
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H });
    data.forEach((d, i) => {
      const cx = pad.l + (i + .5) * iw / data.length;
      const h = ih * d.v / max;
      svg.appendChild(el("rect", { x: cx - bw / 2, y: pad.t + ih - h, width: bw, height: h, rx: 4, fill: d.color || "var(--brand)", opacity: .85 }));
      svg.appendChild(txt(cx, pad.t + ih - h - 4, d.v, { "text-anchor": "middle", "font-size": 12, opacity: .6 }));
      svg.appendChild(txt(cx, H - 8, d.k, { "text-anchor": "middle", "font-size": 12, opacity: .6 }));
    });
    if (!data.length) svg.appendChild(txt(W / 2, H / 2, "暂无数据", { "text-anchor": "middle", opacity: .5 }));
    elHost.innerHTML = ""; elHost.appendChild(svg);
  }

  /* 环形进度 */
  function ring(elHost, pct, opt) {
    opt = opt || {};
    const size = opt.size || 76, sw = opt.sw || 7, R = (size - sw) / 2, C = 2 * Math.PI * R;
    const svg = el("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
    svg.appendChild(el("circle", { cx: size / 2, cy: size / 2, r: R, fill: "none", stroke: "var(--line-soft)", "stroke-width": sw }));
    const arc = el("circle", {
      cx: size / 2, cy: size / 2, r: R, fill: "none", stroke: opt.color || "var(--brand)",
      "stroke-width": sw, "stroke-linecap": "round", "stroke-dasharray": C,
      "stroke-dashoffset": C * (1 - Math.max(0, Math.min(1, pct / 100))), transform: `rotate(-90 ${size / 2} ${size / 2})`
    });
    svg.appendChild(arc);
    elHost.innerHTML = `<div class="ring">${svg.outerHTML}<span class="num">${pct}</span></div>`;
  }

  window.LD.Charts = { line, radar, bars, ring };
})();
