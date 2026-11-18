# -*- coding: utf-8 -*-
"""B3 题型注册表测试：注册表加载 / 20 项 / 唯一性 / srsKind 合法 / 包装交叉引用。"""
import json
import subprocess

import pytest


def _node_eval(body: str) -> str:
    code = (
        "globalThis.window={};"
        "eval(require('fs').readFileSync('src/core/srs.js','utf-8'));"
        "eval(require('fs').readFileSync('src/core/exercise.js','utf-8'));"
        f"console.log(JSON.stringify((function(){{ {body} }})()));"
    )
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, encoding="utf-8", cwd=".")
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def test_registry_loads_20():
    """注册表 20 项、id 唯一。"""
    v = json.loads(_node_eval(
        "var t=window.LD.Exercise.types();"
        "return {n:t.length, uniq:new Set(t.map(function(e){return e.id;})).size};"
    ))
    assert v["n"] == 20
    assert v["uniq"] == 20


def test_srs_kind_legal():
    """所有 srsKind ∈ FSRS 7 粒度。"""
    v = json.loads(_node_eval(
        "var kinds=new Set(window.LD.Srs.KINDS);"
        "var bad=window.LD.Exercise.types().filter(function(e){return !kinds.has(e.srsKind);});"
        "return {bad:bad.map(function(e){return e.id+':'+e.srsKind;})};"
    ))
    assert v["bad"] == []


def test_needs_and_by_ability():
    """needs 非空；byAbility 分组正确。"""
    v = json.loads(_node_eval(
        "var noNeeds=window.LD.Exercise.types().filter(function(e){return !e.needs||!e.needs.length;});"
        "return {noNeeds:noNeeds.length,"
        "grammar:window.LD.Exercise.byAbility('grammar').length,"
        "listening:window.LD.Exercise.byAbility('listening').length};"
    ))
    assert v["noNeeds"] == 0
    assert v["grammar"] == 4        # select_genus / conjugate / select_case / article_table
    assert v["listening"] == 4      # listen_choice / listen_gap / listen_full / listen_dialog


def test_wrapper_cross_refs():
    """包装项 id 与 drill/listening 源码注释交叉引用存在。"""
    drill = open("src/modules/drill.js", encoding="utf-8").read()
    listening = open("src/modules/listening.js", encoding="utf-8").read()
    assert "select_genus" in drill and "conjugate" in drill and "select_case" in drill
    assert "listen_choice" in listening and "speak_shadow" in listening


def test_browser_mount(page):
    """浏览器运行时：LD.Exercise 挂载，types()=20，get('select_genus').srsKind='item'。"""
    r = page.evaluate(
        """() => ({
          n: window.LD.Exercise.types().length,
          genus: window.LD.Exercise.get('select_genus').srsKind,
          ids: window.LD.Exercise.ids().length,
        })"""
    )
    assert r["n"] == 20
    assert r["genus"] == "item"
    assert r["ids"] == 20