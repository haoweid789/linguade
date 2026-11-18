"""LinguaDE · OCR / HTR 评测脚本（CER · WER 基线）

配套 docs/ocr-research.md 第 7.3 节的评测方案：把「识别质量」量化成可写进验收文档的数字。

识别通道（可插拔）：
  --channel mock      内置模拟通道：对参考文本施加确定性噪声，用于验证评测脚本本身（零依赖、零凭证）
  --channel backend   调本地后端 POST /api/ocr/grade（multipart），需后端已配置视觉大模型
  --channel api       直连 OpenAI 兼容视觉模型 /chat/completions（需 --base-url/--api-key/--model）

数据来源：
  --manifest PATH      本地样本清单（jsonl：{"image": "路径", "ref": "参考文本"}）——最通用
  --hf REPO_ID         从 HuggingFace 数据集读取（默认 fhswf/german_handwriting；需 pandas+pyarrow）
  --make-samples       用 PIL 合成德语样本（印刷体近似）到 tests/ocr/samples/ 并生成 manifest

典型用法：
  python tools/ocr_eval.py --selftest
  python tools/ocr_eval.py --make-samples
  python tools/ocr_eval.py --manifest tests/ocr/samples/manifest.jsonl --channel mock --report docs/ocr-eval-report.md
  python tools/ocr_eval.py --manifest tests/ocr/samples/manifest.jsonl --channel backend --backend http://127.0.0.1:8000
  python tools/ocr_eval.py --manifest tests/ocr/samples/manifest.jsonl --channel api \
      --base-url https://<maas-endpoint>/v1 --api-key sk-xxx --model qwen-vl-max
"""
import argparse
import base64
import json
import os
import random
import sys
import unicodedata
import urllib.request
import uuid

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES_DIR = os.path.join(ROOT, "tests", "ocr", "samples")
DEFAULT_REPORT = os.path.join(ROOT, "docs", "ocr-eval-report.md")

# 与后端 backend/app/ocr.py 的三套 prompt 保持一致的简版（评测只用 grammar 模式转录）
GRAMMAR_PROMPT = (
    "你是德语语法批改专家。用户上传手写或打印的德语文本照片。"
    "请 1) 逐字转录原文；2) 找出语法/拼写/标点错误并给出修改与中文讲解。"
    "只输出 JSON：{\"transcript\":\"...\",\"confidence\":0.0-1.0,"
    "\"corrections\":[{\"orig\":\"...\",\"fixed\":\"...\",\"type\":\"...\",\"explain\":\"...\"}],"
    "\"comments\":\"...\",\"suggestions\":[\"...\"]}。无法辨认处标注 [难以辨认]，不要编造。"
)

SYNTH_SAMPLES = [
    ("s1", "Ich habe gestern einen interessanten Film gesehen."),
    ("s2", "Obwohl das Wetter schlecht war, sind wir spazieren gegangen."),
    ("s3", "Meine Freundin möchte nächstes Jahr in München studieren."),
    ("s4", "Können Sie mir bitte erklären, wie die Anmeldung funktioniert?"),
    ("s5", "Der Prüfling hat die Aufgabe innerhalb von zwanzig Minuten gelöst."),
    ("s6", "Für die Bewerbung brauche ich ein APS-Zertifikat und einen Sprachnachweis."),
]


# ---------------------------------------------------------------- 指标计算
def _lev(a, b):
    """Levenshtein 编辑距离（自实现，零依赖）"""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def normalize(s, keep_case=True):
    s = unicodedata.normalize("NFC", s or "")
    s = s.replace("\r", " ").replace("\n", " ")
    s = " ".join(s.split())
    return s if keep_case else s.lower()


def cer(ref, hyp, keep_case=True):
    ref = normalize(ref, keep_case)
    hyp = normalize(hyp, keep_case)
    return _lev(ref, hyp) / max(1, len(ref))


def wer(ref, hyp, keep_case=True):
    ref_w = normalize(ref, keep_case).split()
    hyp_w = normalize(hyp, keep_case).split()
    return _lev(ref_w, hyp_w) / max(1, len(ref_w))


# ---------------------------------------------------------------- 识别通道
def mock_transcribe(ref, seed=1, rate=0.08):
    """确定性噪声通道：模拟 OCR/HTR 的删除/替换/换位错误"""
    rng = random.Random(seed)
    chars = list(ref)
    n = max(1, int(len(chars) * rate))
    alphabet = "abcdefghijklmnopqrstuvwxyzäöüß"
    for _ in range(n):
        if not chars:
            break
        i = rng.randrange(len(chars))
        r = rng.random()
        if r < 0.34:
            del chars[i]
        elif r < 0.67:
            chars[i] = rng.choice(alphabet)
        else:
            j = rng.randrange(len(chars))
            chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)


