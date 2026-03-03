#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Prepare GCP IAM for Cloud Run deploys in this repo.

Usage:
  scripts/predeploy-cloud-run.sh [options]

Options:
  --project     GCP project id (default: vibent-488403)
  --region      GCP region (default: us-central1)
  --help        Show help

What this script does:
  1) Enables required services for build + deploy.
  2) Grants Cloud Build service accounts permissions for:
     - reading staged source objects
     - building images
     - pushing images to Artifact Registry
  3) If present, patches the default Cloud Build bucket IAM too.

Safe to re-run; IAM bindings are idempotent.
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

require_cmd gcloud

log "Setting gcloud project"
gcloud config set project "${PROJECT_ID}" >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
if [[ -z "${PROJECT_NUMBER}" ]]; then
  echo "Unable to resolve project number for ${PROJECT_ID}" >&2
  exit 1
fi

BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
LEGACY_CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
CB_BUCKET="gs://${PROJECT_ID}_cloudbuild"

log "Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project "${PROJECT_ID}"

log "Granting project-level IAM for Cloud Build service accounts"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/storage.objectViewer" \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/cloudbuild.builds.builder" \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --quiet >/dev/null

if gcloud iam service-accounts describe "${LEGACY_CB_SA}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${LEGACY_CB_SA}" \
    --role="roles/storage.objectViewer" \
    --quiet >/dev/null
fi

log "Granting bucket-level fallback IAM on ${CB_BUCKET} (if bucket exists)"
if gcloud storage buckets describe "${CB_BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets add-iam-policy-binding "${CB_BUCKET}" \
    --member="serviceAccount:${BUILD_SA}" \
    --role="roles/storage.objectViewer" \
    --project "${PROJECT_ID}" >/dev/null

  if gcloud iam service-accounts describe "${LEGACY_CB_SA}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud storage buckets add-iam-policy-binding "${CB_BUCKET}" \
      --member="serviceAccount:${LEGACY_CB_SA}" \
      --role="roles/storage.objectViewer" \
      --project "${PROJECT_ID}" >/dev/null
  fi
else
  echo "Cloud Build bucket not found yet; skipping bucket-level IAM."
  echo "If a future build error mentions ${CB_BUCKET}, re-run this script."
fi

cat <<EOF

Pre-deploy IAM bootstrap complete.

Project: ${PROJECT_ID}
Region: ${REGION}
Build SA: ${BUILD_SA}
Legacy Cloud Build SA: ${LEGACY_CB_SA}

Next step:
  scripts/deploy-cloud-run.sh --project ${PROJECT_ID}
EOF
