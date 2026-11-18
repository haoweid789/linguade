#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德语 TTS 发音回归抽检（B3）。

把德语最小对立对（前端 phonetics.js 的 PAIRS 16 类 + 衍生二元组）送进 TTS 通道合成，
然后逐类做**时域/频谱初判**：
  part1 结构完整性：WAV 头 / 时长 / 非静音能量（全自动）；
  part2 类别可区分性：同类两词时长比 + 人类规则初筛（无法替代人耳逐条听）。

用法：
  零凭证自测（mock 通道跑结构完整性）：
      python tools/tts_de_sample.py --selftest
  真实通道抽检（voxcpm backend 自建 / siliconflow key）：
      LINGUADE_TTS_CHANNEL=voxcpm LINGUADE_VOXCPM_BASE_URL=http://127.0.0.1:8000 \\
          python tools/tts_de_sample.py --real
      LINGUADE_SILICONFLOW_API_KEY=sk-xxx python tools/tts_de_sample.py --real
  输出 report：docs/tts-de-eval-<日期>.md + 抽检音频落盘 tools/tts-de-samples/
"""
import argparse
import datetime
import hashlib
import io
import os
import struct
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

# 最小对立对（与 src/phonetics.js 的 PAIRS 对照；Tur/Zohn 等系对照构造，
# 真正用于"必听项"的是 ü/u、ö/o、ch 软硬、ei/ie 五类）
PAIRS = [
    # (class, word_a, word_b, phoneme_diff, note)
    ("ü/u 对立", "Tür", "Tur", "ü [yː] vs u [uː]", "Tur 读不顺时可换 der Turm 辅助两类"),
    ("ü/u 短音", "Müller", "Muller", "ü 短 [ʏ] vs u 短 [ʊ]", "含 ö 外来近词对照"),
    ("ö/o 对立", "Böen", "Boen", "ö [øː] vs o [oː]", "二元音组 ö/ø"),
    ("ö/o 短音", "schöpfen", "schofen", "ö 短 [œ] vs o 短 [ɔ]", ""),
    ("ä/e 长音", "Mäden", "Medien", "ä 长 [ɛː] vs e 长 [eː]", "Mädchen 亦可"),
    ("ch 软音", "ich", "Bach", "ich [ɪç] 软音 [ç]", "ich vs Bach 即软/硬 ch 的教科书对照"),
    ("ch 硬音", "Bach", "ich", "Bach [bax] 硬音 [x]", "a/o/u/au 后读 [x]"),
    ("s 浊音", "Sohn", "Zohn", "词首 s 元音后 [z] vs z [ts]", "Zohn 本身不存在，按对照构造"),
    ("z [ts]", "Zeit", "Seid", "z [ts] vs s 长音", "Zeit vs Seit"),
    ("v [f]", "Vater", "Water", "v [f] vs w [v]", "外来词 v 读 [v] 的反例对照"),
    ("g 尾清化", "Tag", "Tak", "词尾 g [k]", ""),
    ("d 尾清化", "Kind", "Kinn", "词尾 d [t]", ""),
    ("ng 鼻音", "singen", "singen", "ng [ŋ] 鼻音", "同词两遍录用于稳定性"),
    ("ei/ie 反读", "mein", "Miene", "ei [aɪ] vs ie [iː]", "最常被读反的一对"),
    ("-er 弱化", "Lehrer", "Lehrer", "词尾 -er 弱化 [ɐ]", "同词两遍稳定性"),
    ("au/aʊ", "Haus", "Haus", "au [aʊ]", "文内复核对照"),
]


def wav_stats(raw: bytes) -> dict:
    """WAV 头解析：时长、非静音能量。失败返回 ok=False。"""
    try:
        bio = io.BytesIO(raw)
        with wave.open(bio, "rb") as w:
            ch = w.getnchannels(); sw = w.getsampwidth(); sr = w.getframerate()
            frames = w.getnframes()
            data = w.readframes(frames)
        if sr <= 0 or frames <= 0:
            return {"ok": False, "reason": "无帧"}
        vals = struct.unpack("<%dh" % (len(data) // 2), data[: (len(data) // 2) * 2])
        rms = (sum(v * v for v in vals) / max(1, len(vals))) ** 0.5 if vals else 0
        peak = max(abs(v) for v in vals) if vals else 0
        return {"ok": True, "sr": sr, "dur": round(frames / sr, 3),
                "rms": round(rms, 2), "peak": peak,
                "bytes": len(raw)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": str(e)[:80], "bytes": len(raw)}


def mock_synth(text: str) -> bytes:
    """零凭证模拟通道：0.5s 静音 WAV，只验证抽检流水线。"""
    sr = 22050
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b"\x00\x00" * int(sr * 0.5))
    return buf.getvalue()


def real_synth(text: str) -> bytes:
    """走 backend/app/tts.py 的 synthesize()（真实通道，透传 env 配置），一次返回 bytes。"""
    import asyncio  # noqa: PLC0415

    async def _go():
        from app.tts import synthesize
        out = await synthesize(text, "wav")
        return out["audio"]

    return asyncio.run(_go())


def main():
    ap = argparse.ArgumentParser(description="德语 TTS 发音回归抽检")
    ap.add_argument("--real", action="store_true", help="走真实 TTS 通道（默认走 mock 自测)")
    ap.add_argument("--selftest", action="store_true", help="同 --real 不给时走 mock")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs"))
    args = ap.parse_args()

    use_real = args.real
    channel = os.environ.get("LINGUADE_TTS_CHANNEL", "off")
    samples_dir = os.path.join(ROOT, "tools", "tts-de-samples")
    os.makedirs(samples_dir, exist_ok=True)

    rows = []
    for cls, wa, wb, diff, note in PAIRS:
        dup = (wa == wb)
        items = [(wa, "a"), (wb, "b")] + ([(wa, "a2")] if dup else [])
        for word, tag in items:
            sid = hashlib.sha1(("%s|%s" % (cls, word)).encode()).hexdigest()[:8]
            st = {"word": word, "tag": tag, "cls": cls}
            raw = b""
            try:
                raw = real_synth(word) if use_real else mock_synth(word)
                st.update(wav_stats(raw))
            except Exception as e:  # noqa: BLE001
                st.update({"ok": False, "reason": str(e)[:120]})
            # 结构通过性：文件合法且时长 > 0；真实通道还要非静音能量
            if st.get("ok"):
                st["ok"] = (st.get("dur", 0) > 0) and (not use_real or st.get("rms", 0) >= 2)
                if use_real and st.get("rms", 0) < 2:
                    st["reason"] = "RMS 过低（近似静音）"
            # 真实通道结构通过 → 落样例文件（人耳听）
            if use_real and st.get("ok") and raw:
                fn = os.path.join(samples_dir, "%s_%s.wav" % (sid, tag))
                with open(fn, "wb") as f:
                    f.write(raw)
                st["file"] = os.path.relpath(fn, ROOT)
            rows.append(st)

    ok_n = sum(1 for r in rows if r.get("ok"))
    cls_summary = {}
    for r in rows:
        if r.get("ok"):
            cls_summary.setdefault(r["cls"], {})[r["tag"]] = r.get("dur")

    today = datetime.date.today().isoformat()
    md = [
        "# 德语 TTS 发音抽检报告 · %s" % today,
        "",
        "- 通道：`%s`（%s）" % (channel, "真实合成" if use_real else "mock 自测流水线"),
        "- 对照：`src/phonetics.js` 最小对立对 16 类",
        "- 结构完整性：%d / %d 通过" % (ok_n, len(rows)),
        "",
        "## 逐条结构完整性",
        "",
        "| 类别 | 词 | 标签 | 时长(s) | RMS | peak | 文件 |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        fname = os.path.basename(r.get("file") or "") or "—"
        md.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            r.get("cls", "—"), r.get("word", "—"), r.get("tag", "—"),
            r.get("dur", "—"), r.get("rms", "—"), r.get("peak", "—"), fname))

    md += ["", "## 类别可区分性粗代理（时长比 a/b；真实结论需人耳逐条听）", ""]
    for cls, cmp_ in cls_summary.items():
        if "a" in cmp_ and "b" in cmp_ and cmp_["a"] and cmp_["b"]:
            ratio = cmp_["a"] / cmp_["b"] if cmp_["b"] else 0
            md.append("- **%s**：时长比 %.2f %s" % (cls, ratio, "（可区分）" if 0.7 <= ratio <= 1.4 else "（差异显著，需人耳复核）"))
        else:
            md.append("- **%s**：仅一词（稳定性对照）" % cls)

    md += ["",
           "## 结论与用法",
           "",
           "1. 结构完整性通过只证明「发得出、不是静音」，**不证明读音正确**。",
           "2. 文件位于 `tools/tts-de-samples/`，逐条人耳听：ü/u、ö/o、ch 软硬、ei/ie 五类是必听项。",
           "3. 听不通过的类，**不进入 B2 内容供给**（在供给脚本剔除该类词表）。",
           "4. 本报告由 `python tools/tts_de_sample.py %s` 生成。" % ("--real" if use_real else "--selftest"),
           ""]
    out_path = os.path.join(args.out, "tts-de-eval-%s.md" % today)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md))
    print("报告：%s（%d/%d 结构通过）" % (out_path, ok_n, len(rows)))


if __name__ == "__main__":
    main()
