---
title: Plugins
description: Installing, configuring and switching off aimux plugins — including the ones aimux ships with.
---

# Plugins

A plugin adds to aimux without a fork: a widget in a bar, a panel on the stats
screen, a pane sitting beside an agent, a key that does something, an assistant
aimux did not know about, a command that fires when an agent finishes a turn.

Some of them ship with aimux. `aimux plugin list` shows those alongside
anything you have added, because there is no difference in how they load — a
built-in is an ordinary plugin whose code happens to be inside the binary.

If you want to _write_ one, this is not the page: read
`docs/developer/plugins.md`, or run `aimux plugin new <id>`.

## Seeing what you have

```
aimux plugin list
```

Two lists come back. `plugins` is everything aimux knows about — id, version,
where it came from, whether it is enabled. `running` is what is actually
loaded, per process, with its state and how many things it has registered.

A plugin can be known and not running for good reasons: it is disabled, its
half for this process does not exist, or it is waiting on a service another
plugin has not provided yet. `aimux plugin log <id>` says which.

## Adding one

```
aimux plugin install <owner/repo>       # from GitHub, into your profile
aimux plugin link ~/code/my-plugin      # a directory you are working on
```

`install` clones into `<profile>/plugins/<id>` and runs whatever build steps
the manifest declares — you are shown them first, and `--yes` skips the
confirmation. `link` copies nothing: the directory stays yours, and it is
watched, so saving a file reloads the plugin without restarting aimux.

Remove with `aimux plugin uninstall <id>` or `aimux plugin unlink <id>`. Both
leave your configuration for that plugin alone unless you pass `--purge`, so
reinstalling does not mean setting it up again.

## Turning one off

```
aimux plugin disable <id>
aimux plugin enable <id>
```

Or flip its switch on the settings screen, under **Plugins**.

A disabled plugin stays known and configured; it just never loads. That makes
"is this plugin the problem?" a one-command question with a one-command answer,
rather than an unlink/relink round trip that loses its settings.

This works on every plugin — including the ones that ship with aimux. They have
no registry row of their own, so the decision is stored under an `overrides`
block keyed by id, which is the same place a linked or installed plugin's
switch lives.

`aimux.config.ts` still outranks it:

```ts
export default {
  plugins: [{ id: 'aimux.claude', enabled: false }],
}
```

When it does, the CLI says so — `shadowedBy: "aimux.config.ts"` — and the
settings row carries the `*` mark and the note _"set in aimux.config.ts — comes
back on restart"_. The write still happens, so removing the config line reveals
what you asked for.

Today those are:

| Id               | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `aimux.claude`   | Writes aimux's theme and activity hooks into Claude Code's settings |
| `aimux.ai-usage` | The Claude/Codex quota tile in the status bar, and its polling      |

Both keep their own settings rows on the settings screen; disabling the plugin
turns the feature off outright.

## Configuring one

A plugin declares its settings in its manifest, and aimux generates rows for
them on the settings screen — one section per plugin, nothing to write by hand.

From a script, or from an agent:

```
aimux plugin config <id>              # every field, and where its value came from
aimux plugin set <id> <key> <value>   # coerced against the declared type
aimux plugin unset <id> <key>         # back to whatever is underneath
```

`set` refuses a key the manifest does not declare, and lists the ones it does.
A typo that landed somewhere no plugin reads would fail silently, which is
worse than failing.

You can still keep values in your config file — useful before a first launch,
or to pin something:

```ts
export default {
  plugins: [{ id: 'acme.telegram-notify', config: { quietMinutes: 15 } }],
}
```

The full order, lowest first: the manifest's default, then what aimux seeded
for a built-in, then what the settings screen or the CLI wrote, then
`aimux.config.ts`. The file you edit by hand outranks the one aimux writes. A
value of the wrong type is ignored with a warning rather than coerced.

Changing a value reloads the plugin that owns it, because a plugin reads its
configuration when it starts. You may see a plugin's pane or widget blink.

### Secrets

A field the manifest marks `secret` is never echoed — not by `plugin config`,
not by `plugin set`'s own output, not on the settings screen, not in the
plugin's log. The row reads `<secret>` and its editor opens empty, because a
secret is replaced rather than edited.

Pass one without putting it in your shell history:

```
aimux plugin set acme.telegram-notify botToken --value-stdin < ~/.token
```

It is still stored as plaintext JSON in your profile. That is shoulder-surfing
hygiene, not encryption.

## When something is wrong

```
aimux plugin show <id>             # state, config, errors and the log, in one call
aimux plugin doctor <id-or-path>   # is it valid, does it load, what does it register
aimux plugin log <id> --level warn # what it has been saying
aimux plugin reload [id]           # reload one, or all of them
```

`plugin show` exits `0` even when the plugin has failed — the question was
answered; read `state`.

`doctor` reports the offending field and a reason rather than "invalid" — the
same output whether you are debugging someone else's plugin or writing your
own.

Plugins run with your permissions, like anything else you install. `install`
shows you the repository and the build steps before it runs them; there is no
sandbox, and aimux does not claim one.

## Commands a plugin adds

A plugin can contribute its own CLI verbs and its own subprocess commands:

```
aimux plugin commands                  # what every manifest declares
aimux plugin exec <plugin-id> <cmd>    # run one
aimux <group> <verb>                   # a verb a plugin registered
```

Completion knows about both, so `aimux <TAB>` lists plugin groups next to the
built-in ones.
