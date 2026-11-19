#!/bin/bash
# Refresh Lara's website knowledge base: crawl elsewedydevelopment.com (English + Arabic), build the tree, load it.
# The new batch is inserted first; only then is the old batch switched off (never deleted).
# Needs the saved Supabase token (scripts/save-supabase-token.sh). Usage: bash scripts/site-kb/run.sh [workdir]
set -e
cd "$(dirname "$0")/../.."
export PATH="$HOME/.sdm-node/node-v22.12.0-darwin-arm64/bin:$PATH"
W="${1:-${TMPDIR:-/tmp}/site-kb-work}"
python3 -I scripts/site-kb/crawl.py "$W"
npx esbuild scripts/site-kb/load.ts --bundle --platform=node --format=esm --outfile="$W/load.mjs" --log-level=error
node "$W/load.mjs" "$W"
TOKEN=$(tr -d '[:space:]' < "$HOME/.sdm-supabase-token")
send() {
  python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$1" \
    | curl -s -X POST "https://api.supabase.com/v1/projects/iyubegbevtjcvtuubpaq/database/query" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @- | cut -c1-300
  echo
}
for f in $(ls "$W"/load_[0-9]*.sql | sort -V); do echo "$f"; send "$f"; done
send "$W/load_done.sql"
