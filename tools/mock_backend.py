"""LinguaDE · 本地 mock 后端（零依赖，仅标准库）

用途：为 e2e 回归提供确定性的 /api/health 与 /api/ai/* 响应，**不依赖任何华为云凭证**。
真实后端见 backend/（FastAPI）。二者接口字段保持一致。

启动：python tools/mock_backend.py --port 8899
"""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
}


def _tiny_wav():
    """0.3s 静音单声道 WAV：/api/tts 的确定性响应（前端 <audio> 可真正播放）。"""
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(b"\x00\x00" * 6615)
    return buf.getvalue()


TTS_WAV = _tiny_wav()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # 静音
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=3600")
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _sse(self, chunks):
        """SSE 流式响应：HTTP/1.1 必须使用 chunked 编码，否则客户端无法判定流结束"""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Transfer-Encoding", "chunked")
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()

        def emit(payload: str):
            data = payload.encode("utf-8")
            self.wfile.write(("%X\r\n" % len(data)).encode("ascii"))
            self.wfile.write(data)
            self.wfile.write(b"\r\n")
            self.wfile.flush()

        for c in chunks:
            emit("data: " + json.dumps({"delta": c}, ensure_ascii=False) + "\n\n")
        emit("data: [DONE]\n\n")
        self.wfile.write(b"0\r\n\r\n")   # 结束块
        self.wfile.flush()

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- 契约校验：与 backend/app/schemas.py 的必填字段保持一致 ----
    # 让 e2e 能抓住「前端漏发字段、真实后端 422、mock 却放行」这类断链。
    CONTRACT = {
        "/api/ai/correct": ["text"],
        "/api/ai/chat": ["open_id", "text"],
        "/api/ai/chat/stream": ["open_id", "text"],
        "/api/ai/translate": ["text"],
        "/api/ai/interview/evaluate": ["open_id", "items"],
        "/api/ai/phoneme/assess": ["open_id", "ref", "hyp"],
        "/api/ai/kt/predict": ["open_id", "skill"],
        "/api/tts": ["text"],
        "/api/sync": ["open_id"],
    }

    def _check_contract(self, path, body):
        for prefix, required in self.CONTRACT.items():
            if path.startswith(prefix):
                missing = [f for f in required if f not in body]
                if missing:
                    detail = [{"loc": ["body", f], "msg": "Field required",
                               "type": "missing"} for f in missing]
                    self._json({"detail": detail}, 422)
                    return False
        return True

    # 模拟最近一次同步快照（GET /api/sync 拉取恢复链路）
    MOCK_SNAPSHOT = {
        "profile": {"name": "云端学习者", "exam": "TestDaF", "level": "B2"},
        "xp": 880, "bestStreak": 12,
        "cards": {"Zimmer": {"ef": 2.3, "iv": 6, "due": 0, "reps": 4, "lapses": 0, "ok": 4, "bad": 0, "history": []}},
        "log": [{"t": 1, "type": "vocab", "ability": "vocab", "ok": True, "ms": 3000, "item": "Zimmer"}],
        "wrong": [], "wordbank": [], "sessions": [], "daily": {}, "chats": {},
        "interviews": [], "speeches": [], "mockexams": [], "plan": None,
        "ability": {"vocab": 66, "grammar": 60, "listening": 52, "speaking": 55, "reading": 58, "writing": 50},
        "diagnosed": True, "visited": {}, "freezes": 1, "badges": ["first"],
    }

    def do_GET(self):
        if self.path.startswith("/api/health"):
            self._json({"ok": True, "database": "sqlite", "redis": False, "llm": True, "asr": True, "ocr": True,
                        "phoneme": {"channel": "rule", "external_ready": False, "effective": "rule"},
                        "kt": {"channel": "bkt", "external_ready": False, "effective": "bkt"},
                        "tts": {"channel": "siliconflow", "ready": True}})
        elif self.path.startswith("/api/sync"):
            # 契约：open_id 必填（与真实后端 Query(min_length=6) 一致）
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            oid = (q.get("open_id") or [""])[0]
            if len(oid) < 6:
                self._json({"detail": [{"loc": ["query", "open_id"], "msg": "ensure this value has at least 6 characters", "type": "value_error"}]}, 422)
            else:
                self._json({"ok": True, "open_id": oid, "snapshot": self.MOCK_SNAPSHOT,
                            "updated_at": "2026-10-25T12:00:00"})
        else:
            self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        ln = int(self.headers.get("Content-Length") or 0)
        body = {}
        if ln:
            raw = self.rfile.read(ln)  # multipart 亦可（OCR 上传）
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                body = {}
        p = self.path

        if not self._check_contract(p, body):
            return

        if p.startswith("/api/ai/correct"):
            self._json({"source": "llm", "issues": [
                {"type": "语序", "wrong": "Ich habe nach Deutschland gegangen",
                 "fix": "Ich bin nach Deutschland gegangen", "why": "表示移动的完成时用 sein 作助动词"}
            ]})
        elif p.startswith("/api/ai/translate"):
            self._json({"text": "Ich möchte mich vorstellen."})
        elif p.startswith("/api/ai/chat/stream"):
            self._sse(["Guten ", "Tag! ", "Wie ", "geht ", "es ", "Ihnen? ", "--- ", "问候语正确，注意 Sie 的正式语气。"])
        elif p.startswith("/api/ai/chat"):
            self._json({"reply": "Guten Tag! Wie geht es Ihnen? --- 你好！问候语正确，注意保持 Sie 的正式语气。"})
        elif p.startswith("/api/ai/speech") or "transcribe" in p:
            self._json({"text": "Guten Tag ich möchte mich kurz vorstellen", "confidence": 0.93})
        elif "interview" in p and "evaluate" in p:
            self._json({"total": 78, "vocab": 80, "grammar": 72, "logic": 80, "delivery": 78,
                        "strengths": ["问题要点覆盖完整"], "risks": ["语法稳定性可提升"],
                        "advice": ["多用 weil / deshalb 从句支撑观点"],
                        "rewrite": "Ich habe mich für Deutschland entschieden, weil die Ausbildung praxisnah ist."})
        elif p.startswith("/api/ocr/grade"):
            self._json({
                "ok": True, "mode": "grammar", "source": "vision-llm", "confidence": 0.92,
                "transcript": "Ich habe nach Deutschland gegangen und ich lerne gern Deutsch.",
                "corrections": [
                    {"orig": "Ich habe nach Deutschland gegangen",
                     "fixed": "Ich bin nach Deutschland gegangen",
                     "type": "助动词", "explain": "表示移动的完成时须用 sein 作助动词"}
                ],
                "comments": "整体可读，注意完成时助动词的选择。",
                "suggestions": ["复习 sein / haben 与完成时的搭配"]
            })
        elif p.startswith("/api/sync"):
            self._json({"ok": True, "user_id": 1, "imported": 0})
        elif p.startswith("/api/ai/phoneme/assess"):
            self._json({
                "per": 25, "nRef": 4, "nErr": 1,
                "channel": "rule", "source": "rule-g2p",
                "pairs": [{"t": "ʏ", "a": "ʊ", "hint": "ü 是「圆唇前元音」：舌位像发 i，但嘴唇要收圆。"}],
                "sounds": [{"t": "ʏ", "a": "ʊ", "st": "warn"}, {"t": "b", "a": "b", "st": "ok"}],
                "advice": ["[ʏ → ʊ] ü 是「圆唇前元音」：舌位像发 i，但嘴唇要收圆。"],
            })
        elif p.startswith("/api/ai/kt/predict"):
            hist = body.get("history") or []
            self._json({
                "skill": body.get("skill", ""), "n": len(hist),
                "mastery": 62, "predict": 71,
                "channel": "bkt", "source": "bkt-inline",
                "params": {"pInit": 0.18, "pTransit": 0.16, "pSlip": 0.09, "pGuess": 0.22},
            })
        elif p.startswith("/api/tts"):
            # 契约：{text} → 音频二进制（与 backend/app/tts.py 的 200 响应一致）
            self._bytes(TTS_WAV, "audio/wav")
        else:
            self._json({"ok": False, "error": "not found"}, 404)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8899)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("mock backend on http://127.0.0.1:%d" % args.port, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()