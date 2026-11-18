#!/bin/bash
# Lara (AI agent) offline test suite: real server code, fake database, nothing sent anywhere.
# Run from anywhere: bash sdm-sales-leads/scripts/lara-test/run.sh
set -e
cd "$(dirname "$0")/../.."
export PATH="$HOME/.sdm-node/node-v22.12.0-darwin-arm64/bin:$PATH"
OUT="${TMPDIR:-/tmp}/lara-test-$$.mjs"
node scripts/lara-test/build.mjs scripts/lara-test/lara.test.ts "$OUT" "$PWD/scripts/lara-test/stub_supabase.js"
node "$OUT"; rc=$?; rm -f "$OUT"; exit $rc
