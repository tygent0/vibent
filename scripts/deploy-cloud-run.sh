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

# Auto-load .env so deploy credentials/settings can be kept in one place.
if [[ -f "${DOTENV_FILE}" ]]; then
  load_dotenv_file "${DOTENV_FILE}"
fi

usage() {
  cat <<'EOF'
Deploy or redeploy vibent to Google Cloud Run.

Usage:
  scripts/deploy-cloud-run.sh [options]

Options:
  --project            GCP project id (default: vibent-488403)
  --region             GCP region (default: us-central1)
  --artifact-repo      Artifact Registry docker repo name (default: vibent)
  --service-prefix     Service name prefix (default: vibent)
  --services           Comma-separated deploy targets: api,web,worker (default: api,web,worker)
  --image-tag          Image tag override (default: UTC timestamp + git sha)
  --mock-github        true|false (default: false)
  --web-url-override   Use this final web URL for API OAuth allowlist checks
  --help               Show this help

Environment variables used when --mock-github=false:
  GITHUB_CLIENT_ID
  GITHUB_CLIENT_SECRET
  VIBENT_SESSION_SECRET
  GITHUB_WEBHOOK_SECRET (optional; default: dev-secret)

Examples:
  scripts/deploy-cloud-run.sh
  scripts/deploy-cloud-run.sh --services api
  scripts/deploy-cloud-run.sh --services api,web
  scripts/deploy-cloud-run.sh --project my-gcp-project --region us-east1 --service-prefix vibent-prod
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

log() {
  echo
  echo "==> $1"
}

PROJECT_ID="${PROJECT_ID:-vibent-488403}"
REGION="${REGION:-us-central1}"
ARTIFACT_REPO="${ARTIFACT_REPO:-vibent}"
SERVICE_PREFIX="${SERVICE_PREFIX:-vibent}"
IMAGE_TAG="${IMAGE_TAG:-}"
VIBENT_MOCK_GITHUB="${VIBENT_MOCK_GITHUB:-false}"
WEB_URL_OVERRIDE="${WEB_URL_OVERRIDE:-}"
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
    --artifact-repo)
      ARTIFACT_REPO="$2"
      shift 2
      ;;
    --service-prefix)
      SERVICE_PREFIX="$2"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --services)
      SERVICES="$2"
      shift 2
      ;;
    --mock-github)
      VIBENT_MOCK_GITHUB="$2"
      shift 2
      ;;
    --web-url-override)
      WEB_URL_OVERRIDE="$2"
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

if [[ "$VIBENT_MOCK_GITHUB" != "true" && "$VIBENT_MOCK_GITHUB" != "false" ]]; then
  echo "--mock-github must be true or false" >&2
  exit 1
fi

DEPLOY_API=false
DEPLOY_WEB=false
DEPLOY_WORKER=false
IFS=',' read -r -a SELECTED_SERVICES <<<"${SERVICES}"
for raw in "${SELECTED_SERVICES[@]}"; do
  service="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "${service}" in
    api)
      DEPLOY_API=true
      ;;
    web)
      DEPLOY_WEB=true
      ;;
    worker)
      DEPLOY_WORKER=true
      ;;
    "")
      ;;
    *)
      echo "Invalid value in --services: ${raw}. Allowed values: api,web,worker" >&2
      exit 1
      ;;
  esac
done

if [[ "${DEPLOY_API}" == "false" && "${DEPLOY_WEB}" == "false" && "${DEPLOY_WORKER}" == "false" ]]; then
  echo "No deploy targets selected. Use --services with at least one of: api,web,worker" >&2
  exit 1
fi

if [[ -z "$IMAGE_TAG" ]]; then
  GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")"
  IMAGE_TAG="$(date -u +%Y%m%d-%H%M%S)-${GIT_SHA}"
fi

if [[ "$VIBENT_MOCK_GITHUB" == "false" ]]; then
  require_var GITHUB_CLIENT_ID
  require_var GITHUB_CLIENT_SECRET
  require_var VIBENT_SESSION_SECRET
fi

GITHUB_WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-dev-secret}"

require_cmd gcloud
require_cmd git

