variable "project_id" {
  type        = string
  description = "GCP project id"
}

variable "region" {
  type        = string
  description = "GCP region"
  default     = "us-central1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "artifact_bucket_name" {
  type    = string
  default = "vibent-artifacts"
}

variable "db_tier" {
  type    = string
  default = "db-custom-1-3840"
}

variable "web_image" {
  type        = string
  description = "Container image for web service"
}

variable "api_image" {
  type        = string
  description = "Container image for api service"
}

variable "worker_image" {
  type        = string
  description = "Container image for worker service"
}

variable "github_owner" {
  type        = string
  description = "GitHub owner for Cloud Build trigger"
}

variable "github_repo" {
  type        = string
  description = "GitHub repository name for Cloud Build trigger"
}
