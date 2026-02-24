# Terraform Deployment (GCP)

## What this deploys

- Cloud Run services: web, api, worker
- Cloud SQL Postgres instance + DB + user
- Pub/Sub topic + subscription for verification jobs
- GCS bucket for artifacts
- Secret Manager placeholders for GitHub credentials
- Cloud Build trigger for `main`
- Cloud Scheduler retention job

## Usage

```bash
cd infra/terraform
terraform init
terraform apply \
  -var='project_id=YOUR_PROJECT' \
  -var='web_image=REGION-docker.pkg.dev/PROJECT/repo/web:tag' \
  -var='api_image=REGION-docker.pkg.dev/PROJECT/repo/api:tag' \
  -var='worker_image=REGION-docker.pkg.dev/PROJECT/repo/worker:tag' \
  -var='github_owner=YOUR_ORG' \
  -var='github_repo=YOUR_REPO'
```

Update `google_sql_user.app.password` immediately via secure secret flow before production.
