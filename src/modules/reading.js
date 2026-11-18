/* 模块 15 · 阅读理解（Leseverstehen）
   对标 Prepilingo / 德语go / deutsch-exam 的阅读专项，补齐「听说读写」四项技能闭环。
   题型参照 TestDaF / 歌德考试的阅读部分：
     ① 小标题匹配（Überschriften zuordnen）—— 训练段落主旨抓取
     ② 判断正误（richtig / falsch / nicht im Text）—— 训练细节定位与辨析
     ③ 细节理解选择（Multiple Choice）—— 训练信息检索
   全部短文围绕留德真实场景（注册 / 租房 / 费用 / 医保 / 打工），配中文译文与逐题解析。 */
(function () {
  const S = () => window.LD.Store.s, E = () => window.LD.Engine;
  const PARSE_KEY = "linguade.paraParse.v1";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (m, t) => { if (window.LD.UI && window.LD.UI.toast) window.LD.UI.toast(m, t); };

  function hashText(text) {
    let h = 5381;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function readParseCache(text) {
    try {
      const all = JSON.parse(localStorage.getItem(PARSE_KEY) || "{}");
      const hit = all[hashText(text)];
      return hit && hit.data ? hit.data : null;
    } catch (e) { return null; }
  }
  function writeParseCache(text, data) {
    try {
      const all = JSON.parse(localStorage.getItem(PARSE_KEY) || "{}");
      all[hashText(text)] = { t: Date.now(), data };
      const keys = Object.keys(all);
      if (keys.length > 60) {
        keys.sort((a, b) => (all[a].t || 0) - (all[b].t || 0));
        keys.slice(0, keys.length - 60).forEach(k => delete all[k]);
      }
      localStorage.setItem(PARSE_KEY, JSON.stringify(all));
    } catch (e) { /* 配额满时静默，下一次重新解析 */ }
  }

  /* 离线解析：分句 + 词库释义 + 规则提示；不伪造 AI 才能给出的逐句翻译 */
  function localParse(text, zh) {
    const parts = String(text || "").split(/(?<=[.!?])\s+/).filter(Boolean);
    const words = [];
    const seen = new Set();
    (String(text || "").match(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{3,}/g) || []).forEach(w => {
      const k = w.toLowerCase();
      if (!seen.has(k)) { seen.add(k); words.push(w); }
    });
    const gloss = [];
    if (window.LD.Lex) words.forEach(w => {
      const hit = window.LD.Lex.lookup(w);
      if (hit && gloss.length < 6 && !gloss.some(g => g.de === hit.de)) gloss.push({ de: hit.de, zh: hit.zh });
    });
    const grammar = [];
    if (/\b(weil|dass|obwohl|wenn|als)\b/i.test(text)) grammar.push({ point: "从句", explain: "从句中变位动词置于句末。", example: "…, weil ich keine Zeit habe." });
    if (/\b(wird|werden|wurde|wurden)\b/i.test(text) && /\bge\w+t\b/i.test(text)) grammar.push({ point: "被动语态", explain: "werden + 过去分词表示被动。", example: "Das Haus wird gebaut." });
    if (/\bman\b/i.test(text)) grammar.push({ point: "无人称 man", explain: "man 泛指“人们”，动词按第三人称单数变位。", example: "In Deutschland trinkt man viel Kaffee." });
    if (/\bzu\b\s+\w+en\b/i.test(text)) grammar.push({ point: "带 zu 不定式", explain: "zu + 动词原形，通常置于句末。", example: "Ich habe keine Zeit zu kommen." });
    return {
      translation: zh || "（离线模式未提供整段翻译；配置大模型后可生成）",
      sentences: parts.map(p => ({ de: p, zh: "", structure: "" })),
      gloss, grammar: grammar.slice(0, 3), source: "local"
    };
  }

  function renderParsed(box, data, cached) {
    const src = cached ? "AI 解析 · 已缓存" : data.source === "llm" ? "AI 解析" : "离线解析 · 分句 + 词库释义";
    let html = `<div class="para-parse"><div class="para-parse-hd">${src}</div>`;
    if (data.translation) html += `<div style="font-size:12.5px;line-height:1.7"><b>整段翻译</b>：${esc(data.translation)}</div>`;
    if (Array.isArray(data.sentences) && data.sentences.length) {
      html += `<div style="margin-top:8px">${data.sentences.map(s => `<div style="padding:4px 0;border-bottom:1px dashed var(--line-soft)">
        <div class="de" style="font-size:12.5px;line-height:1.65">${esc(s.de)}</div>
        ${s.zh ? `<div style="font-size:12px;color:var(--text-3)">${esc(s.zh)}</div>` : ""}
        ${s.structure ? `<span class="tag" style="margin-top:3px">${esc(s.structure)}</span>` : ""}
      </div>`).join("")}</div>`;
    }
    if (Array.isArray(data.gloss) && data.gloss.length) {
      html += `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">${data.gloss.map(g => `<span class="tag"><b class="de">${esc(g.de)}</b> ${esc(g.zh)}</span>`).join("")}</div>`;
    }
    if (Array.isArray(data.grammar) && data.grammar.length) {
      html += `<div style="margin-top:8px">${data.grammar.map(g => `<div style="font-size:12px;line-height:1.65"><b>${esc(g.point)}</b>：${esc(g.explain)}${g.example ? ` <span class="de" style="color:var(--text-3)">${esc(g.example)}</span>` : ""}</div>`).join("")}</div>`;
    }
    box.innerHTML = html + "</div>";
  }

  function toggleParse(host, btn, i, p) {
    const x = p.paras[i];
    const box = host.querySelector("#parse-" + i);
    if (!box) return;
    if (box.style.display !== "none" && box.innerHTML.trim()) {
      box.style.display = "none";
      btn.textContent = "解析";
      return;
    }
    box.style.display = "block";
    btn.textContent = "收起";
    const cached = readParseCache(x.de);
    if (cached) { renderParsed(box, cached, true); return; }
    box.innerHTML = `<div class="hint" style="margin:0">解析中…</div>`;
    if (window.LD.LLM && window.LD.LLM.ready() && window.LD.LLM.parseParagraph) {
      window.LD.LLM.parseParagraph(x.de)
        .then(data => { writeParseCache(x.de, data); renderParsed(box, data, false); })
        .catch(() => renderParsed(box, localParse(x.de, x.zh), false));
    } else {
      renderParsed(box, localParse(x.de, x.zh), false);
    }
  }

  /* ============ 阅读语料库：5 篇分级短文 ============ */
  const PASSAGES = [
    {
      id: "immatrikulation", lv: "A2", theme: "留学事务",
      title: "Die Immatrikulation an einer deutschen Universität",
      titleZh: "在德国大学注册入学",
      src: "高校国际办公室须知改写",
      paras: [
        { de: "Wenn Sie einen Zulassungsbescheid erhalten haben, müssen Sie sich innerhalb von zwei Wochen einschreiben. Die Frist steht in dem Brief. Wer zu spät kommt, verliert seinen Studienplatz.", zh: "收到录取通知书后，您必须在两周内完成注册。截止日期写在通知书里。迟到者将失去学习位置。" },
        { de: "Für die Immatrikulation brauchen Sie mehrere Dokumente: Ihren Pass, das Zeugnis Ihrer Hochschulreife, einen Nachweis über die Krankenversicherung und ein Passfoto. Fehlt ein Dokument, kann die Universität Sie nicht einschreiben.", zh: "注册需要多份材料：护照、高校入学资格证明、医疗保险证明和一张证件照。缺少任何一份，学校都无法为您注册。" },
        { de: "Vor Beginn des Semesters müssen Sie den Semesterbeitrag bezahlen. Er kostet an den meisten Universitäten zwischen 150 und 350 Euro. Der Betrag enthält oft ein Ticket für Bus und Bahn in der Region.", zh: "学期开始前必须缴纳学期注册费。在多数大学为 150 至 350 欧元，费用通常包含本地区公交与火车的交通票。" },
        { de: "Nach der Einschreibung bekommen Sie einen Studierendenausweis. Mit diesem Ausweis können Sie in der Mensa günstig essen, Bücher in der Bibliothek ausleihen und Kopien für das Studium machen. Viele Museen und Schwimmbäder geben Studierenden Rabatt.", zh: "注册完成后您将获得学生证。凭学生证可以在食堂优惠就餐、在图书馆借书、复印学习资料。许多博物馆和游泳馆也对学生打折。" }
      ],
      headings: ["Diese Dokumente sind nötig", "Die Frist nicht verpassen", "Was der Studierendenausweis bietet", "Der Semesterbeitrag"],
      headingZh: ["注册所需材料", "切勿错过截止日期", "学生证的用途", "学期注册费"],
      headingAns: [1, 0, 3, 2],
      tfng: [
        { q: "Wer den Zulassungsbescheid erhalten hat, muss sich sofort einschreiben.", qzh: "收到录取通知书后必须立即注册。", a: "falsch", why: "原文是 innerhalb von zwei Wochen（两周内），不是 sofort（立刻）。" },
        { q: "Ein Passfoto gehört zu den erforderlichen Dokumenten.", qzh: "证件照属于必需材料。", a: "richtig", why: "第二段明确列出 ein Passfoto。" },
        { q: "Der Semesterbeitrag kostet an jeder Universität genau 250 Euro.", qzh: "每所大学的学期费都恰好是 250 欧元。", a: "falsch", why: "原文是 zwischen 150 und 350 Euro（150 到 350 之间），并非固定 250。" },
        { q: "Der Studierendenausweis gilt auch in vielen Museen.", qzh: "学生证在许多博物馆也有效。", a: "richtig", why: "最后一句：Viele Museen und Schwimmbäder geben Studierenden Rabatt。" },
        { q: "Ohne Nachweis der Krankenversicherung ist keine Immatrikulation möglich.", qzh: "没有医疗保险证明就无法注册。", a: "richtig", why: "第二段指出缺少该文件「kann die Universität Sie nicht einschreiben」。" }
      ],
      mcq: [
        { q: "Wie lange hat man nach dem Zulassungsbescheid Zeit für die Immatrikulation?", qzh: "收到录取通知后有多长时间办理注册？", opts: ["Eine Woche", "Zwei Wochen", "Einen Monat"], a: 1, why: "第一段：innerhalb von zwei Wochen。" },
        { q: "Was enthält der Semesterbeitrag oft?", qzh: "学期费通常包含什么？", opts: ["Ein Regionticket für Bus und Bahn", "Ein Buchgutschein", "Eine Krankenversicherung"], a: 0, why: "第三段末句：ein Ticket für Bus und Bahn in der Region。" },
        { q: "Was kann man mit dem Studierendenausweis NICHT machen?", qzh: "用学生证不能做什么？", opts: ["In der Mensa essen", "Ein Auto kaufen", "Bücher ausleihen"], a: 1, why: "文中列举了食堂、借书、复印、博物馆折扣，未提及购车。" }
      ],
      words: [
        { de: "der Zulassungsbescheid, -e", zh: "录取通知书" }, { de: "einschreiben", zh: "注册（入学）" },
        { de: "die Frist, -en", zh: "期限" }, { de: "der Nachweis, -e", zh: "证明" },
        { de: "der Semesterbeitrag, -träge", zh: "学期注册费" }, { de: "ausleihen", zh: "借出" }
      ]
    },
    {
      id: "wohnung", lv: "B1", theme: "留学生活",
      title: "Eine Wohnung in Deutschland finden",
      titleZh: "在德国找房子",
      src: "德国租房指南改写",
      paras: [
        { de: "Die Wohnungssuche ist für viele Studierende der schwierigste Schritt in Deutschland. In Großstädten wie München, Berlin oder Hamburg sind die Mieten hoch und es gibt wenige freie Wohnungen. Eine Studie zeigt: In München zahlt man für ein kleines Zimmer durchschnittlich 600 Euro warm.", zh: "找房是许多留学生在德国最难的一步。在慕尼黑、柏林、汉堡这样的大城市，房租高且空房少。一项研究显示：在慕尼黑，一间小房间平均含暖租为 600 欧元。" },
        { de: "Bevor man eine Wohnung mieten kann, sollte man einige Kosten kennen. Neben der Kaltmiete kommen Nebenkosten hinzu: Wasser, Heizung, Müll und Hausmeister. Zusammen sind das oft etwa zwei Euro pro Quadratmeter. Außerdem verlangen viele Vermieter eine Kaution. Die Kaution darf maximal drei Kaltmieten betragen.", zh: "租房前应先了解几项费用。除冷租外还有附加费：水、暖气、垃圾和大楼管理员，合计约为每平方米两欧元。此外许多房东要求押金，押金最高不得超过三个月冷租。" },
        { de: "Bei einer Besichtigung sollte man pünktlich sein und die wichtigsten Papiere mitbringen: Personalausweis, Immatrikulationsbescheinigung, Einkommensnachweis der Eltern und manchmal eine Mietschuldenfreiheitsbescheinigung. Wer diese Dokumente nicht dabei hat, hat oft keine Chance.", zh: "看房时应守时并携带最重要证件：身份证、入学注册证明、父母收入证明，有时还需无欠租证明。不带这些材料的人往往没有机会。" },
        { de: "Eine Alternative zum Mieten ist das Wohnheim. Die Zimmer im Studentenwerk sind viel günstiger, aber die Wartelisten sind lang. Experten raten, sich schon ein Jahr vor dem Studium beim Studentenwerk zu bewerben.", zh: "租房的替代选择是学生宿舍。大学生服务中心的房间便宜得多，但排队名单很长。专家建议在入学前一年就向大学生服务中心申请。" }
      ],
      headings: ["Diese Kosten kommen auf Mieter zu", "Was man zur Besichtigung mitbringt", "Hohe Mieten in den Großstädten", "Das Wohnheim als Alternative"],
      headingZh: ["租客需承担的费用", "看房要带的材料", "大城市的高房租", "学生宿舍作为替代"],
      headingAns: [2, 0, 1, 3],
      tfng: [
        { q: "In Großstädten sind die Mieten höher als auf dem Land.", qzh: "大城市房租比乡下高。", a: "richtig", why: "第一段：In Großstädten … sind die Mieten hoch。" },
        { q: "Die Kaution darf höchstens drei Kaltmieten betragen.", qzh: "押金最高为三个月冷租。", a: "richtig", why: "第二段：maximal drei Kaltmieten。" },
        { q: "Zur Besichtigung muss man eine Bürgschaft der Eltern mitbringen.", qzh: "看房必须带父母的担保函。", a: "nicht im Text", why: "文中只提到 Einkommensnachweis der Eltern（父母收入证明），未提 Bürgschaft（担保函）。" },
        { q: "Die Zimmer im Studentenwerk sind günstiger als private Zimmer.", qzh: "大学生服务中心的房间比私人房间便宜。", a: "richtig", why: "第四段：viel günstiger。" },
        { q: "Man sollte sich erst nach dem Studienbeginn beim Studentenwerk bewerben.", qzh: "应该在开学后才向大学生服务中心申请。", a: "falsch", why: "原文建议 schon ein Jahr vor dem Studium（入学前一年）。" }
      ],
      mcq: [
        { q: "Was sind Nebenkosten?", qzh: "什么是附加费？", opts: ["Die Miete für das Zimmer", "Kosten für Wasser und Heizung", "Die Kaution"], a: 1, why: "第二段列举：Wasser, Heizung, Müll und Hausmeister。" },
        { q: "Wie hoch darf die Kaution maximal sein?", qzh: "押金最高是多少？", opts: ["Eine Kaltmiete", "Zwei Kaltmieten", "Drei Kaltmieten"], a: 2, why: "第二段：maximal drei Kaltmieten。" },
        { q: "Was ist ein Problem beim Wohnheim?", qzh: "学生宿舍的问题是什么？", opts: ["Es ist zu teuer", "Die Wartelisten sind lang", "Es gibt keine Zimmer"], a: 1, why: "第四段：aber die Wartelisten sind lang。" }
      ],
      words: [
        { de: "die Miete, -n", zh: "房租" }, { de: "die Kaution, -en", zh: "押金" },
        { de: "die Besichtigung, -en", zh: "看房" }, { de: "der Vermieter, -", zh: "房东" },
        { de: "das Wohnheim, -e", zh: "学生宿舍" }, { de: "die Warteliste, -n", zh: "排队名单" }
      ]
    },
    {
      id: "kosten", lv: "B1", theme: "留学事务",
      title: "Was kostet das Studium in Deutschland?",
      titleZh: "在德国上大学要花多少钱？",
      src: "DAAD 费用说明改写",
      paras: [
        { de: "An deutschen Staatsuniversitäten zahlen Studierende keine Studiengebühren. Das gilt für fast alle Bundesländer und für Studierende aus der Europäischen Union genauso wie für internationale Studierende. Trotzdem ist das Studium nicht kostenlos.", zh: "在德国公立大学，学生无需缴纳学费。这一规定适用于几乎所有联邦州，对欧盟学生和国际学生一视同仁。尽管如此，上大学并非零成本。" },
        { de: "Jeder Student muss pro Semester den Semesterbeitrag bezahlen. Er liegt zwischen 150 und 350 Euro und finanziert die Mensa, das Sportprogramm und das Semesterticket. Dazu kommen die Lebenshaltungskosten. Der Deutsche Akademische Austauschdienst (DAAD) rechnet mit etwa 900 Euro pro Monat: für Miete, Essen, Kleidung, Bücher und Freizeit.", zh: "每名学生每学期须缴纳学期注册费，为 150 至 350 欧元，用于食堂、体育项目和学期交通票。此外还有生活费。德国学术交流总署（DAAD）估算每月约 900 欧元：房租、饮食、衣着、书籍和休闲。" },
        { de: "Internationale Studierende müssen außerdem nachweisen, dass sie für ein Jahr genug Geld haben. Dieses Geld sperrt die Bank auf ein Sperrkonto. Im Jahr 2026 sind das 11.904 Euro, also 992 Euro pro Monat. Ohne diesen Nachweis bekommen Sie kein Visum.", zh: "国际学生还须证明自己有一年的生活费用。这笔钱由银行冻结在冻结账户上。2026 年的数额为 11,904 欧元，即每月 992 欧元。没有这项证明就拿不到签证。" },
        { de: "Es gibt mehrere Möglichkeiten, Geld zu sparen: Wohnheimzimmer sind günstiger als private Wohnungen, in der Mensa isst man für drei bis fünf Euro, und mit dem Semesterticket fahren Bus und Bahn ohne Extrakosten. Viele Studierende arbeiten zusätzlich als Tutor oder in der Bibliothek.", zh: "省钱有几种办法：宿舍比租房便宜，食堂一餐三到五欧元，凭学期交通票乘公交和火车无需额外付费。许多学生还额外担任助教或在图书馆打工。" }
      ],
      headings: ["Keine Studiengebühren, aber nicht kostenlos", "Der monatliche Lebensunterhalt", "Das Sperrkonto für das Visum", "Wie Studierende Geld sparen"],
      headingZh: ["免学费但不免费", "每月生活费", "签证用的冻结账户", "学生如何省钱"],
      headingAns: [0, 1, 2, 3],
      tfng: [
        { q: "An staatlichen Universitäten zahlt man keine Studiengebühren.", qzh: "在国立大学不交学费。", a: "richtig", why: "第一段第一句。" },
        { q: "Der Semesterbeitrag finanziert auch das Semesterticket.", qzh: "学期费也用于学期交通票。", a: "richtig", why: "第二段：finanziert die Mensa, das Sportprogramm und das Semesterticket。" },
        { q: "Internationale Studierende brauchen für Deutschland kein Visum.", qzh: "国际学生赴德不需要签证。", a: "falsch", why: "第三段：Ohne diesen Nachweis bekommen Sie kein Visum——说明签证是必需的。" },
        { q: "Im Jahr 2026 muss man 992 Euro pro Monat auf dem Sperrkonto nachweisen.", qzh: "2026 年须证明冻结账户每月有 992 欧元。", a: "richtig", why: "第三段：11.904 Euro, also 992 Euro pro Monat。" },
        { q: "In der Mensa kostet ein Essen etwa zehn Euro.", qzh: "食堂一餐约十欧元。", a: "falsch", why: "第四段：für drei bis fünf Euro。" }
      ],
      mcq: [
        { q: "Was finanziert der Semesterbeitrag NICHT?", qzh: "学期费不用于什么？", opts: ["Die Mensa", "Das Sportprogramm", "Die private Krankenversicherung"], a: 2, why: "第二段只提到 Mensa、Sportprogramm、Semesterticket，未涉及医保。" },
        { q: "Wie viel Geld muss man 2026 auf dem Sperrkonto nachweisen?", qzh: "2026 年冻结账户需证明多少钱？", opts: ["11.904 Euro", "992 Euro", "9.900 Euro"], a: 0, why: "第三段：11.904 Euro（992 是月均）。" },
        { q: "Was ist im Text kein Spartipp?", qzh: "文中哪个不是省钱建议？", opts: ["Im Wohnheim wohnen", "In der Mensa essen", "Mit dem Flugzeug reisen"], a: 2, why: "第四段讲宿舍、食堂、学期票，未提飞机。" }
      ],
      words: [
        { de: "die Studiengebühr, -en", zh: "学费" }, { de: "der Beitritt / der Beitrag, -träge", zh: "费用；会费" },
        { de: "die Lebenshaltungskosten (Pl.)", zh: "生活费" }, { de: "sperren", zh: "冻结" },
        { de: "das Sperrkonto, -konten", zh: "冻结账户" }, { de: "der Nachweis, -e", zh: "证明" }
      ]
    },
    {
      id: "versicherung", lv: "B1", theme: "留学生活",
      title: "Krankenversicherung: wichtig für alle Studierenden",
      titleZh: "医疗保险：对所有学生都重要",
      src: "德国医保须知改写",
      paras: [
        { de: "In Deutschland muss jeder Mensch krankenversichert sein. Auch internationale Studierende brauchen eine Versicherung, und zwar vom ersten Semester an. Ohne Versicherung kann man sich nicht immatrikulieren.", zh: "在德国，每个人都必须参加医疗保险。国际学生同样需要保险，且从第一学期起就要有。没有保险就无法注册入学。" },
        { de: "Studierende haben zwei Möglichkeiten. Die gesetzliche Krankenversicherung (GKV) kostet für Studierende unter 30 Jahren etwa 120 Euro pro Monat. Das ist teuer, aber der Schutz ist groß: Arztbesuche, Medikamente und Krankenhausaufenthalte sind weitgehend abgedeckt. Die private Krankenversicherung (PKV) ist oft günstiger, aber sie deckt nicht immer alles ab.", zh: "学生有两种选择。法定医疗保险（GKV）对 30 岁以下学生每月约 120 欧元。虽贵但保障全：就诊、药品和住院基本都在覆盖范围内。私人医疗保险（PKV）通常更便宜，但并不总能覆盖所有项目。" },
        { de: "Wer aus einem EU-Land kommt, kann manchmal seine Versicherungskarte aus dem Heimatland benutzen. Dann braucht man keine deutsche Versicherung. Studierende aus anderen Ländern müssen sich in Deutschland versichern.", zh: "来自欧盟国家的人有时可以使用本国的保险卡，这样就不需要在德国另购保险。来自其他国家的学生则必须在德国投保。" },
        { de: "Ein wichtiger Tipp: Wer länger als sechs Monate in Deutschland bleibt, sollte die Versicherung direkt nach der Ankunft abschließen. Die Bearbeitung dauert oft mehrere Wochen, und ohne gültige Versicherung darf keine Universität einen Studierenden einschreiben.", zh: "重要提示：凡在德国停留超过六个月者，应在抵达后立即办理保险。办理过程往往需要数周，而没有有效保险，任何大学都不得为学生注册。" }
      ],
      headings: ["Versicherungspflicht für alle", "Gesetzlich oder privat", "Studierende aus der EU", "Früh genug abschließen"],
      headingZh: ["人人必须参保", "法定还是私人", "来自欧盟的学生", "尽早办理"],
      headingAns: [0, 1, 2, 3],
      tfng: [
        { q: "Ohne Krankenversicherung ist keine Immatrikulation möglich.", qzh: "没有医保就无法注册。", a: "richtig", why: "第一段末句。" },
        { q: "Die GKV kostet für Studierende unter 30 Jahren etwa 120 Euro im Monat.", qzh: "GKV 对 30 岁以下学生每月约 120 欧元。", a: "richtig", why: "第二段原文数字。" },
        { q: "Die private Versicherung deckt immer mehr ab als die gesetzliche.", qzh: "私人保险总比法定保险覆盖更多。", a: "falsch", why: "原文说 PKV「nicht immer alles abdeckt」，GKV 的 Schutz ist groß。" },
        { q: "EU-Studierende brauchen nie eine deutsche Versicherung.", qzh: "欧盟学生从不需要德国保险。", a: "falsch", why: "原文是「manchmal」可以用本国保险卡，并非「nie」。" },
        { q: "Die Bearbeitung einer Versicherung dauert oft nur wenige Tage.", qzh: "保险办理通常只需几天。", a: "falsch", why: "第四段：mehrere Wochen。" }
      ],
      mcq: [
        { q: "Was ist im Text kein Vorteil der GKV?", qzh: "文中哪个不是 GKV 的优点？", opts: ["Arztbesuche sind abgedeckt", "Medikamente sind abgedeckt", "Sie ist sehr günstig"], a: 2, why: "第二段说 GKV「teuer」，PKV 才 günstiger。" },
        { q: "Wer kann manchmal die Versicherungskarte aus dem Heimatland nutzen?", qzh: "谁有时可以用本国的保险卡？", opts: ["Studierende aus Asien", "Studierende aus EU-Ländern", "Alle internationalen Studierenden"], a: 1, why: "第三段第一句。" },
        { q: "Wie lange dauert die Bearbeitung oft?", qzh: "办理通常要多久？", opts: ["Wenige Tage", "Mehrere Wochen", "Ein Jahr"], a: 1, why: "第四段：mehrere Wochen。" }
      ],
      words: [
        { de: "krankenversichert", zh: "参加医疗保险的" }, { de: "gesetzlich", zh: "法定的" },
        { de: "abdecken", zh: "覆盖（费用）" }, { de: "der Aufenthalt, -e", zh: "停留" },
        { de: "gültig", zh: "有效的" }, { de: "die Bearbeitung, -en", zh: "办理；处理" }
      ]
    },
    {
      id: "nebenjob", lv: "B1", theme: "留学生活",
      title: "Nebenjob: Was Studierende wissen müssen",
      titleZh: "打工：学生必须知道的事",
      src: "国际学生打工规定改写",
      paras: [
        { de: "Viele internationale Studierende arbeiten neben dem Studium. Das hat zwei Vorteile: Man verdient Geld und verbessert gleichzeitig sein Deutsch. Aber es gibt Regeln, die man kennen muss.", zh: "许多国际学生一边读书一边打工。这有两个好处：既能赚钱，又能同时提高德语。但有一些规定是必须了解的。" },
        { de: "Studierende aus Ländern außerhalb der EU dürfen höchstens 140 volle Tage pro Jahr arbeiten, oder 280 halbe Tage. Wer mehr arbeitet, verstößt gegen das Aufenthaltsgesetz. Studierende aus der EU dürfen unbeschränkt arbeiten.", zh: "非欧盟国家的学生每年最多可打工 140 个全天，或 280 个半天。超时即违反居留法。欧盟学生则不受限制。" },
        { de: "Vor dem Job sollte man prüfen, ob der Verdienst das BAföG oder ein Stipendium beeinflusst. Wer zu viel verdient, verliert manchmal die Förderung. Auch der Krankenversicherungsstatus kann sich ändern, wenn man mehr als etwa 20 Stunden pro Woche arbeitet.", zh: "打工前应核实收入是否影响 BAföG 助学金或奖学金。收入过高者有时会失去资助。每周工作超过约 20 小时，医保状态也可能发生变化。" },
        { de: "Beliebte Jobs für Studierende sind: Hiwi an der Universität, Kellner im Café, Nachhilfe für Schüler und Lieferdienst. Als Hiwi verdient man etwa 15 bis 17 Euro pro Stunde und lernt dabei die Universität von innen kennen. Nachhilfe ist besonders für Studierende geeignet, die ihre Muttersprache gut beherrschen.", zh: "受学生欢迎的工作有：大学助教（Hiwi）、咖啡馆服务员、中小学生家教和配送服务。做 Hiwi 时薪约 15 至 17 欧元，还能借此深入了解大学。家教特别适合母语掌握得好的学生。" }
      ],
      headings: ["Zwei gute Gründe für einen Job", "Die 140-Tage-Regel", "Achtung: BAföG und Versicherung", "Diese Jobs nehmen Studierende gern"],
      headingZh: ["打工的两个理由", "140 天规定", "注意：助学金与保险", "学生爱做的四类工作"],
      headingAns: [0, 1, 2, 3],
      tfng: [
        { q: "Ein Nebenjob hilft auch beim Deutschlernen.", qzh: "打工也有助于学德语。", a: "richtig", why: "第一段：verbessert gleichzeitig sein Deutsch。" },
        { q: "Nicht-EU-Studierende dürfen 200 volle Tage pro Jahr arbeiten.", qzh: "非欧盟学生每年可打工 200 个全天。", a: "falsch", why: "原文是 140 volle Tage。" },
        { q: "Wer zu viel verdient, kann sein BAföG verlieren.", qzh: "收入过高可能失去 BAföG。", a: "richtig", why: "第三段：verliert manchmal die Förderung。" },
        { q: "Als Hiwi verdient man etwa 15 bis 17 Euro pro Stunde.", qzh: "做 Hiwi 时薪约 15 到 17 欧元。", a: "richtig", why: "第四段原文数字。" },
        { q: "EU-Studierende dürfen höchstens 280 halbe Tage arbeiten.", qzh: "欧盟学生最多只能打工 280 个半天。", a: "falsch", why: "第二段：EU-Studierende dürfen unbeschränkt arbeiten（不受限）。" }
      ],
      mcq: [
        { q: "Wie viele volle Tage dürfen Nicht-EU-Studierende pro Jahr arbeiten?", qzh: "非欧盟学生每年可打工多少全天？", opts: ["140", "280", "200"], a: 0, why: "第二段：140 volle Tage。" },
        { q: "Was kann sich ändern, wenn man mehr als 20 Stunden pro Woche arbeitet?", qzh: "每周工作超 20 小时可能改变什么？", opts: ["Das Visum", "Der Krankenversicherungsstatus", "Der Studienplatz"], a: 1, why: "第三段末句。" },
        { q: "Welcher Job steht NICHT im Text?", qzh: "文中没提到哪种工作？", opts: ["Hiwi", "Kellner", "Zahnarzt"], a: 2, why: "第四段列举 Hiwi、Kellner、Nachhilfe、Lieferdienst。" }
      ],
      words: [
        { de: "der Nebenjob, -s", zh: "兼职打工" }, { de: "verdienen", zh: "赚得" },
        { de: "verstoßen gegen", zh: "违反" }, { de: "das Aufenthaltsgesetz, -e", zh: "居留法" },
        { de: "unbeschränkt", zh: "无限制的" }, { de: "die Förderung, -en", zh: "资助" },
        { de: "die Nachhilfe, -n", zh: "家教辅导" }, { de: "beherrschen", zh: "掌握" }
      ]
    }
  ];

  /* 阅读池 = 内置精编短文 + 导入的内容包（tools/reading_pipeline.py 产物，独立 content-pack-reading.json） */
  const pool = () => PASSAGES.concat(((window.LD.Store && window.LD.Store.s.contentPack || {}).reading) || []);

  const QTYPES = [
    { k: "heading", nm: "小标题匹配", en: "Überschriften zuordnen", ic: "▤", desc: "为每个段落选出最贴切的小标题，训练段落主旨抓取" },
    { k: "tfng", nm: "判断正误", en: "Richtig / Falsch / Nicht im Text", ic: "◑", desc: "判断陈述与原文的关系：正确 / 错误 / 原文未提及" },
    { k: "mcq", nm: "细节理解", en: "Multiple Choice", ic: "◎", desc: "根据原文细节作答，训练信息检索速度" }
  ];

  let cur = null;          // 当前短文
  let ans = null;          // 作答 { heading:[], tfng:[], mcq:[] }
  let submitted = false;
  let zhOpen = true;       // 中文译文显隐
  let examMode = false;    // 考试模式：限时 + 提交前不给中文
  let taskApplied = "";
  let deadline = 0;        // 考试模式的截止时间戳
  let rdFilter = { lv: "all", len: "all" };
  let rdTick = null;

  const words = p => (p.paras || []).reduce((a, x) => a + String(x.de || "").split(/\s+/).filter(Boolean).length, 0);
  /* 建议用时：读约 90 词/分钟，题目约 40 秒/题，向上取整到分钟 */
  const examSecs = p => Math.max(4, Math.ceil(words(p) / 90 + (p.headings.length + p.tfng.length + p.mcq.length) * 40 / 60));

  const Mod = {
    title: "阅读理解",
    desc: "TestDaF / 歌德题型：小标题匹配 / 判断正误 / 细节理解，配中文译文与逐题解析",
    render(host, ctx) {
      window.LD.Store.visit("reading");
      const taskCtx = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("reading") : null;
      if (taskCtx && taskApplied !== taskCtx.taskId) {
        taskApplied = taskCtx.taskId;
        examMode = !!(taskCtx.spec && taskCtx.spec.timed) || taskCtx.text.includes("限时");
      }
      const saved = taskCtx && taskCtx.data && taskCtx.data.reading;
      if (taskCtx && !saved) { cur = null; submitted = false; }
      if (saved && saved.paperId) {
        const hit = pool().find(p => p.id === saved.paperId);
        if (hit) {
          cur = hit;
          ans = {
            heading: Array.isArray(saved.ans && saved.ans.heading) ? saved.ans.heading.slice(0, hit.headings.length) : Array(hit.headings.length).fill(-1),
            tfng: Array.isArray(saved.ans && saved.ans.tfng) ? saved.ans.tfng.slice(0, hit.tfng.length) : Array(hit.tfng.length).fill(""),
            mcq: Array.isArray(saved.ans && saved.ans.mcq) ? saved.ans.mcq.slice(0, hit.mcq.length) : Array(hit.mcq.length).fill(-1)
          };
          while (ans.heading.length < hit.headings.length) ans.heading.push(-1);
          while (ans.tfng.length < hit.tfng.length) ans.tfng.push("");
          while (ans.mcq.length < hit.mcq.length) ans.mcq.push(-1);
          submitted = !!saved.submitted;
          examMode = !!saved.examMode;
          zhOpen = saved.zhOpen !== false;
          deadline = +saved.deadline || 0;
        }
      }
      if (!cur) return list(host, ctx);
      renderPaper(host, ctx);
    }
  };

  /* ---------- 列表页 ---------- */
  function list(host, ctx) {
    const done = S().readingDone || {};
    const activeRun = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("reading") : null;
    const timedTask = !!(activeRun && activeRun.spec && activeRun.spec.timed);
    const orderedPool = pool().slice().sort((a, b) => ((done[a.id] && done[a.id].times) || 0) - ((done[b.id] && done[b.id].times) || 0));
    const filtered = orderedPool.filter(p => {
      if (rdFilter.lv !== "all" && p.lv !== rdFilter.lv) return false;
      const w = words(p);
      if (rdFilter.len === "s" && w > 150) return false;
      if (rdFilter.len === "m" && (w <= 150 || w > 320)) return false;
      if (rdFilter.len === "l" && w <= 320) return false;
      return true;
    });
    host.innerHTML = `
      <div class="page-head"><h1>阅读理解</h1>
        <p>共 ${pool().length} 篇可用短文${filtered.length !== pool().length ? ` · 当前筛选 ${filtered.length} 篇` : ""}；优先展示练习次数较少的内容。题型接近 TestDaF / 歌德阅读训练，不代表官方真题。</p></div>
      ${LD.FirstWeek ? LD.FirstWeek.notice(LD.FirstWeek.contextFor("reading")) : ""}
      <div class="rd-filters">
        <span class="rd-filter-label">长度</span>
        ${[["all", "全部"], ["s", "短文 ≤150 词"], ["m", "中 151–320 词"], ["l", "长 >320 词"]].map(([k, n]) =>
          `<button type="button" class="btn btn-sm rd-chip ${rdFilter.len === k ? "active" : ""}" data-len="${k}">${n}</button>`).join("")}
        <span class="rd-filter-label">等级</span>
        ${[["all", "全部"]].concat([...new Set(pool().map(p => p.lv))].sort().map(l => [l, l])).map(([k, n]) =>
          `<button type="button" class="btn btn-sm rd-chip ${rdFilter.lv === k ? "active" : ""}" data-lv="${k}">${n}</button>`).join("")}
        <button type="button" class="btn btn-sm ${examMode ? "btn-primary" : ""}" id="rdExamMode" ${timedTask ? "disabled title='今日任务已锁定限时模式'" : ""}>${timedTask ? "任务限时：已开启" : examMode ? "考试模式：已开" : "考试模式：关"}</button>
        <span class="hint" style="margin:0">考试模式：按篇幅与题量给出限时，提交前不给中文译文。</span>
      </div>
      <div class="card card-pad" style="margin-bottom:14px;border-color:var(--accent)" ${activeRun ? "hidden" : ""}>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <b style="font-size:14px">AI 生成阅读题</b>
            <div class="hint" style="margin:2px 0 0">题库做完时按等级与主题生成原创短文 + 题目；生成内容标注「AI 生成 · 未人工审校」。</div>
          </div>
          <select id="aiReadLevel" style="width:auto">${(window.LD.AIGen ? LD.AIGen.LEVELS : ["A2", "B1", "B2", "C1", "C2"]).map(l => `<option value="${l}" ${l === "B2" ? "selected" : ""}>${l}</option>`).join("")}</select>
          <input id="aiReadTopic" type="text" placeholder="主题（可选）" style="width:180px">
          <button class="btn btn-primary" id="aiReadGen">生成 1 套</button>
        </div>
        <div id="aiReadOut" class="hint" style="margin-top:6px"></div>
      </div>
      <div class="grid g2">
        ${filtered.map(p => {
          const rec = done[p.id];
          const total = p.headings.length + p.tfng.length + p.mcq.length;
          const w = words(p);
          const source = p.src || (p.source === "ai" ? "AI 生成 · 未人工审校" : "内置内容");
          const trust = p.source === "ai" || /AI 生成|待校对/.test(source) ? "AI 生成 · 未人工审校" : "内置内容 · 人工编写";
          return `<button class="card card-pad reading-card" type="button" data-p="${esc(p.id)}" aria-label="开始阅读：${esc(p.title)}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <h3 style="margin:0;font-size:15px;line-height:1.5" class="de">${esc(p.title)}</h3>
              <span class="tag ${p.lv === "A2" ? "tag-ok" : "tag-blue"}">${p.lv}</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-3);margin-top:4px">${p.titleZh ? esc(p.titleZh) + " · " : ""}${esc(p.theme || "综合")} · ${p.paras.length} 段 / ${w} 词 · 建议 ${examSecs(p)} 分钟</div>
            <div class="content-source" title="${esc(source)}">来源：${esc(source)}${p.fetchedAt ? ` · ${esc(p.fetchedAt)}` : ""} · <b>${esc(trust)}</b></div>
            <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
              ${QTYPES.map(q => `<span class="tag">${q.ic} ${q.nm}</span>`).join("")}
            </div>
            <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12px;color:var(--text-3)">${rec ? `已练 ${rec.times} 次 · 最好 ${rec.best}/${total}` : `未练 · 共 ${total} 题`}</span>
              <span class="btn btn-sm btn-primary">${rec ? "重做" : "开始"}</span>
            </div>
          </button>`;
        }).join("")}
      </div>
      ${filtered.length ? "" : `<div class="card card-pad empty"><div class="big">▤</div><strong>当前筛选下没有短文</strong><p>换一下长度或等级，或回到「全部」。</p></div>`}
      <div class="card card-pad" style="margin-top:14px">
        <h3 style="margin:0 0 10px;font-size:15px">阅读策略（TestDaF 考生向）</h3>
        <div style="font-size:13px;line-height:1.9;color:var(--text-2)">
          <div>· 先读题干再读文章：带着问题扫读（skimming），不要逐字翻译</div>
          <div>· 抓「信号词」：aber, weil, deshalb, trotzdem 后常是考点</div>
          <div>· 判断正误题警惕绝对化词：nie, immer, alle, nur —— 多为错误选项</div>
          <div>· 「原文未提及」≠ 错误：文中找不到依据时才选，忌主观推断</div>
        </div>
      </div>`;
    [...host.querySelectorAll(".rd-chip")].forEach(c => c.onclick = () => {
      if (c.dataset.len) rdFilter.len = c.dataset.len;
      if (c.dataset.lv) rdFilter.lv = c.dataset.lv;
      list(host, ctx);
    });
    const examBtn = host.querySelector("#rdExamMode");
    if (examBtn) examBtn.onclick = () => {
      examMode = !examMode;
      toast(examMode ? "考试模式已开：限时作答，提交前不给中文译文" : "考试模式已关：可看中文译文与导语", "info");
      list(host, ctx);
    };
    host.querySelectorAll("[data-p]").forEach(c => c.onclick = () => {
      cur = pool().find(p => p.id === c.dataset.p);
      startPaper();
      renderPaper(host, ctx);
    });
    const aiBtn = host.querySelector("#aiReadGen");
    if (aiBtn) aiBtn.onclick = async () => {
      const out = host.querySelector("#aiReadOut");
      if (!window.LD.AIGen) { out.textContent = "AI 出题模块未加载"; return; }
      aiBtn.disabled = true;
      const old = aiBtn.textContent;
      aiBtn.textContent = "生成中…";
      out.textContent = "正在生成，通常需要 10–30 秒…";
      const r = await LD.AIGen.generateReading({
        level: host.querySelector("#aiReadLevel").value,
        topic: host.querySelector("#aiReadTopic").value.trim()
      });
      aiBtn.disabled = false;
      aiBtn.textContent = old;
      if (!r.ok) { out.textContent = r.message || "生成失败"; return; }
      out.textContent = `已生成《${r.item.titleZh}》；正在打开。`;
      cur = r.item;
      startPaper();
      renderPaper(host, ctx);
    };
  }

  function startPaper() {
    ans = { heading: Array(cur.headings.length).fill(-1), tfng: Array(cur.tfng.length).fill(""), mcq: Array(cur.mcq.length).fill(-1) };
    submitted = false;
    zhOpen = !examMode;                    // 考试模式：交卷前不给中文
    deadline = examMode ? Date.now() + examSecs(cur) * 60000 : 0;
  }

  const clockText = () => {
    if (!deadline) return "";
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    return (left > 0 ? "剩余 " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") : "时间到，仍可继续作答并提交");
  };
  function saveRun() {
    const c = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("reading") : null;
    if (!c || !cur) return;
    window.LD.FirstWeek.update(c, { data: Object.assign({}, c.data || {}, {
      reading: { paperId: cur.id, ans, submitted, examMode, deadline, zhOpen }
    }) });
  }
  function scoreOf(p) {
    let ok = 0, answered = 0;
    p.headings.forEach((_, i) => { if (ans.heading[i] >= 0) answered++; if (ans.heading[i] === p.headingAns[i]) ok++; });
    p.tfng.forEach((x, i) => { if (ans.tfng[i]) answered++; if (ans.tfng[i] === x.a) ok++; });
    p.mcq.forEach((x, i) => { if (ans.mcq[i] >= 0) answered++; if (ans.mcq[i] === x.a) ok++; });
    const total = p.headings.length + p.tfng.length + p.mcq.length;
    return { ok, total, answered, pct: total ? Math.round(ok / total * 100) : 0 };
  }

  /* ---------- 试卷页 ---------- */
  function renderPaper(host, ctx) {
    const p = cur;
    const total = p.headings.length + p.tfng.length + p.mcq.length;
    const sc = scoreOf(p);
    const answered = sc.answered;
    const run = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("reading") : null;
    const saved = run && run.data && run.data.reading;
    const taskPaper = !!(run && saved && saved.paperId === p.id);
    const receipt = (submitted && taskPaper && window.LD.FirstWeek)
      ? window.LD.FirstWeek.receipt(run, {
        embedded: true,
        title: "本次阅读回执",
        summary: `答对 ${sc.ok}/${sc.total}`,
        detail: `正确率 ${sc.pct}% · 已答 ${sc.answered}/${sc.total} 题`,
        evidence: "阅读作答",
        source: "reading-round",
        label: "完成阅读任务"
      })
      : "";

    host.innerHTML = `
      ${receipt}
      <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <button class="btn btn-sm btn-ghost" id="back">← 返回列表</button>
          <h1 style="margin-top:8px" class="de">${p.title}</h1>
          <p>${examMode && !submitted ? "" : (p.titleZh ? p.titleZh + " · " : "")}难度 ${p.lv} · 来源：${p.src} · 共 ${total} 题 · 建议用时 ${examSecs(p)} 分钟${examMode ? " · 考试模式：交卷前隐藏中文译文" : ""} · 点击正文中的德语单词可查词并收藏</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${examMode && !submitted ? `<span class="rd-clock ${deadline && deadline - Date.now() < 60000 ? "low" : ""}" id="rdClock">${clockText()}</span>` : ""}
          <button class="btn btn-sm" id="toggleZh">${zhOpen ? "隐藏" : "显示"}中文译文</button>
        </div>
      </div>

      ${LD.FirstWeek ? LD.FirstWeek.notice(LD.FirstWeek.contextFor("reading")) : ""}

      <div class="grid" style="grid-template-columns:1fr 300px">
        <div>
          <div class="card card-pad" style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <span class="tag tag-blue">阅读材料</span>
              <span class="hint" style="margin:0">已答 ${answered} / ${total}</span>
            </div>
            ${p.paras.map((x, i) => `
              <div style="margin-bottom:14px;padding-left:10px;border-left:3px solid var(--brand-soft)">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
                  <span class="tag">第 ${i + 1} 段</span>
                  <button class="btn btn-sm" data-parse="${i}">解析</button>
                </div>
                <div class="de wl-ctx" data-wctx="${window.LD.WordLink ? LD.WordLink.attr(x.de.slice(0, 120)) : ""}" style="font-size:14.5px;line-height:1.85">${window.LD.WordLink ? LD.WordLink.linkHTML(x.de) : x.de}</div>
                <div id="parse-${i}" style="display:none"></div>
                ${(zhOpen && x.zh) ? `<div class="rd-zh" style="font-size:12.5px;color:var(--text-3);margin-top:6px;line-height:1.7">${x.zh}</div>` : ""}
              </div>`).join("")}
            <div class="divider"><span>生词提示</span></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${p.words.map(w => `<span class="tag" title="${w.zh}"><b class="de">${w.de}</b> ${w.zh}</span>`).join("")}
            </div>
          </div>

          ${QTYPES.map(qt => questionBlock(qt, p)).join("")}

          <div class="card card-pad" style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="submitBtn" ${submitted ? "disabled" : ""}>提交答案（${answered}/${total}）</button>
            <button class="btn btn-ghost" id="resetBtn">重做</button>
            ${submitted ? `<span class="tag tag-blue">已批改</span>` : `<span class="hint" style="margin:0">可先跳过，最后一起提交</span>`}
          </div>
        </div>

        <div class="card card-pad" style="align-self:flex-start;position:sticky;top:76px">
          <h2 style="margin:0 0 8px;font-size:13.5px">${QTYPES[0].ic} 题型说明</h2>
          ${QTYPES.map(qt => `<div style="margin-bottom:10px">
            <div style="font-weight:600;font-size:13px">${qt.nm}</div>
            <div style="font-size:12px;color:var(--text-3);line-height:1.7">${qt.desc}</div></div>`).join("")}
          <div class="divider"><span>进度</span></div>
          <div class="progress-line" style="margin-top:0"><i style="width:${answered / total * 100}%"></i></div>
          <div class="hint">共 ${total} 题，已答 ${answered} 题</div>
        </div>
      </div>`;

    host.querySelector("#back").onclick = () => { cur = null; if (rdTick) { clearInterval(rdTick); rdTick = null; } list(host, ctx); };
    host.querySelector("#toggleZh").onclick = () => {
      if (examMode && !submitted) { toast("考试模式下译文要等交卷后才给", "info"); return; }
      zhOpen = !zhOpen; renderPaper(host, ctx);
    };
    if (rdTick) { clearInterval(rdTick); rdTick = null; }
    if (examMode && !submitted) {
      rdTick = setInterval(() => {
        const el = host.querySelector("#rdClock");
        if (!el || submitted || !deadline) { if (rdTick) clearInterval(rdTick); rdTick = null; return; }
        el.textContent = clockText();
        el.classList.toggle("low", deadline - Date.now() < 60000);
      }, 1000);
    }
    host.querySelector("#resetBtn").onclick = () => { startPaper(); renderPaper(host, ctx); };
    const sb = host.querySelector("#submitBtn");
    if (sb) sb.onclick = () => submit(host, ctx);

    // 绑定题型控件
    host.querySelectorAll("[data-h]").forEach(sel => sel.onchange = () => {
      ans.heading[+sel.dataset.h] = +sel.value;
      if (!submitted) renderPaper(host, ctx);
    });
    host.querySelectorAll("[data-t]").forEach(b => b.onclick = () => {
      ans.tfng[+b.dataset.t] = b.dataset.v;
      if (!submitted) renderPaper(host, ctx);
    });
    host.querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
      ans.mcq[+b.dataset.m] = +b.dataset.v;
      if (!submitted) renderPaper(host, ctx);
    });
    if (window.LD.WordLink) window.LD.WordLink.bind(host, { mode: "popover", module: "阅读理解", ctx: p.title });
    host.querySelectorAll("[data-parse]").forEach(b => b.onclick = () => toggleParse(host, b, +b.dataset.parse, p));
    saveRun();
  }

  function questionBlock(qt, p) {
    if (qt.k === "heading") {
      const used = new Set(ans.heading.filter(x => x >= 0));
      return `<div class="card card-pad" style="margin-bottom:14px">
        <h3 style="margin:0 0 4px;font-size:15px">一、${qt.nm}</h3>
        <div class="hint" style="margin:0 0 12px">为下面 ${p.headings.length} 个段落选择最贴切的小标题。</div>
        ${p.paras.map((x, i) => `
          <div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line-soft)">
            <span class="tag">第 ${i + 1} 段</span>
            <div class="de" style="flex:1;font-size:13px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.de.slice(0, 60)}…</div>
            <select data-h="${i}" style="width:220px">
              <option value="-1">选择小标题…</option>
              ${p.headings.map((h, j) => {
                const sel = ans.heading[i] === j;
                const dis = !sel && used.has(j) ? "disabled" : "";
                return `<option value="${j}" ${sel ? "selected" : ""} ${dis}>${String.fromCharCode(65 + j)}. ${h}${(zhOpen && p.headingZh[j]) ? "（" + p.headingZh[j] + "）" : ""}</option>`;
              }).join("")}
            </select>
            ${submitted ? mark(ans.heading[i] === p.headingAns[i]) : ""}
          </div>`).join("")}
        ${submitted ? `<div class="hint">正确答案：${p.headingAns.map((a, i) => `第 ${i + 1} 段 → ${String.fromCharCode(65 + a)}. ${p.headings[a]}`).join("；")}</div>` : ""}
      </div>`;
    }
    if (qt.k === "tfng") {
      return `<div class="card card-pad" style="margin-bottom:14px">
        <h3 style="margin:0 0 4px;font-size:15px">二、${qt.nm}</h3>
        <div class="hint" style="margin:0 0 12px">richtig（正确）／ falsch（错误）／ nicht im Text（原文未提及）。警惕 nie / immer / alle / nur 等绝对化表述。</div>
        ${p.tfng.map((x, i) => `
          <div style="padding:12px 0;border-bottom:1px solid var(--line-soft)">
            <div class="de" style="font-size:14px;font-weight:500">${i + 1}. ${x.q}</div>
            <div style="font-size:12.5px;color:var(--text-3);margin-top:2px">${x.qzh}</div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
              ${["richtig", "falsch", "nicht im Text"].map(v => `
                <div class="scene-chip ${ans.tfng[i] === v ? "active" : ""}" data-t="${i}" data-v="${v}">${v}</div>`).join("")}
              ${submitted ? mark(ans.tfng[i] === x.a) : ""}
            </div>
            ${submitted ? `<div class="hint" style="margin-top:6px">答案：${x.a} —— ${x.why}</div>` : ""}
          </div>`).join("")}
      </div>`;
    }
    return `<div class="card card-pad" style="margin-bottom:14px">
      <h3 style="margin:0 0 4px;font-size:15px">三、${qt.nm}</h3>
      <div class="hint" style="margin:0 0 12px">根据原文选择正确答案。</div>
      ${p.mcq.map((x, i) => `
        <div style="padding:12px 0;border-bottom:1px solid var(--line-soft)">
          <div class="de" style="font-size:14px;font-weight:500">${i + 1}. ${x.q}</div>
          <div style="font-size:12.5px;color:var(--text-3);margin-top:2px">${x.qzh}</div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
            ${x.opts.map((o, j) => `
              <div class="list-item ${ans.mcq[i] === j ? "active" : ""}" data-m="${i}" data-v="${j}" style="cursor:pointer;border:1px solid var(--line);border-radius:9px;padding:8px 12px">
                <span class="tag">${String.fromCharCode(65 + j)}</span>
                <div class="main"><div class="t1 de" style="font-size:13px">${o}</div></div>
                ${submitted && j === x.a ? '<span style="color:var(--ok);font-weight:700">✓ 正确答案</span>' : ""}
              </div>`).join("")}
          </div>
          ${submitted ? mark(ans.mcq[i] === x.a) + `<div class="hint" style="margin-top:6px">解析：${x.why}</div>` : ""}
        </div>`).join("")}
    </div>`;
  }

  const mark = ok => `<span style="margin-left:8px;color:${ok ? "var(--ok)" : "var(--danger)"};font-weight:700">${ok ? "✓" : "✕"}</span>`;

  /* ---------- 批改 ---------- */
  function submit(host, ctx) {
    const p = cur;
    const sc = scoreOf(p);
    if (!sc.total) { toast("这篇短文没有可提交的题目", "err"); return; }
    if (!sc.answered) { toast("至少回答一题再提交；空卷不会记入任务完成", "err"); return; }
    submitted = true;
    if (rdTick) { clearInterval(rdTick); rdTick = null; }
    if (examMode) zhOpen = true;          // 交卷后才放开中文译文
    const detail = [];
    p.headings.forEach((_, i) => detail.push({ q: `标题匹配 第${i + 1}段`, ok: ans.heading[i] === p.headingAns[i] }));
    p.tfng.forEach((x, i) => detail.push({ q: `判断正误 第${i + 1}题`, ok: ans.tfng[i] === x.a }));
    p.mcq.forEach((x, i) => detail.push({ q: `细节理解 第${i + 1}题`, ok: ans.mcq[i] === x.a }));

    // 记录成绩
    const s = S();
    s.readingDone = s.readingDone || {};
    const rec = s.readingDone[p.id] || { best: 0, times: 0 };
    rec.best = Math.max(rec.best, sc.ok); rec.times += 1;
    s.readingDone[p.id] = rec;
    window.LD.Store.save();

    // 学习流水 + BKT
    window.LD.Store.logAnswer({ type: "reading", ability: "reading", ok: sc.pct >= 60, ms: sc.total * 20000, item: p.title, skill: "read:" + p.id });
    if (sc.pct < 60) {
      detail.filter(d => !d.ok).forEach(d => window.LD.Store.addWrong({
        module: "阅读理解", type: d.q, wrong: "（未答对）", right: "见试卷解析", source: p.titleZh || p.title, why: `${p.titleZh || p.title} · ${d.q} 需复盘`
      }));
    }
    window.LD.Store.addSession({ module: "reading", ms: sc.total * 20000, count: sc.total });

    const c = window.LD.FirstWeek ? window.LD.FirstWeek.contextFor("reading") : null;
    const rd = c && c.data && c.data.reading;
    if (c && rd && rd.paperId === p.id && window.LD.FirstWeek) {
      window.LD.FirstWeek.evidence(c, "阅读作答");
      window.LD.FirstWeek.update(c, { progress: Math.max(+c.progress || 0, sc.answered), data: Object.assign({}, c.data || {}, {
        reading: { paperId: p.id, ans, submitted: true, examMode, deadline, zhOpen }
      }) });
    }
    renderPaper(host, ctx);
    const receipt = host.querySelector(".fw-receipt");
    if (receipt) receipt.scrollIntoView({ behavior: "smooth", block: "start" });
    else host.scrollIntoView({ behavior: "smooth" });
    toast(`已批改：答对 ${sc.ok}/${sc.total}`, sc.pct >= 60 ? "ok" : "info");
  }

  /* 模块元数据：分组 / 图标 / 名称 / 优先级 / 顺序 / 简介（导航与首页据此渲染） */
  Object.assign(Mod, { label: "阅读理解", icon: "▣", group: "沉淀与复盘", priority: "P0", order: 14, ds: "TestDaF/歌德题型：小标题匹配 / 判断正误 / 细节理解" });
  window.LD.define("reading", Mod);
  window.LD_READING_PASSAGES = pool();
  window.LD.ReadingPool = pool;
})();
