#!/bin/sh
# aimux hook bridge for Claude Code.
# Reads a Claude hook event JSON from stdin, attaches the pane id supplied
# via env, and POSTs the merged JSON to the aimux daemon's local HTTP hook
# server. Never blocks Claude: short timeout, all errors suppressed,
# always exits 0.
#
# The hook URL is read from AIMUX_HOOK_URL_FILE on every invocation so that
# PTYs spawned by a previous daemon transparently follow URL changes after a
# daemon restart. AIMUX_HOOK_URL is honored as a legacy fallback.

set -u

resolve_url() {
  if [ -n "${AIMUX_HOOK_URL_FILE:-}" ] && [ -r "${AIMUX_HOOK_URL_FILE}" ]; then
    url=$(cat "${AIMUX_HOOK_URL_FILE}" 2>/dev/null) || url=""
    if [ -n "$url" ]; then
      printf '%s' "$url"
      return
    fi
  fi
  printf '%s' "${AIMUX_HOOK_URL:-}"
}

URL=$(resolve_url)
[ -z "$URL" ] && exit 0

payload=$(cat) || exit 0

# Best-effort: inject aimuxPaneId into the payload. If python3 is missing,
# fall back to forwarding the original payload — the server can still
# correlate via session_id in many cases.
if command -v python3 >/dev/null 2>&1; then
  body=$(printf '%s' "$payload" | python3 -c '
import json, os, sys
try:
    d = json.load(sys.stdin)
    if not isinstance(d, dict):
        d = {"raw": d}
except Exception:
    d = {}
d["aimuxPaneId"] = os.environ.get("AIMUX_PANE_ID", "")
sys.stdout.write(json.dumps(d))
' 2>/dev/null) || body="$payload"
else
  body="$payload"
fi

curl -fsS -m 2 -X POST \
  -H 'Content-Type: application/json' \
  --data-raw "$body" \
  "$URL" >/dev/null 2>&1 || true

exit 0
