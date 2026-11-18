"""Read-only access to the bundled, license-attributed learning corpus."""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
import sqlite3


router = APIRouter(prefix="/api/content", tags=["learning content"])
DB_PATH = Path(__file__).resolve().parents[1] / "data" / "learning_content.sqlite"


def _connect():
    if not DB_PATH.is_file():
        raise HTTPException(503, "学习语料库尚未构建")
    uri = DB_PATH.resolve().as_uri() + "?mode=ro"
    try:
        return sqlite3.connect(uri, uri=True, timeout=3)
    except sqlite3.Error as exc:
        raise HTTPException(503, "学习语料库暂时不可用") from exc


def _public(row):
    return {
        "asset_id": row[0], "level": row[1], "text": row[2], "source": row[3],
        "source_id": row[4], "source_url": row[5], "text_license": row[6],
        "audio_license": row[7], "attribution": row[8], "audio_mime": row[9],
        "metadata": json.loads(row[10] or "{}"),
        "audio_url": "/api/content/audio?asset_id=" + row[0] if row[9] else "",
    }


@router.get("/writing")
def writing_samples(level: str = Query("", pattern=r"^(|A1|A2|B1|B2|C1|C2)$"),
                    limit: int = Query(10, ge=1, le=30)):
    """Random sample of human CEFR-rated writing examples (not paginated)."""
    with _connect() as conn:
        rows = conn.execute("""SELECT asset_id,level,text,source,source_id,source_url,
            text_license,audio_license,attribution,audio_mime,metadata_json
            FROM content_assets WHERE kind='writing' AND (?='' OR level=?)
            ORDER BY RANDOM() LIMIT ?""", (level, level, limit)).fetchall()
    return {"items": [_public(row) for row in rows], "count": len(rows)}


@router.get("/listening")
def listening_assets(limit: int = Query(30, ge=1, le=50)):
    """Random sample of licensed listening recordings (not paginated)."""
    with _connect() as conn:
        rows = conn.execute("""SELECT asset_id,level,text,source,source_id,source_url,
            text_license,audio_license,attribution,audio_mime,metadata_json
            FROM content_assets WHERE kind='listening' ORDER BY RANDOM() LIMIT ?""",
            (limit,)).fetchall()
    return {"items": [_public(row) for row in rows], "count": len(rows)}


@router.get("/audio")
def audio(asset_id: str = Query(..., min_length=1, max_length=120)):
    with _connect() as conn:
        row = conn.execute("SELECT audio_mime,audio_blob FROM content_assets WHERE asset_id=? AND kind='listening'",
                           (asset_id,)).fetchone()
    if not row or not row[1]:
        raise HTTPException(404, "找不到这段已授权录音")
    return Response(content=row[1], media_type=row[0] or "application/octet-stream",
                    headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"})
