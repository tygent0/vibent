# API and Agent Contracts

OpenAPI specs:

- API: `packages/shared/openapi/api.yaml`
- Agent daemon: `packages/shared/openapi/agent.yaml`

## API endpoints

- `GET /health`
- `GET /v1/status`
- `POST /v1/runs`
- `GET /v1/runs`
- `GET /v1/runs/:runId`
- `POST /v1/evals/plan`
- `POST /v1/evals`
- `POST /v1/review/run`
- `GET /v1/reviews/:runId`
- `POST /v1/releases`
- `GET /v1/releases`
- `POST /v1/releases/promote`
- `POST /v1/releases/rollback`
- `POST /v1/signals`
- `GET /v1/signals/session/:sessionId`
- `POST /v1/publish` (`mode=pr|direct`)
- `POST /v1/webhooks/github`

## Agent daemon endpoints

- `POST /v1/run/create`
- `POST /v1/patch/propose`
- `POST /v1/eval/plan`
- `POST /v1/eval/run`
- `POST /v1/review/run`
- `POST /v1/release/create`
- `POST /v1/release/promote`
- `POST /v1/release/rollback`
- `GET /v1/release/list`
- `POST /v1/signals/ingest`
- `POST /v1/bundle/summarize`
- `POST /v1/publish` (`mode=pr|direct`)
- `GET /v1/status`
