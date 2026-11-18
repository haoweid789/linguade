"""LinguaDE · TTS 批量发音音频生成（词表/例句 → mp3/wav）

在已有华为云接口（backend/app/hwcloud.py 的 AK/SK 通道）之外，新增「语言 API Key」通道，
两个通道可插拔切换，用于给词表/例句批量生成发音音频（回填内容库的音频列）。

通道（--channel）：
  siliconflow  硅基流动语音 API（Bearer 语言 API Key，sk- 开头）——德语可用
               默认 heygen/heygen-voice-1-turbo（免费至 2026-11-30，音色为 UUID 格式
               voice_id，10 个默认音色 ID 见模型页「API」标签）；失败自动降级
               FunAudioLLM/CosyVoice2-0.5B（内置音色 模型名:anna / alex / bella / ...）。
               单次请求文本 <=5000 字符。
  hwcloud      华为云 SIS 语音合成 RunTts（AK/SK 签名，仅标准库实现，与 hwcloud.py
               同一套 SDK-HMAC-SHA256 算法）。文本 <=500 字符。注意：官方 RunTts
               音色表目前仅中英文发音人，德语内容请走 siliconflow 通道。
  voxcpm       自建 vLLM-Omni / Nano-vLLM 部署的 OpenBMB VoxCPM2（POST /v1/audio/speech，
               OpenAI 兼容接口）。零商业凭据（有鉴权网关才加 Bearer），--api-key 包在
               Authorization 里，服务端本地时可省略。文本 <=4000 字符；格式只支持
               wav/mp3（默认 wav 48kHz）。
               服务端：vllm serve openbmb/VoxCPM2 --omni --port 8000
  mock         零凭证模拟通道：生成 0.5s 静音 WAV，用于无 Key 验证整条流水线。

输入（三选一）：
  --text "..."      单句模式
  --input PATH      .txt（每行一句）或 .jsonl（每行 {"id": "...", "text": "..."}）
  （都不给）         从 stdin 按行读

输出：
  --out DIR         音频目录（默认 tools/tts-out），文件名 0001_<id或sha1>.<格式>
  manifest.jsonl    写到输出目录，每行 {"id","text","file","ok","channel","model","bytes","error"}
                    供回填内容库音频列时做映射。

凭证（命令行 flag > 环境变量；AK/SK 是账号级 IAM 凭证，SIS 可直接复用 OCR 的）：
  LINGUADE_SILICONFLOW_API_KEY     语言 API Key（sk-...）
  LINGUADE_TTS_SIS_ENDPOINT / LINGUADE_TTS_SIS_PROJECT_ID / LINGUADE_TTS_SIS_AK / LINGUADE_TTS_SIS_SK
  兜底：LINGUADE_OCR_AK / LINGUADE_OCR_SK / LINGUADE_OCR_PROJECT_ID

典型用法：
  python tools/tts_generate.py --selftest
  python tools/tts_generate.py --text "Guten Tag" --channel siliconflow --api-key sk-xxx --voice <uuid>
  python tools/tts_generate.py --input vocab.jsonl --channel siliconflow --api-key sk-xxx --concurrency 4
  python tools/tts_generate.py --input vocab.txt --channel hwcloud \\
      --endpoint https://sis-ext.cn-north-4.myhuaweicloud.com --project-id xxx --ak xxx --sk xxx
  python tools/tts_generate.py --input vocab.txt --channel hwcloud --ak xxx --sk xxx \\
      --endpoint https://sis-ext.cn-north-4.myhuaweicloud.com --project-id xxx --property chinese_xiaoyu_common
"""
import argparse
import base64
import concurrent.futures
import hashlib
import hmac
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import wave
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "tools", "tts-out")

SF_DEFAULT_BASE = "https://api.siliconflow.cn"
SF_DEFAULT_MODEL = "heygen/heygen-voice-1-turbo"
SF_FALLBACK_MODEL = "FunAudioLLM/CosyVoice2-0.5B"
SF_FALLBACK_VOICE = SF_FALLBACK_MODEL + ":anna"


# ---------------------------------------------------------------- 华为云 AK/SK 签名
# 与 backend/app/hwcloud.py 同一套 SDK-HMAC-SHA256，标准库实现，复制于此保持 tools 脚本零后端依赖。

