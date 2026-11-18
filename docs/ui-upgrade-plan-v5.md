# LinguaDE 全站 UI 升级方案（设计系统 v4 → v5）

> 2026-11-04 · 基于 ui-ux-pro-max 技能检索 + 3.17.0 长期使用报告 + 现网截图（ui-study/after-*）+ `src/styles.css`（782 行）全文审读
> 适用版本基线：3.18.8 · 交付物是方案，未经确认不直接改码

---

## 〇、结论先行

**v4 不需要重设计，需要纵深。** 90 天报告给视觉设计打了 8.5/10（"组件一致、留白克制、深浅色都干净"），3.18.0 已把小字下限、触摸目标、键盘可达的 P0 全部修复。这个底子扔掉换风格是负资产。

v5 的主张一句话：**把"纸面印刷品"这个隐喻做完整** —— v4 有了纸（纸色底、发丝线、单一主色），但缺铅字（衬线展示字体）、缺墨色层次（浮层投影纪律）、缺翻页的手感（动效令牌）。六条升级轨按感知收益排序：

| 轨 | 内容 | 感知收益 | 工作量 |
|---|---|---|---|
| T1 | 排印三栈（真实 Inter + 德语衬线展示 + 音标 mono） | ★★★★★ | 中 |
| T2 | 动效令牌 + 页面转场 | ★★★★ | 小 |
| T3 | 浮层投影纪律（elevation 三档） | ★★★ | 小 |
| T4 | emoji 图标 → SVG 全量替换 | ★★★ | 小 |
| T5 | 组件精修（词卡舞台 / 图表色带 / 顶栏） | ★★★ | 中 |
| T6 | 可达性收尾 + landing 对齐 | ★★ | 小 |

**P0 = T1+T2+T3+T4，一个版本发完**（全是 CSS/静态资源层，不碰模块逻辑，对 135 项 flow tests 零风险）；T5、T6 进 P1/P2。

---

## 一、检索过程与取舍（透明度声明）

`--design-system` 聚合检索跑了两次均不匹配（"education"→ 儿童向 Claymorphism + 紫色系；"calm productivity"→ 拟物 Neumorphism + 紫色系），**按技能规则不采纳、不落盘**。改用定向域检索，采纳情况：

| 域 | 结果 | 采纳 |
|---|---|---|
| style | Minimalism & Swiss Style（单色主色、无影、网格、低动效） | ✅ 验证了 v4 现有基因，继续走深 |
| color | LMS 蓝绿/琥珀、Language-Learning 靛蓝 | ❌ 换色即丢弃墨蓝+金的品牌资产，拒绝 |
| typography | "Inter + 衬线 display + JetBrains Mono 标签"三栈（Bold Typography Mobile） | ✅ 采纳并改造：衬线给德语词展示而非标题 |
| gsap | Page Transition Subtle 档（出 200ms / 入 200ms，exit 恒快于 enter） | ✅ 采纳节奏，但用 vanilla CSS 实现（零依赖原则，不引 GSAP） |
| ux | 进度指示 / 空态 / 活动态 / 深链 | ◑ 空态、活动态 v4 已达标；深链（hash 路由）列入 T6 可选项 |

## 二、定位与不变项

- **产品**：成人德语备考工具（TestDaF/DSH/Telc/歌德），中国学生，日均 30–50 分钟，桌面 + 手机，离线优先，单文件 2.26MB。
- **气质关键词**：纸感学术 · 克制 · 可信 · 考场般的安静。
- **不变项**（v5 不动）：墨蓝 `#2c3a55` + 德意志金 `#b08430` 双色基因、纸色底、发丝线分隔、深浅双主题、12px 小字下限、40px 触摸目标、`prefers-reduced-motion` 全局兜底、零外部请求。

---

## 三、六条升级轨

### T1 · 排印三栈（本次升级的核心）

