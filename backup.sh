#!/bin/bash
# VNCaro Database Backup - chạy lúc 3h sáng hàng ngày
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/vncaro_backups"
DB_PATH="/var/www/vncaro/vncaro.db"
LOG="/root/vncaro_backup.log"

mkdir -p "$BACKUP_DIR"
DEST="$BACKUP_DIR/vncaro_${DATE}.db"

node -e "
const {DatabaseSync}=require('node:sqlite');
try {
  const db=new DatabaseSync('$DB_PATH');
  db.exec(\"VACUUM INTO '$DEST'\");
  const u=db.prepare('SELECT COUNT(*) as c FROM users').get();
  const g=db.prepare('SELECT COUNT(*) as c FROM games').get();
  console.log('Backup OK: $DATE | users=' + u.c + ' | games=' + g.c);
} catch(e){
  console.error('Backup FAILED:', e.message);
  process.exit(1);
}
" >> "$LOG" 2>&1

if [ \$? -eq 0 ]; then
  find "$BACKUP_DIR" -name "vncaro_*.db" -mtime +30 -delete 2>/dev/null
  echo "[$(date)] Cleanup done. Files: $(ls $BACKUP_DIR | wc -l)" >> "$LOG"
else
  echo "[$(date)] BACKUP FAILED!" >> "$LOG"
fi
