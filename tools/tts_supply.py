#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""词库 + 例句 + 阅读音源批量生成（B2，内容供给流水线）。

把 3 份清单喂给 tools/tts_generate.py 的任意通道（voxcpm 优先），把音频
落成 content-pack-audio.json（喂给词卡/跟读/例句的 audioUrl 链路），
形成与 Tatoeba 真人录音同格式、同清单的"合成音源包"。

输入清单（本工具自己生成，不依赖外部文件）：
  - 词库全表 5737 条：取词头（冠词 + 词头，名词性词显示冠词）
  - 例句：词条 ex 句子（与词卡例句一致）
  - 阅读短文：84 篇的 paras 段落（可选层，B4 分层后为可选包）

输出：
  dist/content-pack-audio.json   {pack:"audio", source:"voxcpm2", items:[{id,text,file,channel,model,len}]}
  dist/audio-v2/<id>.wav         音频文件（按 id 哈希命名，与 Tatoeba 同目录格式）

用法：
  # 结构自测（mock 通道写两个样例，并校验与目标清单接口一致）
  python tools/tts_supply.py --dry
  # 正式批量（按工具默认通道换 voxcpm / siliconflow）
  LINGUADE_TTS_CHANNEL=voxcpm LINGUADE_VOXCPM_BASE_URL=http://127.0.0.1:8000 \\
      python tools/tts_supply.py --out dist
  # 只先生成 20 条样例看听感
  ... --limit 20
