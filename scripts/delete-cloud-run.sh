#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOTENV_FILE="${DOTENV_FILE:-${REPO_ROOT}/.env}"

load_dotenv_file() {
  local file="$1"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" != *"="* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"

    if [[ "${key}" =~ ^export[[:space:]]+ ]]; then
      key="${key#export }"
      key="${key#"${key%%[![:space:]]*}"}"
    fi
    if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    if [[ "${value}" == \"*\" && "${value}" == *\" && "${#value}" -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value}" == \'*\' && "${#value}" -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "${key}=${value}"
  done <"${file}"
}

if [[ -f "${DOTENV_FILE}" ]]; then
  load_dotenv_file "${DOTENV_FILE}"
fi

usage() {
  cat <<'EOF'
Delete vibent Cloud Run services in Google Cloud.

Usage:
  scripts/delete-cloud-run.sh [options]

Options:
  --project          GCP project id (default: vibent-488403)
  --region           GCP region (default: us-central1)
  --service-prefix   Service name prefix (default: vibent)
  --services         Comma-separated delete targets: api,web,worker (default: api,web,worker)
  --help             Show this help

Examples:
  scripts/delete-cloud-run.sh
  scripts/delete-cloud-run.sh --services web
  scripts/delete-cloud-run.sh --project my-gcp-project --region us-east1 --service-prefix vibent-prod
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

log() {
  echo
  echo "==> $1"
}

PROJECT_ID="${PROJECT_ID:-vibent-488403}"
REGION="${REGION:-us-central1}"
SERVICE_PREFIX="${SERVICE_PREFIX:-vibent}"
SERVICES="${SERVICES:-api,web,worker}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --service-prefix)
      SERVICE_PREFIX="$2"
      shift 2
      ;;
    --services)
      SERVICES="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

DELETE_API=false
DELETE_WEB=false
DELETE_WORKER=false
IFS=',' read -r -a SELECTED_SERVICES <<<"${SERVICES}"
for raw in "${SELECTED_SERVICES[@]}"; do
  service="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "${service}" in
    api)
      DELETE_API=true
      ;;
    web)
      DELETE_WEB=true
      ;;
    worker)
      DELETE_WORKER=true
      ;;
    "")
      ;;
    *)
      echo "Invalid value in --services: ${raw}. Allowed values: api,web,worker" >&2
      exit 1
      ;;
  esac
done

if [[ "${DELETE_API}" == "false" && "${DELETE_WEB}" == "false" && "${DELETE_WORKER}" == "false" ]]; then
  echo "No delete targets selected. Use --services with at least one of: api,web,worker" >&2
  exit 1
fi

require_cmd gcloud

API_SERVICE="${SERVICE_PREFIX}-api"
WEB_SERVICE="${SERVICE_PREFIX}-web"
WORKER_SERVICE="${SERVICE_PREFIX}-worker"

service_exists() {
  local service="$1"
  gcloud run services describe "${service}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='value(metadata.name)' >/dev/null 2>&1
}

delete_service() {
  local service="$1"
  if service_exists "${service}"; then
    log "Deleting Cloud Run service ${service}"
    gcloud run services delete "${service}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --quiet
  else
    log "Skipping ${service} (not found)"
  fi
}

log "Setting gcloud project"
gcloud config set project "${PROJECT_ID}" >/dev/null

DELETED_SERVICES=()

if [[ "${DELETE_WEB}" == "true" ]]; then
  delete_service "${WEB_SERVICE}"
  DELETED_SERVICES+=("web")
fi

if [[ "${DELETE_WORKER}" == "true" ]]; then
  delete_service "${WORKER_SERVICE}"
  DELETED_SERVICES+=("worker")
fi

if [[ "${DELETE_API}" == "true" ]]; then
  delete_service "${API_SERVICE}"
  DELETED_SERVICES+=("api")
fi

cat <<EOF

Delete complete.

Project: ${PROJECT_ID}
Region: ${REGION}
Service prefix: ${SERVICE_PREFIX}
Services requested for deletion: ${DELETED_SERVICES[*]}
EOF
