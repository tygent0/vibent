# Architecture

## Product shape

vibent keeps UX minimal and local-first while preserving scalable service boundaries.

## Components

- CLI (`apps/cli`): local-first run creation, verify, replay, publish wrapper, agent daemon.
- API (`apps/api`): run/eval/publish/webhook endpoints and run metadata store.
- Worker (`apps/worker`): executes verification plans, captures logs, redacts secrets.
- Web (`apps/web`): landing, sign-in, connect repos, runs, run detail, publish, settings.
- Shared (`packages/shared`): schemas and OpenAPI contracts.

## Data model

- `Run`: goal, base ref/SHA, patch pointer, eval pointers, status, reproducibility.
- `Eval`: commands executed, pass/fail, artifact pointer, summary.
- `Review`: automated findings and pass/fail gate for publish/release.
- `Bundle`: publish summary associated to run.
- `Release`: rollout lifecycle independent of publish (`canary`, `stable`, `rolled_back`).
- `ProductionSignal`: monitoring feedback loop attached to sessions/runs.
- `Artifact`: file-based locally; object storage in GCP.

## Publish behavior

Publish supports two modes:

- `pr`: updates exactly two GitHub surfaces:
  - `Vibent Evidence` check run on PR head SHA.
  - one rolling PR comment identified with hidden marker `<!-- vibent-evidence -->`.
- `direct`: emits evidence bundle without PR dependency.

Both modes require passing review.

## Retention defaults

- Summaries: retained indefinitely.
- Artifacts: 14 days default.
- Published bundle artifacts: 90 days (configurable).
