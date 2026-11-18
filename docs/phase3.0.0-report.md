# 3.0.0 实施报告 · AI 链路打通 + 质量基建

> 状态：**已完成并通过全部质量门**（一键 `tools/test.ps1` 退出码 0，e2e 37 项全绿）。

## 一、交付清单

### C 组 · 质量基建

| 交付 | 文件 |
| --- | --- |
| 四套 e2e（37 项：flow 9 / v06 8 / v07 6 / v08 10 / v09 4） | `tests/`（`conftest.py` + 5 个 `flow*.py` + `pytest.ini` + `requirements-dev.txt`） |
| 零依赖 mock 后端（e2e 不依赖任何云凭证） | `tools/mock_backend.py`（含 SSE chunked 流式） |
| 一键质量门 | `tools/test.ps1` |
| CI | `.github/workflows/ci.yml` |

### A 组 · 语音链路

| 交付 | 文件 |
| --- | --- |
| 语音转写适配层（后端 Whisper / 浏览器识别 / 手动 三通道） | 新增 `src/adapters/asr.js`（`LD.ASR`） |
| 口语测评接入后端转写，UI 标注当前通道 | 修改 `src/modules/speech.js` |

### B 组 · LLM 接线与可观测

| 交付 | 文件 |
| --- | --- |
| 后端客户端（health / correct / chat / chatStream / interviewEvaluate / transcribe / sync） | 新增 `src/adapters/backend.js`（`LD.Backend`） |
| **三层降级**：后端 → 直连大模型 → 本地规则 | 修改 `src/llm.js`（`correct` / `reply` / `evaluateInterview`，新增 `aiReady` / `backendReady`） |
| SSE 流式对话端点 | 修改 `backend/app/ai.py`（`POST /api/ai/chat/stream`）+ `backend/app/llm.py`（`chat_stream`） |
| 对话流式增量渲染 + 失败降级 | 修改 `src/modules/chat.js` |
| 链路状态徽标（后端 / 大模型 / 语音 / Redis） | 修改 `src/core/ui.js` |

### D 组 · 文档

`README.md` 重写、`CHANGELOG.md` 新增、后端版本号 → **3.0.0**。

## 二、过程中修复的真实缺陷

| # | 缺陷 | 发现方式 |
| --- | --- | --- |
| 1 | 模块注册行误用 `LD.define(...)`（模块内并无局部 `LD`，统一用 `window.LD`）→ 运行时 `ReferenceError` | **装配冒烟**（`node --check` 与文本校验均无法发现） |
| 2 | 模块脚本排序误匹配模块内联 CSS 的 `order:` 属性 → 顺序错乱 | 构建产物顺序核对 |
| 3 | mock 的 SSE 未用 `Transfer-Encoding: chunked`（HTTP/1.1 下流无法正常结束）→ 前端只收到部分增量 | e2e 失败定位 |
| 4 | 此前前端**根本没接后端**（三层降级名不副实）、语音**没走 ASR** | 现状核对 |

## 三、验证结果（一键质量门）

```
1/4 构建         → dist/index.html 433KB，产物零外部请求
2/4 一致性校验   → 模块 17/17/17，脚本顺序一致，外链 0，闭合配对
3/4 装配冒烟     → 35 个内联脚本按序执行零错误，注册表自检 0/0/0
4/4 e2e 回归     → 37 项全绿（含 HLR 公式浏览器内实测、沙盘可复现、AI 链路真走后端）

```

另：`node --check` 对全部前端脚本 0 语法错误；后端 `.py` 编译通过。

## 四、已知边界

-   **`file://` 下录音不可用**（`getUserMedia` 限制）：单文件离线版语音走「浏览器识别 / 手动」通道，功能不缺失；后端 Whisper 通道需 `http(s)`；
-   **真实云服务**：端到端仅用 mock 验证；华为云 MaaS 与昇腾 Whisper 需真实凭证才能线上验真；
-   e2e 依赖 dev 依赖（playwright / pytest），**不进入运行时产物**。

## 五、下一步

-   **3.1.0**：FSRS 三参数进沙盘（四方对比）、发音最小对立对、方言听力、行业德语；
-   **3.2.0**：后端同步完善（RDS/Redis 切换）+ 华为云 ECS 部署上线（auto-deploy，Docker Compose 形态）。