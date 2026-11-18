# -*- coding: utf-8 -*-
"""B9 数据互通测试：TSV 导出形状 / LibreLingo YAML 导入 / apkg 往返。"""
import json
import subprocess

import pytest


def _node(expr_body):
    # store.js 在 IIFE 里 const LD=window.LD——harness 里预置 window.LD，store 会挂 Store 到 window.LD
    code = (
        "globalThis.window={LD:{},addEventListener:()=>{},removeEventListener:()=>{},dispatchEvent:()=>{},location:{protocol:'http:',host:'x'}};"
        "globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};"
        "globalThis.document={querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{},createElement:()=>({}),getElementById:()=>null};"
        "globalThis.navigator={onLine:true};"
        "eval(require('fs').readFileSync('src/store.js','utf-8'));"
        f"console.log(JSON.stringify((function(){{ {expr_body} }})()));"
    )
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, encoding="utf-8", cwd=".")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_export_lexicon_tsv_shape():
    """全词库 TSV：行数=词库+1 表头，front=词头+冠词，back 含词性，tags 含 CEFR。"""
    v = _node(
        "globalThis.window.LD_LEX=[['Haus','die','房子','n','A1','Das Haus.'],['gehen','-','去','v','A2','Ich gehe.']];"
        "var tsv=window.LD.Store.exportLexiconTSV();"
        "var lines=tsv.split('\\n');"
        "return {rows:lines.length, head:lines[0], f0:lines[1].split('\\t')[0], b0:lines[1].split('\\t')[1], tags0:lines[1].split('\\t')[2]};"
    )
    assert v["rows"] == 3          # 表头 + 2 词
    assert v["head"].startswith("front\tback\ttags")
    assert v["f0"] == "die Haus"
    assert "n" in v["b0"]
    assert "A1" in v["tags0"] and "lingopack" in v["tags0"]


def test_import_libreLingo_yaml():
    """LibreLingo YAML 子集 → 并入生词本；幂等去重；坏行计错。"""
    yaml_text = (
        "words:\n"
        "  - de: Haus\n"
        "    zh: 房子\n"
        "    cefr: A1\n"
        "  - de: Baum\n"
        "    zh: 树\n"
        "  - de: \n"
        "    zh: 缺词头\n"
    )
    v = _node(
        f"var r=window.LD.Store.importLibreLingoYaml({json.dumps(yaml_text)});"
        "var r2=window.LD.Store.importLibreLingoYaml('words:\\n  - de: Haus\\n    zh: 房子\\n');"
        "return {added:r.added, skipped:r.skipped, errors:r.errors.length, bank:window.LD.Store.s.wordbank.length, r2added:r2.added};"
    )
    assert v["added"] == 2
    assert v["skipped"] == 0
    assert v["errors"] >= 1          # 缺 de 行计错
    assert v["bank"] == 2
    assert v["r2added"] == 0         # 幂等：重复导入不再加


def test_apkg_roundtrip(tmp_path):
    """anki_apkg.py build→inspect 往返：notes 数一致。"""
    deck = tmp_path / "deck.json"
    out = tmp_path / "out.apkg"
    deck.write_text(json.dumps([
        {"front": "Haus", "back": "房子（n）", "tags": "A1 lingopack"},
        {"front": "der Baum", "back": "树（n）", "tags": "A1"},
    ], ensure_ascii=False), encoding="utf-8")
    r1 = subprocess.run(["python", "-I", "tools/anki_apkg.py", "--build", str(deck), str(out)],
                        capture_output=True, text=True, encoding="utf-8", cwd=".")
    assert r1.returncode == 0, r1.stderr
    r2 = subprocess.run(["python", "-I", "tools/anki_apkg.py", "--inspect", str(out)],
                        capture_output=True, text=True, encoding="utf-8", cwd=".")
    assert r2.returncode == 0, r2.stderr
    assert "notes: 2" in r2.stdout
    assert "Haus" in r2.stdout