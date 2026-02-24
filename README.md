# vibent

vibent is developer-joy-first evidence for AI-assisted coding.

Prefer local usage for the fastest workflow and full CLI/API access:
https://github.com/tygent0/vibent

## Command surface

- `vibent run "goal"`
- `vibent verify`
- `vibent review`
- `vibent publish --mode pr|direct`
- `vibent blame path:line`
- `vibent replay <run_id>`
- `vibent release create [run_id] --env dev --traffic 10`
- `vibent release promote <release_id> --traffic 100`
- `vibent release rollback <release_id> --reason "..."`
- `vibent signal add --type latency --severity warning --summary "..."`
- `vibent agent serve`
- `vibent session start --title "..."`
- `vibent session status`
- `vibent session note "..."`
- `vibent session continue [session_id]`

## Monorepo layout

- `apps/web`: Next.js UI (landing, auth, connect, runs, publish, settings)
- `apps/api`: Fastify REST API + webhook + publishing APIs
- `apps/worker`: verification worker service
- `apps/cli`: vibent CLI + agent daemon
- `packages/shared`: shared schemas and OpenAPI specs
- `infra/terraform`: GCP IaC
- `docs`: setup and architecture docs

## One-command bootstrap

```bash
pnpm bootstrap
```

## Local development

1. Copy env values:

```bash
cp .env.example .env
```

2. Start dependencies and apps:

```bash
docker compose up -d postgres
pnpm install
pnpm dev
```

Web: `http://localhost:3000`  
API: `http://localhost:8080`  
Worker: `http://localhost:8090`

## GitHub setup

See `docs/github-setup.md`.

## Docs

- Getting started: `docs/getting-started.md`
- Concepts: `docs/concepts.md`
- Advanced usage: `docs/advanced-usage.md`
- API and daemon contracts: `docs/api.md`
- Local development: `docs/local-dev.md`

## Tests

```bash
pnpm test
```

Includes:
- run manifest creation and hashing
- secret redaction
- GitHub publish behavior (mocked)
- webhook signature validation

## Deployment

Terraform for GCP lives in `infra/terraform`.

```bash
cd infra/terraform
terraform init
terraform apply
```
