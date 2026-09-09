#!/usr/bin/env bash
# Rebuilds the throwaway `demo` profile that assets/demo.tape records.
#
# A profile is a full namespace — its own config, project catalog, daemon
# socket and runtime state — so recording never touches the profile you
# actually work in. Run this on its own to re-seed without recording:
#
#   ./assets/demo-setup.sh
#
# The three projects are the ones the GIF shows in the sidebar. Point them
# anywhere with the env vars; the first one wants an open pull request, since
# that is what the github tab is filmed showing.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEMO_PROJECT_1="${DEMO_PROJECT_1:-$repo}"
DEMO_PROJECT_2="${DEMO_PROJECT_2:-$HOME/dev/aimux-website}"
DEMO_PROJECT_3="${DEMO_PROJECT_3:-$HOME/dev/control}"

export AIMUX_PROFILE=demo

# Only the catalog and config are dropped. The daemon is left alone: tabs live
# in the UI's reducer, so they die with the recorded process, and killing by
# name would take out whatever else the machine is running.
rm -f "$HOME/.config/aimux/demo/aimux.json" "$HOME/.config/aimux/demo/aimux-projects.json"

# The layout the GIF shows: projects on the left, the git pane and the setup
# pane on the right, catppuccin frappé. Written before the first launch so the
# app comes up already dressed instead of being configured on camera.
#
# The right bar is 3 columns narrower than the left one on purpose: ttyd keeps
# a scrollbar gutter, so the last columns of the window never get painted and a
# bar flush against the edge loses its numbers.
mkdir -p "$HOME/.config/aimux/demo"
cat > "$HOME/.config/aimux/demo/aimux.json" <<'JSON'
{
  "bars": {
    "left": {
      "visible": true,
      "width": 34,
      "widgets": [{ "grow": 67, "id": "projects", "visible": true }]
    },
    "right": {
      "visible": true,
      "width": 31,
      "widgets": [
        { "grow": 42, "id": "git", "visible": true },
        { "grow": 41, "id": "setup", "visible": true }
      ]
    }
  },
  "gitPane": { "diffModeRatio": 0.35, "fileListMode": "flat", "treeCompaction": true },
  "projectBarVisible": true,
  "settings": { "statusBar.hints": false, "statusBar.separator": "slant" },
  "sidebar": { "visible": true, "width": 34 },
  "themeId": "catppuccin-frappe",
  "themeMode": "light",
  "themeTransparent": false,
  "version": 2
}
JSON

aimux() { bun run "$repo/src/index.tsx" "$@"; }

aimux project create aimux          --project "$DEMO_PROJECT_1" > /dev/null
aimux project create aimux-docs     --project "$DEMO_PROJECT_2" > /dev/null
aimux project create share-terminal --project "$DEMO_PROJECT_3" > /dev/null

echo "demo profile seeded:"
aimux project list
