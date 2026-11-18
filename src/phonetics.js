/* LinguaDE · 德语音素引擎（3.6.0）
   目的：把口语反馈从「只有文本比对」升级为「音素级定位」——能指出具体哪个音发错。
   方法：规则式 G2P（字素→音素）+ 参考/识别音素序列的 Levenshtein 对齐 + 最小对立对诊断。
   参考：① GOP 音素级发音评估（Witt et al. 2000；Hu et al. 2015，Kaldi gop_speechocean762）；
         ② Phoneme Party（guettli/pp）：在浏览器本地用「音素序列比对 + PER + 编辑距离」给出
            逐音素反馈（绿=对 / 黄=接近 / 红=错）。
   定位：非声学模型，属「转写文本 → 音素」的近似定位法，作为辅助反馈，不作官方判分。 */
(function () {
  /* ---------------- 1. 字素 → 音素（最长匹配优先） ---------------- */
  /* 音素用简化 IPA 符号；顺序即优先级（code 中靠前的规则先匹配） */
  const RULES = [
    // 三字母 / 特殊后缀
    ["sch", "ʃ"], ["tsc", "tʃ"], ["tion", "tsioːn"], ["chs", "ks"],
    // 双元音
    ["eu", "ɔʏ"], ["äu", "ɔʏ"], ["ei", "aɪ"], ["ai", "aɪ"], ["au", "aʊ"],
    // 长元音（双写/加 h）
    ["aa", "aː"], ["ee", "eː"], ["oo", "oː"], ["ie", "iː"],
    ["ah", "aː"], ["eh", "eː"], ["oh", "oː"], ["uh", "uː"], ["ih", "iː"], ["äh", "ɛː"], ["öh", "øː"], ["üh", "yː"],
    // 辅音组合
    ["sch", "ʃ"], ["sp", "ʃp"], ["st", "ʃt"], ["ch", "ç"], ["ck", "k"], ["ph", "f"],
    ["th", "t"], ["tz", "ts"], ["ts", "ts"], ["ng", "ŋ"], ["nk", "ŋk"], ["qu", "kv"], ["pf", "pf"],
    // 单字素元音
    ["a", "a"], ["e", "ɛ"], ["i", "ɪ"], ["o", "ɔ"], ["u", "ʊ"], ["y", "ʏ"],
    ["ä", "ɛ"], ["ö", "œ"], ["ü", "ʏ"],
    // 单字素辅音
    ["b", "b"], ["c", "k"], ["d", "d"], ["f", "f"], ["g", "ɡ"], ["h", ""], ["j", "j"],
    ["k", "k"], ["l", "l"], ["m", "m"], ["n", "n"], ["p", "p"], ["r", "ʁ"], ["s", "z"],
    ["t", "t"], ["v", "f"], ["w", "v"], ["x", "ks"], ["z", "ts"], ["ß", "s"]
  ];

  /* st/sp 只在词首或前缀后读 [ʃt]/[ʃp]；Fenster / erst / Angst 等保持 [st] */
  const ST_PREFIXES = ["ver", "be", "ge", "er", "ent", "emp", "miss", "zer", "un", "an", "auf", "aus",
    "bei", "ein", "mit", "nach", "vor", "zu", "ab", "um", "wider", "wieder", "hin", "her", "dar",
    "durch", "über", "unter", "hinter", "neben", "zusammen", "zurück", "teil", "fest", "frei",
    "voll", "weg"];
  const ST_EXCEPTIONS = new Set(["erst", "erste", "erster", "erstes", "ersten", "ernst", "angst",
    "gestern", "geste", "gesten", "beste", "bester", "besten", "bestes", "best"]);

  function stSpark(word, i) {
    if (i === 0) return true;
    if (ST_EXCEPTIONS.has(word)) return false;
    const before = word.slice(0, i);
    return ST_PREFIXES.some(p => before.endsWith(p));
  }

  const VOWEL = /[aeiouäöü]/;
  function voicedS(word) {
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== "s") continue;
      const prev = word[i - 1] || "", next = word[i + 1] || "";
      if ((i === 0 && VOWEL.test(next)) || (VOWEL.test(prev) && VOWEL.test(next))) return true;
    }
    return false;
  }

  /* 上下文相关的读音修正（德语特有，规则式 G2P 的关键） */
  function postFix(phones, word) {
    const w = word.toLowerCase();
    const out = phones.slice();
    // ch：a/o/u/au 之后读 [x]，否则读 [ç]
    for (let i = 0; i < out.length; i++) {
      if (out[i] === "ç") {
        const before = out[i - 1] || "";
        if (/[aɔʊ]/.test(before) || before === "aʊ") out[i] = "x";
      }
    }
    // 词尾 -er → [ɐ]（多音节词去掉词尾弱读元音：Fenster → fɛnstɐ）
    if (/-?er$/.test(w) && out.length >= 2 && out[out.length - 1] === "ʁ") {
      out[out.length - 1] = "ɐ";
      if (w.length >= 5 && out[out.length - 2] === "ɛ") out.splice(out.length - 2, 1);
    }
    // 词尾 -ig → [ɪç]
    if (/ig$/.test(w) && (out[out.length - 1] === "k" || out[out.length - 1] === "ɡ")) out[out.length - 1] = "ç";
    // 词尾 -en → [ən]（Atmen / haben / gehen）
    if (/en$/.test(w) && out[out.length - 1] === "n") {
      const prev = out[out.length - 2];
      if (prev === "ɛ" || prev === "e") out[out.length - 2] = "ə";
      else out.splice(out.length - 1, 0, "ə");
    }
    // 词尾 e → [ə]
    if (/e$/.test(w) && out[out.length - 1] === "ɛ") out[out.length - 1] = "ə";
    // 词尾清化：b/d/g → p/t/k（Tag / Kind / gibt）
    if (/(?:b|d|g)$/.test(w) && out.length) {
      const last = out[out.length - 1];
      if (last === "b") out[out.length - 1] = "p";
      if (last === "d") out[out.length - 1] = "t";
      if (last === "ɡ") out[out.length - 1] = "k";
    }
    // 词尾 s 不浊化（sechs / das / Haus）
    if (/s$/.test(w) && out[out.length - 1] === "z") out[out.length - 1] = "s";
    // s 不在词首元音前、也不在两个元音之间 → 清音 [s]（Ausmaß / Fenster）
    if (!voicedS(w)) {
      for (let i = 0; i < out.length; i++) if (out[i] === "z") out[i] = "s";
    }
    // s 在词首且后接辅音 → [s]（默认已 z）；元音后仍为 [z]
    if (/^s/.test(w) && out[0] === "z" && !/[aeiouäöü]/.test(w[1] || "")) out[0] = "s";
    // 双写辅音只发一次（Zelle / kommen）
    const DUP = new Set(["b", "d", "f", "ɡ", "k", "l", "m", "n", "p", "s", "t", "ʁ", "z"]);
    for (let i = out.length - 1; i > 0; i--) {
      if (out[i] === out[i - 1] && DUP.has(out[i])) out.splice(i, 1);
    }
    return out.filter(Boolean);
  }

  /* 单词 → 音素数组 */
  function wordPhones(word) {
    let s = (word || "").toLowerCase().replace(/[^a-zäöüß]/g, "");
    const out = [];
    let i = 0;
    while (i < s.length) {
      // h：词首或辅音后读 [h]；元音后只作长音符号（gehen / ihn）
      if (s[i] === "h") {
        const prev = s[i - 1] || "";
        if (i === 0 || !/[aeiouäöü]/.test(prev)) out.push("h");
        i += 1;
        continue;
      }
      // st/sp：不在词首、也不在前缀之后时保持 [st]/[sp]
      if (i > 0 && (s.startsWith("st", i) || s.startsWith("sp", i)) && !stSpark(s, i)) {
        out.push(s.slice(i, i + 2));
        i += 2;
        continue;
      }
      let hit = null;
      for (const [g, p] of RULES) {
        if (s.startsWith(g, i)) { hit = [g, p]; break; }
      }
      if (hit) { if (hit[1]) out.push(hit[1]); i += hit[0].length; }
      else { out.push(s[i]); i += 1; }
    }
    return postFix(out, s);
  }

  /* 文本 → 音素序列（" " 作为词边界标记，便于对齐时不跨词错配） */
  function toPhones(text) {
    const words = (text || "").toLowerCase().replace(/[.,!?;:"„“”()]/g, " ").split(/\s+/).filter(Boolean);
    const seq = [];
    words.forEach((w, k) => {
      if (k) seq.push(" ");
      wordPhones(w).forEach(p => seq.push(p));
    });
    return seq;
  }

  /* ---------------- 2. 最小对立对（L2 德语常见混淆） ---------------- */
  /* 键为「两音素排序后拼接」，值为诊断提示 */
  const PAIRS = {
    "uː|yː": "ü 是「圆唇前元音」：舌位像发 i，但嘴唇要收圆——常见把它读成 u。",
    "ʊ|ʏ": "ü 短音 [ʏ] 与 u 短音 [ʊ] 混淆：先把舌头往前抬，再保持圆唇。",
    "oː|øː": "ö 是「圆唇前元音」：舌位像 e，嘴唇收圆。",
    "ɔ|œ": "ö 短音 [œ] 与 o 短音 [ɔ] 混淆：舌位更靠前。",
    "eː|ɛː": "长 ä [ɛː] 与长 e [eː] 常混：ä 开口更大、舌位更低。",
    "ç|ʃ": "ch 在 i/e/ä/ö/ü 后读软音 [ç]（近「希」），不是 [ʃ]（「施」）。",
    "ç|x": "ch 有两个音：a/o/u/au 后读 [x]（近「喝」），其余读 [ç]。",
    "s|ʃ": "s 词首元音前读浊音 [z]，sch 才读 [ʃ]。",
    "s|z": "德语词首 s（接元音）读浊音 [z]，如 Sohn。",
    "ts|s": "德语 z 读 [ts]（如 Zeit），不读 [s]。",
    "f|v": "德语 v 多读 [f]（如 Vater），外来词才读 [v]。",
    "k|ɡ": "g 词尾会「清化」读 [k]（如 Tag）。",
    "t|d": "d 词尾清化为 [t]（如 Kind）。",
    "n|ŋ": "ng 读鼻音 [ŋ]（如 singen），不发 [n]+[ɡ]。",
    "aɪ|iː": "ei 读 [aɪ]、ie 读 [iː]——两者最常被读反（mein ≠ Miene）。",
    "ʁ|ɐ": "词尾 -er 弱化为 [ɐ]（近「阿」），不是清晰的 [ʁ]。"
  };
  const pk = (a, b) => [a, b].sort().join("|");

  /* ---------------- 3. 音素对齐（Levenshtein + 回溯） ---------------- */
  function align(A, B) {
    const m = A.length, n = B.length;
    const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    // 回溯
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && A[i - 1] === B[j - 1] && d[i][j] === d[i - 1][j - 1]) {
        ops.push({ op: "match", t: A[i - 1], a: B[j - 1] }); i--; j--;
      } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
        ops.push({ op: "sub", t: A[i - 1], a: B[j - 1] }); i--; j--;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
        ops.push({ op: "del", t: A[i - 1], a: "" }); i--;
      } else {
        ops.push({ op: "ins", t: "", a: B[j - 1] }); j--;
      }
    }
    return ops.reverse();
  }

  /* ---------------- 4. 音素级比对入口 ---------------- */
  /* 返回：per 音素错误率 / ops 对齐结果 / sounds 逐音素反馈（供可视化）/ advice 提示 */
  function compare(refText, hypText) {
    const A = toPhones(refText), B = toPhones(hypText);
    const real = x => x !== " ";                       // 词边界符不算音素
    const nRef = A.filter(real).length;
    if (!nRef || !B.filter(real).length) return null;

    const ops = align(A, B);
    // 词边界上的错配不计入音素错误（避免把断词算成发音错误）
    const errs = ops.filter(o => o.op !== "match" && (real(o.t) || real(o.a)));
    const per = errs.length / Math.max(1, nRef);

    const seen = new Set();
    const pairs = [];
    errs.forEach(o => {
      const t = real(o.t) ? o.t : "∅", a = real(o.a) ? o.a : "∅";
      const key = t + ">" + a;
      if (seen.has(key)) return;
      seen.add(key);
      const hint = PAIRS[pk(t, a)] || null;
      pairs.push({ t, a, hint });
    });

    const sounds = ops.filter(o => real(o.t) || real(o.a)).map(o => ({
      t: o.t, a: o.a,
      st: o.op === "match" ? "ok" : (PAIRS[pk(real(o.t) ? o.t : "∅", real(o.a) ? o.a : "∅")] ? "warn" : "bad")
    }));

    const advice = pairs.slice(0, 3).map(p => {
      const arrow = (p.t === "∅" ? "漏读" : p.a === "∅" ? "未读出" : `${p.t} → ${p.a}`);
      return p.hint ? `[${arrow}] ${p.hint}` : `[${arrow}] 该音素与标准发音不一致，放慢跟读比对。`;
    });
    if (!advice.length) advice.push("音素层面未发现明显错读，重点打磨连贯与语调。");

    return {
      per: Math.round(per * 100),
      nRef, nErr: errs.length,
      pairs, sounds: sounds.slice(0, 24), advice,
      phonesRef: A.filter(real)
    };
  }

  window.LD = window.LD || {};
  window.LD.Phonetics = { toPhones, wordPhones, align, compare, PAIRS };
})();