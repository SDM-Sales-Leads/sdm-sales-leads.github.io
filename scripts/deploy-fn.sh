#!/bin/bash
# Builds the edge function and deploys it to Supabase (project iyubegbevtjcvtuubpaq, function "api") with the saved access token.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.sdm-node/node-v22.12.0-darwin-arm64/bin:$PATH"
REF=iyubegbevtjcvtuubpaq
[ -s "$HOME/.sdm-supabase-token" ] || { echo "No token yet: run scripts/save-supabase-token.sh once."; exit 1; }
TOKEN=$(tr -d '[:space:]' < "$HOME/.sdm-supabase-token")
npx esbuild supabase/functions/api/index.ts --bundle --format=esm --platform=neutral --target=es2022 --external:'npm:*' --outfile=dist-fn/api.js >/dev/null
# keep the function's current "verify JWT" setting
CUR=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.supabase.com/v1/projects/$REF/functions/api")
VJ=$(printf '%s' "$CUR" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(str(d["verify_jwt"]).lower())') || { echo "Could not read the function (token wrong or expired?): $CUR" | cut -c1-200; exit 1; }
ENTRY=$(printf '%s' "$CUR" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("entrypoint_path") or "index.ts")' | sed 's#.*/##')
echo "Deploying (verify_jwt=$VJ) ..."
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/functions/deploy?slug=api" -H "Authorization: Bearer $TOKEN" \
  -F "metadata={\"entrypoint_path\":\"$ENTRY\",\"name\":\"api\",\"verify_jwt\":$VJ}" -F "file=@dist-fn/api.js;filename=$ENTRY" | cut -c1-300
echo
