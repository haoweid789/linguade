# LinguaDE 3.0 升级计划

> 2.x 阶段已完成「三文件归一 → 模块化内核 → 元数据下沉」。3.0 的目标是在**不牺牲「零依赖、离线优先、单文件可分发」**底座的前提下，补齐 **AI 增强 / 工程化 / 上线部署** 三条战线。

---

## 一、2.5 后的基线（起点）

| 维度 | 现状 |
|---|---|
| 工程 | `linguade/`：`src/`（34 个脚本）+ `backend/` + `tools/` + `dist/` + `legacy/` |
| 内核 | `core/bus.js`（事件总线）、`registry.js`（注册表）、`ui.js`、`router.js` |
| 模块 | 17 个，元数据（group/icon/label/priority/order/ds）随模块文件走 |
| 加模块成本 | **写 1 个模块文件 + 跑 1 条 `python tools/build.py`**（脚本引用与排序自动同步） |
| 质量门 | `tools/check.py`（一致性）、`tools/smoke.mjs`（装配冒烟）、`build.py`（外链校验） |
| 产物 | `dist/index.html` 420KB，`file://` 零外部请求 |

---

## 二、3.0 总目标（四条战线）

- **A. 功能纵深**：算法与内容从「够用」做到「有说服力」
- **B. AI 增强**：华为云 MaaS 大模型 + 昇腾 Whisper 真正接入，且**不配置也能完整运行**
- **C. 工程化**：回归自动化、CI、版本发布、双形态产物（dev / dist）
- **D. 部署上线**：一台华为云 ECS 对外可访问

**不变的原则**：零运行时依赖、`file://` 可离线打开、localStorage 本地优先、后端始终可选。

---

## 三、里程碑

### 3.0.0 · 云端增强可用版
**目标**：AI 链路打通 + 质量门可用。

| 编号 | 任务 | 交付 / 验收 |
|---|---|---|
| A1 | `src/adapters/asr.js`：语音转写客户端（后端优先、浏览器 SpeechRecognition 兜底） | 口语测评/复述在「无后端」与「有后端」两条链路都能得分 |
| B1 | 后端接华为云 MaaS（OpenAI 兼容层） | 设置页填后端地址后，对话/纠错/面试走大模型 |
| B2 | 后端接昇腾 Whisper `/api/ai/speech/transcribe` | 上传录音返回转写文本，前端三维评分 |
| B3 | `/api/ai/chat` 支持 SSE 流式 | 对话逐字返回，超时可中断并降级本地规则引擎 |
| B4 | `/api/health` 前端可见（llm/asr/redis 状态徽标） | 首页标签如实反映链路状态 |
| C1 | `tests/` + Playwright：`flow` / `v06` / `v07` / `v08` 四套回归 | `npm run test` 全绿 |
| C2 | GitHub Actions（或等效）CI：build + check + smoke + e2e | 每次提交自动验证 |

**验收**：`python tools/build.py && python tools/check.py && node tools/smoke.mjs` 全绿；四套 e2e 全绿；大模型「配/不配」两模式功能等价。

### 3.1.0 · 算法与内容纵深
| 编号 | 任务 | 说明 |
|---|---|---|
| A2 | **FSRS 三参数**接入算法沙盘 | 沙盘由三方对比升级为 **HLR / SM-2 / Leitner / FSRS 四方对比** |
| A3 | 发音最小对立对专项（ü/u、ch 双读音、长短元音） | 口语测评新增题库与对错判定 |
| A4 | 方言听力 / 行业德语场景 | 扩 `src/data/corpus.js` 与听力题库 |
| A5 | 词库分级校对与扩充 | 社区可校对的数据格式说明 |
| C3 | 版本与发布 | 打 tag、生成 `dist` 单文件 + `CHANGELOG` |
| C4 | 体积与性能预算 | dist 大小告警阈值、首屏渲染耗时统计 |

**验收**：沙盘四方对比可复现（seeded PRNG）；新增专项模块均通过 check/smoke。

### 3.2.0 · 多端同步与发布
| 编号 | 任务 | 说明 |
|---|---|---|
| B5 | 后端数据同步完善（增量、冲突策略） | `open_id` 维度的同步与拉取 |
| B6 | PostgreSQL（RDS）与 Redis 切换 | 通过 `--env` 注入，默认仍 SQLite |
| D1 | 华为云 ECS 部署（auto-deploy） | 见第四节 |
| D2 | 演示环境与文档 | 公网可访问地址 + 部署手册 |

---

## 四、部署上线（auto-deploy）

- **形态**：静态前端（nginx）+ 可选后端（uvicorn）→ 属「前后端分离」，按 auto-deploy 要求走 **Docker Compose**。
- **命令骨架**：
  ```bash
  python scripts/auto_deploy.py --repo <linguade> --app-name linguade \
    --region cn-north-4 --flavor-tier small \
    --env LINGUADE_LLM_BASE_URL=... --env LINGUADE_LLM_API_KEY=... \
    --env LINGUADE_LLM_MODEL=... --env LINGUADE_ASR_BASE_URL=... --yes
  ```
- **边界（务必注意）**：auto-deploy **只创建单台 ECS**，**不创建** RDS / Redis / OBS；数据库与缓存需另行准备并经 `--env` 注入。
- **默认策略**：后端默认 `sqlite+aiosqlite`，**零外部依赖即可跑通演示**；需要多端同步时再切换 RDS for PostgreSQL + 华为云 Redis。
- **安全**：AK/SK 只从环境变量读；API Key 只存后端环境变量，不入库不入文件；SSH 端口默认仅放行控制机 IP。
- **清理**：`python scripts/destroy.py --workdir <terraform-workdir>`。

---

## 五、验收标准（3.0）

1. `dist/index.html` 在 `file://` 下：18 路由冒烟零 JS 错误、**零外部请求**；
2. `python tools/check.py`、`node tools/smoke.mjs`、Playwright 四套回归 **全部通过**；
3. 新增模块：**只改 1 个模块文件 + 1 条构建命令**，导航/首页自动出现；
4. 后端「不配置」时功能完整，「配置华为云 MaaS/Whisper」时 AI 链路生效并可观测；
5. `auto_deploy.py --plan-only` 产出可执行部署计划，且能一键部署到 ECS。

---

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| 引入 AI 依赖破坏「离线可用」卖点 | 三层降级（后端 → 直连 → 本地规则引擎），任何一步失败都不影响主流程 |
| Playwright 等开发依赖被误认为运行时依赖 | 明确写入 `README`：仅 devDependency，产物仍是零依赖单文件 |
| 华为云密钥泄露 | 只存后端环境变量；前端设置页仅用于「无后端」兜底，且本地保存 |
| auto-deploy 不建 RDS/Redis | 文档写清边界；默认 SQLite，先跑通再升级 |
| 沙盘四方对比引入随机性争议 | 固定 seeded PRNG，可复现 |

---

## 七、非目标（3.0 明确不做）

- 不引入 React/Vue/webpack 等重型框架；
- 不改动 17 个模块的既有业务逻辑（只做增强）；
- 不做多节点 / 集群 / K8s（auto-deploy 亦不支持）；
- 不手工维护 `dist/index.html`（永远由 `build.py` 产出）。

---

## 八、建议执行顺序

```
3.0.0：C1/C2 质量基建  →  A1/B1/B2 AI 链路  →  B3/B4 体验与可观测
3.1.0：A2 FSRS 四方对比  →  A3/A4 内容纵深  →  C3/C4 发布与预算
3.2.0：B5/B6 同步与存储  →  D1/D2 部署与演示
```