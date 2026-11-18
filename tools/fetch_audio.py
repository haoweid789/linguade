#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真人录音进包 · Tatoeba 德语实人音频 → dist/audio/ + dist/content-pack-audio.json

素材来源（全部已在本机缓存，许可逐条记录）：
  .content-cache/tatoeba/audio-list-500.json  Tatoeba API「带录音德语句」清单（id/text/license/owner）
  .content-cache/tatoeba/audio/<id>.mp3       已下载的实人录音
  https://audio.tatoeba.org/sentences/deu/<id>.mp3  缺文件时的补齐源（--fetch 才走网络）

分两档进产品：
  · 单文件版（file://）把最前面的 --inline 条压成 data: URL 打进 dist/index.html，
    离线也能听到真人发音；体积按 --budget-kb 硬上限，超了就少打几条，不谎报。
  · 部署版（http）其余条目走 dist/audio/<id>.mp3 按需流式播放，不占首屏。
"""
import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_AUDIO = os.path.join(ROOT, ".content-cache", "tatoeba", "audio")
CACHE_LIST = os.path.join(ROOT, ".content-cache", "tatoeba", "audio-list-500.json")
SPEECH_PACK = os.path.join(ROOT, "dist", "content-pack-speech.json")
OUT_PACK = os.path.join(ROOT, "dist", "content-pack-audio.json")
OUT_AUDIO = os.path.join(ROOT, "dist", "audio")
AUDIO_URL = "https://audio.tatoeba.org/sentences/deu/%s.mp3"


def words(text):
    return [w for w in str(text).split() if w.strip()]


def load_candidates():
    with io.open(CACHE_LIST, encoding="utf-8") as f:
        rows = json.load(f).get("data") or []
    taken = set()
    if os.path.exists(SPEECH_PACK):
        with io.open(SPEECH_PACK, encoding="utf-8") as f:
            taken = {str(i.get("de", "")).strip().lower() for i in json.load(f).get("items", [])}
    out = []
    for r in rows:
        text = str(r.get("text") or "").strip()
        lic = str(r.get("license") or "")
        if r.get("lang") != "deu" or not text or not lic:
            continue
        if "/by-nc" in lic.lower() or "nc" in lic.lower().split("/")[-1]:
            continue                                    # 非商业许可不进产品（可审计红线）
        n = len(words(text))
        if n < 3 or n > 16:
            continue
        if text.lower() in taken:
            continue                                    # 已跟读包里的同句不重复进
        out.append({"id": str(r["id"]), "de": text, "lic": lic,
                    "by": str(r.get("owner") or ""), "n": n})
    out.sort(key=lambda x: (x["n"], x["id"]))           # 短句优先，跟读门槛低
    return out


def cache_path(sid):
    return os.path.join(CACHE_AUDIO, sid + ".mp3")


def ensure_file(sid, allow_fetch):
    p = cache_path(sid)
    if os.path.exists(p) and os.path.getsize(p) > 2000:
        return p
    if not allow_fetch:
        return ""
    url = AUDIO_URL % sid
    try:
        subprocess.check_call(["curl", "-sSL", "--max-time", "30", "-o", p, url])
    except Exception:
        return ""
    return p if os.path.exists(p) and os.path.getsize(p) > 2000 else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=60, help="放进 dist/audio 的条数上限")
    ap.add_argument("--inline", type=int, default=24, help="打进单文件的条数上限")
    ap.add_argument("--budget-kb", type=int, default=420, help="base64 内联总字节上限（KB）")
    ap.add_argument("--fetch", action="store_true", help="缓存缺文件时允许联网补齐")
    ap.add_argument("--write", action="store_true", help="真正写 dist/ 产物")
    args = ap.parse_args()

    if not os.path.exists(CACHE_LIST):
        sys.exit("缺少 Tatoeba 音频清单：%s（先跑 tools/content_pipeline.py）" % CACHE_LIST)

    cands = load_candidates()
    print("候选带录音德语句：%d 条（已排除 NC 许可与跟读包重复）" % len(cands))

    picked = []
    for c in cands:
        if len(picked) >= args.limit:
            break
        p = ensure_file(c["id"], args.fetch)
        if not p:
            continue
        size = os.path.getsize(p)
        picked.append(dict(c, path=p, bytes=size))

    if not picked:
        sys.exit("没有任何可用的本地录音，跳过写盘")

    total_bytes = sum(x["bytes"] for x in picked)
    inline_bytes = 0
    for x in picked:
        b64_len = (x["bytes"] + 2) // 3 * 4
        if len([y for y in picked if y.get("b64")]) >= args.inline or inline_bytes + b64_len > args.budget_kb * 1024:
            continue
        x["b64"] = base64.b64encode(open(x["path"], "rb").read()).decode("ascii")
        inline_bytes += b64_len

    items = [{
        "id": x["id"], "de": x["de"], "lic": x["lic"],
        "hasAudio": True, "audioLicense": x["lic"], "audioBy": x["by"],
        "audioFile": "audio/%s.mp3" % x["id"], "audioBytes": x["bytes"],
    } for x in picked]
    for x in picked:
        if x.get("b64"):
            for it in items:
                if it["id"] == x["id"]:
                    it["audioB64"] = x["b64"]
    n_inline = sum(1 for x in picked if x.get("b64"))

    pack = {
        "pack": "speech",
        "label": "真人录音句",
        "version": 1,
        "generatedAt": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source": "Tatoeba（audio.tatoeba.org 实人录音，逐条许可见 items[].audioLicense）",
        "sourceUrl": "https://tatoeba.org/en/audios",
        "license": "Text: CC BY 2.0 FR · Audio: 逐条 audioLicense（已排除 NC）",
        "count": len(items),
        "withAudio": len(items),
        "inlineAudio": n_inline,
        "audioKb": round(total_bytes / 1024),
        "inlineKb": round(inline_bytes / 1024),
        "items": items,
    }

    print("选中 %d 条（%d KB）· 内联进单文件 %d 条（%d KB）· 其余走 dist/audio/ 按需播放"
          % (len(items), total_bytes // 1024, n_inline, inline_bytes // 1024))
    if not args.write:
        print("未写盘（加 --write 才生成 dist/audio/ 与 content-pack-audio.json）")
        return

    if os.path.isdir(OUT_AUDIO):
        shutil.rmtree(OUT_AUDIO)
    os.makedirs(OUT_AUDIO)
    for x in picked:
        shutil.copyfile(x["path"], os.path.join(OUT_AUDIO, x["id"] + ".mp3"))
    with io.open(OUT_PACK, "w", encoding="utf-8", newline="\n") as f:
        json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))
    print("已写：%s（%d 个 mp3）" % (os.path.relpath(OUT_AUDIO, ROOT), len(picked)))
    print("已写：%s" % os.path.relpath(OUT_PACK, ROOT))


if __name__ == "__main__":
    main()