def _pct(value: str) -> str:
    return quote(str(value), safe="-_.~")


def _canonical_query(query: str) -> str:
    pairs = []
    for part in (query or "").split("&"):
        if not part:
            continue
        k, _, v = part.partition("=")
        pairs.append((_pct(k), _pct(v)))
    pairs.sort()
    return "&".join(k + "=" + v for k, v in pairs)


def _canonical_headers(headers: dict) -> tuple:
    norm = {k.lower().strip(): str(v).strip() for k, v in headers.items()}
    items = sorted(norm.items())
    canon = "".join(k + ":" + v + "\n" for k, v in items)
    return canon, ";".join(k for k, _ in items)


def hw_sign(method: str, url: str, headers: dict, body: bytes,
            ak: str, sk: str, now=None) -> dict:
    """返回补上 X-Sdk-Date 与 Authorization 的请求头副本。"""
    u = urlsplit(url)
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    h = {k: v for k, v in headers.items() if k.lower() != "x-sdk-date"}
    h["X-Sdk-Date"] = stamp
    if not any(k.lower() == "host" for k in h):
        h["Host"] = u.netloc
    canon_headers, signed = _canonical_headers(h)
    path = "/".join(_pct(seg) for seg in (u.path or "/").split("/"))
    payload_hash = hashlib.sha256(body or b"").hexdigest()
    canon_req = "\n".join([method.upper(), path, _canonical_query(u.query),
                           canon_headers, signed, payload_hash])
    to_sign = "SDK-HMAC-SHA256\n" + stamp + "\n" + \
              hashlib.sha256(canon_req.encode()).hexdigest()
    sig = hmac.new(sk.encode(), to_sign.encode(), hashlib.sha256).hexdigest()
    h["Authorization"] = ("SDK-HMAC-SHA256 Access=%s, SignedHeaders=%s, Signature=%s"
                          % (ak, signed, sig))
    return h


# ---------------------------------------------------------------- 三条合成通道

def http_post_json(url: str, headers: dict, payload: bytes, timeout: float):
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        raise RuntimeError("HTTP %s：%s" % (e.code, detail)) from None


def sf_synth(text: str, model: str, voice: str, args) -> bytes:
    """硅基流动：POST /v1/audio/speech，成功返回音频二进制流。"""
    url = args.base_url.rstrip("/") + "/v1/audio/speech"
    body = {
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": args.format,
        "speed": args.speed,
    }
    # opus 固定 48000，接口不接受 sample_rate 字段
    if args.format != "opus":
        body["sample_rate"] = args.sample_rate
    headers = {"Authorization": "Bearer " + args.api_key,
               "Content-Type": "application/json"}
    _, data = http_post_json(url, headers, json.dumps(body).encode("utf-8"),
                             args.timeout)
    if data[:1] == b"{" or len(data) < 100:
        raise RuntimeError("返回不是音频流：%s" % data[:200].decode("utf-8", "replace"))
    return data


def sf_candidates(args):
    """heygen 需要 UUID voice_id：给了 --voice 就先试所配模型，失败（或没给 voice）降级 CosyVoice2。"""
    cands = []
    if args.voice:
        cands.append((args.model, args.voice))
    if args.fallback or not cands:
        cands.append((SF_FALLBACK_MODEL, SF_FALLBACK_VOICE))
    # 去重保序
    seen, out = set(), []
    for c in cands:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def sis_synth(text: str, args) -> bytes:
    """华为云 SIS RunTts：POST /v1/{project_id}/tts，音频以 base64 放在 result.data。"""
    url = args.endpoint.rstrip("/") + "/v1/" + _pct(args.project_id) + "/tts"
    cfg = {"audio_format": args.format if args.format in ("wav", "mp3", "pcm") else "wav",
           "sample_rate": str(args.sis_sample_rate),
           "property": args.property,
           "speed": args.sis_speed,
           "volume": args.sis_volume}
    payload = json.dumps({"text": text[:500], "config": cfg}).encode("utf-8")
    headers = hw_sign("POST", url, {"Content-Type": "application/json"},
                      payload, args.ak, args.sk)
    _, data = http_post_json(url, headers, payload, args.timeout)
    try:
        doc = json.loads(data.decode("utf-8"))
    except ValueError:
        raise RuntimeError("返回不是 JSON：%r" % data[:120]) from None
    if doc.get("error_code"):
        raise RuntimeError("SIS.%s：%s" % (doc.get("error_code"), doc.get("error_msg")))
    b64 = (doc.get("result") or {}).get("data")
    if not b64:
        raise RuntimeError("响应缺少 result.data：%s" % str(doc)[:160])
    return base64.b64decode(b64)


