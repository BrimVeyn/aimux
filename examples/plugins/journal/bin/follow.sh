#!/bin/sh
# The service. Follows the daemon's event stream through the CLI and appends
# every line to a file in the plugin's state directory. No SDK, no
# TypeScript: `aimux events follow` prints one JSON object per event, and a
# shell can redirect that.
#
# Supervised by the daemon with `restart: always`, so a daemon restart — which
# ends the stream — brings it back rather than leaving a journal that stopped.
set -eu

state="${AIMUX_PLUGIN_STATE_DIR:?run me from aimux: AIMUX_PLUGIN_STATE_DIR is not set}"
mkdir -p "$state"
out="$state/journal.ndjson"

# `AIMUX_BIN_PATH` is the executable running the daemon. Installed, that is
# `aimux` itself. Linked from a checkout it is `bun`, and the CLI is the
# checkout's entry point — which this plugin knows, because it lives in it.
bin="${AIMUX_BIN_PATH:-aimux}"
case "$(basename "$bin")" in
  bun*) set -- "$bin" run "${AIMUX_PLUGIN_ROOT:?}/../../../src/index.tsx" ;;
  *) set -- "$bin" ;;
esac

printf '{"ts":%s,"type":"journal","event":"journal:started","at":"%s","payload":{"pid":%s}}\n' \
  "$(date +%s)000" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" >> "$out"

exec "$@" events follow >> "$out"
