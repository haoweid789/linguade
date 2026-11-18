#!/usr/bin/env node
/* LinguaDE · B1 内容 lint：校验 content/lexicon/words.yaml
 * 用法：node tools/content_lint.mjs [--yaml <path>] [--json]
 * 退出码：0 = 无 error；1 = 有 error。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const yamlPath = args.includes("--yaml")
  ? args[args.indexOf("--yaml") + 1]
  : path.join(ROOT, "content", "lexicon", "words.yaml");
const jsonOut = args.includes("--json");

const POS_ENUM = new Set(["n", "v", "adj", "adv", "prep", "art", "num", "pron", "conj", "phrase", "part", "interj"]);
const CEFR_ENUM = new Set(["A1", "A2", "B1", "B2", "C1", "C2", ""]);
const GENUS_ENUM = new Set(["der", "die", "das", "-"]);

function parseScalar(v) {
  if (v === "null" || v === "") return null;
  if (v.startsWith("[")) return v.slice(1, -1).split(",").filter(Boolean).map((x) => parseScalar(x));
  try {
    return JSON.parse(v);
  } catch {
    return v; /* 非 JSON 标量按原始字符串（如非法枚举值），交给 lint 报错 */
  }
}

function parseYaml(text) {
  const words = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("#") || line === "words:") continue;
    const m = line.match(/^  - (\w+): (.*)$/);
    if (m) {
      cur = {};
      words.push(cur);
      cur[m[1]] = parseScalar(m[2]);
      continue;
    }
    const k = line.match(/^    (\w+): (.*)$/);
    if (k && cur) cur[k[1]] = parseScalar(k[2]);
  }
  return words;
}

function lint(words) {
  const errors = [];
  const warnings = [];
  const stats = { total: words.length, withExample: 0, withGenus: 0, humanReviewed: 0, byCefr: {}, byPos: {} };
  const seen = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const at = `words[${i}](${w.de || "?"})`;
    for (const f of ["de", "genus", "zh", "pos", "cefr"]) {
      if (w[f] == null || w[f] === "") errors.push(`${at}: 缺字段 ${f}`);
    }
    if (w.genus && !GENUS_ENUM.has(w.genus)) errors.push(`${at}: 非法 genus "${w.genus}"`);
    if (w.pos && !POS_ENUM.has(w.pos)) errors.push(`${at}: 未知 pos "${w.pos}"`);
    if (w.cefr && !CEFR_ENUM.has(w.cefr)) errors.push(`${at}: 非法 cefr "${w.cefr}"`);
    if (w.ex_de && w.ex_zh) stats.withExample++;
    else warnings.push(`${at}: 缺例句对`);
    if (w.genus !== "-" && w.genus) stats.withGenus++;
    if (w.formOf && w.formKind !== "participle" && w.formKind !== "plural") {
      warnings.push(`${at}: formOf 存在但 formKind="${w.formKind}" 非 participle/plural`);
    }
    const key = `${w.de}|${w.src || ""}`;
    if (seen.has(key)) warnings.push(`${at}: 与 words[${seen.get(key)}] 重复（同 src）`);
    else seen.set(key, i);
    stats.byCefr[w.cefr || "?"] = (stats.byCefr[w.cefr || "?"] || 0) + 1;
    stats.byPos[w.pos || "?"] = (stats.byPos[w.pos || "?"] || 0) + 1;
  }
  return { errors, warnings, stats };
}

const text = fs.readFileSync(yamlPath, "utf-8");
const words = parseYaml(text);
const { errors, warnings, stats } = lint(words);
if (jsonOut) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings, stats }, null, 2));
} else {
  console.log(`lint: ${words.length} 词 | errors=${errors.length} warnings=${warnings.length}`);
  for (const e of errors.slice(0, 30)) console.log("  ERROR", e);
  for (const w of warnings.slice(0, 10)) console.log("  warn ", w);
  if (warnings.length > 10) console.log(`  ... 其余 ${warnings.length - 10} 条 warning`);
  console.log(`分布: CEFR=${JSON.stringify(stats.byCefr)} pos=${JSON.stringify(stats.byPos)}`);
  console.log(`带例句 ${stats.withExample} | 带 Genus ${stats.withGenus}`);
}
process.exit(errors.length ? 1 : 0);