API_SERVICE="${SERVICE_PREFIX}-api"
WEB_SERVICE="${SERVICE_PREFIX}-web"
WORKER_SERVICE="${SERVICE_PREFIX}-worker"

REGISTRY_HOST="${REGION}-docker.pkg.dev"
API_IMAGE="${REGISTRY_HOST}/${PROJECT_ID}/${ARTIFACT_REPO}/api:${IMAGE_TAG}"
WEB_IMAGE="${REGISTRY_HOST}/${PROJECT_ID}/${ARTIFACT_REPO}/web:${IMAGE_TAG}"
WORKER_IMAGE="${REGISTRY_HOST}/${PROJECT_ID}/${ARTIFACT_REPO}/worker:${IMAGE_TAG}"

deploy_api() {
  local web_url="$1"
  local envs=(
    "API_PORT=8080"
    "API_HOST=0.0.0.0"
    "VIBENT_WEB_URL=${web_url}"
    "VIBENT_MOCK_GITHUB=${VIBENT_MOCK_GITHUB}"
    "GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}"
  )

  if [[ "$VIBENT_MOCK_GITHUB" == "false" ]]; then
    envs+=(
      "GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}"
      "GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}"
      "VIBENT_SESSION_SECRET=${VIBENT_SESSION_SECRET}"
    )
  fi

  local env_csv
  env_csv="$(IFS=,; echo "${envs[*]}")"

  gcloud run deploy "${API_SERVICE}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --image "${API_IMAGE}" \
    --set-env-vars "${env_csv}" \
    --quiet
}

deploy_worker() {
  gcloud run deploy "${WORKER_SERVICE}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --image "${WORKER_IMAGE}" \
    --set-env-vars "WORKER_PORT=8080,WORKER_HOST=0.0.0.0" \
    --quiet
}

deploy_web() {
  local api_url="$1"
  gcloud run deploy "${WEB_SERVICE}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --image "${WEB_IMAGE}" \
    --set-env-vars "WEB_PORT=8080,VIBENT_API_URL=${api_url},NEXT_PUBLIC_VIBENT_API_URL=${api_url}" \
    --quiet
}

build_web_with_api_url() {
  local api_url="$1"
  build_image_with_dockerfile "${WEB_IMAGE}" "apps/web/Dockerfile" "NEXT_PUBLIC_VIBENT_API_URL=${api_url}"
}

build_image_with_dockerfile() {
  local image="$1"
  local dockerfile="$2"
  local build_arg="${3:-}"
  local cfg
  cfg="$(mktemp)"

  local extra_args=""
  if [[ -n "${build_arg}" ]]; then
    extra_args="
      - --build-arg
      - ${build_arg}"
  fi

  cat >"${cfg}" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -f
      - ${dockerfile}${extra_args}
      - -t
      - ${image}
      - .
images:
  - ${image}
EOF

  gcloud builds submit --project "${PROJECT_ID}" --config "${cfg}" .
  rm -f "${cfg}"
}

get_service_url() {
  local service="$1"
  gcloud run services describe "${service}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='value(status.url)' 2>/dev/null || true
}

log "Setting gcloud project"
gcloud config set project "${PROJECT_ID}" >/dev/null

log "Enabling required GCP APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project "${PROJECT_ID}"

if ! gcloud artifacts repositories describe "${ARTIFACT_REPO}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  log "Creating Artifact Registry repo ${ARTIFACT_REPO}"
  gcloud artifacts repositories create "${ARTIFACT_REPO}" \
    --project "${PROJECT_ID}" \
    --location "${REGION}" \
    --repository-format docker \
    --description "vibent images"
fi

EXISTING_API_URL="$(get_service_url "${API_SERVICE}")"
EXISTING_WEB_URL="$(get_service_url "${WEB_SERVICE}")"
EXISTING_WORKER_URL="$(get_service_url "${WORKER_SERVICE}")"

if [[ "${DEPLOY_API}" == "true" ]]; then
  log "Building API image ${API_IMAGE}"
  build_image_with_dockerfile "${API_IMAGE}" "apps/api/Dockerfile"
fi

