/* LinguaDE · 语音转写适配层（LD.ASR）
 * 通道优先级（由模块自己选择）：
 *   1) 华为云/后端 Whisper 转写——需 http(s) 环境、可录音且已配置后端
 *   2) 浏览器 SpeechRecognition
 *   3) 本地录音回放 + 手动转写文本
 *   4) 手动录入
 * 注意：getUserMedia 在 file:// 下不可用；本地离线单文件版会退到浏览器识别或手动输入。
 */
(function () {
  const LD = (window.LD = window.LD || {});

  const backendReady = () => !!(LD.Backend && LD.Backend.ready());
  const mediaSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const secureContext = () => location.protocol !== "file:";
  const canCapture = () => mediaSupported() && secureContext();

  /* 是否可以走后端录音转写 */
  const canRecord = () => backendReady() && mediaSupported() && secureContext();

  function pickMime() {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
    return "";
  }

  /* 打开麦克风并准备录制；返回句柄 { rec, stream, chunks, mime } */
  function createRecorder() {
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      return { rec, stream, chunks, mime: rec.mimeType || mime || "audio/webm" };
    });
  }

  /* 停止录制并上传转写；返回 { text, confidence, source:"asr" } */
  function stopAndTranscribe(handle) {
    return stopCapture(handle).then(blob => {
      const mime = handle.mime || "audio/webm";
        const fmt = mime.indexOf("ogg") >= 0 ? "ogg" : mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
      return LD.Backend.transcribe(blob, "speech." + fmt)
        .then(j => ({ text: (j && j.text) || "", confidence: j && j.confidence, source: "asr" }));
    });
  }

  /* 本地录音兜底：Firefox 等无浏览器 ASR 的环境仍可录音回放，识别文本由学习者手动填写。 */
  function stopCapture(handle) {
    return new Promise((resolve, reject) => {
      handle.rec.onstop = () => {
        handle.stream.getTracks().forEach(t => t.stop());
        resolve(new Blob(handle.chunks, { type: handle.mime || "audio/webm" }));
      };
      try { handle.rec.stop(); } catch (e) { reject(e); }
    });
  }

  LD.ASR = { canRecord, canCapture, createRecorder, stopCapture, stopAndTranscribe, backendReady, mediaSupported, secureContext, pickMime };
})();
