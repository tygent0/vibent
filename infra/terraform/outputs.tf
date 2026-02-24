output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "worker_url" {
  value = google_cloud_run_v2_service.worker.uri
}

output "artifact_bucket" {
  value = google_storage_bucket.artifacts.name
}

output "pubsub_topic" {
  value = google_pubsub_topic.verification.name
}
