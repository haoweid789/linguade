"""Build a provenance-preserving SQLite library for open German learning data.

Inputs:
  .content-cache/merlin/merlin-de.json
  .content-cache/tatoeba/audio-list-500.json
  .content-cache/sentences_with_audio.tar.bz2

Output:
  backend/data/learning_content.sqlite (MERLIN learner texts + CC BY/CC0 audio)

Run after refreshing the source caches with --refresh-tatoeba. The script only
imports explicitly open, non-NC audio and keeps per-record license metadata.
"""
import argparse
import csv
import io
import json
import os
import re
import sqlite3
import tempfile
import tarfile
import urllib.request


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MERLIN = os.path.join(ROOT, ".content-cache", "merlin", "merlin-de.json")
TATOEBA_SAMPLE = os.path.join(ROOT, ".content-cache", "tatoeba", "audio-list-500.json")
TATOEBA_INDEX = os.path.join(ROOT, ".content-cache", "sentences_with_audio.tar.bz2")
AUDIO_CACHE = os.path.join(ROOT, ".content-cache", "tatoeba", "audio")
DB_PATH = os.path.join(ROOT, "backend", "data", "learning_content.sqlite")
TATOEBA_API = "https://api.tatoeba.org/unstable/sentences?lang=deu&has_audio=yes&limit=500&sort=random"
MERLIN_URL = "https://huggingface.co/datasets/UniversalCEFR/merlin_de"
TATOEBA_URL = "https://tatoeba.org/en/sentences/show/{}"
TATOEBA_AUDIO_URL = "https://audio.tatoeba.org/sentences/deu/{}.mp3"


