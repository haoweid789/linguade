#!/bin/sh
# 每日热备 SQLite；保留 7 天。备份内含 LLM Key 与密码哈希，目录/文件权限收到 700/600。
set -eu
DIR=/opt/auto-deploy/linguade
mkdir -p "$DIR/data/backup"
chmod 700 "$DIR/data/backup"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="/data/backup/linguade-$STAMP.db"
docker exec linguade-backend-1 python -c "import sqlite3,sys; s=sqlite3.connect('/data/linguade.db'); d=sqlite3.connect('$FILE'); s.backup(d); r=d.execute('PRAGMA integrity_check').fetchone()[0]; d.close(); s.close(); sys.exit(0 if r=='ok' else 1)"
chmod 600 "$DIR/data/backup/linguade-$STAMP.db"
find "$DIR/data/backup" -name 'linguade-*.db' -mtime +7 -delete
echo "$(date '+%F %T') backup ok: $FILE ($(du -h "$DIR/data/backup/linguade-$STAMP.db" | cut -f1))"
