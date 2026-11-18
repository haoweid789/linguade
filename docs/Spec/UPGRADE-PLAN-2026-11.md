# LinguaDE 全项目升级计划 · 2026-11

> **状态**：计划待确认 · **基线**：3.23.1（线上 HTTPS）· **范围**：delta only
>
> 已落地的不在本计划内（3.18–3.23 的修复与 v5 设计系统见 CHANGELOG）。
>
> 注：本计划由 AI 整理自 2026 年 11 月的多次决策与建议汇总；“当天收尾”等细节只在对应提交记录中成立，不代表本计划的实际排期。

---

## 一、目标

补掉三大缺口：

1. **TTS 凭据死扣**——`/api/tts` 两个通道全阻塞，词卡发音离线只能赌系统语音包；
2. **内容信任最后一公里**——B1–C2 5000+ 机器对齐词待人工，人工审校工作台已就绪（3.23.0）但未跑批次；
3. **体验细节尾款**——上两轮审查遗留的 4 个小问题 + 新版暴露的 2 个。

---

## 二、本期已实施（当天收尾，X 天）

| # | 事项 | 落点 | 验收 |
|---|---|---|---|
| A1 | 「考试倒排已启用：0 词被提前」0 词时隐藏 | `src/modules/vocab.js` | 生词网器 examDate 设置下页头不出现空 tag |
| A2 | 备份横幅加云同步豁免 | `src/core/router.js` backupReminder | `lastSyncAt` 7 天内时不显示「只存在本机」 |
| A3 | 「近 8 周学习时长」全 0 时空态对齐分类正确率 | `src/modules/analytics.js` | 空态与「暂无分类数据」同文案形态 |
| A4 | 任务完成即时反馈 | 今日任务行勾选加打钩 + 计数更新动画 | 完成一项后周历格 0/3→1/3 可见变化 |
| A5 | 任务文案折行：`（到期优先）` 被拆字 | styles.css | 320px 不再拆字，`text-wrap:balance` |

---

## 三、P0 · VoxCPM2 自建 TTS（唯一硬瓶颈，1–2 天）

> 背景：3.14 双通道代码就绪、凭据卡住（`tts:off`）；VoxCPM2（OpenBMB，2B，30 语言含德语，48kHz，Apache-2.0）**零凭据、零试听成本**，本期唯一需要 GPU 的是 GPU 运行时。

### B1 后端 channel（半天）

- **改动**：`backend/app/tts.py` 增 `channel=voxcpm`：POST vLLM-Omni/vLLM 的 OpenAI 兼容 `/v1/audio/speech`（Nano-vLLM 接口亦可），请求/响应透传，超时/失败返回 501 走既有降级链不变。
- **配置**：`LINGUADE_TTS_CHANNEL=voxcpm` + `LINGUADE_VOXCPM_BASE`（默认 http://127.0.0.1:8000）+ `LINGUADE_VOXCPM_KEY`（可空）。`deploy/env.example` 同步。
- **健康检查**：`/api/health` 加 `voxcpm` 可用性（失败不喝套，沿用 ch 降级口径）。
- **验收**：`python tools/tts_generate.py --text "Guten Tag" --channel voxcpm` 成功落 wav；`POST /api/tts` 走通；mock 不受影响。

### B2 批量合成内容供给（半天）

- **改动**：`tools/tts_generate.py` 增 `voxcpm` 通道；批量合成全词库（5737）+ 例句 + 阅读短文 84 篇，落 `dist/audio/` + manifest，塞进已有内容包管线（与 Tatoeba 真人录音同格式、同清单）。
- **注意**：批量在便宜 GPU 上做（一次性任务）；**不进实时链路**，避免词点击等待。
- **验收**：mp3 数量与 manifest 一致；`LEC` 前端发音回退链（真人录音 → 后端 TTS → 浏览器）能取到新音频。

### B3 德语发音回归抽检（半天，关键）

- **改动**：新增 `tools/tts_de_sample.py`：抽样 ch 双音（Ich/Bach）、ü/u、ö/o、长短元音、ei/ie、b/p 等 20 类 minimal pairs 合成；对比 `phonetics.js` 的 G2P 音素串，由程序逐对断言（至少含本轮 digit-scope 的全部类）。
- **验收**：抽检报告落盘 `docs/tts-de-eval-*.md`；抽检未过的类不入内容供给（并入 B2 的生成清单剔除）。

