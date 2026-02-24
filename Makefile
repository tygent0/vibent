SHELL := /bin/bash
.DEFAULT_GOAL := help

PNPM ?= pnpm
COMPOSE ?= docker compose

.PHONY: help env install bootstrap up down restart ps logs logs-api logs-worker logs-web logs-postgres \
	db-up db-down db-reset dev dev-db build lint test typecheck format ci clean

help: ## Show available targets
	@echo "vibent make targets:"
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env: ## Create .env from .env.example if missing
	@cp -n .env.example .env || true
	@echo ".env ready"

install: ## Install JS dependencies
	$(PNPM) install

bootstrap: ## Full bootstrap (deps + shared build + db + migrate/seed)
	bash scripts/bootstrap.sh

db-up: ## Start only Postgres
	$(COMPOSE) up -d postgres

db-down: ## Stop Postgres
	$(COMPOSE) stop postgres

db-reset: ## Reset Postgres volume (destructive)
	$(COMPOSE) down -v postgres
	$(COMPOSE) up -d postgres

up: env ## Build and start full stack (postgres + api + worker + web)
	$(COMPOSE) up -d --build

down: ## Stop and remove full stack containers/networks
	$(COMPOSE) down

restart: ## Restart full stack
	$(MAKE) down
	$(MAKE) up

ps: ## Show compose service status
	$(COMPOSE) ps

logs: ## Tail logs for all services
	$(COMPOSE) logs -f

logs-api: ## Tail api logs
	$(COMPOSE) logs -f api

logs-worker: ## Tail worker logs
	$(COMPOSE) logs -f worker

logs-web: ## Tail web logs
	$(COMPOSE) logs -f web

logs-postgres: ## Tail postgres logs
	$(COMPOSE) logs -f postgres

dev-db: env install db-up ## Local dev deps + db
	@echo "DB is up. Run: $(PNPM) dev"

dev: env install db-up ## Start local dev mode (turbo dev, foreground)
	$(PNPM) dev

build: ## Build all packages/apps
	$(PNPM) build

lint: ## Lint all packages/apps
	$(PNPM) lint

test: ## Run all tests
	$(PNPM) test

typecheck: ## Type-check all packages/apps
	$(PNPM) typecheck

format: ## Format repository
	$(PNPM) format

ci: lint test typecheck build ## Run full CI-equivalent checks

clean: ## Remove local runtime artifacts
	rm -rf .vibent artifacts dist
