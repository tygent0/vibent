# Local Development

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker
- git

## Quickstart

```bash
cp .env.example .env
pnpm bootstrap
pnpm dev
```

## Makefile shortcuts

```bash
make up        # full docker stack (postgres + api + worker + web)
make down      # stop full stack
make dev       # local turbo dev + postgres
make ci        # lint + test + typecheck + build
make help      # list all targets
```

## Port conflicts

If `make up` fails with `port is already allocated`, override ports in `.env`:

```bash
POSTGRES_PORT=55432
API_PORT=18080
WEB_PORT=13000
WORKER_PORT=18090
VIBENT_API_URL=http://localhost:18080
NEXT_PUBLIC_VIBENT_API_URL=http://localhost:18080
VIBENT_WEB_URL=http://localhost:13000
```

## Local happy path

```bash
pnpm --filter @vibent/cli build
./apps/cli/bin/vibent.js session start --title "my context"
./apps/cli/bin/vibent.js run "add caching to search"
./apps/cli/bin/vibent.js verify
./apps/cli/bin/vibent.js review
./apps/cli/bin/vibent.js publish --mode direct
./apps/cli/bin/vibent.js release create --env dev --traffic 10
./apps/cli/bin/vibent.js session status
./apps/cli/bin/vibent.js session continue
./apps/cli/bin/vibent.js login
./apps/cli/bin/vibent.js publish --mode pr --pr 123
```

## Optional targeted test map

```bash
mkdir -p .vibent
cp docs/testmap.example.yaml .vibent/testmap.yaml
```

## Mock mode

`VIBENT_MOCK_GITHUB=true` is enabled by default, so publishing flows work without real GitHub credentials.

## Provider mode

`vibent run` uses a pluggable provider and defaults to `stub`.

Example:

```bash
export VIBENT_PROVIDER=openai-compatible
export VIBENT_PROVIDER_MODEL=gpt-4.1-mini
export VIBENT_PROVIDER_API_KEY=...
```