if [[ "${DEPLOY_WORKER}" == "true" ]]; then
  log "Building worker image ${WORKER_IMAGE}"
  build_image_with_dockerfile "${WORKER_IMAGE}" "apps/worker/Dockerfile"
fi

API_URL="${EXISTING_API_URL}"
WEB_URL="${EXISTING_WEB_URL}"
WORKER_URL="${EXISTING_WORKER_URL}"
INITIAL_WEB_URL=""

if [[ "${DEPLOY_API}" == "true" ]]; then
  INITIAL_WEB_URL="${WEB_URL_OVERRIDE:-${WEB_URL:-https://placeholder.invalid}}"
  log "Deploying API service ${API_SERVICE}"
  deploy_api "${INITIAL_WEB_URL}"

  API_URL="$(get_service_url "${API_SERVICE}")"
  if [[ -z "${API_URL}" ]]; then
    echo "Failed to resolve API URL for service ${API_SERVICE}" >&2
    exit 1
  fi
fi

if [[ "${DEPLOY_WEB}" == "true" ]]; then
  if [[ -z "${API_URL}" ]]; then
    echo "Cannot deploy web: API URL is unavailable. Deploy API first or include --services api,web." >&2
    exit 1
  fi

  log "Building web image ${WEB_IMAGE} with NEXT_PUBLIC_VIBENT_API_URL=${API_URL}"
  build_web_with_api_url "${API_URL}"

  log "Deploying web service ${WEB_SERVICE}"
  deploy_web "${API_URL}"

  WEB_URL="$(get_service_url "${WEB_SERVICE}")"
  if [[ -z "${WEB_URL}" ]]; then
    echo "Failed to resolve WEB URL for service ${WEB_SERVICE}" >&2
    exit 1
  fi
fi

if [[ "${DEPLOY_WORKER}" == "true" ]]; then
  log "Deploying worker service ${WORKER_SERVICE}"
  deploy_worker

  WORKER_URL="$(get_service_url "${WORKER_SERVICE}")"
  if [[ -z "${WORKER_URL}" ]]; then
    echo "Failed to resolve WORKER URL for service ${WORKER_SERVICE}" >&2
    exit 1
  fi
fi

FINAL_WEB_URL="${WEB_URL_OVERRIDE:-${WEB_URL}}"
if [[ "${DEPLOY_API}" == "true" ]]; then
  FINAL_WEB_URL="${WEB_URL_OVERRIDE:-${WEB_URL:-${INITIAL_WEB_URL}}}"
  if [[ "${FINAL_WEB_URL}" != "${INITIAL_WEB_URL}" ]]; then
    log "Redeploying API with VIBENT_WEB_URL=${FINAL_WEB_URL}"
    deploy_api "${FINAL_WEB_URL}"
    API_URL="$(get_service_url "${API_SERVICE}")"
    if [[ -z "${API_URL}" ]]; then
      echo "Failed to resolve API URL for service ${API_SERVICE} after redeploy" >&2
      exit 1
    fi
  fi
fi

SELECTED_DEPLOYS=()
if [[ "${DEPLOY_API}" == "true" ]]; then
  SELECTED_DEPLOYS+=("api")
fi
if [[ "${DEPLOY_WEB}" == "true" ]]; then
  SELECTED_DEPLOYS+=("web")
fi
if [[ "${DEPLOY_WORKER}" == "true" ]]; then
  SELECTED_DEPLOYS+=("worker")
fi

CALLBACK_URL="not-found"
if [[ -n "${API_URL}" ]]; then
  CALLBACK_URL="${API_URL}/v1/auth/github/callback"
fi

cat <<EOF

Deploy complete.

Project: ${PROJECT_ID}
Region: ${REGION}
Image tag: ${IMAGE_TAG}
Services deployed: ${SELECTED_DEPLOYS[*]}

Web URL: ${WEB_URL:-not-found}
API URL: ${API_URL:-not-found}
Worker URL: ${WORKER_URL:-not-found}

GitHub OAuth settings:
- Homepage URL: ${FINAL_WEB_URL:-not-found}
- Callback URL: ${CALLBACK_URL}

To redeploy, run the same command again.
EOF
