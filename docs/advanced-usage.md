# Advanced Usage

## Provider configuration

`vibent run` uses pluggable provider modes.

Environment variables:
- `VIBENT_PROVIDER=stub|openai-compatible|anthropic-compatible`
- `VIBENT_PROVIDER_MODEL=...`
- `VIBENT_PROVIDER_API_BASE_URL=https://...`
- `VIBENT_PROVIDER_API_KEY=...`
- `VIBENT_PROVIDER_MAX_ATTEMPTS=3`
- `VIBENT_PROVIDER_MAX_PATCH_CHARS=200000`
- `VIBENT_PROVIDER_TIMEOUT_MS=120000`

If provider calls fail, vibent falls back to a safe stub patch.

## Automated review workflows

Run explicit review commands:

```bash
./apps/cli/bin/vibent.js review <run_id> --command "pnpm lint"
```

Publish and release flows enforce passing review.

## Release orchestration

Create canary:

```bash
./apps/cli/bin/vibent.js release create <run_id> --env prod --traffic 10
```

Promote:

```bash
./apps/cli/bin/vibent.js release promote <release_id> --traffic 100
```

Rollback:

```bash
./apps/cli/bin/vibent.js release rollback <release_id> --reason "error budget burn"
```

## Agent daemon integration

Start daemon:

```bash
./apps/cli/bin/vibent.js agent serve
```

Key daemon endpoints:
- `/v1/review/run`
- `/v1/release/create`
- `/v1/release/promote`
- `/v1/release/rollback`
- `/v1/signals/ingest`

## Session memory query patterns

- Query prior failures in a file area: `/v1/memory/query` with `files`
- Fetch latest snapshot: `/v1/memory/snapshot`
- Build machine-consumable continuation: `/v1/resume/plan`

## Custom targeted test map

```bash
mkdir -p .vibent
cp docs/testmap.example.yaml .vibent/testmap.yaml
```

The planner maps changed files to focused verification commands.
