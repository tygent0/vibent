#!/usr/bin/env bash
set -euo pipefail

mkdir -p data
cp -f data/seed/state.json data/state.json
mkdir -p artifacts
cat > artifacts/run_seed123.patch <<'PATCH'
# seed patch
PATCH
cat > artifacts/eval_seed123.log <<'LOG'
seed verification log
LOG

echo "Seeded local data into data/state.json"
