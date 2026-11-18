# 开源与论文调研 · 3.6.0 升级落地（2026-10-26）

> 方法：联网检索开源项目与学术论文，筛选**纯前端 / 零运行时依赖**可落地、且能回应
> 体验报告 #2 痛点的方向，逐项落地并纳入质量门。本文记录「来源 → 结论 → 落地映射 → 未落地待办」。

---

## 一、调研来源与关键结论

| 方向 | 来源 | 关键结论 | 本工程落地 |
|---|---|---|---|
| 间隔重复算法 | `open-spaced-repetition/fsrs-rs`、`free-spaced-repetition-scheduler`、Anki FSRS、`srs-benchmark` | FSRS 以「目标保持率 R」为调度旋钮：`interval = S / FACTOR × (R^(1/DECAY) − 1)`，`FACTOR = 0.9^(1/DECAY) − 1`；R=0.9 时间隔 = 稳定性 S；时长为整数/分数间隔，R 可在 70–97% 调 | **✅ 3.6.0**：`Engine.fsrsInterval(S, R)` + 沙盘 **70–97% 保持率滑杆**（把写死的 0.9 变成可控权衡） |
| 音素级发音评估（GOP） | Kaldi `egs/gop_speechocean762`；Witt et al. 2000；Hu et al. 2015；`tzyll/goparrot`；`frank613/CTC-based-GOP` | GOP = 音素后验比，用于**音素级**发音与错读检测；GOP-NN > GOP-GMM；文本/特征层面亦可用「音素序列 + 编辑距离 + PER」近似定位 | **✅ 3.6.0**：`src/phonetics.js`（规则式 G2P + 音素 Levenshtein 对齐 + 最小对立对提示），口语报告新增**音素诊断块**（PER + 着色 + 建议） |
| 浏览器本地音素反馈 | `guettli/pp`（Phoneme Party，ONNX + ZIPA） | 纯静态站点、无服务器：目标音素序列 vs 识别音素序列 → PER / 编辑距离 / 逐音素着色（绿黄红） | **✅ 3.6.0**：以同一交互范式实现（不下载模型，规则式 G2P 替代声学识别） |
| 德语可读性分级 | Hancke & Meurers 2012（GEO-GEOlino，89.7%）；Battisti et al. 2020（LREC，德语简化语料 6200 篇）；Vajjala 等 CEFR 分类 | **形态学特征**在德语可读性任务中**单独表现最好**（85.4%），高于传统可读性公式基线（82.2%）；组合全部特征组最佳 | **✅ 3.6.0**：`grade_para` 加入长词率 / 派生后缀率 / 长复合词率 / 逗号-句比，报告新增三列 |
| 知识追踪 | DKT（Xiong et al. 2016）、SAINT+、DLKT 综述（IEEE TKDE 2025）、`jdxyw/deepKT` | 深度序列模型需训练数据与框架；本项目已有 BKT 四参数在线更新 | ⏸ **未落地**（缺 torch/训练数据；BKT 已满足在线自适应，列入后续可选） |
| 德语发音辨析（声学） | `SergejKurtasch/german-phoneme-validator`（22 组 L2 德语混淆对，PyTorch ~1.74GB） | 声学级验证需模型下载与推理环境 | ⏸ **未落地**（体积/依赖与「离线单文件」红线冲突；已用其**混淆对分类学**充实最小对立对提示库） |

---

## 二、3.6.0 落地清单（全部通过质量门）

1. **德语音素引擎** `src/phonetics.js`
   - 规则式 G2P：最长匹配 + 德语特例修正（ch 双音位 [ç]/[x] 依前元音、词尾 -er→[ɐ] / -ig→[ɪç] / -en→[ən]、词尾 e→[ə]、词首 s 浊化）。
   - 音素对齐：Levenshtein + 回溯，词边界错配不计入音素错误。
   - 最小对立对库 16 组 + 逐音素状态（ok/warn/bad）与建议。
   - 实测：`über→uber` 定位 `ʏ→ʊ`（附 ü 圆唇要领）；`heiße→heise` 定位词首 `s→z` 浊化。
2. **口语报告音素诊断块**：PER + 逐音素着色条 + 最小对立对建议（`src/modules/speech.js`）。
3. **FSRS 目标保持率**：`fsrsInterval` + 沙盘滑杆 + 公式与 R 明示（`src/engine.js` / `src/modules/sandbox.js`）。
4. **德语形态学分级**：`tools/reading_pipeline.py` `grade_para` 与报告三列。
5. **词库册独立内容包**：`lexicon_enrich.py --pack` 另产 `dist/content-pack-lexicon.json`；前端 `pack:"lexicon"` 导入契约 + 启动幂等并入 `LD_LEX`。
6. **质量门**：`test.ps1` 五步（构建 → 一致性 → 内容产物 → 冒烟 → e2e）；e2e **70 项 / 八套**（新增 `flow_v13` 5 项 + `flow_v12` 词库册契约 1 项）。

---

## 三、未落地项与理由（后续可选）

- ~~**声学级 GOP / 音素识别**~~ → **已在 3.7.0 落地为后端可选通道**（`backend/app/phoneme.py`：`rule` 默认 / `acoustic` 外部服务），音素混淆对分类学亦已用于最小对立对提示库；前端离线形态仍走本地规则。
- ~~**深度知识追踪（DKT/SAINT+）**~~ → **已在 3.7.0 落地为后端可选通道**（`backend/app/kt.py`：`bkt` 默认 / `dkt` 外部服务），服务不可用自动回落。
- **FSRS 参数自动优化**：论文级做法是在用户复习历史上拟合 21 参数；样本量要求高（数百条/卡片），前端 localStorage 数据可作为后续数据源。
- **CEFR 绝对分级**：维基百科书面语整体偏难，当前用「同批相对分位」保证阅读梯度；论文口径的绝对分级需带标注语料（如 MERLIN / GEO-GEOlino）。

---

## 四、复现方式

```bash
python tools/reading_pipeline.py --all     # 重生成阅读内容包（含形态学分级）
node -e "global.window=global; require('./src/phonetics.js'); console.log(window.LD.Phonetics.compare('über','uber'))"
python -m pytest tests/flow_v13.py -q      # 音素诊断 + FSRS 保持率
powershell -File tools/test.ps1            # 五步质量门（含 70 项 e2e）
```