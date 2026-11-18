# LinguaDE 技术方案 · 内容规模化（解决"内容耗尽"）

> 问题来源：**学习者使用体验报告（2026-10-25）** 将「内容耗尽」列为致命级缺陷 #1——全部内容 2–4 周见底，是 30 天流失的第一原因。
> 现状基线（3.4.0 发布后）：词汇 476 词（B2/C1 首批 167 词已入），阅读 5 篇、写作 6 题、跟读 10 句、面试 12 题、纠错句库 20 句——除词汇外其余五个池未变。
> 目标：把六个内容池从"百级"扩到"准无限"，且**版权干净、离线可用、质量可控**。
> 调研日期：2026-10-25 · agent-reach（github / web 渠道）+ 公开搜索。配套调研：`docs/ocr-research.md`（OCR 批改，3.3.0）；本方案对应 **3.5.0 内容引擎**（3.4.0 已被「学习者体验与数据闭环」占用，见 `CHANGELOG.md`）。
> 结论先行：**三层内容供给**——① 开放语料打底（Tatoeba/GerVLPro/Simple German Corpus 等，CC 授权，离线打包）② LLM 按需生成 + 缓存（CEFR 校准 + 质检）③ 程序化模板兜底。跟读音轨用浏览器 TTS + Tatoeba 实人录音解决，不需要服务端 GPU。

---

## 一、问题量化：每个池子缺口有多大

| 内容池 | 现状（3.4.0 后） | 目标参考（6 个月备考 A1→B1/B2） | 缺口 | 耗尽周期 |
|---|---|---|---|---|
| 词汇 | **476 词**（A1 121 / A2 60 / B1 128 / B2 97 / C1 70，3.4.0 新增 B2/C1 首批） | Goethe A1+A2+B1 官方词表合计约 2,400 词；高频 5,000 词覆盖口语 85%+ | ~5–10× | 3–4 周（按日均 15 新词） |
| 阅读 | 5 篇 | 每周 3–5 篇 × 24 周 ≈ 100+ 篇分级短文 | ~20× | ~1 周 |
| 写作题 | 6 道 | Goethe/telc Schreiben 题型变体 ≥ 40 题 | ~7× | 2 周 |
| 跟读 | 10 句 | 每日 5–10 句 × 180 天 ≈ 1,000+ 句带音频 | ~100× | ~1–2 天 |
| 面试题 | 12 道 | 按 8 大话题 × 5–8 变体 ≈ 60–100 题 | ~6× | 1–2 周 |
| 纠错句库 | 20 句 | 按语法点 × 难度矩阵 ≈ 200+ 句 | ~10× | 1 周 |

结论：单靠手工编辑不可能补齐（3.4.0 手工精修 167 个 B2/C1 词条约耗一个工作日，可佐证），必须走"**开放语料 + 生成**"双轮。另一个被低估的问题：**跟读池 1–2 天就见底，是六个池子中最紧迫的**。

> 已落地缓解（3.4.0，见 CHANGELOG）：词库 309→476；听力新增双人对话 4 段（TTS 双音色）；体验报告的另两件致命项（open_id 契约、数据迁移）已修复。**本方案聚焦剩余五个池 + 词汇的第二批扩充。**

---

## 二、总体架构：三层内容供给

```text
┌─ L1 · 开放语料打底（构建期离线打包，零运行成本）
│    词汇: GerVLPro / DAFlex / FrequencyWords      句子: Tatoeba de (~33万句对)
│    阅读: Aligned Simple German Corpus (CC BY-SA) 纠错: AEG 管线批量合成
│    音频: Tatoeba 实人录音（逐条核对授权）+ 浏览器 TTS 兜底
│
├─ L2 · LLM 按需生成（运行时，结果缓存复用）
│    出题/改写/续写均走现有三层降级链（backend LLM → 浏览器直连 → 规则）
│    prompt 内嵌 CEFR 约束 + 题型模板 + 质检字段；产物入 IndexedDB/SQLite 缓存
│
└─ L3 · 程序化模板兜底（零 LLM）
     模板 × 词表 = 填空/选择/句型转换/纠错句，确定性生成，保证离线永不枯竭
```