def _mime_of(path):
    ext = os.path.splitext(path)[1].lower()
    return {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}.get(
        ext.lstrip("."), "image/png")


def backend_transcribe(image_path, backend, mode="grammar", timeout=120):
    """调本地后端 /api/ocr/grade（标准库 multipart，零依赖）"""
    boundary = "----linguade" + uuid.uuid4().hex
    with open(image_path, "rb") as f:
        img = f.read()
    mime = _mime_of(image_path)
    parts = []
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"capture%s\"\r\n"
                  "Content-Type: %s\r\n\r\n" % (boundary, os.path.splitext(image_path)[1], mime)).encode("utf-8"))
    parts.append(img + b"\r\n")
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"mode\"\r\n\r\n%s\r\n" % (boundary, mode)).encode("utf-8"))
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"meta\"\r\n\r\n{}\r\n" % boundary).encode("utf-8"))
    parts.append(("--%s--\r\n" % boundary).encode("utf-8"))
    body = b"".join(parts)
    req = urllib.request.Request(backend.rstrip("/") + "/api/ocr/grade", data=body,
                                 headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.loads(r.read().decode("utf-8"))
    return j.get("transcript", ""), j


def _safe_json(txt):
    s = (txt or "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    i = s.find("{")
    j = s.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        return json.loads(s[i:j + 1])
    except json.JSONDecodeError:
        return None


def api_transcribe(image_path, base_url, api_key, model, mode="grammar", timeout=120):
    """直连 OpenAI 兼容视觉模型（零依赖）"""
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    data_url = "data:%s;base64,%s" % (_mime_of(image_path), b64)
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": GRAMMAR_PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": "请按系统要求处理这张德语图片。"},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]},
        ],
    }
    req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions",
                                 data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + api_key})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.loads(r.read().decode("utf-8"))
    content = (j.get("choices") or [{}])[0].get("message", {}).get("content", "")
    parsed = _safe_json(content)
    if isinstance(parsed, dict):
        return parsed.get("transcript", ""), parsed
    return content or "", {"raw": content}


# ---------------------------------------------------------------- 数据来源
def load_manifest(path):
    items = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            o = json.loads(line)
            base = os.path.dirname(os.path.abspath(path))
            img = o["image"] if os.path.isabs(o["image"]) else os.path.join(base, o["image"])
            items.append({"image": img, "ref": o["ref"]})
    return items


def load_hf(repo_id, shard=0, limit=50, split="train"):
    """从 HuggingFace 数据集加载（需 pandas + pyarrow）"""
    try:
        import pandas as pd
    except ImportError:
        raise SystemExit("读取 HF 数据集需要 pandas：pip install pandas")
    try:
        import pyarrow  # noqa: F401
    except ImportError:
        raise SystemExit("读取 parquet 需要 pyarrow：pip install pyarrow（当前环境网络受限时请改用 --manifest）")
    from huggingface_hub import hf_hub_download
    filename = "data/%s-%05d-of-00008.parquet" % (split, shard)   # 该数据集共 8 个分片
    path = hf_hub_download(repo_id=repo_id, repo_type="dataset", filename=filename)
    df = pd.read_parquet(path).head(limit)
    items = []
    for _, row in df.iterrows():
        col = row.to_dict()
        img = col.get("image") or col.get("img") or col.get("file")
        text = col.get("text") or col.get("label") or col.get("transcription") or ""
        if isinstance(img, dict):                          # HF 的 Image 结构 {bytes, path}
            img = img.get("path") or img.get("bytes")
        if isinstance(img, (bytes, bytearray)):
            ext = ".png"
            tmp = os.path.join(SAMPLES_DIR, "_hf_%d%s" % (len(items), ext))
            os.makedirs(SAMPLES_DIR, exist_ok=True)
            with open(tmp, "wb") as f:
                f.write(img)
            img = tmp
        if img and text:
            items.append({"image": str(img), "ref": str(text)})
    return items


def make_samples():
    """用 PIL 合成德语样本（印刷体近似 + 轻微噪点），生成 manifest.jsonl"""
    from PIL import Image, ImageDraw, ImageFont

    os.makedirs(SAMPLES_DIR, exist_ok=True)
    font = None
    for cand in ("arial.ttf", "calibri.ttf", "segoeui.ttf"):
        p = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", cand)
        if os.path.exists(p):
            font = ImageFont.truetype(p, 30)
            break
    if font is None:
        font = ImageFont.load_default()

    manifest = os.path.join(SAMPLES_DIR, "manifest.jsonl")
    rng = random.Random(20261025)
    with open(manifest, "w", encoding="utf-8") as mf:
        for name, text in SYNTH_SAMPLES:
            img = Image.new("RGB", (1100, 120), "white")
            d = ImageDraw.Draw(img)
            d.text((30, 38), text, fill=(30, 30, 30), font=font)
            # 轻微噪点，模拟扫描/拍照
            px = img.load()
            for _ in range(1200):
                x = rng.randrange(img.width)
                y = rng.randrange(img.height)
                v = rng.randrange(150, 235)
                px[x, y] = (v, v, v)
            img = img.rotate(rng.uniform(-0.6, 0.6), expand=True, fillcolor="white")
            path = os.path.join(SAMPLES_DIR, name + ".png")
            img.save(path)
            mf.write(json.dumps({"image": os.path.basename(path), "ref": text}, ensure_ascii=False) + "\n")
    print("已生成 %d 张样本 → %s" % (len(SYNTH_SAMPLES), SAMPLES_DIR))
    print("清单：", manifest)


