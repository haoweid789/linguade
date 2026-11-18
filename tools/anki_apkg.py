#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LinguaDE · B9 Anki apkg 工具（Python 标准库，零依赖）

用法：
  python tools/anki_apkg.py --build <deck.json> <out.apkg>
      deck.json = [{"front": "...", "back": "...", "tags": "a b"}, ...]
      生成合法 .apkg（collection.anki2：col/notes/cards/decks 表，Basic 模型 Front/Back，\x1f 分隔字段）。
  python tools/anki_apkg.py --inspect <in.apkg>
      解包读取 SQLite，打印 notes 计数与 3 条样例。

注意：首版纯文本卡片（无媒体）；.apkg 结构按 Anki 旧版 schema（compatible with 2.1.x 导入）。
"""
import argparse
import json
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

# Anki schema 常量（旧版 collection.anki2，2.1.x 兼容）
COL = {
    "id": 1724120720,
    "mod": 0,
    "scm": 0,
    "ver": 11,
    "dty": 0,
    "usn": 0,
    "ls": 0,
    "conf": {
        "decks": {},
        "curDeck": 1,
        "newSpread": 25,
        "dueCounts": True,
        "curModel": None,
        "collapseTime": 1200,
    },
    "decks": {
        "1": {
            "id": 1,
            "name": "LinguaDE",
            "desc": "",
            "mod": 0,
            "usn": -1,
            "collapsed": False,
            "browserCollapsed": True,
            "newToday": [0, 0],
            "revToday": [0, 0],
            "lrnToday": [0, 0],
            "timeToday": [0, 0],
            "dyn": 0,
            "extendNew": 10,
            "extendRev": 50,
            "conf": 1,
            "rev": {"bury": False, "ivlFct": 1.0, "maxIvl": 36500, "perDay": 200, "ease4": 1.3},
            "new": {"bury": True, "delays": [1.0, 10.0], "initialFactor": 2.5, "ints": [1, 4, 7], "order": 1, "perDay": 20},
            "lapse": {"delays": [10.0], "leechFails": 8, "leechIvl": 0, "maxIvl": 36500, "mult": 0.0},
        }
    },
}

MODEL = {
    "id": 1557050659,
    "name": "Basic",
    "type": 0,
    "mod": 0,
    "usn": -1,
    "sortf": 0,
    "did": 1,
    "tmpls": [
        {
            "name": "Card 1",
            "ord": 0,
            "qfmt": "{{Front}}",
            "afmt": '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}',
            "bqfmt": "",
            "bafmt": "",
            "did": None,
            "bqm": False,
            "bafm": False,
        }
    ],
    "flds": [
        {"name": "Front", "ord": 0, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
        {"name": "Back", "ord": 1, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
    ],
    "css": ".card {\n font-family: Arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n",
    "latexPre": "",
    "latexPost": "",
    "req": [],
    "tags": [],
    "vers": [],
}


def build_apkg(cards, out_path):
    """cards: [{front, back, tags}] → out.apkg"""
    now = 1700000000
    with tempfile.TemporaryDirectory() as td:
        db_path = Path(td) / "collection.anki2"
        con = sqlite3.connect(str(db_path))
        cur = con.cursor()
        cur.execute(
            "CREATE TABLE col ("
            "id integer primary key, crt integer not null, mod integer not null,"
            " scm integer not null, ver integer not null, dty integer not null,"
            " usn integer not null, ls integer not null, conf text not null,"
            " models text not null, decks text not null, dconf text not null,"
            " tags text not null)"
        )
        cur.execute(
            "CREATE TABLE notes ("
            " id integer primary key, guid text not null, mid integer not null,"
            " mod integer not null, usn integer not null, tags text not null,"
            " flds text not null, sfld integer not null, csum integer not null,"
            " flags integer not null, data text not null)"
        )
        cur.execute(
            "CREATE TABLE cards ("
            " id integer primary key, nid integer not null, did integer not null,"
            " ord integer not null, mod integer not null, usn integer not null,"
            " type integer not null, queue integer not null, due integer not null,"
            " ivl integer not null, factor integer not null, reps integer not null,"
            " lapses integer not null, left integer not null, odue integer not null,"
            " odid integer not null, flags integer not null, data text not null)"
        )
        cur.execute(
            "CREATE TABLE revlog ("
            " id integer primary key, cid integer not null, usn integer not null,"
            " ease integer not null, ivl integer not null, lastIvl integer not null,"
            " factor integer not null, time integer not null, type integer not null)"
        )
        cur.execute(
            "CREATE TABLE graves (usn integer not null, oid integer not null, nid integer not null)"
        )
        import json as _json

        cur.execute(
            "INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                COL["id"],
                now,
                now,
                now,
                COL["ver"],
                COL["dty"],
                COL["usn"],
                COL["ls"],
                _json.dumps(COL["conf"]),
                _json.dumps({str(MODEL["id"]): MODEL}),
                _json.dumps(COL["decks"]),
                _json.dumps({str(1): {"id": 1, "name": "Default", "mod": 0}}),
                "",
            ),
        )
        for idx, c in enumerate(cards):
            note_id = now + idx * 1000
            flds = "\x1f".join([c.get("front", ""), c.get("back", "")])
            guid = "ld%010x" % (idx + 1)
            cur.execute(
                "INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    note_id,
                    guid,
                    MODEL["id"],
                    now,
                    -1,
                    " " + (c.get("tags") or "").strip() + " ",
                    flds,
                    0,
                    0,
                    0,
                    "",
                ),
            )
            cur.execute(
                "INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    note_id,
                    note_id,
                    1,
                    0,
                    now,
                    -1,
                    0,
                    0,
                    note_id,
                    0,
                    2500,
                    0,
                    0,
                    0,
                    0,
                    0,
                    "",
                    "",
                ),
            )
        con.commit()
        con.close()
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(db_path, "collection.anki2")
            z.writestr("media", "{}")
    return len(cards)


def inspect_apkg(in_path):
    with zipfile.ZipFile(in_path) as z:
        names = z.namelist()
        if "collection.anki2" not in names:
            print("无 collection.anki2（可能带前缀 collection.anki21 或损坏）:", names[:5])
            return 1
        with tempfile.TemporaryDirectory() as td:
            db_path = Path(td) / "c.anki2"
            db_path.write_bytes(z.read("collection.anki2"))
            con = sqlite3.connect(str(db_path))
            cur = con.cursor()
            n = cur.execute("SELECT count(*) FROM notes").fetchone()[0]
            print("notes:", n)
            for row in cur.execute("SELECT flds, tags FROM notes LIMIT 3"):
                flds = row[0].split("\x1f")
                print("  front:", flds[0][:60], "| back:", flds[1][:40] if len(flds) > 1 else "", "| tags:", row[1].strip())
            con.close()
    return 0


def main():
    ap = argparse.ArgumentParser(description="LinguaDE Anki apkg 工具")
    ap.add_argument("--build", nargs=2, metavar=("DECK_JSON", "OUT_APKG"))
    ap.add_argument("--inspect", metavar="IN_APKG")
    args = ap.parse_args()
    if args.build:
        cards = json.loads(Path(args.build[0]).read_text(encoding="utf-8"))
        n = build_apkg(cards, args.build[1])
        print(f"已生成 {args.build[1]}（{n} notes）")
        return 0
    if args.inspect:
        return inspect_apkg(args.inspect)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())