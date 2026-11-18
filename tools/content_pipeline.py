# -*- coding: utf-8 -*-
"""LinguaDE · 内容管线（3.5.0-b）：Tatoeba 语料 → 跟读内容包

依据 docs/content-scaling-plan.md §四 的构建期流水线（ingest/filter/pack）：

  fetch    采集原始数据到 .content-cache/：频率词表 + 音频索引（curl 断点续传）
           + Tatoeba API 分页采集德语短句（api.tatoeba.org/unstable，逐条带 id 与授权）
  extract  解包音频索引 → audio-ids.tsv（句 id → 音频授权；与采集句交叉标记 hasAudio）
  pack     质量过滤 + 频率词表难度筛选 → dist/content-pack-speech.json（跟读内容包）
           + docs/content-pipeline-report.md（词表合并候选统计报告）
  --all    fetch + extract + pack 一条龙
  --bulk   备选：全量导出 sentences.tar.bz2（219MB，弱网慎用；extract 会从其中过滤德语子集）

质量红线（content-scaling-plan §六）：
  · 只打包「≥80% 的词在频率表前 8000 或本工程词库内」的短句（4–14 词）——保证可读性
  · 每条带 provenance（Tatoeba 句 ID 与 license）；有实人录音的优先并逐条记录音频授权
  · 文本授权 CC-BY 2.0 FR（Tatoeba）
  · 无中文释义的词**不进词库**——频率词表只产出「候选清单报告」，不盲扩 LD_LEX
"""
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".content-cache")
DIST_PACK = os.path.join(ROOT, "dist", "content-pack-speech.json")
REPORT = os.path.join(ROOT, "docs", "content-pipeline-report.md")

TATOEBA_API = "https://api.tatoeba.org/unstable/sentences?lang=deu&limit=100&sort=random"
TATOEBA_BULK = "https://downloads.tatoeba.org/exports/sentences.tar.bz2"
TATOEBA_AUDIO = "https://downloads.tatoeba.org/exports/sentences_with_audio.tar.bz2"
FREQ_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt"
AUDIO_SIZE = 6385170
FREQ_SIZE = 662497
HARVEST_PAGES = 40          # sort=random 广域采样：~90% 句落在 4–14 词，且能命中实人录音句（按词数升序会拿到全新无音频句）
HARVEST_TARGET = 2500       # 4–14 词句子的采集目标量


def sh(cmd):
    return subprocess.call(cmd, shell=(os.name == "nt"))


def fsize(p):
    return os.path.getsize(p) if os.path.exists(p) else 0


def fetch(use_bulk=False):
    os.makedirs(CACHE, exist_ok=True)
    # 1) 频率词表（小文件，断点续传循环）
    p = os.path.join(CACHE, "de_50k.txt")
    for _ in range(30):
        if fsize(p) >= FREQ_SIZE:
            break
        sh("curl -sL -C - --max-time 60 -o \"%s\" \"%s\"" % (p, FREQ_URL))
    print("  de_50k.txt            %8d / %8d  %s" % (fsize(p), FREQ_SIZE, "OK" if fsize(p) >= FREQ_SIZE else "未完成"))
    # 2) 音频授权索引（6.4MB）
    p = os.path.join(CACHE, "sentences_with_audio.tar.bz2")
    for _ in range(30):
        if fsize(p) >= AUDIO_SIZE:
            break
        sh("curl -sL -C - --max-time 110 -o \"%s\" \"%s\"" % (p, TATOEBA_AUDIO))
    print("  音频授权索引          %8d / %8d  %s" % (fsize(p), AUDIO_SIZE, "OK" if fsize(p) >= AUDIO_SIZE else "未完成"))
    if fsize(p) < AUDIO_SIZE or fsize(os.path.join(CACHE, "de_50k.txt")) < FREQ_SIZE:
        return False
    # 3) 德语短句：默认走 API 分页采集（弱网友好）；--bulk 才拉 219MB 全量导出
    if use_bulk:
        p = os.path.join(CACHE, "sentences.tar.bz2")
        for _ in range(60):
            if fsize(p) >= 219383396:
                break
            sh("curl -sL -C - --max-time 110 -o \"%s\" \"%s\"" % (p, TATOEBA_BULK))
        print("  sentences.tar.bz2     %8d / 219383396  %s" % (fsize(p), "OK" if fsize(p) >= 219383396 else "未完成（重跑续传）"))
        return fsize(p) >= 219383396
    return harvest_api()