# ---------------------------------------------------------------- 评测主流程
def evaluate(items, channel, args):
    rows = []
    for i, it in enumerate(items):
        ref = it["ref"]
        img = it["image"]
        if channel == "mock":
            hyp = mock_transcribe(ref, seed=args.seed + i, rate=args.noise)
            raw = {"transcript": hyp, "source": "mock"}
        elif channel == "backend":
            hyp, raw = backend_transcribe(img, args.backend, args.mode)
        elif channel == "api":
            hyp, raw = api_transcribe(img, args.base_url, args.api_key, args.model, args.mode)
        else:
            raise SystemExit("未知通道：" + channel)
        rows.append({
            "image": os.path.basename(img),
            "ref": ref,
            "hyp": hyp,
            "cer": cer(ref, hyp),
            "wer": wer(ref, hyp),
            "confidence": (raw or {}).get("confidence"),
        })
        print("[%d/%d] CER=%.3f %s" % (i + 1, len(items), rows[-1]["cer"], rows[-1]["image"]))
    return rows


def report_md(rows, channel, args):
    n = len(rows)
    avg_cer = sum(r["cer"] for r in rows) / max(1, n)
    avg_wer = sum(r["wer"] for r in rows) / max(1, n)
    exact = sum(1 for r in rows if r["cer"] == 0)
    conf = [r["confidence"] for r in rows if r["confidence"] is not None]
    lines = []
    lines.append("# LinguaDE · OCR / HTR 评测报告\n")
    lines.append("> 由 `tools/ocr_eval.py` 生成 · 指标：CER（字符错误率）、WER（词错误率）\n")
    lines.append("## 一、配置\n")
    lines.append("| 项 | 值 |")
    lines.append("|---|---|")
    lines.append("| 识别通道 | `%s` |" % channel)
    lines.append("| 样本数 | %d |" % n)
    if channel == "mock":
        lines.append("| 注入噪声率 | %s |" % args.noise)
        lines.append("| 随机种子 | %s |" % args.seed)
    if channel == "api":
        lines.append("| 模型 | `%s` |" % args.model)
        lines.append("| 服务地址 | `%s` |" % args.base_url)
    if channel == "backend":
        lines.append("| 后端 | `%s` |" % args.backend)
    lines.append("\n## 二、汇总\n")
    lines.append("| 指标 | 值 |")
    lines.append("|---|---|")
    lines.append("| 平均 CER | **%.3f**（%.1f%%） |" % (avg_cer, avg_cer * 100))
    lines.append("| 平均 WER | **%.3f**（%.1f%%） |" % (avg_wer, avg_wer * 100))
    lines.append("| 完全正确样本 | %d / %d |" % (exact, n))
    if conf:
        lines.append("| 平均置信度 | %.2f |" % (sum(conf) / len(conf)))
    lines.append("\n## 三、逐样本结果\n")
    lines.append("| # | 图片 | CER | WER | 置信度 | 参考文本 | 识别文本 |")
    lines.append("|---|---|---|---|---|---|---|")
    for i, r in enumerate(rows, 1):
        c = "" if r["confidence"] is None else "%.2f" % r["confidence"]
        lines.append("| %d | %s | %.3f | %.3f | %s | %s | %s |" % (
            i, r["image"], r["cer"], r["wer"], c,
            r["ref"].replace("|", "/"), (r["hyp"] or "").replace("|", "/")))
    worst = sorted(rows, key=lambda r: -r["cer"])[:3]
    lines.append("\n## 四、最差样例（Top 3，用于定位薄弱环节）\n")
    for r in worst:
        lines.append("- `%s`  CER=%.3f\n  - 参考：%s\n  - 识别：%s" % (r["image"], r["cer"], r["ref"], r["hyp"]))
    lines.append("\n## 五、如何解读与使用\n")
    lines.append("- **mock 通道**的数字只用于验证评测脚本自身（CER 应接近注入噪声率），**不代表模型能力**；")
    lines.append("- 真实基线需在配置凭证后运行：`--channel backend`（自建后端）或 `--channel api`（直连视觉模型）；")
    lines.append("- 建议对照口径：现代学习者手写德语，VLM 级模型 CER 约 10% 量级；印刷体练习册应显著更低；")
    lines.append("- 接入前请用同一批样本跑多通道对比（视觉 LLM / 华为云 OCR / TrOCR），再决定产品链路。")
    return "\n".join(lines) + "\n"


