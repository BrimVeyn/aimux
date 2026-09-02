# `aimux-plugin.json`

The manifest is everything aimux must know **before** it runs a line of your
code: which halves exist, which API generation you wrote against, what
configuration you take, and which subprocess commands you contribute. It is
therefore parsed on its own and never by importing the plugin — which is why a
plugin with a broken manifest fails with a field name rather than a stack.

`aimux plugin doctor <path>` reports every problem at once, each as
`field: reason`. Fix them from that list; do not guess from this page.

## A complete one

```jsonc
{
  "id": "acme.telegram-notify",
  "name": "Telegram notify",
  "version": "0.2.0",
  "description": "Send a Telegram message when an agent finishes a turn",
  "apiVersion": 1,
  "minAimuxVersion": "1.23.0",
  "entries": {
    "ui": "src/ui.tsx",
    "daemon": "src/daemon.ts",
  },
  "build": [["bun", "install"]],
  "config": {
    "botToken": {
      "type": "string",
      "label": "Bot token",
      "description": "From @BotFather",
      "required": true,
      "secret": true,
    },
    "quietMinutes": { "type": "number", "label": "Stay quiet for", "default": 5 },
  },
  "commands": [{ "id": "test", "title": "Send a test message", "command": ["./send.sh", "test"] }],
}
```

## Fields

| Field             | Required | Rule                                                                        |
| ----------------- | -------- | --------------------------------------------------------------------------- |
| `id`              | yes      | lowercase, dot-separated, at least `<vendor>.<name>`                        |
| `version`         | yes      | any non-empty string                                                        |
| `apiVersion`      | yes      | an integer, and it must equal the generation this aimux implements          |
| `name`            | no       | human-facing; defaults to `id`                                              |
| `description`     | no       | shown in `plugin list` and on the settings screen                           |
| `minAimuxVersion` | no       | semver; refuses to load on an older aimux                                   |
| `entries`         | no\*     | `ui` and/or `daemon`, each a relative path inside the plugin                |
| `build`           | no       | argv arrays run once at link/install time, e.g. `[["bun","install"]]`       |
| `config`          | no       | field name → `{ type, label?, description?, default?, required?, secret? }` |
| `commands`        | no\*     | `{ id, command: argv, title?, contexts? }`                                  |

\* A plugin must contribute _something_: `entries.ui`, `entries.daemon`, or a
non-empty `commands`. A manifest with none of the three is rejected.

The `id` is the namespace for every registration you make — widget ids, keymap
modes, RPC verbs, hook paths. The dot is required because an unqualified
`notify` would collide the first time two people had the same idea.

## What makes it invalid

```jsonc
{ "id": "notify" }
```

→ `id: must be lowercase, dot-separated, at least "<vendor>.<name>"`. Also
missing `version` and `apiVersion`, and it contributes nothing.

```jsonc
{ "entries": { "ui": "/Users/me/plugin/ui.ts" } }
```

→ `entries.ui: must be a relative path inside the plugin directory`. Same for
anything containing `..`.

```jsonc
{ "entries": { "server": "src/server.ts" } }
```

→ `entries.server: unknown host; only "ui" and "daemon" load plugins`. The
terminal manager loads no plugin code, deliberately.

```jsonc
{ "config": { "retries": { "type": "int" } } }
```

→ `config.retries.type: must be one of "string", "number", "boolean"`. These
three are what the settings screen can render.

```jsonc
{ "config": { "retries": { "type": "number", "default": "3" } } }
```

→ `config.retries.default: must be a number to match the declared type`. A
plugin reading `ctx.config.retries` must never receive the string `"3"`.

```jsonc
{ "build": ["bun install"] }
```

→ `build[0]: must be a non-empty array of strings (argv, not a shell string)`.
Same rule for `commands[].command`: argv, so there is no quoting to get wrong
and nothing to inject into.

```jsonc
{ "apiVersion": 2 }
```

→ `apiVersion: is 2; this aimux implements 1`. Bumped only on a break.

## Configuration precedence

Manifest `default` ← the registry (what `plugin install` and the settings
screen write) ← `aimux.config.ts`. The file a human edits outranks the one a
machine wrote.

```ts
// aimux.config.ts
plugins: [
  { id: 'acme.telegram-notify', config: { quietMinutes: 15 } },
  { id: 'aimux.claude', enabled: false }, // works on shipped plugins too
]
```

A value of the wrong type is dropped with an issue rather than coerced. A key
the manifest does not describe is passed through untouched — the schema exists
to generate settings rows, not to be a wall.

A field marked `required` with no value anywhere makes the plugin fail to load,
which is the honest outcome: a notifier with no bot token cannot notify, and
failing at load says so once instead of at every event.
