# LinguaDE · 人工复核工作清单

> 由 `python tools/review_worklist.py --write` 生成；机器只负责把债列清楚，判断留给人。
> 每完成一项就在对应复选框打勾，复跑本工具会按最新数据重排优先级。

## A. 例句（词库 5906 词）

- 无任何例句：**0** 条 → 目标补到 5906 条全覆盖
- 有德语句但缺中文对照：**0** 条

<details><summary>缺例句词条（前 40 条）</summary>

_（无）_

</details>

## B. 词形原形缺失（三重闸门拒绝标注，0 条）

这些词词典标了复数/过去分词，但原形不在当前词库，所以本轮**不标注**。
补录方式二选一：把原形作为新词条加进词库，或放弃标注（保持现状）。

<details><summary>词形 → 需要的原形</summary>

_（无）_

</details>

## C. 机器对齐词条抽检（5334 条，本轮抽 30 条）

等级为词频估计，非官方 CEFR；释义来自 ECDICT / kaikki 对齐，需人工确认「词性 + 释义 + 例句」三件套。

<details><summary>抽检样本</summary>

| 德语 | 冠词 | 中文 | 词性 | 等级 |
|---|---|---|---|---|
| ab | - | 从…起 | prep | A1 |
| Film | der | 电影 | n | A1 |
| nur | - | 只；仅仅 | adv | A1 |
| anders | - | 不同地；另外 | adv | A2 |
| lassen | - | 允许 | v | A2 |
| vorbei | - | 经过；结束 | adv | A2 |
| Begründung | die | 理由 | n | B1 |
| entschlossen | - | 坚决的；果断的 | adj | B1 |
| Grund | der | 原因 | n | B1 |
| Lehrstelle | die | 学徒岗位 | n | B1 |
| Praktikantin | die | 女实习生 | n | B1 |
| steil | - | 陡的 | adj | B1 |
| voraussichtlich | - | 预期的 | adj | B1 |
| beeindrucken | - | 留下深刻印象 | v | B2 |
| Königin | die | 女王 | n | B2 |
| wissenschaftlich | - | 科学的 | adj | B2 |
| erforschen | - | 探索 | v | C1 |
| mähen | - | 割草 | v | C1 |
| verfügbar | - | 可用的 | adj | C1 |
| brillant | - | 杰出的 | adj | C2 |
| keinesfalls | - | 绝不 | adv | C2 |
| schnurren | - | 发出呼噜声 | v | C2 |
| zynisch | - | 愤世嫉俗的 | adj | C2 |
| College | das | 学院 | n | A2 |
| Trottel | der | 白痴 | n | B1 |
| Krebs | der | 癌症 | n | B1 |
| Fluch | der | 诅咒 | n | B1 |
| Junior | der | 年轻人 | n | B2 |
| Sammlung | die | 收藏 | n | B2 |
| Spinne | die | 蜘蛛 | n | B2 |

</details>

## D. 阅读考试化改写（86 篇）

- 缺中文主题导语：**0** 篇
- 题目偏少（≤3 题，不够一场考试）：**0** 篇
- 改写口径：TestDaF 三段式（段落配小标题 + 判断正误 + 细节选择），按建议用时限时

最长 12 篇（优先做成限时套题）：

- `wiki-regen`：821 词 · 6 题 · 建议 12 分钟
- `wiki-goethe-institut`：675 词 · 6 题 · 建议 11 分钟
- `wiki-fuball-in-deutschland`：658 词 · 6 题 · 建议 10 分钟
- `wiki-schule`：621 词 · 6 题 · 建议 10 分钟
- `wiki-bank`：613 词 · 6 题 · 建议 10 分钟
- `wiki-klimawandel`：605 词 · 6 题 · 建议 10 分钟
- `wiki-klima-in-deutschland`：602 词 · 6 题 · 建议 10 分钟
- `wiki-wasserstoff`：594 词 · 6 题 · 建议 10 分钟
- `wiki-fruhstuck`：587 词 · 6 题 · 建议 10 分钟
- `wiki-weihnachten`：585 词 · 6 题 · 建议 10 分钟
- `wiki-umwelt`：580 词 · 6 题 · 建议 10 分钟
- `wiki-sonne`：573 词 · 6 题 · 建议 10 分钟

## E. 真人录音覆盖（80 条本地 / 跟读池 380 句 = 21.1%）

- 打进单文件（离线可播）：**24** 条，其余走 `dist/audio/` 按需播放
- 补齐：`python tools/fetch_audio.py --write --fetch --limit 160` 后再 `python tools/build.py`

## 扩容目标（例句 / 人工词条）

| 项 | 当前 | 目标 | 缺口 |
|---|---|---|---|
| 人工校订词条 | 572 | 1200 | 628 |
| 词条带例句 | 5906 | 5906 | 0 |
| 阅读带导语 | 86 | 86 | 0 |
| 真人录音句 | 80 | 300 | 220 |

- 人工词条只能逐条写：`src/data/lexicon-1..8.js` 里按现有 7 字段格式追加，然后跑
  `python tools/lexicon_govern.py --write && python tools/test_content.py && python tools/build.py`。
- 治理脚本不会覆盖人工区（`MACHINE_START` 之前），也不会替你造例句：查不到可靠例句就留空。
