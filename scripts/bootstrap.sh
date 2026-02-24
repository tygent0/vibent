#!/usr/bin/env bash
set -euo pipefail

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install with: npm i -g pnpm"
  exit 1
fi

pnpm install
pnpm --filter @vibent/shared build
cp -n .env.example .env || true
docker compose up -d postgres
pnpm --filter @vibent/api db:migrate || true
pnpm --filter @vibent/api seed || true
echo "Bootstrap complete. Run: pnpm dev"
