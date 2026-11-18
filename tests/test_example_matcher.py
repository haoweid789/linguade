# -*- coding: utf-8 -*-
"""例句匹配器的结构性用例（纯 Python，不启浏览器）

覆盖「体检器/选句器认不出来的深层结构」：情态 + 可分动词、从句 + 情态、
完成时（含强变化分词）、情态被动、zu-不定式、双不定式，以及必须拒绝的同形误配。
词形表来自 german_exam.db；缺库时整体跳过（选句器此时只剩规则模式）。
"""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import import_german_exam_db as imp  # noqa: E402
import lexicon_audit as audit  # noqa: E402

DB = imp.DEFAULT_DB
needs_db = pytest.mark.skipif(
    not os.path.exists((DB or "").replace("\\", "/")), reason="需要 german_exam.db 提供词形表")

POSITIVE = [
    # 情态 + 可分动词（不定式在句末）
    ("abholen", "v", "Er muss die Fahrkarte morgen früh abholen."),
    # 从句 + 情态
    ("abholen", "v", "..., weil er die Fahrkarte abholen muss."),
    # 完成时 / 强变化分词
    ("abholen", "v", "Er hat die Fahrkarte gestern abgeholt."),
    ("aufgeben", "v", "Sie hat den Plan längst aufgegeben."),
    ("teilnehmen", "v", "Er hat am Kurs teilgenommen."),
    ("nehmen", "v", "Sie hat den Bus genommen."),
    ("geben", "v", "Sie hat mir das Buch gegeben."),
    ("schlafen", "v", "Er hat bis zehn geschlafen."),
    ("sehen", "v", "Ich habe ihn gestern gesehen."),
    # 情态被动
    ("abholen", "v", "Die Fahrkarte muss morgen abgeholt werden."),
    # zu-不定式
    ("abholen", "v", "Er versucht, die Fahrkarte noch abzuholen."),
    ("kennenlernen", "v", "Wir haben uns im Kurs kennengelernt."),
    # 主句拆分（前缀落句末）与第二位置变位
    ("abholen", "v", "Er holt die Fahrkarte morgen ab."),
    ("abhängen", "v", "Es hängt stark von den Eltern ab."),
    ("abhängen", "v", "Das hängt davon ab, wie viel Zeit wir haben."),
    ("aufgeben", "v", "Sie gibt den Plan nicht auf."),
    ("annehmen", "v", "Wir nehmen an, dass er kommt."),
    ("vorschlagen", "v", "Ich schlage vor, dass wir warten."),
    ("teilnehmen", "v", "Nimmst du am Kurs teil?"),
    # 双不定式（情态 + 另一不定式）
    ("abholen", "v", "Er muss den Zug abholen lassen."),
    # 情态动词自身的变形（含强变化与虚拟）
    ("müssen", "v", "Ich muss heute länger arbeiten."),
    ("müssen", "v", "Das hättest du nicht gemusst."),
    ("können", "v", "Er konnte gestern nicht kommen."),
    ("dürfen", "v", "Hier darf man nicht rauchen."),
    ("wollen", "v", "Sie wollte uns gestern besuchen."),
    # 命令式（强变化裸词干）
    ("nehmen", "v", "Nimm dir Zeit."),
    ("geben", "v", "Gib mir das Buch."),
    ("essen", "v", "Iss mehr Gemüse."),
    ("sehen", "v", "Sieh dir das an."),
]

NEGATIVE = [
    # 前缀 + 词根凑巧同现，但不是该可分动词
    ("einstellen", "v", "Kann ich ein paar Fragen stellen?"),
    ("ausmachen", "v", "Ich hasse diese Spinnen; wegen denen flippe ich jedes Mal aus."),
    ("ansehen", "v", "Schalte das Licht an. Ich kann nichts sehen."),
    ("zusagen", "v", "Um die Wahrheit zu sagen, habe ich Angst."),
    ("aufladen", "v", "Ich lade dich auf einen Drink ein."),
    # 词形相似但不是这个词
    ("warnen", "v", "Das wär klasse."),
    ("ändern", "v", "Nimm den anderen Stuhl!"),
    ("dienen", "v", "Die Erde ist rund."),
]


def _hit(word, pos, sentence):
    single, multi, sep = imp.form_sets(word, pos, audit.db_forms().get(word.lower(), []))
    toks, soft, ends, early, _n = imp.sent_pack(sentence)
    return imp.sentence_hit(pos, toks, soft, ends, early, single, multi, sep)


@needs_db
@pytest.mark.parametrize("word,pos,sentence", POSITIVE)
def test_deep_structures_match(word, pos, sentence):
    assert _hit(word, pos, sentence), "应命中：%s ← %s" % (word, sentence)


@needs_db
@pytest.mark.parametrize("word,pos,sentence", NEGATIVE)
def test_lookalike_sentences_rejected(word, pos, sentence):
    assert not _hit(word, pos, sentence), "不该命中：%s ← %s" % (word, sentence)
