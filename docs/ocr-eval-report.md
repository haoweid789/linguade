# LinguaDE · OCR / HTR 评测报告

> 由 `tools/ocr_eval.py` 生成 · 指标：CER（字符错误率）、WER（词错误率）

## 一、配置

| 项 | 值 |
|---|---|
| 识别通道 | `mock` |
| 样本数 | 6 |
| 注入噪声率 | 0.1 |
| 随机种子 | 42 |

## 二、汇总

| 指标 | 值 |
|---|---|
| 平均 CER | **0.106**（10.6%） |
| 平均 WER | **0.594**（59.4%） |
| 完全正确样本 | 0 / 6 |

## 三、逐样本结果

| # | 图片 | CER | WER | 置信度 | 参考文本 | 识别文本 |
|---|---|---|---|---|---|---|
| 1 | s1.png | 0.120 | 0.714 |  | Ich habe gestern einen interessanten Film gesehen. | Ich hbne gesten einen interessanteb Fil gesehe. |
| 2 | s2.png | 0.100 | 0.667 |  | Obwohl das Wetter schlecht war, sind wir spazieren gegangen. | Obohl das Wetter schlecht warw slnd wia spaziere ggangen. |
| 3 | s3.png | 0.088 | 0.625 |  | Meine Freundin möchte nächstes Jahr in München studieren. | Mine Freundin möchte nähwtes Jahr inMünchen studiere. |
| 4 | s4.png | 0.113 | 0.556 |  | Können Sie mir bitte erklären, wie die Anmeldung funktioniert? | nne Sie mir biite edklären, wie die Anmelrung funktoniert? |
| 5 | s5.png | 0.091 | 0.400 |  | Der Prüfling hat die Aufgabe innerhalb von zwanzig Minuten gelöst. | Derrüflsng hat die Aufgabe ennerhalb wob zwanzig Minuten gelöst. |
| 6 | s6.png | 0.122 | 0.600 |  | Für die Bewerbung brauche ich ein APS-Zertifikat und einen Sprachnachweis. | Fcrid e Bewerung brauche ich eim APS-Zerhifiat und einen Spraühnachweks. |

## 四、最差样例（Top 3，用于定位薄弱环节）

- `s6.png`  CER=0.122
  - 参考：Für die Bewerbung brauche ich ein APS-Zertifikat und einen Sprachnachweis.
  - 识别：Fcrid e Bewerung brauche ich eim APS-Zerhifiat und einen Spraühnachweks.
- `s1.png`  CER=0.120
  - 参考：Ich habe gestern einen interessanten Film gesehen.
  - 识别：Ich hbne gesten einen interessanteb Fil gesehe.
- `s4.png`  CER=0.113
  - 参考：Können Sie mir bitte erklären, wie die Anmeldung funktioniert?
  - 识别：nne Sie mir biite edklären, wie die Anmelrung funktoniert?

## 五、如何解读与使用

- **mock 通道**的数字只用于验证评测脚本自身（CER 应接近注入噪声率），**不代表模型能力**；
- 真实基线需在配置凭证后运行：`--channel backend`（自建后端）或 `--channel api`（直连视觉模型）；
- 建议对照口径：现代学习者手写德语，VLM 级模型 CER 约 10% 量级；印刷体练习册应显著更低；
- 接入前请用同一批样本跑多通道对比（视觉 LLM / 华为云 OCR / TrOCR），再决定产品链路。
