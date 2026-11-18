/* LinguaDE · B7 每日内容位（每日一句 / 每日听力）
 * 参照：每日德语听力 daily.*（ContentProvider 式每日内容）、德语GO DailySentence/DailyTrans。
 * 确定性：日期字符串哈希种子（同日同内容，可测试）；不进 B2 due 队列，纯展示位。
 * 数据：LD_LEX 词条与例句（100% 带例句对）；TTS 复用 speech.js SpeechUtil。 */
(function () {
  const LD = (window.LD = window.LD || {});

  /* FNV-1a 32 位（与 store.js 校验和同算法，纯函数自实现） */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  const LEX = () => window.LD_LEX || [];

  /* 句池：例句长度 3–16 词（与 speech.js pool 同口径） */
  function sentPool() {
    return LEX().filter(x => x && x[5] && x[5].split(" ").length >= 3 && x[5].split(" ").length <= 16);
  }

  function pick(kind, dateStr) {
    const pool = sentPool();
    if (!pool.length) return null;
    const seed = fnv1a(String(dateStr) + "|" + kind);
    return pool[seed % pool.length];
  }

  /* 每日一句：词头 + 例句对 */
  function sentence(dateStr) {
    const w = pick("sentence", dateStr);
    if (!w) return null;
    return { de: w[0], zh: w[2], ex: w[5], exzh: w[6] || "" };
  }

  /* 每日听力：1–3 句（同池取窗口，确定性） */
  function listening(dateStr) {
    const pool = sentPool();
    if (!pool.length) return [];
    const seed = fnv1a(String(dateStr) + "|listening");
    const start = seed % Math.max(1, pool.length - 3);
    const out = [];
    for (let k = 0; k < 3; k++) {
      const w = pool[(start + k) % pool.length];
      if (w) out.push({ de: w[5], zh: w[6] || "" });
    }
    return out;
  }

  const today = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };

  LD.Daily = { fnv1a, pick, sentence, listening, today };
})();