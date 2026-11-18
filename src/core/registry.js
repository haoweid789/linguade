/* LinguaDE · 模块注册表
 * 模块经 LD.define(name, spec) 注册，spec 自带元数据（group/icon/label/priority/order/ds）。
 * 导航、首页与一致性校验统统据此生成 —— 新增模块只需写「一个模块文件」，无需再改别处。
 */
(function () {
  const LD = (window.LD = window.LD || {});
  LD.Modules = LD.Modules || {};

  /* 分组展示顺序（模块用 group 字段归位，组内按 order 排序） */
  const GROUPS = ["学习闭环", "沉淀与复盘", "智能内核", "场景实战"];

  function define(name, spec) {
    if (LD.Modules[name]) console.warn("[LinguaDE] 模块重复注册：", name);
    if (!spec || typeof spec.render !== "function") {
      console.warn("[LinguaDE] 模块缺少 render(host, ctx)：", name);
    }
    if (spec && !spec.group) console.warn("[LinguaDE] 模块缺少元数据 group：", name);
    LD.Modules[name] = spec;
    return spec;
  }

  const hasMeta = spec => spec && spec.group;

  /* 已纳入导航的模块（含元数据），并标注其路由名 */
  function list() {
    return Object.keys(LD.Modules)
      .filter(n => hasMeta(LD.Modules[n]))
      .map(n => Object.assign({ route: n }, LD.Modules[n]));
  }

  /* 按 order 升序（未声明 order 的排到末尾） */
  function ordered() {
    return list().sort((a, b) => (a.order == null ? 999 : a.order) - (b.order == null ? 999 : b.order));
  }

  /* 分组视图：[{ group, items:[...] }]
     入学诊断是一次性的：完成后从导航与首页移除；
     未完成时反过来锁死其余模块，强制先做完测试 */
  function byGroup() {
    const done = !!(LD.Store && LD.Store.s && LD.Store.s.diagnosed);
    const all = ordered().filter(m => !(m.route === "diagnose" && done));
    const visible = done ? all : all.filter(m => m.route === "diagnose");
    return GROUPS
      .map(group => ({ group, items: visible.filter(m => m.group === group) }))
      .filter(g => g.items.length > 0);
  }

  /* 主入口：只保留日常闭环。nav:"more" 的重叠工具自 3.25.0 起不进导航与首页（「更多工具」组已移除），仅路由可达 */
  function primaryGroups() {
    const done = !!(LD.Store && LD.Store.s && LD.Store.s.diagnosed);
    const all = ordered().filter(m => !(m.route === "diagnose" && done));
    const visible = done ? all : all.filter(m => m.route === "diagnose");
    return GROUPS
      .map(group => ({ group, items: visible.filter(m => m.group === group && m.nav !== "more") }))
      .filter(g => g.items.length > 0);
  }

  /* 一致性自检（供启动时告警与 tools/check.py 使用） */
  function validate() {
    const registered = Object.keys(LD.Modules);
    return {
      registered,
      noRender: registered.filter(n => !LD.Modules[n] || typeof LD.Modules[n].render !== "function"),
      noGroup: registered.filter(n => !LD.Modules[n] || !LD.Modules[n].group),
      noOrder: registered.filter(n => !LD.Modules[n] || LD.Modules[n].order == null),
      groups: GROUPS
    };
  }

  LD.define = define;
  LD.moduleList = list;
  LD.modulesByGroup = byGroup;
  LD.primaryGroups = primaryGroups;
  LD.validateModules = validate;
})();