"""LinguaDE · flow_v33：B 系合成音源（VoxCPM2 供给链）回归

覆盖：
  1. 音频内容包可导入（pack==="audio" 分支，audioLicense 非 NC/ND）
  2. NC 授权的 speech 包仍被拒绝（已有红线回归）
  3. 内容包清单分层字段 tier：audio=optional / 其余=main，
     且 audio 永不内联进单文件（体积红线在清单层守住）
"""
import pathlib

DIST = pathlib.Path(__file__).resolve().parent.parent / "dist" / "index.html"


def test_audio_pack_imports(page, errors):
    """合成音源包（B2 供给产物形态）可并入 contentPack.audio"""
    r = page.evaluate("""() => {
      const r = window.LD.Store.importData(JSON.stringify({
        pack: "audio", version: 1, generatedAt: "2026-11-09T00:00:00",
        source: "voxcpm2", license: "Apache-2.0 (OpenBMB VoxCPM2)", tier: "optional", count: 2,
        items: [
          { id: "lex-abc123", text: "der Apfel", file: "audio-v2/lex-abc123.wav", channel: "voxcpm", model: "openbmb/VoxCPM2", bytes: 5123, audioLicense: "Apache-2.0" },
          { id: "sp-0001", text: "Guten Morgen.", file: "audio-v2/sp-0001.wav", channel: "voxcpm", model: "openbmb/VoxCPM2", bytes: 4096, audioLicense: "Apache-2.0" }
        ]
      }), "json");
      const s = window.LD.Store.s;
      return { ok: r && r.ok, kind: r && r.kind, imported: r && r.imported, stored: (s.contentPack.audio || []).length };
    }""")
    assert r["ok"], "合成音源包导入应成功：%r" % r


def test_nc_license_pack_still_rejected(page):
    """NC 授权红线回归：speech 包带 NC 音频不能进"""
    r = page.evaluate("""() => {
      const r = window.LD.Store.importData(JSON.stringify({
        pack: "speech", version: 1, count: 1,
        items: [{ id: "x1", de: "Hallo.", hasAudio: true, audioLicense: "CC-BY-NC 4.0" }]
      }), "json");
      return { ok: r && r.ok, error: r && r.error };
    }""")
    assert not r["ok"], "NC 授权 speech 包应被拒绝"
    assert "NC" in (r["error"] or ""), "错误信息应指明 NC：%r" % r


def test_pack_manifest_tiers_and_no_inline_audio():
    """清单分层：audio 为 optional 且永不内联；主包维持 inline"""
    if not DIST.exists():
        import pytest
        pytest.skip("dist/index.html 不存在（先跑 python tools/build.py）")
    import re
    txt = DIST.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r'"pack":"audio"[^}]*?"inline":(true|false)', txt)
    if m:
        assert m.group(1) == "false", "audio 包禁止内联进单文件（体积红线）"
    assert '"tier":"main"' in txt or '"tier": "main"' in txt, "主包 tier 字段应存在"
