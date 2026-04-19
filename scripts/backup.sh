#!/usr/bin/env bash
# PACS Medical Backup Script — HIPAA / Ley 26.529 art. 14 (Argentina)
# Retención: 10 años (3650 días) para adultos
# Ejecutar como cron: 0 2 * * * /path/to/scripts/backup.sh >> /var/log/pacs-backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/backups/pacs}"
DATE=$(date +%Y%m%d_%H%M%S)
STORAGE_ROOT="${STORAGE_ROOT:-${SCRIPT_DIR}/../storage}"
RETENTION_DAYS="${RETENTION_DAYS:-3650}"

mkdir -p "${BACKUP_ROOT}/db" "${BACKUP_ROOT}/files"

echo "[BACKUP] Iniciando backup: ${DATE}"

# 1. Backup MySQL — usa DATABASE_URL del entorno
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[BACKUP] ERROR: DATABASE_URL no está configurado"
  exit 1
fi

# Extraer credenciales de DATABASE_URL (formato: mysql://user:pass@host:port/dbname)
DB_USER=$(echo "${DATABASE_URL}" | sed -E 's|mysql://([^:]+):.*|\1|')
DB_PASS=$(echo "${DATABASE_URL}" | sed -E 's|mysql://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "${DATABASE_URL}" | sed -E 's|mysql://[^@]+@([^:/]+).*|\1|')
DB_PORT=$(echo "${DATABASE_URL}" | sed -E 's|mysql://[^@]+@[^:]+:([0-9]+)/.*|\1|')
DB_NAME=$(echo "${DATABASE_URL}" | sed -E 's|mysql://[^/]+/([^?]+).*|\1|')

export MYSQL_PWD="${DB_PASS}"
mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${DB_NAME}" \
  > "${BACKUP_ROOT}/db/pacs_${DATE}.sql"
gzip "${BACKUP_ROOT}/db/pacs_${DATE}.sql"

# 2. Backup storage (DICOM files + PDFs)
rsync -av --delete "${STORAGE_ROOT}/" "${BACKUP_ROOT}/files/"

# 3. Verificar integridad
md5sum "${BACKUP_ROOT}/db/pacs_${DATE}.sql.gz" > "${BACKUP_ROOT}/db/pacs_${DATE}.sql.gz.md5"

# 4. Limpiar backups DB más viejos que RETENTION_DAYS
find "${BACKUP_ROOT}/db/" -name "*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
find "${BACKUP_ROOT}/db/" -name "*.sql.gz.md5" -mtime "+${RETENTION_DAYS}" -delete

# 5. Escribir status file para el endpoint /api/admin/backup/status
BACKUP_SIZE=$(du -sb "${BACKUP_ROOT}/db/pacs_${DATE}.sql.gz" 2>/dev/null | awk '{print $1}' || echo 0)
STATUS_FILE="${BACKUP_STATUS_FILE:-${BACKUP_ROOT}/last_backup.json}"
cat > "${STATUS_FILE}" <<EOF
{
  "lastBackupAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "lastBackupFile": "pacs_${DATE}.sql.gz",
  "lastBackupSizeBytes": ${BACKUP_SIZE}
}
EOF

echo "[BACKUP] Completado: ${DATE}"
