---
title: AI Usage Indicator
description: Bottom-bar indicator showing live Claude Code and Codex session usage, sourced from the official OAuth endpoints.
---

# AI Usage Indicator

`aimux` can show the current **session usage** of AI CLI tools (Claude Code,
Codex) as a widget in the bottom status bar, clickable for the detail per
provider.

It is a plugin aimux ships (`aimux.ai-usage`), and it ships **off**: until you
switch it on, nothing is spawned, no keychain is read, no network call happens
and nothing is rendered.

Being loaded is the whole switch. There is no separate settings row for it —
there was one for a release, beside the plugin's own, and a feature with two
switches is a feature you can turn on and watch do nothing. See
[Plugins](plugins.md).

## What It Shows

A small widget in the status bar, between the filler and the version tile. Each
polled tool gets its provider glyph and the percentage of its current session
window (5 hours):

```
 22%   48%
```

- the **glyph** is a nerd-font icon per provider — `nf-cod-claude` and
  `nf-cod-openai`, so the tile needs a nerd font just like the status bar
  separators
- the **percentage** is the current session window; a provider that reports no
  percentage shows its compact token total instead
- before the first poll comes back the tile is a single `…`, and a tool whose
  last poll failed outright shows its glyph alone rather than a stale number

The tile carries no status colours — it uses the bar's own ink. Colour is
reserved for the gauges below, where a bar is a real fraction of a real ceiling
and means what a bar is supposed to mean.

## The Detail, Per Provider

**Click the widget** to open the Quotas modal — the same block the Stats screen
shows under _Quotas_, on its own so the answer to "how much is left" is not
found among four other sections. `Esc` closes it.

```
Claude                                            1m ago · Max
Session  ███████░░░░░░░░░   22%  ·  resets in 59m
Weekly   ███████████░░░░░   43%  ·  resets in 4d 21h
         Behind (+13%)
```

Per provider, one row per window the provider reports:

- a **16-segment gauge**, `success` under 60%, `warning` from 60, `error` from
  85
- the **percentage**, and whatever context fits in what is left — usually the
  reset countdown
- a second line for the **pace** when there is one to report: behind reads as a
  warning, ahead as a success, on-track as neither

The header line names the provider, when it was last refreshed, and the plan
tier the endpoint reported. A provider whose poll failed says so on its own
line, and the other one keeps working.

## Enabling It

The quickest way is the settings screen: **Plugins → AI usage**. The same
switch from the CLI:

```sh
aimux plugin enable aimux.ai-usage
```

Or from `aimux.config.ts`, under the key the feature had before it was a plugin
— which is where the rest of its settings live anyway:

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

`plugins: [{ id: 'aimux.ai-usage', enabled: true }]` says exactly the same
thing. Either line, being in `aimux.config.ts`, outranks the switch on the
screen and comes back on every restart.

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
| `enabled`          | `boolean`                              | `false`               | Whether the plugin loads. The same switch as `plugins: [{ id: 'aimux.ai-usage', enabled }]` and as the Plugins drawer; when off, nothing runs.                     |
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
  tool falls back to its glyph alone in the widget and says what went wrong in
  the modal; the other tool keeps working.
- On `401 / 403` from either endpoint, the cached credentials are evicted and
  the modal reads `oauth expired — run <cli> to re-auth`.
- A poll that fails after a good one keeps the last number rather than blanking
  it, so a blip does not read as a reset quota.
- All network requests use a 15 s timeout and abort cleanly.
- No data is written to disk by the indicator.

## Theming

Every color comes from the active theme's palette. The widget uses the status
bar's own ink; `success` / `warning` / `error` are spent on the modal's gauges
and on the pace line, which are the only places here where a colour is a
statement. Switching themes at runtime updates both immediately. No hardcoded
colors.

## Removing the Feature

Switch the plugin off — **Plugins → AI usage** on the settings screen,
`aimux plugin disable aimux.ai-usage`, or `statusBar.aiUsage.enabled: false` in
`aimux.config.ts`. The tile leaves the status bar, the polling service is torn
down, and no further network or keychain access occurs.
