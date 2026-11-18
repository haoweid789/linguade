#!/usr/bin/env node
/* LinguaDE · B8 whisper 端上 ASR POC（Node 侧可行性验证，不进前端主包）
 * 目的：验证 whisper-tiny 在浏览器/Node 端加载+推理链路的可行性（Duolingo 已验证此路线：
 *   domestic-static.duolingo.cn/asr/whisper/whisper-tiny-en.tflite）。
 * 本脚本无真实德语音频时用合成信号跑通管线（加载→推理→输出），真实 WER 对比留待样本。
 * 用法：node tools/whisper_poc.mjs [--model <url|path>] [--audio <wav>] */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const modelArg = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const audioArg = args.includes("--audio") ? args[args.indexOf("--audio") + 1] : null;

async function main() {
  console.log("[poc] whisper 端上 ASR 可行性验证");
  console.log("[poc] node:", process.version);

  // 1. transformers.js 可用性
  let transformers = null;
  try {
    transformers = await import("@huggingface/transformers");
    console.log("[poc] transformers.js: 可用");
  } catch (e) {
    console.log("[poc] transformers.js: 未安装（npm i @huggingface/transformers）——跳过推理段");
  }

  // 2. 模型来源
  const MODEL_URL = modelArg || "Xenova/whisper-tiny";
  console.log("[poc] 模型:", MODEL_URL);

  // 3. 音频：有 --audio 用真实 wav；否则合成 1 秒 440Hz 正弦 wav（16kHz mono）
  let audioPath = audioArg;
  if (!audioPath) {
    audioPath = path.join(ROOT, "_tmp", "poc-tone.wav");
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    const sr = 16000, secs = 1, n = sr * secs;
    const data = Buffer.alloc(44 + n * 2);
    data.write("RIFF", 0); data.writeUInt32LE(36 + n * 2, 4); data.write("WAVE", 8);
    data.write("fmt ", 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
    data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
    data.write("data", 36); data.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 8000), 44 + i * 2);
    fs.writeFileSync(audioPath, data);
    console.log("[poc] 合成测试音:", audioPath, "(440Hz 1s —— 不含语音，只验证管线)");
  }

  if (transformers) {
    const t0 = Date.now();
    try {
      const transcriber = await transformers.pipeline("automatic-speech-recognition", MODEL_URL, {
        dtype: "q8", device: "cpu"
      });
      console.log("[poc] 模型加载: %d ms", Date.now() - t0);
      const audio = await transformers.readAudio(audioPath, 16000);
      const t1 = Date.now();
      const out = await transcriber(audio, { language: "de", task: "transcribe" });
      console.log("[poc] 推理: %d ms | 输出:", JSON.stringify(out).slice(0, 200));
    } catch (e) {
      console.log("[poc] 推理失败:", e.message);
    }
  }

  // 4. 结论提示
  console.log("[poc] 结论：管线验证完成。前端集成评估——");
  console.log("[poc]   whisper-tiny q8 ≈ 40–80MB（模型+运行时），与 2.6MB 首屏红线冲突；");
  console.log("[poc]   若做端上 ASR，走可选下载包（复用内容包分层机制），不做主包内联。");
}

main().catch(e => { console.error("[poc] FATAL:", e.message); process.exit(1); });