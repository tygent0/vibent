# Getting Started

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker
- git

## Setup

```bash
cp .env.example .env
pnpm bootstrap
pnpm dev
```

Web: `http://localhost:3000`  
API: `http://localhost:8080`  
Worker: `http://localhost:8090`

## 10-minute happy path

```bash
pnpm --filter @vibent/cli build
./apps/cli/bin/vibent.js session start --title "ship search fix"
./apps/cli/bin/vibent.js run "fix search timeout"
./apps/cli/bin/vibent.js verify
./apps/cli/bin/vibent.js review
./apps/cli/bin/vibent.js publish --mode direct
./apps/cli/bin/vibent.js release create --env dev --traffic 10
./apps/cli/bin/vibent.js session status
```

## PR mode publish

```bash
./apps/cli/bin/vibent.js login
./apps/cli/bin/vibent.js publish --mode pr --pr 123
```

PR mode updates two surfaces:
- GitHub check: `Vibent Evidence`
- One rolling PR comment (`<!-- vibent-evidence -->`)

## Add production signals

```bash
./apps/cli/bin/vibent.js signal add \
  --type latency \
  --severity warning \
  --summary "p95 latency increased after release" \
  --value 420 \
  --unit ms
```

Signals appear in session detail and influence resume recommendations.
