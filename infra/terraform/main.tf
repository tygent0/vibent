provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  prefix = "vibent-${var.environment}"
}

resource "google_project_service" "required" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
    "pubsub.googleapis.com",
    "storage.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudscheduler.googleapis.com"
  ])
  project = var.project_id
  service = each.key
}

resource "google_storage_bucket" "artifacts" {
  name                        = "${var.artifact_bucket_name}-${var.project_id}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
  lifecycle_rule {
    condition {
      age = 14
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_pubsub_topic" "verification" {
  name = "${local.prefix}-verification"
}

resource "google_pubsub_subscription" "verification_worker" {
  name  = "${local.prefix}-verification-worker"
  topic = google_pubsub_topic.verification.name

  ack_deadline_seconds = 30

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

resource "google_sql_database_instance" "postgres" {
  name             = "${local.prefix}-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier = var.db_tier

    backup_configuration {
      enabled = true
    }

    ip_configuration {
      ipv4_enabled = true
    }
  }

  deletion_protection = true
}

resource "google_sql_database" "app" {
  name     = "vibent"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app" {
  name     = "vibent"
  instance = google_sql_database_instance.postgres.name
  password = "change-me-immediately"
}

resource "google_secret_manager_secret" "github_app_private_key" {
  secret_id = "${local.prefix}-github-app-private-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "github_client_secret" {
  secret_id = "${local.prefix}-github-client-secret"
  replication {
    auto {}
  }
}

resource "google_cloud_run_v2_service" "api" {
  name     = "${local.prefix}-api"
  location = var.region

  template {
    containers {
      image = var.api_image
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.artifacts.name
      }
      env {
        name  = "PUBSUB_TOPIC"
        value = google_pubsub_topic.verification.name
      }
    }
  }
}

resource "google_cloud_run_v2_service" "worker" {
  name     = "${local.prefix}-worker"
  location = var.region

  template {
    containers {
      image = var.worker_image
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.artifacts.name
      }
      env {
        name  = "PUBSUB_TOPIC"
        value = google_pubsub_topic.verification.name
      }
    }
  }
}

resource "google_cloud_run_v2_service" "web" {
  name     = "${local.prefix}-web"
  location = var.region

  template {
    containers {
      image = var.web_image
      env {
        name  = "VIBENT_API_URL"
        value = google_cloud_run_v2_service.api.uri
      }
    }
  }
}

resource "google_cloudbuild_trigger" "main" {
  name = "${local.prefix}-main"

  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = "^main$"
    }
  }

  filename = "cloudbuild.yaml"
}

resource "google_cloud_scheduler_job" "retention" {
  name      = "${local.prefix}-retention"
  schedule  = "0 3 * * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = "${google_cloud_run_v2_service.worker.uri}/v1/cleanup"
    http_method = "POST"
  }
}
