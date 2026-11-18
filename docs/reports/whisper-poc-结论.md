# whisper 端上 ASR POC 结论（B8）

- 日期：2026-11-12
- 方法：`tools/whisper_poc.mjs`（Node 侧管线验证；transformers.js 未装，推理段跳过）
- 性质：观察材料（reports），不是已确认 facts

## 结论

1. **可行性成立但成本明确**：Duolingo 已在中国版 APK 内实锤此路线（`domestic-static.duolingo.cn/asr/whisper/whisper-tiny-en.tflite`，TFLite 端上推理）。开源侧对应路径：transformers.js + Xenova/whisper-tiny（Node 验证脚本已就绪，`npm i @huggingface/transformers` 即可跑通）。
2. **体积冲突**：whisper-tiny q8 模型 + 运行时 ≈ 40–80MB，与 LinguaDE 2.6MB 首屏红线冲突——**不做主包内联**；若上，走可选下载包（复用 3.24.1 内容包分层机制，按需下载）。
3. **当前取舍**： LinguaDE 已有后端昇腾 Whisper 通道（asr.py）+ 浏览器 SpeechRecognition 双通道，覆盖比赛演示场景（有网/华为云环境）；端上 whisper 的增益是**离线演示**，优先级让位于 B2/B3（已完成）之后的可选包。
4. **真实德语音频 WER 对比**：留待有样本时补（POC 管线已备好 `--audio <wav>` 参数）。

## 复现命令

```
node tools/whisper_poc.mjs                      # 管线自检（无依赖）
npm i @huggingface/transformers
node tools/whisper_poc.mjs --model Xenova/whisper-tiny --audio <de.wav>
```