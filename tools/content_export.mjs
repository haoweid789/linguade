#!/usr/bin/env node
/* LinguaDE · B1 内容导出：src/data/lexicon-*.js → content/lexicon/words.yaml + _manifest.json
 * 用 vm 执行取真数组（例句含逗号/引号，禁止正则切分）。
 * 用法：node tools/content_export.mjs [--check]
 *   --check 只比对 manifest 与现有 words.yaml 是否一致（不写文件），CI 用。 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, "src", "data");
const OUT = path.join(ROOT, "content", "lexicon");
const CHECK = process.argv.includes("--check");

const LEX_FILES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => `lexicon-${n}.js`);
const AUX_FILES = ["lexicon-human.js", "lexicon-review.js"];

function loadLexicon(file) {
  const code = fs.readFileSync(path.join(DATA, file), "utf-8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return sandbox.window.LD_LEX || [];
}

function loadSet(file, key) {
  const code = fs.readFileSync(path.join(DATA, file), "utf-8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return sandbox.window[key] || new Set();
}

/* 规范化词条（对拍与哈希的基准形状） */
function normRow(r) {
  const row = {
    de: r[0],
    genus: r[1] ?? "-",
    zh: r[2] ?? "",
    pos: r[3] ?? "",
    cefr: r[4] ?? "",
    ex_de: r[5] ?? "",
    ex_zh: r[6] ?? "",
  };
  if (r.length > 7 && r[7] !== "" && r[7] != null) row.formOf = r[7];
  if (r.length > 8 && r[8] !== "" && r[8] != null) row.formKind = r[8];
  const tags = [];
  for (let i = 9; i < r.length; i++) {
    if (r[i] !== "" && r[i] != null) tags.push(r[i]);
  }
  if (tags.length) row.tags = tags;
  return row;
}

function rowHash(row) {
  const canon = [row.de, row.genus, row.zh, row.pos, row.cefr, row.ex_de, row.ex_zh,
    row.formOf ?? "", row.formKind ?? "", (row.tags || []).join("|")].join("");
  return crypto.createHash("sha256").update(canon, "utf-8").digest("hex");
}

/* YAML 序列化（零依赖，块风格，字符串 JSON 转义） */
function yq(s) {
  return JSON.stringify(String(s));
}

function toYaml(words) {
  const lines = ["# LinguaDE 词库 · B1 导出（勿手改；改源 lexicon-*.js 后重跑 tools/content_export.mjs）", "words:"];
  let lastSrc = null;
  for (const w of words) {
    if (w.src !== lastSrc) {
      lines.push(`  # ---- ${w.src} ----`);
      lastSrc = w.src;
    }
    lines.push(`  - de: ${yq(w.de)}`);
    lines.push(`    genus: ${yq(w.genus)}`);
    lines.push(`    pos: ${yq(w.pos)}`);
    lines.push(`    zh: ${yq(w.zh)}`);
    lines.push(`    cefr: ${yq(w.cefr)}`);
    lines.push(`    ex_de: ${yq(w.ex_de)}`);
    lines.push(`    ex_zh: ${yq(w.ex_zh)}`);
    if (w.formOf) lines.push(`    formOf: ${yq(w.formOf)}`);
    if (w.formKind) lines.push(`    formKind: ${yq(w.formKind)}`);
    if (w.tags && w.tags.length) lines.push(`    tags: [${w.tags.map(yq).join(", ")}]`);
    lines.push(`    src: ${yq(w.src)}`);
  }
  return lines.join("\n") + "\n";
}

function main() {
  const all = [];
  const manifest = {};
  for (const f of LEX_FILES) {
    const rows = loadLexicon(f);
    const norm = rows.map(normRow);
    const h = crypto.createHash("sha256");
    for (const r of norm) h.update(rowHash(r) + "\n");
    manifest[f] = { count: rows.length, hash: h.digest("hex") };
    norm.forEach((r, i) => all.push({ ...r, src: f.replace(".js", "") }));
  }
  const human = loadSet(AUX_FILES[0], "LD_LEX_REVIEWED");
  const reviewed = loadSet(AUX_FILES[1], "LD_LEX_REVIEWED");
  manifest["lexicon-human.js"] = { count: human.size, words: [...human] };
  manifest["lexicon-review.js"] = { count: reviewed.size };

  const yaml = toYaml(all);
  const manJson = JSON.stringify(manifest, null, 2) + "\n";

  if (CHECK) {
    const curYaml = path.join(OUT, "words.yaml");
    const curMan = path.join(OUT, "_manifest.json");
    if (!fs.existsSync(curYaml) || !fs.existsSync(curMan)) {
      console.error("CHECK FAIL: content/lexicon 未导出过"); process.exit(1);
    }
    const same = fs.readFileSync(curYaml, "utf-8") === yaml &&
      fs.readFileSync(curMan, "utf-8") === manJson;
    console.log(same ? "CHECK OK: words.yaml 与源数据一致" : "CHECK FAIL: 源数据已变更，需重跑导出");
    process.exit(same ? 0 : 1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "words.yaml"), yaml);
  fs.writeFileSync(path.join(OUT, "_manifest.json"), manJson);
  console.log(`导出完成：${all.length} 词 → content/lexicon/words.yaml`);
  for (const [f, m] of Object.entries(manifest)) {
    console.log(`  ${f}: ${m.count !== undefined ? m.count + " 条" : ""} ${m.hash ? m.hash.slice(0, 12) : ""}`);
  }
}

main();