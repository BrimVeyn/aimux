# Tokens

What the conversation in front of you has spent, in a status-bar tile; every
open conversation on a page of the stats screen; one key to resume a
conversation in a fresh tab; and one warning when a tab crosses a line you
drew.

`<leader>R` resumes the active tab. The manifest asks for the key:

```jsonc
"contributes": { "keymaps": [{ "mode": "navigation", "key": "<leader>R", "action": "resume" }] }
```

## What it demonstrates

- **`ctx.assistants.session(tabId)`** — the session id and the model, parsed
  from the argv the daemon already keeps, and the transcript path found under
  it
- **`ctx.assistants.usage(tabId)`** — cumulative tokens read from that
  transcript: input, output, cache, per model, and how many billed turns
- **`ctx.assistants.resume(tabId)`** — close and respawn on the same
  conversation, the move after a rate limit or a crashed CLI
- **`ctx.on('tab:turnComplete')`** in the daemon as the trigger, because a
  turn ending is the moment the number changes and a timer would read the
  same file between turns for nothing
- a **status-bar tile** and a **stats page** on the same slice
- **`ctx.ui.notifications.notify`** for the warning — through the slot, so a
  plugin like `ntfy` puts it on your phone

## Two directions of RPC

The daemon pushes (`broadcast`) on every finished turn, and the UI asks
(`call`) once for any tab it has not heard about — which is what makes the
tile right on the first switch to a tab rather than on its first turn. Both
halves speak the same `TabUsage` shape, in `src/usage.ts`, shared as a module
because two processes share no memory.

## The part it had to guess

The line. `warnAt` counts _everything_ — cache reads included, which is what
a long session is mostly made of — and it ships at five million because that
is a number a Claude Code session reaches after a serious afternoon. It is a
cost nudge, not a context-window gauge: aimux does not know the window, and
this plugin does not pretend to. Set it to 0 to turn it off:

```ts
plugins: [{ id: 'aimux-examples.tokens', config: { warnAt: 0 } }]
```

A tab whose assistant writes no transcript shows `⌁ —`, which is the honest
answer and not an error.