### B4 内容包的「主包 + 可选包」分层（文档，0.5 天）

- **改动**：内容包清单分层（主包词库例句 / 可选包录音图），与 `content-packs.js` 的消费口径对齐；`tools/build.py` 清单生成支持分层字段。
- **验收**：内容包发现横幅分层显示；单文件版可选包仍走 HTTP 按需取（不涨单文件体积红线）。

---

## 四、P1 · Anki 导出（2 小时）

- **改动**：`Store.exportAnki()` → TSV（卡片/释义/例句/标签）；设置「数据管理」加按钮，与已有的 Anki 导入成对；导出计数写快照。
- **验收**：导出的 TSV 在 Anki 实机导入成功，字段与 `importData("tsv")` 互通 round-trip。

---

## 五、P2 · 学情报告一键导出（半天）

- **改动**：学情分析页加「导出学习报告 (Markdown)」按钮：累计时长/能力雷达数据/正确率/错题摘要/考试覆盖天数，纯文本 Markdown（含函数/图表占位） 下载。
- **验收**：打开下载的 .md 可读、无模板残留 `${}`。

---

## 六、P3 · 教师音色（等 B1–B2 完成后）

- **改动**：Voice Design 生成一个固定「老师音色」（自然语言描述），作为默认发音音色落应用设置；对照播放听力/跟读/词卡发音。
- **验收**：默认发音使用该音色，用户可在设置里切回系统语音。

---

## 七、内容纵深（半天起，排队）

| # | 事项 | 说明 | 状态 |
|---|---|---|---|
| F1 | `docs/design-system.md` | token 名册 + 图标/触摸/排印规则（Astryx 方法） | 待确认 |
| F2 | check.py 裸 hex 检查 | token 外裸 hex 报错，40 行 | 待确认 |
| F3 | B1 高频 1000 词复核批次 | `tools/review_batch.py` 结构校验 + 人工只看未命中边角；经 `lexicon_workbench.py` 落台账 | 待确认 |
| F4 | `docs/SPEC.md` 结构内本文件 | 规范 | 本次 |

---

## 八、执行顺序与依赖

```
第 1 天：A1–A5（当晚上线）+ C1
第 2–3 天：B1→B3→B2→B4（每步独立可测，B3 先于 B2 结论；B4 依赖 B2）
第 4 天：D1
第 5 天以后：E → F1→F2→F3（F3 持续跑，无发版依赖）
```

每一步：改 → 建（build.py 断言 2.6MB 红线）→ check → 该文件 flow 套 → 全量回归 → CHANGELOG 一行 → commit。

---

## 九、风险与回滚

| 风险 | 对策 |
|---|---|
| GPU 不可达/供给慢 | B1 失败走既有 501 降级；批量供给在外部 GPU 做完再上包，线上无依赖 |
| 2.6MB 红线被顶爆 | B1/B2 不涨前端体积（只涨 dist/audio 内容包与 dist/lexicon-review.json，清单门外）；E/F2 都属 lint/文档不进单文件 |
| 并行编辑者改同一文件 | Edit 前核对 mtime；新测试独立文件（flow_v26 起）；版本号顺延不抢号 |
| 发音抽检未过 | 抽检未过的类剔除，不入供给；结论写进 docs/tts-de-eval |

---

## 十、验收一览

- A1/A2/A3/A4/A5：200+ 全绿 + 当日上线
- B1：`tts_generate.py --channel voxcpm` 成功落 wav，`/api/tts` 通
- B2：音频 manifest 与文件一一对应，内容包发现可见
- B3：`docs/tts-de-eval-*.md` 有全部分类结论
- B4：横幅分层显示
- C1：Anki 实机导入 round-trip 成功
- D1：下载 .md 无模板残留
- dist 单文件 ≤ 2.6MB（build.py 强制断言）

> **待确认决策**：B2 批量合成在哪个环境跑（本地 Mac / 租云 GPU）——由用户定。
