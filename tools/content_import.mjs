#!/usr/bin/env node
/* LinguaDE · B1 内容导入：content/lexicon/words.yaml → content/_roundtrip/lexicon-<n>.js
 * 验收用：roundtrip 产物与源数组深比较（本工具不覆盖 src/data 源文件）。
 * 用法：node tools/content_import.mjs  */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, "src", "data");
const OUT = path.join(ROOT, "content", "lexicon");
const RT = path.join(ROOT, "content", "_roundtrip");

/* 极简 YAML 块解析：只认本工具导出的形状（words: 列表，标量行 key: value） */
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
      cur[m[1]] = JSON.parse(m[2]);
      continue;
    }
    const k = line.match(/^    (\w+): (.*)$/);
    if (k && cur) {
      const v = k[2];
      if (v.startsWith("[")) {
        cur[k[1]] = v.slice(1, -1).split(",").filter(Boolean).map((x) => JSON.parse(x));
      } else if (v === "null" || v === "") {
        cur[k[1]] = null;
      } else {
        cur[k[1]] = JSON.parse(v);
      }
    }
  }
  return words;
}

function normRow(r) {
  const row = [r.de, r.genus, r.zh, r.pos, r.cefr, r.ex_de, r.ex_zh];
  if (r.formOf) row.push(r.formOf); else row.push("");
  if (r.formKind) row.push(r.formKind); else row.push("");
  for (const t of r.tags || []) row.push(t);
  return row;
}

function rowHash(row) {
  const canon = [row[0], row[1] ?? "-", row[2] ?? "", row[3] ?? "", row[4] ?? "",
    row[5] ?? "", row[6] ?? "", row[7] ?? "", row[8] ?? "",
    row.slice(9).filter((x) => x !== "").join("|")].join("");
  return crypto.createHash("sha256").update(canon, "utf-8").digest("hex");
}

function loadSrc(file) {
  const code = fs.readFileSync(path.join(DATA, file), "utf-8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return sandbox.window.LD_LEX || [];
}

function main() {
  const yaml = fs.readFileSync(path.join(OUT, "words.yaml"), "utf-8");
  const words = parseYaml(yaml);
  const bySrc = {};
  for (const w of words) {
    const f = w.src + ".js";
    (bySrc[f] = bySrc[f] || []).push(w);
  }
  fs.mkdirSync(RT, { recursive: true });
  let allEq = true;
  for (const [f, ws] of Object.entries(bySrc)) {
    const srcRows = loadSrc(f);
    if (srcRows.length !== ws.length) {
      console.error(`MISMATCH ${f}: 条数 ${srcRows.length} vs ${ws.length}`);
      allEq = false;
      continue;
    }
    let fileEq = true;
    for (let i = 0; i < srcRows.length; i++) {
      const a = rowHash(srcRows[i]);
      const b = rowHash(normRow(ws[i]));
      if (a !== b) {
        console.error(`MISMATCH ${f}[${i}]: ${JSON.stringify(srcRows[i]).slice(0, 90)} vs ${JSON.stringify(ws[i]).slice(0, 90)}`);
        fileEq = false;
        allEq = false;
        break;
      }
    }
    /* 生成 roundtrip JS（数据等价；头部注释为生成说明） */
    const out = [
      `/* LinguaDE roundtrip（B1 验证产物，勿手工编辑）· 源 ${f}`,
      `window.LD_LEX = (window.LD_LEX || []).concat([`,
      ...ws.map((w) => `  ${JSON.stringify(normRow(w))},`),
      `]);`,
    ].join("\n");
    fs.writeFileSync(path.join(RT, f), out);
    console.log(`${fileEq ? "OK" : "FAIL"} ${f}: ${ws.length} 条`);
  }
  console.log(allEq ? "ROUNDTRIP EQUIVALENT" : "ROUNDTRIP FAILED");
  process.exit(allEq ? 0 : 1);
}

main();