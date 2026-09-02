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

A disabled plugin stays registered and configured; it just never loads. That
makes "is this plugin the problem?" a one-command question with a one-command
answer, rather than an unlink/relink round trip that loses its settings.

The plugins that ship with aimux have no registry row to toggle — they are part
of the binary — so they are switched off in `aimux.config.ts`:

```ts
export default {
  plugins: [{ id: 'aimux.claude', enabled: false }],
}
```

Today those are:

| Id               | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `aimux.claude`   | Writes aimux's theme and activity hooks into Claude Code's settings |
| `aimux.ai-usage` | The Claude/Codex quota tile in the status bar, and its polling      |

Both keep their own settings rows on the settings screen; disabling the plugin
turns the feature off outright.

## Configuring one

A plugin declares its settings in its manifest, and aimux generates rows for
them on the settings screen — nothing to write by hand. When you would rather
keep the values in your config file, or need to set something before first
launch:

```ts
export default {
  plugins: [{ id: 'acme.telegram-notify', config: { quietMinutes: 15 } }],
}
```

`aimux.config.ts` wins over the settings screen for a key it declares: the file
you edit outranks the one aimux writes. A value of the wrong type is ignored
with a warning rather than coerced.

Secrets marked as such in the manifest are never echoed — not by `plugin list`,
not on the settings screen, not in the plugin's log. They are still stored as
plaintext JSON in your profile: that is shoulder-surfing hygiene, not
encryption.

## When something is wrong

```
aimux plugin doctor <id-or-path>   # is it valid, does it load, what does it register
aimux plugin log <id> --level warn # what it has been saying
aimux plugin reload [id]           # reload one, or all of them
```

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