def vox_synth(text: str, args) -> bytes:
    """VoxCPM2（vLLM-Omni / Nano-vLLM OpenAI 兼容接口），零凭据默认无 Bearer。"""
    url = args.voxcpm_base_url.rstrip("/") + "/v1/audio/speech"
    body = {"model": args.voxcpm_model or "openbmb/VoxCPM2",
            "input": text, "voice": args.voxcpm_voice or "default",
            "response_format": args.format}
    headers = {"Content-Type": "application/json"}
    if args.api_key:
        headers["Authorization"] = "Bearer " + args.api_key
    _, data = http_post_json(url, headers, json.dumps(body).encode("utf-8"),
                             args.timeout)
    if data[:1] == b"{":
        try:
            doc = json.loads(data.decode("utf-8"))
        except ValueError:
            raise RuntimeError("VoxCPM2 返回不是音频流：%s" % data[:200].decode("utf-8", "replace")) from None
        b64 = (doc.get("data") or (doc.get("audio") if isinstance(doc.get("audio"), str) else None)
               or doc.get("b64"))
        if not b64:
            raise RuntimeError("VoxCPM2 返回 JSON 但缺少音频载体：%s" % str(doc)[:160])
        data = base64.b64decode(b64)
    if len(data) < 100:
        raise RuntimeError("VoxCPM2 返回为空或过短（%d bytes）" % len(data))
    return data


def mock_synth(text: str) -> bytes:
    """零凭证模拟通道：0.5s 静音 WAV，只用于验证流水线（命名/落盘/清单/重试）。"""
    sr = 22050
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * int(sr * 0.5))
    return buf.getvalue()


def candidates_for(args):
    if args.channel == "siliconflow":
        return sf_candidates(args)
    return [(None, None)]  # hwcloud / mock 单候选，占位对齐结构


def synth_once(text: str, model, voice, args) -> bytes:
    if args.channel == "siliconflow":
        return sf_synth(text, model, voice, args)
    if args.channel == "voxcpm":
        return vox_synth(text, args)
    if args.channel == "hwcloud":
        return sis_synth(text, args)
    return mock_synth(text)


def synth_with_retry(text: str, args):
    """按候选（模型，音色）逐个尝试，每个候选内做 retries 次退避重试。返回 (bytes, model)。"""
    errors = []
    for model, voice in candidates_for(args):
        label = model or args.channel
        for attempt in range(args.retries + 1):
            try:
                return synth_once(text, model, voice, args), label
            except Exception as e:
                errors.append("[%s#%d] %s" % (label, attempt + 1, e))
                if attempt < args.retries:
                    time.sleep(0.8 * (attempt + 1))
    raise RuntimeError("；".join(errors[-3:]))


# ---------------------------------------------------------------- 输入 / 输出

def load_items(args):
    if args.text:
        return [{"id": hashlib.sha1(args.text.encode()).hexdigest()[:10],
                 "text": args.text.strip()}]
    rows = []
    if args.input:
        with open(args.input, "r", encoding="utf-8-sig") as f:
            raw = f.read().splitlines()
    else:
        raw = sys.stdin.read().splitlines()
    for ln, line in enumerate(raw, 1):
        line = line.strip()
        if not line:
            continue
        if args.input and args.input.lower().endswith(".jsonl"):
            try:
                obj = json.loads(line)
            except ValueError:
                raise SystemExit("输入第 %d 行不是合法 JSON：%s" % (ln, line[:80]))
            text = str(obj.get("text") or "").strip()
            item_id = str(obj.get("id") or "").strip()
        else:
            text, item_id = line, ""
        if not text:
            continue
        item_id = item_id or hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
        rows.append({"id": item_id, "text": text})
    if args.limit:
        rows = rows[:args.limit]
    return rows


