# Agent Playbook

This page is optimized for coding agents that need to understand and modify vibent quickly.

## Read Order

1. `getting-started.md`
2. `local-dev.md`
3. `concepts.md`
4. `architecture.md`
5. `api.md`
6. `advanced-usage.md`

## Fast Facts

- Monorepo manager: `pnpm` + Turborepo
- Main apps:
  - `apps/web` (Next.js web UI)
  - `apps/api` (Fastify API)
  - `apps/worker` (verification worker)
  - `apps/cli` (CLI + agent daemon)
- Shared contracts: `packages/shared`

## Typical Agent Flow

1. Start session: `vibent session start --title "..."`
2. Create run: `vibent run "..."`
3. Verify: `vibent verify`
4. Review gate: `vibent review`
5. Publish: `vibent publish --mode direct` or `--mode pr`
6. Rollout: `vibent release create/promote/rollback`
7. Capture feedback: `vibent signal add ...`

## Source of Truth

- API contract: `packages/shared/openapi/api.yaml`
- Agent contract: `packages/shared/openapi/agent.yaml`
- Runtime docs manifest for agents: `/docs/manifest`
  - Query by intent tag: `/docs/manifest?tag=setup`
  - Multiple required tags: `/docs/manifest?tag=api&tag=agent`
