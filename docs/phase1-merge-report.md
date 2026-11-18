# Phase 1 · 工程合流报告

> 目标：把三份 HTML 归一为一个模块化工程，`dist` 只由构建产出，旧版归档比对。

## 一、血缘判定（合流依据）

| 文件 | 版本 | 模块数 | 处理 |
|---|---|---|---|
| `LinguaDE-德语自适应学习陪伴系统.html`（根目录 295KB） | v0.x 单文件 | 14 | 归档 → `legacy/LinguaDE-v0.html` |
| `lingo-de-v3/lingo-de/index.html`（18KB） | v3 源码入口 | 17 | **唯一真源** → `linguade/index.html` + `src/` |
| `lingo-de-v3/lingo-de/dist/index.html`（427KB） | v3 构建产物 | 17 | 不再直接维护，改由构建生成 |

**模块差异比对结论**（正则提取 `window.LD.Modules.<key> =`）：

- legacy 独有模块：**无**
- v3 独有模块：`reading`、`sandbox`、`weak`

⇒ v3 是旧版的**严格超集**，合流无内容遗失风险。

## 二、工程结构（Phase 1 后）

```
linguade/
├── index.html          # v3 源码入口（外链改为 src/**，移除平台注入脚本）
├── src/                # 前端源码（原 app/**，零依赖原生 JS）
│   ├── data/  modules/  store.js engine.js llm.js charts.js main.js styles.css
├── backend/            # FastAPI 后端（原样迁入）
├── tools/build.py      # 打包脚本（ROOT 改为工程根 + 新增外链校验）
├── dist/index.html     # 构建产物（不再手工编辑）
├── legacy/LinguaDE-v0.html
└── docs/phase1-merge-report.md
```

## 三、本阶段改动清单

1. 新建 `linguade/`，v3 源码迁入（`app/` → `src/`，`build.py` → `tools/`）。
2. `index.html` 中 22 处外链由 `app/` 改为 `src/`。
3. 移除平台注入的 `/page/page_comm/inject.js`（否则 `file://` 下产生外部请求）。
4. `tools/build.py`：`ROOT` 上溯一级；新增产物**外链残留校验**。
5. 旧单文件归档到 `legacy/`。

## 四、验证结果

| 项 | 结果 |
|---|---|
| 构建 | `python tools/build.py` → 418 KB，可复现 |
| 外链残留 | **0**（构建脚本自校验通过） |
| `<script>` 开/闭配对 | 29 / 29 |
| 模块完整性 | dist 内含全部 **17** 个模块 |
| 模块差异 | legacy 无独有；v3 新增 reading/sandbox/weak |

## 五、已知边界（留待 Phase 2）

- 依赖仍是**隐式顺序**（`index.html` 脚本顺序 = 依赖顺序），尚未引入注册表；
- 路由/导航仍**双维护**（`index.html` nav + `main.js` HOME.mod）；
- 跨模块事件仍用散落的 `window.addEventListener("ld:xxx")`；
- `tools/check.py`（注册/导航一致性校验）尚未创建。

## 六、Phase 2 入口

落地 `core/registry.js`、`core/bus.js`、`core/router.js`，把 17 个模块从
`window.LD.Modules.x = Mod` 迁移到 `LD.define(name, {...})`，导航改为注册表渲染，
并补齐 `tools/check.py`。验收：新增模块只需改 1 个文件，且回归全绿。