**现状问题**：`styles.css` 的 `font-family` 把 `Inter` 排在第一位，但全站**没有任何 `@font-face`**——Windows 上实际渲染的是 Segoe UI / 微软雅黑，"设计意图里的 Inter"从未真正上屏。同时德语词卡用无衬线加粗撑 52px，长复合词（`Donaudampfschifffahrt…`）在无衬线下缺乏"被印刷出来"的学术质感；音标 `/ˈjoːɡn̩tˌhɛʁbɛʁɡə/` 与正文同字体，IPA 字符混排突兀。

**方案：三栈分工**

| 栈 | 字体 | 用途 | 子集策略 |
|---|---|---|---|
| UI 栈 | Inter（400/600，latin） | 全局界面、中文回落 PingFang/雅黑 | latin woff2 ≈ 2×25KB |
| 展示栈 | **Source Serif 4**（600，latin） | 词卡大词 `.vocab-word`、词弹窗标题 `.ld-word-title`、面试题干 `.iv-q .de`、口语句卡 | latin woff2 ≈ 30KB；选它而非 Playfair 是因为长复合词需要低对比度、笔画均匀的衬线 |
| 数据栈 | JetBrains Mono（400） | 音标、`.hero-stat b`/`.stat .v` 数字、表格数字、`.rd-clock` 计时 | 基础 latin ≈ 25KB；IPA 扩展字符（ʁ ɛ ɐ̯ 等）**不打包**，用 `src/phonetics.js` 的音素表提取实际用到的码点，`pyftsubset` 按需补 ~5KB |

```css
/* 落点：styles.css 顶部新增 */
@font-face{font-family:"Inter";src:url("data:font/woff2;base64,…") format("woff2");font-weight:400;font-display:swap;unicode-range:U+0000-00FF,U+2013-2026}
@font-face{font-family:"Inter";src:url("data:font/woff2;base64,…") format("woff2");font-weight:600;font-display:swap;unicode-range:U+0000-00FF,U+2013-2026}
@font-face{font-family:"SSerif";src:url("data:font/woff2;base64,…") format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"JBMono";src:url("data:font/woff2;base64,…") format("woff2");font-weight:400;font-display:swap}

:root{
  --font-ui:"Inter","PingFang SC","Microsoft YaHei","Segoe UI",Roboto,sans-serif;
  --font-de:"SSerif","Inter","Segoe UI",serif;   /* 德语展示 */
  --font-mono:"JBMono","SFMono-Regular",Consolas,monospace;
  --fs-12:12px;--fs-13:13px;--fs-14:14px;--fs-15:15px;--fs-17:17px;--fs-19:19px;--fs-24:24px;--fs-30:30px;
}
body{font-family:var(--font-ui);font-size:var(--fs-14)}
.vocab-word,.ld-word-title,.iv-q .de,.speech-sentence{font-family:var(--font-de)}
.vocab-phon,.hero-stat b,.stat .v,.rd-clock,.msg-time{font-family:var(--font-mono)} /* 数字类逐个过，别一刀切 */
```

**约束与代价**：
- 内联 base64 使单文件 +~130KB（+6%）。瘦身备选：只上 Source Serif 一支（+30KB），UI 栈维持系统字体——但那样"Inter"之名依旧不副实，不推荐。
- 中文**绝不**打 webfont（体积不可接受），继续系统栈；`font-display:swap` 防阻塞。
- 构建链：字体文件放 `src/assets/fonts/`，`tools/build.py` 需新增「woff2 → base64 内联 + 产物体积断言（≤2.6MB）」两步。
- 正文 14px **保持不变**（90 天报告认可留白，动正文密度风险大于收益），只把 `.hint` 系 12.5px 的行高 1.7 统一成 `1.6`。

### T2 · 动效令牌与页面转场

**现状**：全站只有 `viewIn .25s` 一处入场动画 + 各组件散落的 `.18s`，无系统。

```css
:root{
  --dur-1:120ms;  /* 微反馈：hover、按压 */
  --dur-2:200ms;  /* 组件：抽屉、toast、词弹窗 */
  --dur-3:300ms;  /* 页面：路由入场 */
  --ease-ui:cubic-bezier(.2,.75,.25,1);          /* 既有，保留 */
  --ease-spring:cubic-bezier(.34,1.56,.64,1);    /* 仅用于成就/连胜类庆祝反馈 */
}
```

