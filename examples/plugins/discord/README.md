# Discord presence

What your agents are doing, on your Discord profile: the project, how many
are working, and whether one is waiting on you.

```
aimux plugin link .
aimux plugin set aimux-examples.discord applicationId 1234567890123456789
```

The id comes from an application you create at
[discord.com/developers/applications](https://discord.com/developers/applications) —
General Information → Application ID. No bot, no token, no OAuth: a local
presence only needs the id, and its **name** is the line Discord prints above
everything else ("Playing aimux"). The Discord desktop client has to be
running on the same machine, with Settings → Activity Privacy → _display
current activity_ on.

Two optional settings: `showProject false` publishes `aimux` instead of the
project name, and `largeImage <key>` shows an icon uploaded under Rich
Presence → Art Assets.

## What it demonstrates

- a **daemon-only plugin**: no UI half at all, because the daemon is where
  every tab's status already is
- **`ctx.clients.ui()`** as the on switch: no interface attached, no presence.
  A daemon outlives the UI, and publishing "3 agents working" to a profile
  while nobody is at the screen is work for nothing
- **`tab:status` / `tab:question` / `tab:turnComplete` / `tab:closed`** as the
  whole input, with `ctx.tabs.list()` seeding the state so a hot reload is
  invisible
- **`ctx.effect`** owning a socket and a timer: unload clears the presence,
  ends the connection and leaves nothing behind
- a protocol implemented rather than installed — Discord's local RPC is
  `int32LE op | int32LE length | JSON` over a Unix socket, which is `src/ipc.ts`
  and no dependency

## Events do not drive the socket

Discord throttles activity updates to roughly one per 15 seconds, and a tab
flickers between `working` and `idle` several times a minute. So the listeners
only mark the state dirty; a 5-second tick decides whether to speak, skips an
update identical to the last one, drops the socket when the last interface
detaches, and reconnects when the client is closed.
That is also why one state has to win — see `summarize()` in `src/presence.ts`.

## The part it had to guess

Where the socket is. `$XDG_RUNTIME_DIR`, `$TMPDIR`, `/tmp`, each with the
Flatpak and Snap subdirectories, indices 0 through 9. A client installed
somewhere none of those cover is a one-line addition to `socketPath()`.

Which project. aimux has several open at once and a profile has one line: it
shows the last one that did something, which is right while you watch one
project and arbitrary while you watch two.
