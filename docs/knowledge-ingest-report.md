# 开放知识库接入报告 · Tatoeba 德中双语

> 生成时间：2026-11-01 18:11:52 · 来源：Tatoeba · 许可：CC BY 2.0 FR
> 用途：为 AI 出题提供开放语料 grounding；条目保留 Tatoeba 句 ID、原文链接与许可。

## 数量与等级分布

| 等级 | 条数 |
|---|---|
| A2 | 228 |
| B1 | 203 |
| B2 | 186 |
| C1 | 120 |
| C2 | 87 |
| **合计** | **824** |

## 来源与许可

- Tatoeba 德语句与其中文翻译：CC BY 2.0 FR；每条带 `https://tatoeba.org/de/sentences/show/<id>`。
- 频率表：hermitdave/FrequencyWords（CC BY-SA 4.0），仅用于等级估计，不随包分发。
- 不使用歌德/TestDaF 真题、CC BY-NC 词表或来源不明的爬取题库。

## 刷新

```bash
python tools/knowledge_ingest.py --all --target 160
python tools/knowledge_ingest.py --all --target 400   # 增量，seen 去重
```

## 已知边界

- 句对是句子级语料，不是完整文章；阅读长文仍由 Wikipedia 阅读管线提供。
- 等级为频率启发式估计，不是官方 CEFR 标注。
- AI 生成题目必须另行校验，不能把开放语料原句直接当考试题。
