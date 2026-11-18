# LinguaDE 3.0.0 · 详细任务清单（待确认）

> 范围：AI 链路打通（含真正三层降级）+ 质量基建。不含内容/算法纵深（归 3.1.0）、不含部署（归 3.2.0）。

## 一、关键现状（决定工作量）

| 事实 | 影响 |
|---|---|
| `src/llm.js` 只用 `cfg.apiBase/apiKey` 直连 LLM，**完全没用 `cfg.backend`** | 后端 `/api/ai/*` 是「已写好但未接线」；三层降级名不副实 |
| `src/modules/speech.js` 用浏览器 `SpeechRecognition`，失败转手动录入，**无录音上传** | 后端 `/api/ai/speech/transcribe` + `asr.py` 无人调用 |
| 后端 `ai.py / asr.py / cache.py / config.py` 已齐备 | 后端仅需「加流式端点」，其余为前端接线 |
| 现有质量门：`check.py` / `smoke.mjs` / `build.py` 外链校验 | 缺「真实浏览器交互」层回归 |

---

## 二、任务清单

### C 组 · 质量基建（建议最先做）

| 编号 | 任务 | 新增/修改文件 | 验收 |
|---|---|---|---|
| C1 | 四套 Playwright 回归（Python，与 README 一致） | 新增 `tests/flow.py`、`tests/flow_v06.py`、`tests/flow_v07.py`、`tests/flow_v08.py`、`tests/conftest.py`、`tests/requirements-dev.txt` | 33 项全绿（9+8+6+10） |
| C2 | 本地 mock 后端（供 e2e 用，不依赖华为云） | 新增 `tools/mock_backend.py`（FastAPI/`http.server`，实现 `/api/health`、`/api/ai/correct\|chat\|speech-transcribe\|interview-evaluate`） | 无凭证也能跑通 AI 链路的 e2e |
| C3 | CI | 新增 `.github/workflows/ci.yml` | push 时自动跑 build + check + smoke + e2e |
| C4 | 回归入口脚本 | 新增 `tools/test.ps1`（或 `Makefile`） | 一条命令跑全部质量门 |

### A 组 · 语音链路（ASR）

| 编号 | 任务 | 新增/修改文件 | 验收 |
|---|---|---|---|
| A1 | 语音转写适配层 `LD.ASR` | 新增 `src/adapters/asr.js` | `LD.ASR.ready()` / `LD.ASR.transcribe(blob, fmt)` |
| A2 | 口语测评接入后端转写 | 修改 `src/modules/speech.js` | 优先「后端 Whisper」，回退「浏览器识别」，再回退「手动录入」；UI 标注当前通道 |
| A3 | `index.html` 引入 adapters | 修改 `index.html`（在 `src/main.js` 前加 2 行 `<script>`） | 产物仍零外链 |

### B 组 · LLM 接线与可观测

| 编号 | 任务 | 新增/修改文件 | 验收 |
|---|---|---|---|
| B1 | 后端调用适配层 `LD.Backend` | 新增 `src/adapters/backend.js`（`ready/correct/chat/interviewEvaluate/health`） | 后端不可达时抛错被上层捕获 |
| B2 | `llm.js` 改为真正三层降级 | 修改 `src/llm.js`（`correct`/`reply`/`evaluateInterview`：**后端 → 直连 LLM → 本地规则**） | 三态可切换，任一失败不阻塞主流程 |
| B3 | 后端流式对话端点 | 修改 `backend/app/ai.py`（新增 `POST /api/ai/chat/stream`，SSE） | `curl` 可见逐块输出 |
| B4 | 对话流式渲染 | 修改 `src/modules/chat.js`（可选：先非流式，再做增量） | 逐字出现，可中断并降级 |
| B5 | 链路可观测 | 修改 `src/core/ui.js`（设置抽屉顶部显示 `/api/health` 的 llm/asr/redis 状态徽标） | 配/不配后端时状态如实显示 |

### D 组 · 文档与收尾

| 编号 | 任务 | 新增/修改文件 | 验收 |
|---|---|---|---|
| D1 | README 更新（新目录 / 命令 / 加模块流程 / 双形态产物） | 修改 `README.md` | 与工程实际一致 |
| D2 | 版本号与 CHANGELOG | 新增 `CHANGELOG.md`；`backend/app/main.py` 版本号 → `3.0.0` | — |

---

## 三、依赖顺序

```
C1/C2/C3/C4（安全网先行）
   ↓
A1 → A2 → A3        （语音：适配层 → 模块 → 引入）
   ↓
B1 → B2 → B5        （LLM 接线：适配层 → 降级 → 可观测）
   ↓
B3 → B4             （流式，独立可后置）
   ↓
D1/D2（收尾）
```

---

## 四、关键约束与风险

| 事项 | 说明 |
|---|---|
| **录音在 `file://` 下不可用** | `getUserMedia` 仅在 `https` / `localhost` 可用。因此「后端 Whisper 转写」只在 http 服务或部署后可用；`file://` 单文件版仍走浏览器识别/手动录入（功能不缺失，只是通道不同） |
| **真实华为云凭证** | 端到端验证依赖 MaaS 与昇腾 Whisper；CI 与本地回归一律走 `tools/mock_backend.py`，不依赖云 |
| **Playwright 安装** | 需 `pip install -r tests/requirements-dev.txt` + `playwright install chromium`（仅开发依赖，**不进入运行时产物**） |
| **保持零依赖底线** | 所有新增依赖仅限 dev/test；`dist/index.html` 仍须零外部请求、`file://` 可开 |
| **接口契约** | 前端 `LD.Backend` 与后端 `/api/ai/*` 的字段需对齐（`schemas.py` 为真源），改动前先核对 |

---

## 五、验收标准（3.0.0 完成时）

1. `python tools/build.py && python tools/check.py && node tools/smoke.mjs` 全绿；
2. 四套 Playwright 回归全绿，且**不依赖任何云凭证**；
3. 后端「未配置」→ 直连 LLM「未配置」→ 本地规则引擎，三级降级逐级可用；
4. 配置后端（mock 或真实）后，纠错/对话/面试/语音转写四条链路都被真实调用（可在浏览器 Network 面板或后端日志中观察）；
5. `/api/health` 状态在前端如实可见；
6. `dist/index.html` 仍为单一文件、零外部请求、`file://` 可打开。