def selftest():
    # 1) 编辑距离与指标精确值
    assert _lev("abc", "abc") == 0
    assert _lev("abc", "abd") == 1
    assert _lev("", "abc") == 3
    assert _lev("Haus", "Hauss") == 1
    assert abs(cer("Haus", "Hauss") - 0.25) < 1e-9   # 1 次插入 / 参考长度 4
    assert abs(wer("Ich bin da", "Ich bin nicht da") - 1 / 3) < 1e-9
    assert cer("Ich bin gegangen.", "Ich bin gegangen.") == 0
    # 2) 归一化：多余空白不应计入错误
    assert cer("Ich  bin\tgegangen", "Ich bin gegangen") == 0
    # 3) mock 通道确定性
    a = mock_transcribe("Ich habe das Buch gelesen.", seed=7, rate=0.1)
    b = mock_transcribe("Ich habe das Buch gelesen.", seed=7, rate=0.1)
    assert a == b, "mock 通道必须确定性"
    assert a != "Ich habe das Buch gelesen.", "mock 应产生误差"
    # 4) mock 通道的 CER 应贴近注入噪声率
    ref = "Obwohl das Wetter schlecht war, sind wir spazieren gegangen."
    rows = [{"cer": cer(ref, mock_transcribe(ref, seed=i, rate=0.1))} for i in range(30)]
    avg = sum(r["cer"] for r in rows) / len(rows)
    assert 0.03 <= avg <= 0.25, "mock CER 偏离噪声率过多：%.3f" % avg
    # 5) 报告生成结构
    rows_full = [{"image": "x.png", "ref": ref, "hyp": mock_transcribe(ref, seed=1, rate=0.1),
                  "cer": 0.1, "wer": 0.1, "confidence": 0.9}]
    md = report_md(rows_full, "mock", argparse.Namespace(noise=0.1, seed=1))
    assert "平均 CER" in md and "逐样本结果" in md
    print("SELFTEST PASS：指标计算 / 归一化 / mock 确定性 / 报告结构 均正确")


def main():
    ap = argparse.ArgumentParser(description="LinguaDE OCR/HTR 评测（CER/WER 基线）")
    ap.add_argument("--selftest", action="store_true", help="零依赖自检（验证评测脚本本身）")
    ap.add_argument("--make-samples", action="store_true", help="用 PIL 合成德语样本并生成 manifest")
    ap.add_argument("--manifest", help="样本清单 jsonl（每行 {image, ref}）")
    ap.add_argument("--hf", help="HuggingFace 数据集 repo_id（默认用 fhswf/german_handwriting）")
    ap.add_argument("--hf-shard", type=int, default=0)
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--channel", choices=["mock", "backend", "api"], default="mock")
    ap.add_argument("--mode", default="grammar", choices=["grammar", "exercise", "essay"])
    ap.add_argument("--noise", type=float, default=0.08, help="mock 通道噪声率")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--backend", default="http://127.0.0.1:8000")
    ap.add_argument("--base-url", default="")
    ap.add_argument("--api-key", default="")
    ap.add_argument("--model", default="")
    ap.add_argument("--report", default=DEFAULT_REPORT)
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return 0
    if args.make_samples:
        make_samples()
        return 0

    if args.manifest:
        items = load_manifest(args.manifest)
    elif args.hf:
        items = load_hf(args.hf, args.hf_shard, args.limit)
    else:
        # 默认：用合成样本（若不存在则先生成）
        man = os.path.join(SAMPLES_DIR, "manifest.jsonl")
        if not os.path.exists(man):
            make_samples()
        items = load_manifest(man)

    if not items:
        raise SystemExit("没有可用样本：请先 --make-samples，或提供 --manifest / --hf")

    if args.channel == "api" and (not args.base_url or not args.api_key):
        raise SystemExit("--channel api 需要 --base-url 与 --api-key")
    if args.channel in ("backend", "api") and not args.report:
        args.report = DEFAULT_REPORT

    rows = evaluate(items, args.channel, args)
    md = report_md(rows, args.channel, args)
    with open(args.report, "w", encoding="utf-8") as f:
        f.write(md)
    avg = sum(r["cer"] for r in rows) / max(1, len(rows))
    print("\n样本数 %d · 平均 CER %.3f · 平均 WER %.3f" % (
        len(rows), avg, sum(r["wer"] for r in rows) / max(1, len(rows))))
    print("报告已写入：", args.report)
    return 0


if __name__ == "__main__":
    sys.exit(main())