设计原则：
1. **L1 保证下限**（离线、免费、版权干净），L2 保证上限（个性化、新颖），L3 保证永不失败。
2. 内容产物统一 schema（`pool / cefr / topic / payload / provenance / hash`），三个池共用一套生成-缓存-去重-审核流水线。
3. **大语料不进 `dist/index.html`**（现约束 ~540KB 零外链，3.4.0 加词库与模考后已从 451KB 涨至 540KB——主包继续膨胀的空间不多了）：L1 语料作为独立可选"内容包"（IndexedDB 首次导入），或后端 `/api/content/*` 按需下发；主包只留种子数据。

---

## 三、六个内容池的逐项方案

### 3.1 词汇（476 → 5,000+，含分级与例句）

> 3.4.0 已完成第一批手工精修（B2 97 / C1 70，含例句与中文释义，去重后入库）；本节解决的是从"百级精修"到"千级规模化"的产能问题。

| 资源 | 说明 | 授权 |
|---|---|---|
| [GerVLPro](https://aclanthology.org/2026.lrec-1.935.pdf) | CEFR 分级德语词表（LREC 2026 论文）：4,015 条 lemma-POS，A1 611 / A2 1,134 / B1 903 / B2 1,103——**与 LinguaDE 的 HLR/FSRS 调度直接兼容** | 学术，以论文声明为准 |
| [DAFlex（UCLouvain CENTAL）](https://cental.uclouvain.be/cefrlex/daflex/) | DaF 专用 CEFR 分级词汇资源 | 以站点声明为准 |
| [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)（1577★） | OpenSubtries 字幕词频表含德语，CC-BY-SA——高频口语词排序依据 | CC-BY-SA |
| [Top 40k German words 开放数据集](https://www.reddit.com/r/German/comments/1l2m049/an_open_dataset_of_the_top_40k_german_words_for)（2025） | 高频词 + AI 释义标注 | 以发布页为准 |
| [Mohith-akash/german-frequency-deck](https://github.com/Mohith-akash/german-frequency-deck) | 5,009 词 A1–C1 Anki 牌组，含神经 TTS 音频、变位、Goethe 等级徽标——**格式转换即可导入** | 以仓库为准 |
| [aringq10/b1-goethe-anki-deck](https://github.com/aringq10/b1-goethe-anki-deck) | Goethe B1 词表 2,871 词牌组化 | 以仓库为准 |

方案：GerVLPro（分级骨架）∪ FrequencyWords（口语频序）去重合并 → 词义例句由 Tatoeba 句库自动回填（CC-BY）→ LLM 补充中文释义校对。注意：**Goethe 官方词表 PDF 有版权**，只作参考校准，不直接内置。

### 3.2 阅读（5 篇 → 100+ 篇分级短文）

| 资源 | 说明 | 授权 |
|---|---|---|
| [A New Aligned Simple German Corpus](https://aclanthology.org/2023.acl-long.638)（[arXiv](https://arxiv.org/html/2209.01106v4)） | 句级对齐"简单德语↔标准德语"语料，来源含 [nachrichtenleicht.de](https://www.nachrichtenleicht.de)（Deutschlandfunk 简语新闻，自带音频）、hurraki.de 等——**可做"同一内容双难度版"的阅读素材** | CC BY-SA 4.0 |
| [CUI03/german-commons](https://huggingface.co/datasets/CUI03/german-commons) | 开放授权德语大文本集（HF） | 开放 |
| [10kGNAD](https://tblock.github.io/10kGNAD) | 一万篇标准德语新闻（B1+ 难度） | CC BY-NC-SA（注意非商用限制） |
| [UniversalCEFR](https://arxiv.org/html/2506.01419v1) | 505,807 篇 CEFR 标注文本（含德语）——生成分级阅读的**自动难度校准参考** | 开放研究 |

方案：L1 打包 Simple German Corpus 精选 50–100 篇（A2–B1 天然分级、版权干净）；L2 由 LLM 生成"命题作文式"分级短文 + 阅读理解题（见 3.3 论文），生成后用 CEFR 词表覆盖率做难度回归校验；公版德语文学（古腾堡）作为 B2+ 补充。

### 3.3 写作题（6 → 40+ 题 + 按需生成）

- 题型模板化：把 Goethe/telc Schreiben 的官方题型骨架（邮件、论坛回帖、议论文……）抽成参数化模板（话题 × 受众 × 字数 × CEFR），模板可无限实例化——**题型骨架本身是功能性描述，无版权风险**。
- LLM 生成新题 + 评分标准（复用 3.3.0 OCR 批改通道的评分维度）。
- 学术支撑（出题/干扰项生成）：
  - [Adaptive and Personalized Exercise Generation for Online Language Learning（ACL 2023, ETH）](https://aclanthology.org/2023.acl-long.567)——个性化填空题生成
  - [LLM-augmented exercise retrieval（L@S 2024）](https://dl.acm.org/doi/10.1145/3636555.3636883)——零样本题目检索/复用
  - [ExGen（RPTEL 2025/2026）](https://rptel.apsce.net/index.php/RPTEL/article/view/2026-21025)——GPT 按需定制练习的系统化方案
  - 干扰项生成系列：[数学 MCQ 干扰项（ACL Findings 2024）](https://arxiv.org/html/2404.02124v1)、[无监督 LLM 干扰项（ACL Findings 2024）](https://aclanthology.org/2024.findings-acl.47.pdf)、[难度可控完形干扰项（ACL 2026）](https://aclanthology.org/2026.acl-long.854.pdf)、[CDGP 基线](https://www.semanticscholar.org/paper/975620e31d43bc5ff38e6f9b370f54df7926d145)

### 3.4 跟读（10 句 → 1,000+ 句带音频）——最紧迫，优先做

| 资源 | 说明 | 授权 |
|---|---|---|
| [Tatoeba](https://tatoeba.org/en/downloads) | 1,360 万句库；德语约 33 万句对（[manythings 镜像](https://www.manythings.org/bilingual)），**其中相当部分有母语者录音**；文本 CC-BY 2.0 FR，音频逐条记录贡献者与授权 | 文本 CC-BY；音频逐条核 |
| 全德语句音频 Anki 包 | [Tatoeba 德语全量带音频牌组](https://ankiweb.net/shared/info/139315945)——现成的格式转换参照 | 同 Tatoeba |
| [rhasspy/piper](https://github.com/rhasspy/piper)（11310★）+ [Thorsten-Voice](https://github.com/thorstenMueller/Thorsten-Voice)（740★） | 本地神经 TTS（MIT）+ 最知名开源德语音色（男声，离线）；后端可选部署，**任意句子秒级生成音频** | MIT / 开放 |
| [Coqui TTS](https://github.com/Coqui-ai/TTS)（46139★） | 备选 TTS 工具包，含德语模型 | MPL 2.0 |
| 浏览器 SpeechSynthesis | **零成本兜底**：Web Speech API 的德语语音本地就绪，离线可用 | 内置 |

方案：句子池 = Tatoeba 按 CEFR 词表过滤（只保留含已学词的句子）→ 有实人录音的直接用录音，没有的走浏览器 TTS（离线即时）或后端 Piper（可选，音质更好）。发音评分复用现有 `asr.js` 三通道语音识别比对。

### 3.5 面试题（12 → 60–100 题）

- 按德语求职/大学面试八大话题（自我介绍、动机、优缺点、项目经历、团队合作、职业规划、反问、情景题）建**问题分类学**，每类 5–8 个变体；骨架人工定，变体由 LLM 生成并配"参考回答要点 + 高频追问"。
- 开放数据参考：[IamHamud/German-Language-Community](https://github.com/IamHamud/German-Language-Community)（社区维护德英学习数据集：词汇/语法/例句）、[abdullahbutt/wordfeather](https://github.com/abdullahbutt/wordfeather)（Goethe A1–C2 全级别材料）。
- 与现有模拟面试模块对接：题目池替换静态列表，其余逻辑不变。

### 3.6 纠错句库（20 → 200+，AEG 管线）

两条互补路线（学术界称为 AEG, Artificial Error Generation）：

1. **规则注错（确定性、离线）**：对正确句执行德语学习者高频错误变换——冠词性错配、格错误（Dativ/Akkusativ）、动词尾位错误、可分动词、ä/ae 拼写、介词搭配——每条正确句可派生多道错题；错误类型打标，可按语法点组卷。
2. **LLM 注错（自然、多样）**：prompt 指定错误类型注入（比规则改写更接近真实学习者错误）。

学术支撑：
- [GenERRate（Foster, BEA 2007）](https://www.cs.rochester.edu/u/tetreaul/bea4/Foster-BEA4.pdf)——经典规则注错工具（思想源头）
- [Felice & Briscoe（EACL 2014）](https://aclanthology.org/E14-3013)——人工校验的注错流水线
- [Stahlberg et al.：带错误标签的合成数据生成（Google）](https://research.google/pubs/synthetic-data-generation-for-grammatical-error-correction-with-tagged-corruption-models)——错误类型标签引导的破坏模型，直接对应"按语法点出题"
- [Náplava & Straka 2019](https://aclanthology.org/D19-5545.pdf)——**合成数据在德语 GEC 上的系统验证**；[IJCAI 2022 统一多语 GEC](https://www.ijcai.org/proceedings/2022/0606.pdf)——德语 1,000 万合成句对先例
- ["To Err Is Human, but Llamas Can Learn It Too"（arXiv 2403.05493）](https://arxiv.org/html/2403.05493v2)——LLM 注错 + Falko-Merlin 德语 F0.5=76.75
- 真实学习者语料对照：Falko-Merlin / [MERLIN](https://huggingface.co/datasets/symeneses/merlin)（学术授权，做质量抽检金标，不内置）

---

## 四、内容生成流水线（工程设计）

```text
tools/content_pipeline.py（构建期，本地跑，零运行成本）
  ├─ ingest:  拉取/转换开放语料（GerVLPro / Tatoeba / SimpleGerman …）
  ├─ filter:  CEFR 词表过滤 + 去重（hash）+ 长度/合规过滤
  ├─ enrich:  本地 LLM 或后端 LLM 批量生成（例句、释义、题目变体、错误注入）
  ├─ check:   ① GEC 模型反查（纠错池：正确句必须 0 告警）
  │           ② CEFR 覆盖率回归（阅读池：词级难度分布）
  │           ③ LLM-as-judge 抽检打分 + 人工抽检 5%
  └─ pack:    按 pool 输出 content-pack.json（版本号 + provenance + hash）
       → 前端 IndexedDB 首次导入 / 后端 /api/content/pack 下发

运行时（可选按需生成）
  某题型缓存不足 → POST /api/content/generate {pool, cefr, topic, n}
  → LLM 生成（三层降级链）→ 质检字段校验 → 缓存 + provenance 标记
```

工程约束与要点：

1. **主包体积红线**：content-pack 与 `dist/index.html` 分离；种子数据（每池 ≤20 条）内联保证首开可玩，包体经 IndexedDB 导入（或 `/api` 拉取）。
2. **provenance 必填**：每条内容记录来源（`tatoeba|aeg-rule|aeg-llm|llm-gen|hand`）与授权，验收文档与比赛答辩都查得到。
3. **缓存即资产**：LLM 按需生成的内容写回缓存池，越用越厚——把"内容耗尽"变成"内容自增长"的产品叙事。
4. **质检复用 3.3.0 的 GEC 能力**：纠错池用 GEC 模型反查是天然闭环；其他池用 CEFR 词表覆盖率 + LLM-as-judge。
5. 质量门不变：`build.py → check.py → smoke.mjs → pytest + e2e`；内容管线单独加 `tools/test_content.py`（schema 校验 + 授权字段非空 + 抽样回归）。

## 五、版本规划与行动清单

| 版本 | 内容 | 依赖 |
|---|---|---|
| 3.3.0（**已发布**） | OCR 拍照批改（`docs/ocr-research.md`） | — |
| 3.4.0（**已发布**） | 学习者体验与数据闭环：open_id 契约修复 / 数据导入与云端恢复 / B2-C1 首批 167 词 / 移动端导航 + PWA / 听力双人对话 / 复习提醒 / 全真模考（体验报告致命项 ①②③ 与重要项 ④⑤⑦⑧ 全闭环） | — |
| **3.5.0-a（离线半已落地 ✅）** | 跟读池：**词库例句派生已上线（10 → 300+ 句，`LD_SPEECH_POOL`）**；纠错池：**AEG 规则注错已上线（20 → 170 句，`tools/aeg_rules.py`）**。剩余：Tatoeba 实人录音导入（外部语料，待跑 `tools/content_pipeline.py`） | 无 |
| **3.5.0-b（管线+跟读半已落地 ✅）** | **`tools/content_pipeline.py` 已上线**：Tatoeba API 采集 + 音频授权交叉 → 跟读内容包 300 句（17 实人录音）+ 前端三格式导入；**频率词表候选报告已产出**（前 5000 词候选 4764，见 `docs/content-pipeline-report.md`）。剩余：GerVLPro 分级词表数据源获取与 LLM 富化入库（红线：无中文释义不入库） | 词表富化通道（LLM） |
| **3.5.0-c ✅ 已落地** | 生词与写作闭环：生词本手动添加 + 内置词典查询 / 写作历史与同题对比（见 `CHANGELOG.md` 3.5.0-c） | — |
| **3.5.0-d ✅ 已落地** | **阅读池管线** `tools/reading_pipeline.py`（维基百科 → 分级短文 **85 篇**：相对难度分位 + 德语形态学特征分级 + 模板出题零 LLM）；**词库富化管线** `tools/lexicon_enrich.py`（候选 **4450** 词 + LLM 富化 + 质检红线 + 抽检清单 + 幂等断点续跑）；**内容产物校验** `tools/test_content.py`（并入质量门第 3 步） | 词库富化**入库待真实 LLM 凭证** |
| **3.6.0 ✅ 已落地** | 对标开源/论文（联网调研）：**音素级发音反馈**（规则式 G2P + 音素序列对齐 + 最小对立对，GOP 思路，`src/phonetics.js`）；**FSRS 目标保持率调度**（Anki / FSRS-rs 同式 + 沙盘滑杆）；**德语形态学分级**（Hancke & Meurers 2012） | — |
| 待办 | 词库 LLM 富化**实跑入库**（红线：无中文释义不入库）；后端 Piper TTS（Thorsten 音色）；content-pack 下发 API | L2 / 后端 |

行动清单：
1. 建内容 schema + `tools/content_pipeline.py` 骨架（ingest/filter/pack 三步先通）；
2. 跟读池 Tatoeba 德语子集抓取与音频授权过滤（downloads 页逐条元数据）；
3. 词汇/纠错两个池的离线管线（不依赖 LLM，先出量；词汇池以 3.4.0 的 476 词为存量底表做增量去重）；
4. L2 生成接口 + 缓存 + 质检字段；
5. 评测：每池抽样 30 条人工盲评（错题类型准确率、阅读难度匹配、跟读自然度），写进验收文档。

## 六、风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| 版权：Goethe 官方词表/真题有版权 | 不能直接内置 | 用 GerVLPro/FrequencyWords 开源词表替代；题型骨架（功能性描述）不抄原文 |
| Tatoeba 音频逐条授权不一 | 误用受限音频 | pack 时只保留授权字段明确的录音；其余走浏览器 TTS |
| 10kGNAD 等 NC 授权 | 比赛演示属灰色 | 默认不打包 NC 授权内容，仅本地研究用 |
| LLM 生成质量不稳 | 错题/释义出错 | 质检三件套（GEC 反查 / CEFR 回归 / LLM-as-judge）+ 人工抽检；provenance 可追溯 |
| LLM 成本 | 生成多了贵 | 构建期批量生成为主（本地/低价模型），运行时按需小批量 + 缓存命中 |
| 主包体积膨胀 | 破坏"零外链单文件"约束（3.4.0 后已 540KB） | content-pack 与主包分离（IndexedDB/API 下发），主包只留种子 |
| 中英混排释义质量 | 释义不准误导学习 | 释义双源（Wiktionary 数据 + LLM 校对），冲突标注人工复核 |

## 附录 A · 综述与方法论参考

- [Stanford: NLP for Education 综述（2025）](https://scale.stanford.edu/ai/repository/survey-natural-language-processing-education-taxonomy-systematic-review-and-future)
- [GenAI in the language classroom（Interactive Learning Environments, 2025/2026，~261 引用）](https://www.tandfonline.com/doi/full/10.1080/10494820.2025.2498537)
- [Application of Generative AI in Education（Law et al., 2024，~864 引用）](https://www.sciencedirect.com/science/article/pii/S2666557324000156)
- 德语文本难度分级：[UniversalCEFR](https://arxiv.org/html/2506.01419v1)、[KONVENS 2019 德语 CEFR 自动分级](https://konvens.org/proceedings/2019/papers/KONVENS2019_paper_9.pdf)、[LLM 德语 CEFR 分类（arXiv 2512.06483）](https://arxiv.org/html/2512.06483v1)
- 同类开源项目参照：[HughYau/learn_german](https://github.com/HughYau/learn_german)（中文德语学习站：34 场景单元/740 词卡/间隔重复）、[german-language topic](https://github.com/topics/german-language)
