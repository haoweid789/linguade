# 词库 Part 11 · 德语词汇资料包 v4 合并（2026-11-12）

## 结果

| 项目 | 数值 |
|---|---:|
| 合并前词库 | 5906 |
| 新增词条 | **517** |
| 合并后词库 | **6423** |
| 新增词条例句覆盖 | 517/517（德语 + 中文） |
| 词库总量体检 | 例句 6423/6423，繁体释义 0，重复词形 0 |
| 机器词条 | 5851（人工词条仍为 572） |

新增词性分布：名词 322 / 动词 89 / 形容词 56 / 副词 22 / 介词 14 / 代词 10 / 数词 2 / 连词 2。

新增分级：C2 307 / C1 170 / B2 24 / A1 14 / A2 1 / B1 1。A1–B1 来自 Goethe 官方词表；其余 B2–C2 按字幕词频派生，**不是官方 CEFR 认定**。

## 8000 行是怎么变成 517 条的

1. **词形归一**：词包是字幕词频表，8000 行里大量是同一词元的屈折形式（ist/war/denke/letzte/gefunden…）。按「词包括号标注 → kaikki 词形表 → 考试库词形表 → spaCy」归并为 5430 个词元。
2. **去重**：其中 3360 个词元已存在于原 5906 词词库，不重复加入。
3. **质量过滤**：剔除人名/地名、OCR 噪音（lch/lhr/nem/lst 等）、纯英文词、感叹词/填充词、粗口/性描写、纯功能词、词性或性别无法确认的词元，以及无法归一的残句。
4. **人工复核**：对保留词元逐条修正词性、名词性别、大小写与中文释义；释义统一转简体。
5. **补例句**：优先从本地 Tatoeba 德中句对与考试库句子池取句；配不到的 261 条人工编写例句与中文；另有约 40 条词典例句因词义/词形不匹配被替换为人工句。

> 因此「8000 词」并没有变成 8000 张卡片：归并后真正的新词元是 517 个，其余要么是已有词的变形，要么是不适合进学习词库的条目。这一取舍对应需求中的「词形归一」。

## 实现

- 源数据：`tools/data/vocab_pack_v4.json`（517 条定稿；来自资料包 v4 的 8000 行归并结果）
- 生成器：`tools/import_vocab_pack.py` → `src/data/lexicon-11.js`
- 挂载：`index.html` 新增 `lexicon-11.js`；`tools/content_export.mjs` 的词库清单加入 Part 11
- 配套：`tools/lexicon_audit.py`、`tools/review_batch.py`、`tools/review_worklist.py` 的机器词条清单同步加入 `lexicon-11.js`
- 重新生成：`python tools/import_vocab_pack.py && node tools/content_export.mjs`

## 自检记录（实际执行）

| 命令 | 结果 |
|---|---|
| `python tools/import_vocab_pack.py` | 已写 `src/data/lexicon-11.js`：517 条 |
| `node tools/content_export.mjs` | 导出完成：6423 词；`lexicon-11.js: 517 条` |
| `node tools/content_lint.mjs` | `lint: 6423 词 \| errors=0 warnings=0` |
| `python tools/lexicon_audit.py` | 6423 词；例句 6423 有 / 0 空；繁体 0；重复词形 0 组 |
| `python tools/review_worklist.py` | 词库 6423 词（人工 572 / 机器 5851）· 缺例句 0 · 缺例句中文 0 |
| `python tools/test_content.py` | 校验通过：内容包 schema / 授权字段 / 题型完整性 / 词库红线 全部一致 |
| `python tools/check.py` | 校验通过（`tools/build.py` 同步模块脚本段后） |
| `python tools/build.py` | 单文件 2.70 MB；产物无外部资源引用（超过 2.6 MB 软上限，工具仅提醒） |
| `python -m pytest tests/flow_v22.py tests/flow_v21.py::test_review_worklist_tool_runs -q` | 4 passed |
| `python -m pytest tests/flow_v18.py tests/flow_v21.py -q` | flow_v18 全过；flow_v21 仅 `test_home_banners_dismissible_for_today` 失败 |

**既有问题说明**：`flow_v21::test_home_banners_dismissible_for_today`（`#backupBanner` 未出现）在未做本改动的 HEAD `e3e54cb` 上同样失败，与本批词库无关，未在本任务中处理。

## 已知边界

- 新增 517 条在 UI 中按机器词条标注（`LD_LEX_MACHINE`），属于「机器对齐 · 待抽检」；其中人工复核过的词性/释义仍需后续抽检。
- B2–C2 分级来自字幕词频，不是官方 CEFR；正式考试请以官方词表为准。
- 词包音频（8000 条 piper 单词发音）本批未接入；如需使用，建议按 `冠词 + 名词` 重新合成后单独接入发音通道。

## 许可证

本文件数据衍生自：

- FrequencyWords 德语字幕词频（CC BY-SA 4.0）
- kaikki.org / Wiktionary German（CC BY-SA 3.0）
- Goethe-Institut A1/A2/B1 公开词表
- Tatoeba 德中句对（CC BY 2.0 FR）

按 CC BY-SA 3.0 / 4.0 的署名与相同方式共享要求使用。
