# Concepts

## Run
A run is a single implementation attempt tied to a goal, patch, and verification evidence.

## Eval
An eval is test/build command execution attached to a run (`vibent verify`).

## Review
A review is an automated gate with findings across policy, security, dependency, lint/test, and release risks (`vibent review`).

Blocking severities are `high` and `critical`.

## Session Memory
A session is the long-lived context container for runs and human/agent collaboration.

Each session stores:
- events (prompt/file/command/test/note)
- highlights (goal/failure/fix/next_step/regression)
- snapshots (last known good, known failures, env fingerprint)
- resume plans (next tasks + suggested commands)

## Publish Modes
- `pr`: updates GitHub check + rolling PR comment, requires GitHub connection
- `direct`: emits evidence bundle without PR dependency

Both modes require a passing review.

## Release
A release is rollout state decoupled from merge/publish.

Lifecycle:
- `created`
- `canary`
- `stable`
- `rolled_back`

## Production Signals
Signals capture production health/regression data (latency, error_rate, rollback, etc.) and feed back into highlights and resume plans.
