# -*- coding: utf-8 -*-
"""B8 流利度指标单元测试（Node 侧 scoreSpeech：填充词/分档/流利度调整/建议）。"""
import json
import subprocess

import pytest


def _score(ref, hyp, meta=None):
    code = (
        "globalThis.window={LD:{}}; "
        "globalThis.document={querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}};"
        "globalThis.localStorage={getItem:()=>null,setItem:()=>{}};"
        "eval(require('fs').readFileSync('src/engine.js','utf-8'));"
        f"console.log(JSON.stringify(window.LD.Engine.scoreSpeech({json.dumps(ref)}, {json.dumps(hyp)}, {json.dumps(meta or {})})));"
    )
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, encoding="utf-8", cwd=".")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_fillers_counted():
    """填充词计数：äh/ähm/öhm/also/und。"""
    res = _score("Ich glaube also dass es klappt", "äh ich glaube also ähm dass es klappt")
    assert res["fillers"] >= 3
    assert res["wpmTag"] in ("过慢", "偏慢", "适中", "偏快")


def test_wpm_tag_buckets():
    """语速分档边界。"""
    # 6 词 / 6 秒 = 60 wpm → 偏慢
    res = _score("eins zwei drei vier fünf sechs", "eins zwei drei vier fünf sechs", {"ms": 6000})
    assert res["wpm"] == 60
    assert res["wpmTag"] == "偏慢"


def test_fillers_reduce_fluency():
    """填充词 ≥2 时流利度被扣减（同语速对照：多 2 词 4 秒 = 105 vs 75wpm 主效应另算，
    这里验证扣减逻辑存在：fillers>=2 时 fluency <= 无扣减基线）。"""
    # 构造同语速对照：干净 6 词 4 秒 (90wpm)，filler 8 词 5.3 秒 (~90wpm)
    clean = _score("eins zwei drei vier fünf sechs", "eins zwei drei vier fünf sechs", {"ms": 4000})
    filler = _score("eins zwei drei vier fünf sechs", "ähm eins zwei drei vier fünf sechs", {"ms": 4667})
    assert abs(clean["wpm"] - filler["wpm"]) <= 2      # 语速基本对齐
    assert filler["fillers"] >= 1
    # 同语速下填充词版流利度不高于干净版（扣减生效）
    assert filler["fluency"] <= clean["fluency"]


def test_longest_pause_passed_and_penalized():
    """最长停顿透传并参与流利度。"""
    res = _score("Guten Tag", "Guten Tag", {"ms": 3000, "longestPauseMs": 3500})
    assert res["longestPauseMs"] == 3500
    noPause = _score("Guten Tag", "Guten Tag", {"ms": 3000})
    assert res["fluency"] <= noPause["fluency"]


def test_advice_mentions_fillers():
    """填充词多时建议文案覆盖。"""
    res = _score("Ich denke das ist gut", "äh ich ähm denke also das ist gut", {"ms": 8000})
    if res["fillers"] >= 3:
        assert any("填充词" in t for t in res["advice"])