def fetch(url, timeout=90):
    request = urllib.request.Request(url, headers={"User-Agent": "LinguaDE-content-import/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def refresh_tatoeba():
    os.makedirs(os.path.dirname(TATOEBA_SAMPLE), exist_ok=True)
    raw = fetch(TATOEBA_API)
    with io.open(TATOEBA_SAMPLE, "wb") as output:
        output.write(raw)
    print("Tatoeba candidates:", len(json.loads(raw).get("data", [])))


def load_audio_index(sentence_ids):
    if not os.path.exists(TATOEBA_INDEX):
        raise FileNotFoundError("Missing Tatoeba license index: " + TATOEBA_INDEX)
    result = {}
    wanted = set(sentence_ids)
    with tarfile.open(TATOEBA_INDEX, "r:bz2") as archive:
        raw = archive.extractfile("sentences_with_audio.csv")
        for line in raw:
            fields = line.decode("utf-8", "replace").rstrip("\n").split("\t")
            if len(fields) >= 5 and fields[0] in wanted:
                # sentence id / audio id / username / license / attribution URL
                result[fields[0]] = {
                    "audio_id": fields[1], "speaker": fields[2],
                    "license": fields[3], "speaker_url": fields[4],
                }
    return result


def is_redistributable_audio(license_name):
    lic = (license_name or "").strip().upper()
    if "NC" in lic or "ND" in lic:
        return False
    return lic == "CC0" or lic.startswith("CC BY ") or lic.startswith("CC BY 4")


def clean_candidates():
    if not os.path.exists(TATOEBA_SAMPLE):
        raise FileNotFoundError("Missing Tatoeba candidates; run with --refresh-tatoeba")
    with io.open(TATOEBA_SAMPLE, encoding="utf-8") as source:
        entries = json.load(source).get("data", [])
    by_id = {str(row.get("id")): row for row in entries if row.get("id") is not None}
    audio = load_audio_index(set(by_id))
    seen, selected = set(), []
    for sentence_id, row in by_id.items():
        text = str(row.get("text") or "").strip()
        words = text.split()
        meta = audio.get(sentence_id)
        if not meta or not is_redistributable_audio(meta["license"]):
            continue
        if row.get("is_unapproved") or not (4 <= len(words) <= 18):
            continue
        if any(char.isdigit() for char in text) or "http" in text.lower():
            continue
        normalized = re.sub(r"[^\wäöüß]+", " ", text.lower()).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        selected.append({
            "asset_id": "tatoeba:" + sentence_id,
            "source_id": sentence_id,
            "text": text,
            "text_license": row.get("license") or "CC BY 2.0 FR",
            "audio_license": meta["license"],
            "speaker": meta["speaker"],
            "speaker_url": meta["speaker_url"],
            "audio_url": TATOEBA_AUDIO_URL.format(sentence_id),
            "source_url": TATOEBA_URL.format(sentence_id),
        })
        if len(selected) >= 50:
            break
    return selected


def load_audio(row):
    os.makedirs(AUDIO_CACHE, exist_ok=True)
    file_path = os.path.join(AUDIO_CACHE, row["source_id"] + ".mp3")
    if not os.path.exists(file_path) or os.path.getsize(file_path) < 256:
        content = fetch(row["audio_url"])
        if not (content.startswith(b"ID3") or (len(content) > 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0)):
            raise ValueError("Not a valid MP3 for " + row["source_id"])
        with open(file_path, "wb") as output:
            output.write(content)
    with open(file_path, "rb") as source:
        return source.read()


def merlin_rows():
    if not os.path.exists(MERLIN):
        raise FileNotFoundError("Missing MERLIN seed: " + MERLIN)
    with io.open(MERLIN, encoding="utf-8") as source:
        rows = json.load(source)
    result = []
    for row in rows:
        text = sanitize_learner_text(row.get("text") or "")
        level = str(row.get("cefr_level") or "").upper()
        title = str(row.get("title") or "").strip()
        if not text or not title or level not in {"A1", "A2", "B1", "B2", "C1", "C2"}:
            continue
        result.append({
            "asset_id": "merlin:" + title,
            "source_id": title,
            "text": text,
            "level": level,
            "source_url": "https://www.merlin-platform.eu/",
            "license": "CC BY-SA 4.0",
        })
    return result


def sanitize_learner_text(value):
    """Remove direct contact/address details before learner work reaches the UI."""
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    salutation = re.compile(r"^\s*(Sehr geehrte|Sehr geehrter|Hallo|Liebe[rn]?|Guten Tag)\b", re.I)
    first_salutation = next((i for i, line in enumerate(lines[:12]) if salutation.search(line)), None)
    address_line = re.compile(r"\b\d{5}\b|(?:straße|str\.?|gasse|weg|allee|platz|ring)\s+\d", re.I)
    if first_salutation is not None and address_line.search("\n".join(lines[:first_salutation])):
        lines = lines[first_salutation:]

    email = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
    phone = re.compile(r"(?<!\w)(?:\+?\d[\d\s()./-]{6,}\d)(?!\w)")
    cleaned = []
    for line in lines:
        if address_line.search(line):
            continue
        cleaned.append(phone.sub("[Telefonnummer entfernt]", email.sub("[E-Mail entfernt]", line)).rstrip())
    text = "\n".join(cleaned).strip()
    closing = re.search(r"(?im)^\s*(?:mit freundlichen gr(?:ü|ue|u)ßen|hochachtungsvoll|liebe gr(?:ü|ue|u)ße|viele gr(?:ü|ue|u)ße|bis bald)\s*[,.!]*\s*$", text)
    if closing:
        text = text[:closing.end()].rstrip()
    return text


def create_schema(conn):
    conn.executescript("""
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS content_assets (
        asset_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'de',
        level TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        text_license TEXT NOT NULL DEFAULT '',
        audio_license TEXT NOT NULL DEFAULT '',
        attribution TEXT NOT NULL DEFAULT '',
        audio_mime TEXT NOT NULL DEFAULT '',
        audio_blob BLOB,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_content_kind_level ON content_assets(kind, level);
      CREATE TABLE IF NOT EXISTS corpus_licenses (
        source TEXT PRIMARY KEY,
        dataset_title TEXT NOT NULL,
        license TEXT NOT NULL,
        source_url TEXT NOT NULL,
        attribution TEXT NOT NULL,
        note TEXT NOT NULL
      );
      DELETE FROM content_assets;
      DELETE FROM corpus_licenses;
    """)


def build():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix="learning_content_", suffix=".sqlite",
                                     dir=os.path.dirname(DB_PATH))
    os.close(fd)
    conn = sqlite3.connect(temp_path)
    try:
        create_schema(conn)
        statement = """INSERT INTO content_assets
          (asset_id,kind,language,level,text,source,source_id,source_url,text_license,
           audio_license,attribution,audio_mime,audio_blob,metadata_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""
        essays = merlin_rows()
        conn.executemany(statement, [(
            row["asset_id"], "writing", "de", row["level"], row["text"],
            "MERLIN", row["source_id"], row["source_url"], row["license"], "",
            "MERLIN Corpus, German learner text " + row["source_id"] + " (CC BY-SA 4.0)",
            "", None,
            json.dumps({"rating": "human CEFR re-rating", "category": "learner"}, ensure_ascii=False),
        ) for row in essays])

        candidate_audio = clean_candidates()
        audio_rows = []
        for row in candidate_audio:
            blob = load_audio(row)
            attribution = "Tatoeba sentence {} (text {}); audio by {} ({})".format(
                row["source_id"], row["text_license"], row["speaker"], row["audio_license"])
            audio_rows.append((
                row["asset_id"], "listening", "de", "", row["text"], "Tatoeba",
                row["source_id"], row["source_url"], row["text_license"], row["audio_license"],
                attribution, "audio/mpeg", blob,
                json.dumps({"speaker": row["speaker"], "speaker_url": row["speaker_url"],
                            "audio_url": row["audio_url"]}, ensure_ascii=False),
            ))
        conn.executemany(statement, audio_rows)
        conn.executemany("""INSERT INTO corpus_licenses
          (source,dataset_title,license,source_url,attribution,note) VALUES (?,?,?,?,?,?)""", [
            ("MERLIN", "MERLIN German learner corpus", "CC BY-SA 4.0",
             "https://www.merlin-platform.eu/",
             "MERLIN project / Eurac Research; learner-text IDs retained.",
             "This 1,033-record German snapshot provides one overall human CEFR label per text, not the full criterion ratings. Direct contact/address details and signatures are removed in the product copy. Share adaptations under CC BY-SA 4.0."),
            ("Tatoeba", "Tatoeba German sentences and per-item recordings", "CC BY 2.0 FR; audio per item",
             "https://tatoeba.org/eng/downloads",
             "Text attribution is per sentence; audio attribution records the contributor and license.",
             "Only non-NC, non-ND audio with explicit license is stored; each record carries its own audio license."),
        ])
        conn.execute("INSERT OR REPLACE INTO corpus_licenses VALUES (?,?,?,?,?,?)", (
            "database", "LinguaDE learning content library", "Mixed per-record license",
            "", "See each asset row and corpus_licenses by source.",
            "Not a single-license database: every record has a text/audio license and source attribution."))
        conn.commit()
        conn.close()
        conn = None
        os.replace(temp_path, DB_PATH)
        print("Database:", DB_PATH)
        print("MERLIN writing samples:", len(essays))
        print("Tatoeba licensed audio samples:", len(audio_rows))
        print("Database bytes:", os.path.getsize(DB_PATH))
    finally:
        if conn is not None:
            conn.close()
        if os.path.exists(temp_path):
            os.remove(temp_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-tatoeba", action="store_true",
                        help="Fetch a new random 500-row audio-backed sample from Tatoeba")
    parser.add_argument("--build", action="store_true", help="Build/update the SQLite database")
    args = parser.parse_args()
    if args.refresh_tatoeba:
        refresh_tatoeba()
    if args.build or not args.refresh_tatoeba:
        build()


if __name__ == "__main__":
    main()
