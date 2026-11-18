"""人工审校工作台：认可/退回落台账，只有 --write 才生成人工覆盖文件。"""
import json
import subprocess
import sys

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "lexicon_workbench.py"


def _run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8"
    )


def test_workbench_approve_and_reject(tmp_path):
    ledger = tmp_path / "ledger.json"
    out = tmp_path / "lexicon-human.js"

    r = _run("--approve", "ab", "--note", "人工核对释义", "--write",
             "--ledger", str(ledger), "--out", str(out))
    assert r.returncode == 0, r.stderr
    assert "ab" in out.read_text(encoding="utf-8")
    data = json.loads(ledger.read_text(encoding="utf-8"))
    assert data["decisions"]["ab"]["status"] == "approved"

    r = _run("--reject", "ab", "--note", "例句与释义不匹配",
             "--ledger", str(ledger), "--out", str(out))
    assert r.returncode == 0, r.stderr
    data = json.loads(ledger.read_text(encoding="utf-8"))
    assert data["decisions"]["ab"]["status"] == "rejected"

    # 退回后重新 write：人工覆盖文件不再包含该词
    r = _run("--write", "--ledger", str(ledger), "--out", str(out))
    assert r.returncode == 0, r.stderr
    assert '"ab"' not in out.read_text(encoding="utf-8")


def test_workbench_list_and_stats_do_not_modify_real_files(tmp_path):
    ledger = tmp_path / "ledger.json"
    before = (ROOT / "src" / "data" / "lexicon-human.js").read_text(encoding="utf-8")
    r = _run("--list", "--limit", "3", "--ledger", str(ledger))
    assert r.returncode == 0, r.stderr
    assert "共 3 条待审" in r.stdout
    assert (ROOT / "src" / "data" / "lexicon-human.js").read_text(encoding="utf-8") == before
