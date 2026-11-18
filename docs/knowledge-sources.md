# 开放知识库接入与 AI 出题（2026-10-29）

> 目标：为阅读题、语法讲解、B2/C1/C2 与专业词汇提供**可持续更新**的内容来源，
> 并在题库接近做完时由大模型按知识点生成原创题，而不是复制教材/真题。

---

## 1. 结论先行

- **GitHub 上能找到德语词表/题库仓库，但许可大多不适合直接接入**：好用的 Goethe/TestDaF 词表通常夹带版权条款或 CC BY-NC；来源不清的爬取题库不能碰。
- **Gitee 没有找到可用的德语 CEFR 词库或语法题库**（搜索到的多为英语词库/通用工具；`qwerty-learner` 是 GPL-3.0 的英语词库）。
- 真正可用的开放底座是 **Tatoeba 德中双语句对（CC BY 2.0 FR）**：当前接口可查到 **68,609** 条德语句带中文翻译，可随机刷新、逐条带句 ID 与许可。
- 因此本项目的策略是：**开放语料做 grounding，大模型生成原创题，人工/规则校验**；不把开放语料原句当考题，也不接 CC BY-NC 词表。

---

## 2. GitHub / Gitee 检索记录

检索时间：2026-10-29；检索方式：GitHub Search API、Gitee 搜索页/网页搜索。

