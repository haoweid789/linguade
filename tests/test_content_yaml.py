# -*- coding: utf-8 -*-
"""B1 内容 YAML 管线测试：导出稳定性 / roundtrip 等价 / lint 行为。

三个工具均为 Node 子进程；本测试不修改 src/data，只在 content/ 下读写。
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"


def run(args: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", **kw
    )


def test_export_manifest_stable():
    """导出两次 manifest 一致（源数据未变时哈希稳定）。"""
    r1 = run([str(TOOLS / "content_export.mjs"), "--check"])
    assert r1.returncode == 0, f"check 失败: {r1.stdout} {r1.stderr}"
    # 重导一次再 check 仍一致
    r2 = run([str(TOOLS / "content_export.mjs")])
    assert r2.returncode == 0, r2.stderr
    r3 = run([str(TOOLS / "content_export.mjs"), "--check"])
    assert r3.returncode == 0


def test_roundtrip_equivalent():
    """导出→导入→与源数组规范化哈希对拍：EQUIVALENT。"""
    run([str(TOOLS / "content_export.mjs")])
    r = run([str(TOOLS / "content_import.mjs")])
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ROUNDTRIP EQUIVALENT" in r.stdout


def test_lint_current_data_clean():
    """对现有导出跑 lint：0 error（warning 允许，当前为 0）。"""
    r = run([str(TOOLS / "content_lint.mjs")])
    assert r.returncode == 0, r.stdout
    assert "errors=0" in r.stdout


def test_lint_rejects_bad_yaml(tmp_path):
    """坏数据被拦截：缺 genus / 非法 cefr → 退出码 1。"""
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        "words:\n"
        "  - de: Haus\n"
        "    genus: irgendein\n"
        "    pos: n\n"
        "    zh: 房子\n"
        "    cefr: Z9\n"
        "    ex_de: Das Haus.\n"
        "    ex_zh: 房子。\n"
        "    src: test\n",
        encoding="utf-8",
    )
    r = run([str(TOOLS / "content_lint.mjs"), "--yaml", str(bad), "--json"])
    assert r.returncode == 1
    data = json.loads(r.stdout)
    assert data["ok"] is False
    assert any("genus" in e for e in data["errors"])
    assert any("cefr" in e for e in data["errors"])