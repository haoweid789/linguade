# 2000 词例句补齐报告

> 生成时间：2026-10-29
> 范围：`src/data/lexicon-9.js` 的 1428 条机器对齐扩展词。

## 覆盖

| 来源 | 条数 | 说明 |
|---|---|---|
| Tatoeba 德中句对（CC BY 2.0 FR） | 291 | 德语例句 + 中文翻译 |
| Wiktionary/kaikki 德语例句（CC BY-SA 3.0） | 379 | 只有德语例句，中文留空 |
| 暂无例句 | 758 | 不伪造，留空待补 |
| **合计** | **1428** | |

## 边界

- 例句优先选 4–20 词、无 HTML/URL 的句子；Tatoeba 例句保留中文，Wiktionary 例句不伪造中文翻译。
- 例句匹配使用词形/词干启发式，可能有个别例句不是目标词的原形；单词卡仍标注“机器对齐 · 待校对”。
- 未直接抓取明镜/时代/每日新闻等版权报纸；如需新闻语料，走 Wikinews（CC BY 2.5）或维基百科（CC BY-SA）管线。

## 复跑

```bash
python tools/knowledge_ingest.py --all --target 12000
python tools/examples_build.py
```
