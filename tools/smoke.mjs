/* LinguaDE · 装配冒烟测试（零依赖，Node 内置 vm + 最小 DOM 桩）
 * 在 Node 里按顺序执行 dist/index.html 的全部内联脚本，校验「装配层」是否正常：
 *   - 模块注册数量与注册表自检（missingMeta / orphanMeta / noRender）
 *   - 核心 API 是否齐备（LD.define / bus / UI / router / Store / Engine / LLM / Charts / EVENTS …）
 *   - 分组视图是否可生成
 * 它不做真实 DOM 渲染，但能捕获 ReferenceError、重复注册、漏注册等静态检查发现不了的错误。
 * 用法：node tools/smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8");

/* build.py 会把内联脚本中的 </script> 转义，这里还原 */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => m[1].replaceAll("<\\/script>", "</script>"));

function makeEl() {
  return {
    style: {}, dataset: {}, children: [], title: "", value: "", textContent: "", innerHTML: "",
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    appendChild() {}, remove() {}, insertAdjacentHTML() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, closest() { return null; },
    querySelector() { return makeEl(); }, querySelectorAll() { return []; }
  };
}

const mem = new Map();
const sandbox = {
  console, setTimeout, clearTimeout,
  setInterval: () => 0,   // 桩：main.js 的通知调度器等定时器只需存在，无需真实触发
  clearInterval: () => {},
  localStorage: {
    getItem(k) { return mem.has(k) ? mem.get(k) : null; },
    setItem(k, v) { mem.set(k, String(v)); },
    removeItem(k) { mem.delete(k); },
    clear() { mem.clear(); }
  },
  navigator: { language: "zh-CN", onLine: true, userAgent: "node-smoke" },
  location: { href: "file:///dist/index.html", origin: "null", reload() {} },
  document: {
    getElementById() { return makeEl(); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    createTextNode() { return {}; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    documentElement: makeEl(), body: makeEl(), head: makeEl()
  },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
  Blob: class { constructor() {} },
  URL: { createObjectURL() { return "blob:smoke"; } },
  confirm: () => false, alert: () => {},
  fetch: () => Promise.reject(new Error("offline")),
  scrollTo() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const problems = [];
scripts.forEach((s, i) => {
  try {
    vm.runInContext(s, sandbox, { filename: `inline-${i}.js` });
  } catch (e) {
    problems.push(`脚本 #${i} 执行失败：${e.message}`);
  }
});

const LD = sandbox.window.LD || {};
const mods = Object.keys(LD.Modules || {});
const chk = typeof LD.validateModules === "function"
  ? LD.validateModules()
  : { noRender: [], noGroup: [], noOrder: [] };

console.log("内联脚本数：", scripts.length);
console.log("已注册模块：", mods.length, "->", mods.join(", "));
console.log(
  "注册表自检：noRender=%d noGroup=%d noOrder=%d",
  (chk.noRender || []).length, (chk.noGroup || []).length, (chk.noOrder || []).length
);

const need = ["define", "bus", "UI", "router", "moduleList", "modulesByGroup", "primaryGroups", "validateModules", "Store", "Engine", "LLM", "Charts", "EVENTS", "Lex", "WordLink", "Timeline", "ContentPacks", "Path", "AIGen"];
const missing = need.filter(k => !LD[k]);
if (missing.length) problems.push("缺少核心 API：" + missing.join(", "));
if (mods.length !== 19) problems.push(`模块数应为 19，实际 ${mods.length}`);
if ((chk.noRender || []).length) problems.push("有模块缺 render：" + chk.noRender.join(", "));
if ((chk.noGroup || []).length) problems.push("有模块缺元数据 group：" + chk.noGroup.join(", "));
if ((chk.noOrder || []).length) problems.push("有模块缺元数据 order：" + chk.noOrder.join(", "));

let groups = [];
try {
  groups = LD.modulesByGroup().map(g => `${g.group}(${g.items.length})`);
} catch (e) {
  problems.push("modulesByGroup 调用失败：" + e.message);
}
console.log("分组视图：", groups.join(" / "));

if (problems.length) {
  console.error("\nSMOKE FAIL:");
  problems.forEach(p => console.error("  - " + p));
  process.exit(1);
}
console.log("\nSMOKE PASS：装配层一切正常");