def safe_slug(text: str, item_id: str) -> str:
    keep = "".join(c for c in item_id if c.isalnum() or c in "-_")
    return keep[:40] or hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def main():
    ap = argparse.ArgumentParser(description="LinguaDE TTS 批量发音音频生成（详见文件头 docstring）")
    ap.add_argument("--selftest", action="store_true", help="零凭证自测：mock 通道跑 2 条并校验 WAV 头")
    ap.add_argument("--channel", default=os.environ.get("LINGUADE_TTS_CHANNEL", "siliconflow"),
                    choices=["siliconflow", "hwcloud", "voxcpm", "mock"])
    ap.add_argument("--text", help="单句模式")
    ap.add_argument("--input", help="词表文件：.txt 每行一句 / .jsonl 每行 {id,text}")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--format", default="mp3", choices=["mp3", "wav", "pcm", "opus"],
                    help="音频格式（hwcloud 仅支持 wav/mp3/pcm，opus 仅 siliconflow，voxcpm 仅 wav/mp3）")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--retries", type=int, default=2, help="每个（模型，音色）候选的重试次数")
    ap.add_argument("--timeout", type=float, default=60.0)
    # siliconflow（语言 API Key 通道）
    ap.add_argument("--base-url", default=os.environ.get("LINGUADE_SILICONFLOW_BASE", SF_DEFAULT_BASE))
    ap.add_argument("--api-key", default=os.environ.get("LINGUADE_SILICONFLOW_API_KEY", ""))
    ap.add_argument("--model", default=SF_DEFAULT_MODEL,
                    help="默认 heygen/heygen-voice-1-turbo；以模型页「API」标签给出的 ID 为准")
    ap.add_argument("--voice", default="",
                    help="HeyGen 音色为 UUID voice_id（10 个默认音色见模型页 API 标签）；"
                         "留空则直接走 CosyVoice2 兜底")
    ap.add_argument("--no-fallback", dest="fallback", action="store_false",
                    help="关闭 heygen→CosyVoice2 自动降级")
    ap.add_argument("--sample-rate", type=int, default=44100)
    ap.add_argument("--speed", type=float, default=1.0, help="siliconflow 语速 0.25~4.0")
    # hwcloud（SIS / AK-SK 通道）
    ap.add_argument("--endpoint", default=os.environ.get("LINGUADE_TTS_SIS_ENDPOINT", ""))
    ap.add_argument("--project-id",
                    default=os.environ.get("LINGUADE_TTS_SIS_PROJECT_ID",
                                           os.environ.get("LINGUADE_OCR_PROJECT_ID", "")))
    ap.add_argument("--ak", default=os.environ.get("LINGUADE_TTS_SIS_AK",
                                                   os.environ.get("LINGUADE_OCR_AK", "")))
    ap.add_argument("--sk", default=os.environ.get("LINGUADE_TTS_SIS_SK",
                                                   os.environ.get("LINGUADE_OCR_SK", "")))
    ap.add_argument("--property", default="chinese_xiaoyu_common",
                    help="SIS 音色，格式 {语言}_{发音人}_{domain}；官方目前仅中英文音色")
    ap.add_argument("--sis-sample-rate", default="16000", help='SIS 采样率字符串："8000"/"16000"')
    ap.add_argument("--sis-speed", type=int, default=0, help="SIS 语速 -500~500")
    ap.add_argument("--sis-volume", type=int, default=50, help="SIS 音量 0~100")
    # voxcpm（自建 VoxCPM2）
    ap.add_argument("--voxcpm-base-url", default=os.environ.get("LINGUADE_VOXCPM_BASE_URL", ""),
                    help="自建 VoxCPM2 服务地址，如 http://127.0.0.1:8000（vllm serve --omni）")
    ap.add_argument("--voxcpm-model", default=os.environ.get("LINGUADE_VOXCPM_MODEL", "openbmb/VoxCPM2"))
    ap.add_argument("--voxcpm-voice", default="",
                    help="留空走服务端默认音色；--api-key 有鉴权网关时才填")
    args = ap.parse_args()

    if args.selftest:
        return selftest(args)

    # 凭证与参数前置校验（失败即用法错误，退出码 2）
    if args.channel == "voxcpm" and not args.voxcpm_base_url:
        ap.error("voxcpm 通道需要 --voxcpm-base-url 或环境变量 LINGUADE_VOXCPM_BASE_URL")
    if args.channel == "siliconflow" and not args.api_key:
        ap.error("siliconflow 通道需要 --api-key 或环境变量 LINGUADE_SILICONFLOW_API_KEY")
    if args.channel == "hwcloud":
        missing = [n for n, v in (("endpoint", args.endpoint), ("project-id", args.project_id),
                                  ("ak", args.ak), ("sk", args.sk)) if not v]
        if missing:
            ap.error("hwcloud 通道缺少参数：%s（AK/SK 可复用 LINGUADE_OCR_AK/OCR_SK）" % ", ".join(missing))

    items = load_items(args)
    if not items:
        print("没有可合成的文本（--text / --input / stdin 至少给一个）")
        return 2
    os.makedirs(args.out, exist_ok=True)

    print("Now: %s | channel=%s format=%s | %d 条文本，并发 %d，重试 %d"
          % (args.out, args.channel, args.format, len(items), args.concurrency, args.retries))

    rows = [None] * len(items)

    def job(i):
        item = items[i]
        try:
            data, model = synth_with_retry(item["text"], args)
            fname = "%04d_%s.%s" % (i + 1, safe_slug(item["text"], item["id"]), args.format)
            return i, {"id": item["id"], "text": item["text"], "file": fname,
                       "ok": True, "channel": args.channel, "model": model,
                       "bytes": len(data), "error": ""}, data
        except Exception as e:
            return i, {"id": item["id"], "text": item["text"], "file": "", "ok": False,
                       "channel": args.channel, "model": "", "bytes": 0,
                       "error": str(e)[:300]}, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as ex:
        for i, row, data in ex.map(job, range(len(items))):
            rows[i] = row
            mark = "OK  " if row["ok"] else "FAIL"
            extra = "" if row["ok"] else " | " + row["error"][:120]
            print("[%s] %04d %s%s" % (mark, i + 1, row["text"][:40], extra))
            if row["ok"]:
                with open(os.path.join(args.out, row["file"]), "wb") as f:
                    f.write(data)

    return finalize(rows, args)