def harvest_api():
    """按词数升序翻页采集德语句（目标 4–14 词区间），落盘 id\ttext\tlicense"""
    out_path = os.path.join(CACHE, "tatoeba-deu.tsv")
    url = TATOEBA_API
    got = 0
    pages = 0
    with io.open(out_path, "w", encoding="utf-8", newline="\n") as out:
        while url and pages < HARVEST_PAGES and got < HARVEST_TARGET:
            data = None
            for attempt in range(4):     # 单页重试
                try:
                    with urllib.request.urlopen(url, timeout=40) as r:
                        data = json.loads(r.read().decode("utf-8"))
                    break
                except Exception as e:
                    print("    第 %d 页失败（%s），重试 %d/4" % (pages + 1, e, attempt + 1))
                    time.sleep(1.5)
            if data is None:
                print("    第 %d 页多次失败，提前结束采集" % (pages + 1))
                break
            for s in data.get("data", []):
                wc = len((s.get("text") or "").split())
                if 4 <= wc <= 14:
                    lic = s.get("license") or ""
                    out.write("%s\t%s\t%s\n" % (s["id"], s["text"].replace("\t", " "), lic))
                    got += 1
            pages += 1
            url = data.get("paging", {}).get("next")
    print("  tatoeba-deu.tsv       采集 %d 句（%d 页 API）→ %s" % (got, pages, os.path.relpath(out_path, ROOT)))
    return got >= 200


def extract():
    """解包音频索引 → audio-ids.tsv（句 id → 音频授权）。
    API 采集路线下句子已直接落盘；--bulk 路线则从全量包过滤德语子集。"""
    audio_path = os.path.join(CACHE, "audio-ids.tsv")
    m = 0
    with tarfile.open(os.path.join(CACHE, "sentences_with_audio.tar.bz2"), "r:bz2") as tar:
        f = tar.extractfile("sentences_with_audio.csv")
        with io.open(audio_path, "w", encoding="utf-8", newline="\n") as out:
            for raw in f:
                parts = raw.decode("utf-8", "replace").rstrip("\n").split("\t")
                if parts:
                    # 列位：sentence_id / audio_id / username / license / attribution
                    lic = parts[3] if len(parts) > 3 else ""
                    usr = parts[2] if len(parts) > 2 else ""
                    out.write("%s\t%s\t%s\n" % (parts[0], lic, usr))
                    m += 1
    print("  带录音句索引 %d 条 → %s" % (m, os.path.relpath(audio_path, ROOT)))
    bulk = os.path.join(CACHE, "sentences.tar.bz2")
    if fsize(bulk) >= 219383396:
        deu_path = os.path.join(CACHE, "tatoeba-deu.tsv")
        n = 0
        with tarfile.open(bulk, "r:bz2") as tar:
            f = tar.extractfile("sentences.csv")
            with io.open(deu_path, "w", encoding="utf-8", newline="\n") as out:
                for raw in f:
                    parts = raw.decode("utf-8", "replace").rstrip("\n").split("\t")
                    if len(parts) >= 3 and parts[1] == "deu" and 4 <= len(parts[2].split()) <= 14:
                        out.write("%s\t%s\t\n" % (parts[0], parts[2],))
                        n += 1
        print("  [bulk] 德语短句 %d 条覆盖 tatoeba-deu.tsv" % n)
    return m > 0


def load_freq(limit=8000):
    """频率词表（OpenSubtitles de）→ 前 limit 词集合与排名"""
    words = {}
    with io.open(os.path.join(CACHE, "de_50k.txt"), encoding="utf-8") as f:
        for i, line in enumerate(f):
            w = line.split(" ")[0].strip().lower()
            if w and i < limit:
                words[w] = i
    return words


def load_lexicon_words():
    ws = set()
    for i in range(1, 8):
        p = os.path.join(ROOT, "src", "data", "lexicon-%d.js" % i)
        if not os.path.exists(p):
            continue
        for m in re.finditer(r'^\["([^"]+)"', io.open(p, encoding="utf-8").read(), re.M):
            ws.add(m.group(1).lower())
    return ws


WORD_RE = re.compile(r"^[a-zA-ZäöüßÄÖÜ][a-zA-ZäöüßÄÖÜ\-]*$")


