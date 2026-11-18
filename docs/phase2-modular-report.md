# Phase 2 · 模块化重构报告

> 目标：消除隐式依赖、双维护与散落事件，让「加一个模块」变成一件安全、可校验的事。

## 一、交付物

| 新增/改动 | 说明 |
|---|---|
| `src/core/bus.js` | 事件总线 + 集中事件名常量（`LD.EVENTS`），底层仍是原生 `CustomEvent`，历史 `ld:*` 监听完全兼容 |
| `src/core/registry.js` | 模块注册表：`LD.define / moduleList / modulesByGroup / validateModules` |
| `src/core/manifest.js` | 17 个模块的元数据**单点真源**（分组 / 图标 / 名称 / 优先级 / 简介 / 角标） |
| `src/core/ui.js` | 从 main.js 抽出：toast / 顶栏状态 / 设置抽屉 / 外壳事件 |
| `src/core/router.js` | 路由分发 + **侧栏导航渲染** + 首页（总览），导航与首页均来自注册表 |
| `src/main.js` | 由 19.5KB 逻辑文件瘦身为 1.9KB 纯启动器 |
| `src/modules/*.js` ×17 | 注册行统一为 `LD.define("x", Mod)` |
| `index.html` | 移除静态导航（改由注册表渲染），引入 core 脚本层 |
| `tools/check.py` | 一致性校验：注册 / 清单 / index 脚本 / 外链 / 脚本闭合 |

## 二、模块契约

```js
LD.define("weak", { title, desc, render(host, ctx) });   // 注册渲染器
// 元数据集中在 core/manifest.js：
//   weak: { label:"弱点突破", icon:"⚔", group:"学习闭环", priority:"P0", ds:"…" }
// 导航与首页由 LD.modulesByGroup() 自动生成
```

- 依赖由**显式脚本顺序**保证，启动时 `LD.validateModules()` 自检并告警；
- 事件统一走 `LD.bus.on/emit`，事件名集中为 `LD.EVENTS.*`；
- 模块之间不互相引用，只经 `LD.Store / LD.Engine / LD.LLM / LD.Charts / LD.bus`。

## 三、「加一个模块」流程对比

| | 重构前 | 重构后 |
|---|---|---|
| 改动点 | ① index.html 加 `<script>` ② 手写 nav 项 ③ main.js HOME.mods 加一条 ④ 模块内 `window.LD.Modules.x = Mod` | ① 写 `src/modules/x.js`（`LD.define`）② `core/manifest.js` 加一条 ③ index.html 加一个 `<script>` |
| 遗漏风险 | 无任何校验，漏一处即静默失效 | `python tools/check.py` **强制三方一致**，漏任一处立即报错 |
| 分组/顺序 | 需同时改 nav 与 HOME | 只改 manifest 一处 |

## 四、验证结果

- `python tools/check.py`：**通过**（模块文件 17 · LD.define 17 · manifest 17 三方一致；外链 0；脚本开闭 29/29）。
- **负向测试**：临时放入未注册的 `_probe.js` → 校验立即报出 3 条不一致并返回码 1；移除后恢复通过。校验器有效。
- `node --check`：**34 个前端脚本 0 语法错误**。
- `python tools/build.py` → `dist/index.html` 419KB，产物自校验「无任何外部资源引用」。

## 五、顺带修复的真实缺陷

- 原来「侧栏导航分组」与「首页模块分组」**不一致**（nav 曾把 `drill/listening/reading/writing/syntax` 错归「智能内核」）。现统一到 `manifest.js` 的分组，二者永远一致。

## 六、遗留（未做运行时浏览器回归）

重构只做了**静态一致性 + 语法级**验证；`file://` 下 18 路由的实际渲染与交互冒烟尚未执行（建议下一步在浏览器里实测一遍）。

## 七、可选增强（Phase 2.5，按需）

把元数据**下沉到模块文件本身**（`LD.define("x", { group, icon, label, priority, ds, render })`），
再让 `tools/build.py` 自动扫描 `src/modules/` 注入脚本，即可把「加模块」压缩到**只改 1 个文件**。