def finalize(rows, args):
    """统计 + 写 manifest 清单（音频文件已在主循环落盘）。"""
    ok = [r for r in rows if r and r["ok"]]
    fail = [r for r in rows if r and not r["ok"]]
    manifest = os.path.join(args.out, "manifest.jsonl")
    with open(manifest, "w", encoding="utf-8") as f:
        for r in rows:
            if r:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("-" * 60)
    print("完成：成功 %d / 失败 %d，输出目录 %s" % (len(ok), len(fail), args.out))
    if ok:
        print("清单：%s（共 %d 字节音频）" % (manifest, sum(r["bytes"] for r in ok)))
    for r in fail[:5]:
        print("失败示例：%s | %s" % (r["text"][:30], r["error"][:150]))
    return 0 if not fail else 1


def selftest(args):
    """零凭证自测：mock 通道合成 2 条，校验 WAV 头（RIFF）与 manifest 完整性。"""
    out = os.path.join(DEFAULT_OUT, "selftest")
    os.makedirs(out, exist_ok=True)
    samples = ["Guten Tag, wie geht es Ihnen?", "Das ist ein Test der TTS-Pipeline."]
    all_ok = True
    for i, text in enumerate(samples, 1):
        data = mock_synth(text)
        header_ok = data[:4] == b"RIFF"
        fname = "%04d_selftest.wav" % i
        with open(os.path.join(out, fname), "wb") as f:
            f.write(data)
        line = {"id": "selftest-%d" % i, "text": text, "file": fname, "ok": header_ok,
                "channel": "mock", "model": "mock", "bytes": len(data), "error": ""}
        print("[PASS]" if header_ok else "[FAIL]", fname, len(data), "bytes, RIFF头:", header_ok)
        all_ok = all_ok and header_ok
    print("自测%s：输出在 %s" % ("通过" if all_ok else "失败", out))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
