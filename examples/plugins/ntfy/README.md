# ntfy

aimux's notifications on your phone through [ntfy](https://ntfy.sh), or on
your desktop — replacing the sound rather than doubling it.

Link it and the desktop half works at once; the phone half needs a topic:

```
aimux plugin set aimux-examples.ntfy topic my-aimux-topic
aimux plugin set aimux-examples.ntfy token --value-stdin < ~/.ntfy-token   # protected topics only
```

`<leader>n` raises a test notification through whatever is configured.

## What it demonstrates

- **`ctx.ui.notifications.provide(sink)`** — the plugin takes the
  notification slot. From then on the sound on "agent asks a question" and
  "turn finished in a tab you are not looking at" stops, and every event —
  aimux's own and any plugin's `notify` — lands in the sink instead
- **one slot, one holder**: a second plugin asking is refused and told so in
  its `aimux plugin log`
- **UI → daemon RPC for delivery**, because an HTTP call and a subprocess do
  not belong in the process drawing frames
- **`ctx.ui.notifications.notify`** from the test key — through the sink, not
  around it, so the test tests the right thing
- a **secret config field** for the token, redacted everywhere but
  `ctx.config`

## Replace, never double

The rule the host enforces is that a notification is delivered once. This
plugin honours it in the other direction too: if neither door takes the
event — no topic, `desktop` off, `osascript` missing — the sink shows a toast
in the app, because silence is the one outcome a sink must not produce having
taken the sound away.

## The part it had to guess

Priorities. A question from the agent is `high` and buzzes; a finished turn
is `low` and does not; a plugin's own `error` is `high` and its `warning`
`default`. ntfy has five levels and aimux has three kinds plus four levels,
so this is a mapping and not a fact — change `priority()` in `src/daemon.ts`
if your phone disagrees.

On Linux the desktop door is `notify-send`; on macOS it is `osascript`, which
posts under the terminal's name and needs that app allowed in System
Settings › Notifications the first time.