def pack(target=300):
    freq = load_freq(8000)
    lex = load_lexicon_words()
    freq_words = set(freq)
    allowed = freq_words | lex
    audio = {}
    with io.open(os.path.join(CACHE, "audio-ids.tsv"), encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            sid = parts[0]
            lic = parts[1] if len(parts) > 1 else ""
            usr = parts[2] if len(parts) > 2 else ""
            # 质量红线（content-scaling-plan §六）：仅保留「授权字段明确」的录音，其余走 TTS；
            # NC（非商用）授权按风险表规则一律不入包（比赛/开源分发属非商用灰色区，默认剔除）
            audio[sid] = (lic, usr) if (lic and "NC" not in lic.upper()) else None
    seen_norm = set()
    with_audio, without = [], []
    with io.open(os.path.join(CACHE, "tatoeba-deu.tsv"), encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2:
                continue
            sid, text = parts[0], parts[1]
            sent_lic = parts[2] if len(parts) > 2 else ""
            ws = text.split()
            if not (4 <= len(ws) <= 14):
                continue
            low = [w.lower().strip(".,!?;:\"'()„“”…") for w in ws]
            if not all(w and (w in allowed or WORD_RE.match(w)) for w in low):
                continue
            # 质量门槛：至少 80% 的词在允许集内（允许少量专名）
            hit = sum(1 for w in low if w in allowed)
            if hit / len(low) < 0.8:
                continue
            if any(ch.isdigit() for ch in text) or "http" in text:
                continue
            norm = " ".join(low)
            if norm in seen_norm:
                continue
            seen_norm.add(norm)
            item = {"id": sid, "de": text, "lic": sent_lic or "CC BY 2.0 FR"}
            meta = audio.get(sid)
            if meta:
                item["hasAudio"] = True
                item["audioLicense"], item["audioBy"] = meta
                with_audio.append(item)
            else:
                without.append(item)
    items = (with_audio + without)[:target]
    out = {
        "pack": "speech", "version": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": "tatoeba", "sourceUrl": "https://tatoeba.org",
        "license": "Text: CC-BY 2.0 FR (Tatoeba); Audio: per-item audioLicense",
        "count": len(items),
        "withAudio": len([i for i in items if i.get("hasAudio")]),
        "items": items,
    }
    os.makedirs(os.path.dirname(DIST_PACK), exist_ok=True)
    io.open(DIST_PACK, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, ensure_ascii=False, indent=1))
    print("  内容包 %d 条（含实人录音 %d）→ %s" % (len(items), out["withAudio"], os.path.relpath(DIST_PACK, ROOT)))
    write_report(freq, lex, len(with_audio), len(without), items)
    return len(items)


def write_report(freq, lex, n_audio, n_plain, items):
    top5k = set(list(freq)[:5000])
    missing = [w for w in top5k if w not in lex]
    body = [
        "# 内容管线运行报告（3.5.0-b）",
        "",
        "> 生成时间：%s · 管线：`python tools/content_pipeline.py --all`（fetch/extract/pack 三步幂等可重跑）" % time.strftime("%Y-%m-%d %H:%M"),
        "",
        "## 产物",
        "",
        "- `dist/content-pack-speech.json` —— 跟读内容包 %d 条（Tatoeba 德语实句，含实人录音标记 %d 条）；" % (len(items), len([i for i in items if i.get("hasAudio")])),
        "  在应用「设置 → 导入（JSON / Anki TSV / 内容包）」选择该文件即可并入跟读池（TTS 即读，标记实人录音的句可对照原声）。",
        "- 文本授权 CC-BY 2.0 FR；逐条音频授权记录于 `audioLicense` 字段（provenance 完整可审计）。",
        "",
        "## 词汇池候选统计（不盲扩，供 LLM 批量富化 / 人工校对）",
        "",
        "| 指标 | 数值 |",
        "|---|---|",
        "| 频率表前 5000 词（OpenSubtitles de） | %d |" % len(top5k),
        "| 其中已在本工程词库（476 词含变体） | %d |" % (len(top5k) - len(missing)),
        "| 候选新词（前 5000 内未收录） | %d |" % len(missing),
        "| 德语子集可打包短句（4-14 词、80%% 以上高频词覆盖） | %d |" % (n_audio + n_plain),
        "| 其中带实人录音 | %d |" % n_audio,
        "",
        "> 质量红线：无中文释义的候选词**不进词库**。下一步（3.5.0-c）：对候选词批量生成「冠词/中文/例句」草稿后人工抽检 ≥5%，再并入 `lexicon-*.js`。",
        "",
        "## 复现命令",
        "",
        "```bash",
        "python tools/content_pipeline.py --all     # 下载(断点续传) → 解包 → 打包",
        "```",
        "",
    ]
    io.open(REPORT, "w", encoding="utf-8", newline="\n").write("\n".join(body))
    print("  报告 → %s" % os.path.relpath(REPORT, ROOT))


def main():
    steps = sys.argv[1:] or ["--all"]
    use_bulk = "--bulk" in steps
    steps = [s for s in steps if not s.startswith("--")]
    if not steps or steps == ["all"]:
        steps = ["fetch", "extract", "pack"]
    for s in steps:
        print("[%s]" % s)
        if s == "fetch":
            if not fetch(use_bulk=use_bulk):
                print("fetch 未完成（网络受限）。已缓存部分可续传，重跑本命令即可。")
                return 1
        elif s == "extract":
            if not extract():
                return 1
        elif s == "pack":
            pack()
        else:
            print("未知步骤：%s（可用：fetch / extract / pack / --all / --bulk）" % s)
            return 2
    print("内容管线完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