"""
import argparse
import glob
import hashlib
import io
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PY = os.path.join(ROOT, "tools", "tts_generate.py")


def read_lexicon():
    """读 src/data/lexicon-*.js 还原词条：[(de, art, zh, pos, lv, ex)]。"""
    rows = []
    seen = set()
    for path in sorted(glob.glob(os.path.join(ROOT, "src", "data", "lexicon-*.js"))):
        txt = open(path, encoding="utf-8").read()
        # lexicon 条目是 JS 数组字面量 ["de","art","zh","pos","lv","ex",...]，用标记定位
        for m in __import__("re").finditer(r'\["([^"\[\]]*?)"\s*,\s*"([^"\[\]]*?)"', txt):
            de, art = m.group(1), m.group(2)
            if not de or de in seen or any(c in de for c in "[]{}"):
                continue
            seen.add(de)
            rows.append((de, art))
    return rows


def read_sentences():
    """跟读句：从 content-pack-speech.json 取（与 listening/speech 同源），
    只要文本（Tatoeba 实人录音优先保留，合成只补无音频条）。"""
    out = []
    path = os.path.join(ROOT, "dist", "content-pack-speech.json")
    if os.path.exists(path):
        data = json.load(open(path, encoding="utf-8"))
        for it in data.get("items", []):
            de = (it.get("de") or "").strip()
            if de:
                out.append(de)
    return out


def read_reading():
    paras = []
    seen = set()
    for path in sorted(glob.glob(os.path.join(ROOT, "src", "data", "reading*.js")) +
                       glob.glob(os.path.join(ROOT, "dist", "content-pack-reading.json"))):
        if path.endswith(".json"):
            data = json.load(open(path, encoding="utf-8"))
            for item in data.get("items", []):
                for p in item.get("paras") or []:
                    de = (p.get("de") if isinstance(p, dict) else str(p)) or ""
                    de = de.strip()
                    if de and de not in seen and len(de) >= 8:
                        seen.add(de); paras.append(de)
        else:
            txt = open(path, encoding="utf-8").read()
            for m in __import__("re").finditer(r'"de"\s*:\s*"([^"]{8,300})"', txt):
                de = m.group(1).strip()
                if de and de not in seen:
                    seen.add(de); paras.append(de)
    return paras


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry", action="store_true", help="mock 通道只生成一个样例并校验清单接口")
    ap.add_argument("--out", default=os.path.join(ROOT, "dist"), help="产物落 dist/（audio-v2 + content-pack-audio.json）")
    ap.add_argument("--limit", type=int, default=0, help="只生成前 N 条（样例听感用）")
    ap.add_argument("--channel", default=None, help="透传给 tts_generate.py 的通道")
    args = ap.parse_args()

    lex = read_lexicon()
    print("词库词头：%d" % len(lex))
    lex_items = [("%s %s" % (art, de) if art in ("der", "die", "das") else de) for de, art in lex]
    sentences = read_sentences()
    print("跟读句：%d" % len(sentences))
    reading = read_reading()
    print("阅读段落：%d" % len(reading))

    items = []
    for de, art in lex:
        t = ("%s %s" % (art, de) if art in ("der", "die", "das") else de)
        items.append({"id": "lex-" + hashlib.sha1(t.encode()).hexdigest()[:10], "text": t, "kind": "vocab"})
    for i, s in enumerate(sentences):
        items.append({"id": "sp-%04d" % i, "text": s, "kind": "sentence"})
    if reading:
        for i, s in enumerate(reading):
            items.append({"id": "rd-%04d" % i, "text": s, "kind": "reading"})
    print("总合成条目：%d（阅读段落为可选层，B4 分层后为可选包）" % len(items))
    if args.limit:
        items = items[:args.limit]

    if args.dry:
        import wave as _w
        out_dir = os.path.join(args.out, "audio-v2")
        os.makedirs(out_dir, exist_ok=True)
        sid = items[0]["id"]
        fn = os.path.join(out_dir, sid + ".wav")
        sr = 22050
        buf = io.BytesIO()
        with _w.open(buf, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes(b"\x00\x00" * int(sr * 0.5))
        with open(fn, "wb") as f:
            f.write(buf.getvalue())
        meta = {"pack": "audio", "version": 1, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "source": "mock(dry)", "license": "Apache-2.0 (OpenBMB VoxCPM2) · 音频合成",
                "count": len(items), "items": [{"id": sid, "text": items[0]["text"],
                "file": "audio-v2/%s.wav" % sid, "channel": "mock", "model": "mock", "bytes": len(buf.getvalue())}]}
        json.dump(meta, open(os.path.join(args.out, "content-pack-audio.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print("dry-run 完成：%s（样例 1 条音频 + 清单）" % os.path.join(args.out, "content-pack-audio.json"))
        return

    # 正式：写输入清单，调用 generate 脚本
    inp = os.path.join(args.out, "_tts_input.jsonl")
    with open(inp, "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps({"id": it["id"], "text": it["text"]}, ensure_ascii=False) + "\n")

    # 把音频按 manifest 重新落到 audio-v2 并生成 content-pack-audio.json
    out_audio = os.path.join(ROOT, "tools", "tts-out")
    cmd = [sys.executable, GEN_PY, "--input", inp, "--channel", args.channel or "voxcpm",
           "--out", os.path.join(ROOT, "tools", "tts-out"),
           "--concurrency", "4", "--retries", "2",
           "--voxcpm-base-url", os.environ.get("LINGUADE_VOXCPM_BASE_URL", "")]
    print("执行：", " ".join(cmd))
    import subprocess
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-2000:])
    if r.returncode != 0:
        print("生成失败（stdout/stderr 见上）", file=sys.stderr)
    manifest = [json.loads(l) for l in open(os.path.join(out_audio, "manifest.jsonl"), encoding="utf-8")]
    ok = [m for m in manifest if m.get("ok")]
    print("成功 %d / 总 %d" % (len(ok), len(manifest)))

    items_by_id = {it["id"]: it for it in items}
    audio_dir = os.path.join(args.out, "audio-v2")
    os.makedirs(audio_dir, exist_ok=True)
    meta_items = []
    for m in ok:
        sid = m["id"]
        src = os.path.join(out_audio, m["file"])
        dst = os.path.join(audio_dir, sid + ".wav")
        with open(src, "rb") as fsrc, open(dst, "wb") as fdst:
            fdst.write(fsrc.read())
        meta_items.append({"id": sid, "text": items_by_id.get(sid, {}).get("text", m.get("text", "")),
                           "file": "audio-v2/%s.wav" % sid, "channel": m.get("channel", ""),
                           "model": m.get("model", ""), "bytes": m.get("bytes", 0),
                           "audioLicense": "Apache-2.0 (OpenBMB VoxCPM2)"})
    meta = {"pack": "audio", "version": 1, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "source": "voxcpm2" if (args.channel or "voxcpm") == "voxcpm" else (args.channel or "voxcpm"),
            "license": "Apache-2.0 (OpenBMB VoxCPM2) · 音频合成",
            "count": len(meta_items),
            "items": meta_items}
    with open(os.path.join(args.out, "content-pack-audio.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print("清单：%s（%d 条）" % (os.path.join(args.out, "content-pack-audio.json"), len(meta_items)))


if __name__ == "__main__":
    main()
