"""把前端词库（app/data/lexicon-*.js）导入数据库
用法： python3 scripts/import_lexicon.py [词库目录]
"""
import asyncio
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models import Word, init_db  # noqa: E402


async def main(data_dir: str):
    words = []
    for f in sorted(glob.glob(os.path.join(data_dir, "lexicon-*.js"))):
        src = open(f, encoding="utf-8").read()
        m = re.search(r"concat\((\[.*\])\);", src, re.S)
        arr = json.loads(m.group(1))
        words.extend(arr)
    print(f"解析到 {len(words)} 个词条")

    from app.models import SessionLocal, engine
    from sqlalchemy import select, func
    await init_db()
    async with SessionLocal() as s:
        existing = set((await s.execute(select(Word.de))).scalars().all())
        added = 0
        for w in words:
            de, art, zh, pos, lv, ex, exzh = w
            if de in existing:
                continue
            s.add(Word(de=de, art=art, zh=zh, pos=pos, level=lv,
                       example=ex, example_zh=exzh))
            existing.add(de)
            added += 1
        await s.commit()
        total = (await s.execute(select(func.count()).select_from(Word))).scalar()
    print(f"新增 {added} 条，词库总计 {total} 条")
    await engine.dispose()


if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "../app/data"
    asyncio.run(main(d))
