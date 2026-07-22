#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/zyapp}"
COMPOSE_FILE="${DEPLOY_DIR}/infra/deploy/compose.production.yml"
ENV_FILE="${DEPLOY_DIR}/infra/deploy/production.env"
BACKUP_DIR="${BACKUP_DIR:-${DEPLOY_DIR}/infra/deploy/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

umask 077
mkdir -p "${BACKUP_DIR}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ENVIRONMENTS="${BACKUP_ENVIRONMENTS:-production test}"
for environment in ${BACKUP_ENVIRONMENTS}; do
  if [ "${environment}" != "production" ] && [ "${environment}" != "test" ]; then
    echo "Unsupported backup environment: ${environment}" >&2
    exit 1
  fi
  if [ "${environment}" = "production" ]; then
    database_variable='POSTGRES_DB'
  else
    database_variable='TEST_POSTGRES_DB'
  fi
  backup_file="${BACKUP_DIR}/zyapp-${environment}-${timestamp}.dump"
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
    sh -lc "exec pg_dump -U \"\$POSTGRES_USER\" -d \"\$${database_variable}\" --format=custom --compress=9" \
    >"${backup_file}"
  sha256sum "${backup_file}" >"${backup_file}.sha256"
  echo "Backup created: ${backup_file}"
done
find "${BACKUP_DIR}" -type f -mtime "+${RETENTION_DAYS}" \
  \( -name 'zyapp-*.dump' -o -name 'zyapp-*.dump.sha256' \) -delete