- **路由转场改为非对称**（gsap Subtle 档结论：exit 恒快于 enter）：router.js 渲染新页前给旧 `#view` 加 140ms 淡出类，入场沿用 `viewIn` 但时长 `var(--dur-3)`。vanilla 实现，约 10 行。
- **词卡揭晓**：`.vocab-zh` 淡入 + 上移 6px（`--dur-2`），例句跟随后 60ms 级联——这是每天被看几百次的瞬间，值得单独调。
- **成就 toast / 连胜徽章**：`slideIn` 换 `--ease-spring` 一次回弹。
- 全部自动落入既有的 `prefers-reduced-motion` 全局兜底，无需逐条处理。

### T3 · 浮层投影纪律（elevation 三档）

v4 把"层级靠结构而不是阴影"执行得太彻底——`--shadow-brand:none`、卡片 `box-shadow:none`，导致 toast、词弹窗 `.ld-word-pop`、抽屉这些**临时浮层**和地上的卡片没有视觉区隔，深色模式下尤其明显。建立三档语义：

```css
:root{
  --shadow-1:0 1px 2px rgba(31,35,40,.04);                    /* 地面层：卡片 resting，基本维持现状 */
  --shadow-2:0 4px 16px rgba(31,35,40,.10);                   /* 浮起层：hover 的可点卡片、词弹窗 */
  --shadow-3:0 16px 44px rgba(31,35,40,.18);                  /* 模态层：抽屉、toast、auth 卡 */
}
.dark{ --shadow-2:0 4px 16px rgba(0,0,0,.45); --shadow-3:0 16px 44px rgba(0,0,0,.6); }
```

落点：`.ld-word-pop`、`.toast`、`.drawer`、`.auth-card` → `--shadow-3`；`.mod-card:hover`、`.home-recommendation:hover`、`.reading-card:hover` → `--shadow-2`；`--shadow-lg` 重命名迁移。**纪律：地面层组件永不给 2/3 档投影，浮层组件永不裸放。**

### T4 · emoji 图标 → SVG 全量替换

skill 交付清单红线"禁 emoji 当图标"，实测 15 处：`🎙`（speech/listening/phonetics ×7）、`📷`（writing/ocrgrade ×2）、`🎯`（×3）、`🔥`（store.js 徽章）、`🏆`、`✦`（顶栏 streak/徽章 ×3）、`⟳`（同步按钮）。替换为项目已有的 `<svg class="ico">` 内联模式（index.html 已是此风格），统一 18px、`stroke-width:1.8`。顶栏 streak 火焰用 Lucide `flame` path，录音用 `mic`，拍照用 `camera`——全部 stroke 风格，与现有图标语汇一致。

### T5 · 组件精修（P1 主战场）

1. **词卡舞台**（产品的脸）：T1 三栈上屏后，补三个语言学习产品的专业细节——
   - **词性色标**：`der/die/das` 三性用专用 token（`--gen-m:#455774` 蓝 / `--gen-f:#a84a44` 砖红 / `--gen-n:#2f6d52` 绿）以圆点/冠词着色呈现在 `.vocab-word` 前、词弹窗、生词本词条。注意与对错语义（ok/danger）隔离：只用于冠词小面积标记，不做大面积底色。**此为产品决策项，需用户拍板**。
   - 词卡底加极淡纸纹（`repeating-linear-gradient` 1px 发丝，opacity .03），呼应"印刷品"。
   - 音标行 mono 化后加 `letter-spacing:.02em`。
