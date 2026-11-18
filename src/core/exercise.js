/* LinguaDE · B3 题型本体（src/core/exercise.js）
 * 德语题型注册表：对齐 Duolingo Challenge$SpecificType 的德语子集（20 项），
 * 每项声明能力域 / 判分方式 / B2 复习粒度 / 内容需求。
 * 纯目录（不依赖 store/engine）；现有 drill/listening 题型以「包装」方式登记，
 * 运行时行为不变；「新增」题型渲染器随 B4/B5/B7 分批实现。
 * 加载序：srs.js 之后、store.js 之前（index.html）。 */
(function () {
  const LD = (window.LD = window.LD || {});

  /* judge: choice 选择 / typing 键入 / match 匹配 / speech 语音评测 / self 自评 / trace 描红 / reference 静态参考 / mixed 混合 / llm 大模型批改
     srsKind: 对齐 B2 REVIEWTYPE 7 粒度（word/sentence/character/grammar/item/group/quick）
     needs: 渲染所需内容字段（B1 words.yaml lint 对齐用）
     impl: "drill"|"listening"|"vocab"|"new"（new = 注册待实现） */
  const EXERCISES = [
    /* ---- 语法专项（drill 包装） ---- */
    { id: "select_genus", n: "冠词性别选择", ability: "grammar", judge: "choice", srsKind: "item", needs: ["de", "genus"], impl: "drill", ref: "drill.art" },
    { id: "conjugate", n: "动词变位填空", ability: "grammar", judge: "choice", srsKind: "item", needs: ["de", "formOf"], impl: "drill", ref: "drill.verb" },
    { id: "select_case", n: "介词支配格", ability: "grammar", judge: "choice", srsKind: "item", needs: ["de", "pos"], impl: "drill", ref: "drill.prep" },
    /* ---- 翻译（新增，词典数据） ---- */
    { id: "translate_de_zh", n: "德译中", ability: "vocab", judge: "typing", srsKind: "word", needs: ["de", "zh"], impl: "new" },
    { id: "translate_zh_de", n: "中译德", ability: "vocab", judge: "typing", srsKind: "word", needs: ["zh", "de"], impl: "new" },
    /* ---- 听力（listening 包装） ---- */
    { id: "listen_choice", n: "听音选义", ability: "listening", judge: "choice", srsKind: "sentence", needs: ["de", "zh", "ex_de"], impl: "listening", ref: "listening.choice" },
    { id: "listen_gap", n: "听写填空", ability: "listening", judge: "typing", srsKind: "sentence", needs: ["ex_de", "ex_zh"], impl: "listening", ref: "listening.dictation" },
    { id: "listen_full", n: "整句听写", ability: "listening", judge: "typing", srsKind: "sentence", needs: ["ex_de"], impl: "listening", ref: "listening.diktat" },
    { id: "listen_dialog", n: "双人对话理解", ability: "listening", judge: "choice", srsKind: "sentence", needs: ["ex_de", "ex_zh"], impl: "listening", ref: "listening.dialog" },
    /* ---- 口语（listening 包装，speech 判分走 speech.js） ---- */
    { id: "speak_repeat", n: "句子复述", ability: "speaking", judge: "speech", srsKind: "sentence", needs: ["ex_de", "ex_zh"], impl: "listening", ref: "listening.repeat" },
    { id: "speak_shadow", n: "影子跟读", ability: "speaking", judge: "speech", srsKind: "sentence", needs: ["ex_de"], impl: "listening", ref: "listening.shadow" },
    /* ---- 词汇（vocab 标记 + 新增） ---- */
    { id: "word_recall", n: "词卡自评", ability: "vocab", judge: "self", srsKind: "word", needs: ["de", "zh", "ex_de"], impl: "vocab", ref: "vocab.rate" },
    { id: "match_pairs", n: "词对匹配", ability: "vocab", judge: "match", srsKind: "group", needs: ["de", "zh"], impl: "new" },
    { id: "spell_word", n: "听音拼写", ability: "vocab", judge: "typing", srsKind: "word", needs: ["de", "ex_de"], impl: "new" },
    /* ---- 阅读/写作（新增） ---- */
    { id: "read_cloze", n: "阅读填空", ability: "reading", judge: "choice", srsKind: "sentence", needs: ["ex_de", "ex_zh"], impl: "new" },
    { id: "read_comprehension", n: "阅读理解", ability: "reading", judge: "choice", srsKind: "group", needs: ["ex_de", "ex_zh"], impl: "new" },
    { id: "write_sentence", n: "造句批改", ability: "writing", judge: "llm", srsKind: "sentence", needs: ["de", "zh"], impl: "new" },
    /* ---- 字符/工具（新增） ---- */
    { id: "char_trace", n: "字母描红", ability: "character", judge: "trace", srsKind: "character", needs: ["de"], impl: "new" },
    { id: "article_table", n: "冠词速查表", ability: "grammar", judge: "reference", srsKind: "item", needs: ["de", "genus"], impl: "new" },
    { id: "quick_quiz", n: "快测（混题）", ability: "mixed", judge: "mixed", srsKind: "quick", needs: ["de", "zh"], impl: "new" },
  ];

  /* 加载自检：id 唯一、字段完备、srsKind 合法（Srs 在时校验） */
  (function selfCheck() {
    const seen = new Set();
    const kinds = new Set((window.LD && window.LD.Srs && window.LD.Srs.KINDS) || []);
    EXERCISES.forEach(e => {
      if (seen.has(e.id)) throw new Error("Exercise id 重复: " + e.id);
      seen.add(e.id);
      ["id", "n", "ability", "judge", "srsKind"].forEach(k => {
        if (!e[k]) throw new Error("Exercise 缺字段 " + k + ": " + e.id);
      });
      if (!Array.isArray(e.needs) || !e.needs.length) throw new Error("Exercise needs 为空: " + e.id);
      if (kinds.size && !kinds.has(e.srsKind)) throw new Error("Exercise srsKind 非法: " + e.id + " → " + e.srsKind);
    });
  })();

  const types = () => EXERCISES.slice();
  const get = id => EXERCISES.find(e => e.id === id) || null;
  const byAbility = ability => EXERCISES.filter(e => e.ability === ability);
  const needs = id => (get(id) || { needs: [] }).needs.slice();

  LD.Exercise = { EXERCISES, types, get, byAbility, needs, ids: () => EXERCISES.map(e => e.id) };
})();