| 来源 | 内容 | 许可 | 结论 |
|---|---|---|---|
| [Tatoeba](https://tatoeba.org/) | 德语-中文句对（含翻译、句 ID、作者） | CC BY 2.0 FR | **已接入**；`tools/knowledge_ingest.py` |
| [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) | 德语词频 `de_50k.txt` | CC BY-SA 4.0 | **已用**于等级估计；不随包分发 |
| [Wikimedia Wikipedia](https://de.wikipedia.org/) | 德语短文/常识条目 | CC BY-SA 4.0 | 已有 `tools/reading_pipeline.py` 阅读池 |
| [Wiktionary](https://de.wiktionary.org/) / [kaikki](https://kaikki.org/) | 德语词条的英文释义、词形、发音 | CC BY-SA 3.0（English Wiktionary extract） | **已用** German extract 做德英释义；不复制例句/音频 |
| [ECDICT](https://github.com/skywind3000/ECDICT) | 英汉词典（约 340 万词条） | MIT | **已用**做英中词义桥接；只用词义字段 |
| [hasharmujahid/deutsch-karten](https://github.com/hasharmujahid/deutsch-karten) | A1–C2 词表、例句、变位 | 代码 MIT；A1–B2 为 Goethe 词表条款；C1/C2 为 **CC BY-NC 4.0** | **不接**：NC 层与歌德条款不适合作为开源项目内置数据 |
| [abdullahbutt/wordfeather](https://github.com/abdullahbutt/wordfeather) | Goethe A1–C2 学习材料 | **CC BY-NC 4.0** | **不接**：非商用限制，且含考试材料 |
| [AMevans12/Anki-Flash-Cards-Deutsch-ZhongWen](https://github.com/AMevans12/Anki-Flash-Cards-Deutsch-ZhongWen) | AI 生成德语 A1–C2 卡片（英释） | MIT | **不接**：AI 生成、英文释义，只能当灵感，不能当词典真值 |
| [Adityav20/vocabforge-cefr-german](https://github.com/Adityav20/vocabforge-cefr-german) | CEFR 词汇提取工具（非数据） | MIT | 工具可借鉴，数据不直接可用 |
| [machinelearningZH/zix_understandability-index](https://github.com/machinelearningZH/zix_understandability-index) | 德语文本可理解度/CEFR 参考思路 | MIT | 可作难度校准参考；本次未接 |
| Gitee `qwerty-learner` | 英语/多考试词库 | GPL-3.0 | **不接**：英语词库，且 GPL 与本项目数据分发边界不一致 |
| Gitee 其余“德语语法/TestDaF 题库” | 多为转载/扫描/来源不明 | 不清晰 | **不接**：版权红线 |

> 说明：许可会变化，接入前应以仓库当时的 `LICENSE` / 数据说明为准；本表只记录检索时的判断。

---

## 3. 已落地的 Tatoeba 接入

### 3.1 数据管线

```bash
python tools/knowledge_ingest.py --all --target 160
python tools/knowledge_ingest.py --all --target 400   # 增量刷新，seen 去重
python tools/knowledge_ingest.py --pack-only          # 只从缓存重打包
```

产出：

- `dist/content-pack-pairs.json`：`pack: "pairs"`，每条含 `id / de / zh / level / license / source / url`
- `docs/knowledge-ingest-report.md`：数量、等级分布、许可与刷新方式
- `.knowledge-cache/tatoeba_pairs.jsonl` + `seen.json`：增量缓存与去重

过滤规则：

- 德语 4–22 词、中文 4–120 字；排除 URL、HTML 标记、过多感叹/问句
- 仅取带中文翻译且翻译未标记 unapproved 的句对
- 等级：按频率表词频 80 分位启发式估计（A2/B1/B2/C1/C2），不是官方 CEFR 标注

### 3.2 前端消费

- `Store.importData` 支持 `pack: "pairs"`，并入 `contentPack.pairs`
- `LD.AIGen` 生成阅读/语法/词汇时，优先从 `contentPack.pairs` 取同等级例句做 grounding
- 部署版首页内容包横幅可一键导入；`file://` 与开发环境不探测

### 3.3 词库（2000 基础 + 3908 考试词，共 5908）

| 部分 | 条数 | 来源 | 质量口径 |
|---|---|---|---|
| 自建核心 | 100 | 本项目自写 | 中文释义/例句人工撰写；B2 20 / C1 20 / C2 20 / 专业 40 |
| 开放词典扩展 | 1428 | kaikki/English Wiktionary German extract（CC BY-SA 3.0）+ ECDICT（MIT） | 德→英→中机器对齐；待校对 |
| 考试词库 | 3908 | Goethe A1–B1 词表（DWDS 整理）+ Tatoeba 语料词频派生 B2–C2 + kaikki 词形 + Tatoeba 例句（CC BY 2.0 FR） | 词性/等级/去重/例句已清洗；中文机器对齐待抽检 |

最终总量 **5908 唯一词**：A1 649 / A2 616 / B1 2128 / B2 944 / C1 762 / C2 809。

- 自建 100 条见 `src/data/lexicon-8.js`；开放词典扩展见 `src/data/lexicon-9.js`，生成脚本 `tools/lexicon_pivot.py`，报告 `docs/lexicon-pivot-report.md`。
- 考试词库见 `src/data/lexicon-10.js`，生成脚本 `tools/import_german_exam_db.py`，报告 `docs/german-exam-db-integration.md`；人工释义覆盖表 `tools/data/exam_vocab_overrides.json`，逐条复核表 `docs/exam-vocab-review.csv`。
- 考试词库本次新增 3908 条（A1 527 / A2 397 / B1 1309 / B2 396 / C1 633 / C2 646），跳过网站已有 1335 条；3908 条全部带例句（本词条句 3770 / 全局句库 42 / 人工补写 97）。
- 开放词典扩展词库 1428 条例句已从 739 缺句 + 408 缺中文补到 0/0：德中句对池 1151 条沿用、人工补写 262 条（`tools/data/lexicon9_example_overrides.json`）。全库 5908 条例句与例句中文均已齐。
- **边界**：1428 条与 3908 条都不是人工词典；开放词典扩展已由 7 个独立审校批次复核（780 条释义被改写），考试词库的 A1–C2 高频错义已人工覆盖 581 条，其余标注“机器对齐 · 待抽检”；例句为空时不伪造。详见 `docs/lexicon-qa.md` 与 `docs/german-exam-db-integration.md`。
- 专业词 40 条覆盖信息、机械、企业经济、医学、法律、环境、电气、建筑。
- `engine.LEVELS` 已开放 C2；词库总量 476 → 2000 → 5908。

### 3.4 语法点与考试结构（german_exam.db）

| 产物 | 内容 | 来源 | 用途 |
|---|---|---|---|
| `src/data/grammar-exam.js` | 71 个语法点（A1 16 / A2 14 / B1 15 / B2 12 / C1 8 / C2 6） | `german_exam.db` `grammar_points`（中文讲解为本项目整理） | 句法纠错模块右侧「语法速查」 |
| `src/data/exam-plan.js` | 12 个考试 / 48 条模块 | `german_exam.db` `exams` / `exam_tasks` / `pass_criteria` | 全真模考首页「考试结构速查」 |

- 两者均由 `tools/import_german_exam_db.py` 从源库导出，幂等可重跑；考试时长/题量为公开考试说明，非官方评分细则。

---

## 4. AI 出题 / 讲解

### 4.1 三个入口

| 入口 | 功能 | 结果落点 |
|---|---|---|
| 阅读理解 → “AI 生成阅读题” | 按等级/主题生成 2 段短文 + 小标题/正误/选择题 + 中文解析 | `contentPack.reading`，源标记 `AI 生成 · 待校对` |
| 句法纠错 → “AI 知识点讲解” | 按语法点生成中文讲解 + 例句 + 3 道练习 | `contentPack.grammar` |
| 错题本 → “AI 扩展词汇” | 按等级/领域生成 B2/C1/C2/专业词条 + 例句 | `contentPack.lexicon` → `LD_LEX`，进入单词队列 |

### 4.2 质量与边界

- 只调用 `LD.LLM.chat`；未配置大模型时明确提示，**不伪造题目/释义**
- 严格 JSON 校验：标题/段落/小标题数量、选项下标、词性/等级枚举
- 去重：阅读按标题+正文哈希，词汇按词条小写去重，已存在则跳过
- 上限：AI 阅读 24 套、语法 40 条、词汇 200 条；超出按时间淘汰旧 AI 项，不删用户导入包
- 标注：所有 AI 内容带 `AI 生成 · 待校对`；开放语料带 Tatoeba 句 ID/许可
- 版权：不复制歌德/TestDaF 真题；生成题必须原创，不允许照抄 grounding 句

---

## 5. 后续可接（未做）

1. **词形/例句补全**：kaikki 已提供德英释义；词形与例句仍可继续接入并做人工抽检（当前扩展词条例句为空）。
2. **Wikibooks 德语语法**：只作为语法点参考，生成中文讲解时保持原创表述。
3. **UniversalCEFR / GerVLPro / DAFlex**：仅作研究级难度校准；接入前需确认许可。
4. **后端生成队列**：把 AI 出题放到 FastAPI 异步任务，避免浏览器直连超时；当前先走直连 + 本地缓存。

---

## 6. 复核清单

- [ ] 新增数据源先看 `LICENSE` / 数据说明，记录到本文件
- [ ] 不接 CC BY-NC、无许可、扫描版教材、真题
- [ ] AI 内容必须标注“待校对”，并保留生成参数/时间
- [ ] 每次接入后跑 `knowledge_ingest.py --pack-only`、build/check/smoke/flow
