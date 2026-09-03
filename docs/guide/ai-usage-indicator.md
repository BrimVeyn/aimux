---
title: AI Usage Indicator
description: Bottom-bar indicator showing live Claude Code and Codex session usage, sourced from the official OAuth endpoints.
---

# AI Usage Indicator

`aimux` can show the current **session usage** of AI CLI tools (Claude Code,
Codex) in the bottom status bar, with a click-to-open popover for detailed
metrics.

The indicator is fully opt-in via config — if you don't enable it, nothing is
spawned, no network calls happen, and nothing is rendered.

It is a plugin aimux ships (`aimux.ai-usage`). The settings below are
unchanged; to remove it outright rather than switch it off, add
`plugins: [{ id: 'aimux.ai-usage', enabled: false }]` to your config — see
[Plugins](plugins.md).

## What It Shows

For each enabled tool the indicator renders a compact dot + percent in the
right-hand tile of the status bar:

```
● 48%    ● 92%
```

- a **colored dot** signalling the utilisation tier
- the **percentage** used in the current session (5-hour window)

The dot color comes from the active theme palette:

- `< 60%` → `success` tone (muted-positive)
- `60–84%` → `warning` tone
- `≥ 85%` → `error` tone

Click the indicator to open a popover with per-tool details (tokens, cost,
burn rate, reset countdown, full segmented bar). Press `Esc` to close.

## Enabling It

Add a `statusBar.aiUsage` block to your `aimux.config.ts`:

```ts
import { defineConfig } from '@brimveyn/aimux-config'

export default defineConfig({
  statusBar: {
    aiUsage: {
      enabled: true,
      pollSeconds: 180,
      tools: ['claude', 'codex'],
    },
  },
})
```

Remove the block or set `enabled: false` to hide the indicator entirely and
stop all polling.

To show only one tool, pass a single-entry `tools` array:

```ts
statusBar: {
  aiUsage: {
    enabled: true,
    tools: ['claude'],
  },
}
```

## Fields

| Field              | Type                                   | Default               | Notes                                                                                                                                                              |
| ------------------ | -------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`          | `boolean`                              | `false`               | Master switch. When `false`, no polling happens.                                                                                                                   |
| `tools`            | `Array<'claude' \| 'codex'>`           | `['claude', 'codex']` | Which tools to poll and render.                                                                                                                                    |
| `pollSeconds`      | `number`                               | `180`                 | Polling interval. Clamped to a minimum of 180 — Claude's OAuth endpoint rate-limits anything faster, and the symptom is an indicator that silently stops updating. |
| `claudePlan`       | `'auto' \| 'pro' \| 'max5' \| 'max20'` | `'auto'`              | Reserved for future use; the current Claude adapter ignores this because the OAuth endpoint returns the true percentage directly.                                  |
| `codexWeeklyLimit` | `number`                               | —                     | Reserved for future use; the current Codex adapter uses the OAuth endpoint.                                                                                        |

## How It Works

Both adapters hit the same backend that the official CLIs use for their
`/usage` (Claude) and `/status` (Codex) commands. The percentage matches what
you see inside each CLI.

### Claude Code

1. The adapter reads the OAuth bearer token from the macOS Keychain entry
   `Claude Code-credentials` via `/usr/bin/security find-generic-password`.
2. It calls `GET https://api.anthropic.com/api/oauth/usage` with:
   - `Authorization: Bearer <accessToken>`
   - `anthropic-beta: oauth-2025-04-20`
3. The response's `five_hour.utilization` and `five_hour.resets_at` are used
   directly.
4. Credentials are cached in memory until their `expiresAt`, so the keychain is
   only touched once per `aimux` session.

Requirements:

- macOS (Keychain access is required for the token read).
- A logged-in Claude Code install (run `claude` once to sign in).
- The very first keychain read pops a macOS dialog asking if `security` may
  read the item. Click **Always Allow**. The ACL is persisted and survives
  reboots, so you should not see it again unless you re-login to Claude, or a
  macOS update replaces `/usr/bin/security` and invalidates its signature.

### Codex

1. The adapter reads `tokens.access_token` and `tokens.account_id` from
   `~/.codex/auth.json`.
2. It calls `GET https://chatgpt.com/backend-api/wham/usage` with:
   - `Authorization: Bearer <access_token>`
   - `ChatGPT-Account-Id: <account_id>`
3. It picks the 5-hour rate window (`limit_window_seconds === 18000`) and reads
   `used_percent` + `reset_at` directly.
4. The `CODEX_HOME` environment variable and the `chatgpt_base_url` override in
   `~/.codex/config.toml` are both honored, matching the Codex CLI's own rules.

Requirements:

- A logged-in Codex CLI install (run `codex` once to sign in). No keychain
  involved on any OS.

## Fault Tolerance

- If the keychain read fails, or `~/.codex/auth.json` is missing, the affected
  tool's cell renders a short error (`CC —` / `CO —`) and the other tool keeps
  working.
- On `401 / 403` from either endpoint, the cached credentials are evicted and
  the cell shows `oauth expired — run <cli> to re-auth`.
- All network requests use a 15 s timeout and abort cleanly.
- No data is written to disk by the indicator.

## Theming

Every color used by the indicator and popover comes from the active theme's
palette (`success`, `warning`, `error`, `ink`, `muted`). Switching themes at
runtime updates the indicator immediately. No hardcoded colors.

## Removing the Feature

Delete the `statusBar` block from `aimux.config.ts` (or set
`statusBar.aiUsage.enabled: false`). The indicator disappears, the polling
service is torn down, and no further network or keychain access occurs.