2. **图表色带**（charts.js）：定义 `--chart-1..8` 浅/深双套，基色从品牌蓝出发、后 7 色取 Okabe-Ito 色盲安全序列；沙盘四系列、学情分析柱图、周历热力图统一改读 token；网格线用 `--line-soft`，数字标签 mono。
3. **顶栏**：`level-chip` 与 `streak-chip` 合并为一个"学习状态"组合件（等级 + 连胜 + XP 三段，hairline 分隔），为移动端省出 44px 宽度。
4. **深色模式抽查**：`.btn-primary`（#3a4a68 底白字 4.6:1 ✓）通过；重点复查 `.tag-warn`、`.persona-badge`、`.rate-btn` 四档边色在 dark 下的可辨性，写入测试。
5. **空态**：`.empty` 结构已达标，可选给 4 个高频空态（错题本/生词本/搜索无结果/未配置 AI）配 32px 单色线条小 SVG，风格与图标一致。

### T6 · 可达性收尾 + landing 对齐（P2）

- 3.17 报告的教训直接复用：**测试要测渲染结果**——把 `test_small_text_floor_on_rendered_pages` 的"遍历 13 路由叶子节点"模式扩展两条：`test_font_stack_on_rendered_pages`（断言词卡 computed font-family 命中 SSerif）与 `test_dark_mode_contrast`（关键 token 组合 WCAG ≥4.5:1）。
- iOS 安全区：`.topbar`、`.drawer`、`.toast-wrap` 补 `env(safe-area-inset-*)`。
- hash 深链（`#/vocab`）：router.js 已有路由表，加 `hashchange` 监听约 20 行，收益是刷新/分享保持页面（ux 检索 Deep Linking 项）。
- `dist/landing.html`（568 行）：已共享墨蓝+金色值，但它是独立硬编码——v5 落地时把 token 段替换为与 styles.css 同源的 `:root` 块，保证下一步改色不产生分叉。

---

## 四、分期与文件落点

| 期 | 内容 | 文件 | 测试影响 |
|---|---|---|---|
| **P0**（1 版本） | T1 字体三栈 + T2 动效令牌/转场 + T3 投影 + T4 图标替换 | `src/styles.css`、`index.html`（无，字体走 CSS）、`src/core/router.js`（+10 行转场）、`tools/build.py`（字体内联+体积断言）、`src/store.js`/6 模块 js（emoji 替换） | flow tests 全量回归；新增 `test_single_file_size_cap` |
| **P1** | T5 全部 + T6 的对比度测试 | `src/charts.js`、`src/core/ui.js`（顶栏组合件）、`src/modules/vocab.js`（词性色标，若拍板）、`styles.css` | 新增 `test_dark_mode_contrast`、`test_chart_colors_from_tokens` |
| **P2** | T6 其余 + landing 对齐 + 空态小图 + 阅读正文衬线实验（设置里加开关，默认关） | `dist/landing.html`、`src/core/router.js`（深链）、`styles.css` | 深链 e2e 1 项 |

**协作注意**：styles.css 是并行编辑热点，P0 四项全部集中在这一个文件时先在群里打招呼；emoji 替换触及 6 个模块文件，逐文件小步提交。前端烤在阿里云镜像里，发版走 `auto-deploy` skill rebuild。

## 五、验收标准

- [ ] Windows 全新 Chrome 下 `getComputedStyle(document.querySelector('.vocab-word')).fontFamily` 命中 Source Serif（不再被 Segoe UI 冒名）
- [ ] 音标在无 JBMono 字符时回落栈可读（德/汉/IPA 三段混排无 tofu）
- [ ] 单文件 ≤ 2.6MB；file:// 打开 0 外部请求（沿用 tools/check.py）
- [ ] 全站无 emoji 图标（`grep -P "[\x{1F300}-\x{1FAFF}]"` 零命中于按钮/标签）
- [ ] 路由转场 exit < enter；`prefers-reduced-motion` 下所有新动效直接呈现终态
- [ ] toast/词弹窗/抽屉有可感知投影，地面卡片维持无影
- [ ] 135 项 flow tests 全绿；新增 3 条渲染结果断言通过

## 六、明确不做的事

- 不换主色、不引 GSAP/three.js 等动画库、不动 14px 正文与内容密度、不加重阴影拟物化、不给中文打 webfont、不做首页大改版（3.16 的首屏减法刚立住，别推翻）。
