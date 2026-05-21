---
title: Snippets
description: Reusable text fragments triggered inline or via a picker, with built-in variables, shell-backed variables, and cursor placement.
---

# Snippets

A snippet is a reusable text fragment. It can be:

- inserted manually via the **snippet picker** (`Ctrl+S`)
- expanded **inline** when you type its `trigger` (e.g. `:sig<space>`) — like
  Espanso macros
- enriched with **dynamic variables** (`{{date}}`, `{{cwd}}`, `{{branch}}`,
  `{{clipboard}}`, plus user-defined shell commands)
- placed precisely with a **cursor placeholder** (`$|`)

## Two Sources of Snippets

Snippets live in one of two places, with very different permissions:

| Source              | Where                                         | Editable from UI? | Can run shell commands? |
| ------------------- | --------------------------------------------- | ----------------- | ----------------------- |
| Typed config        | `aimux.config.ts` (the `snippets:` array)     | No (read-only)    | Yes                     |
| User catalog (JSON) | `aimux-snippets.json` (under the profile dir) | Yes (`Ctrl+S`)    | No (stripped on load)   |

Config-pinned snippets get a stable id prefix `config:` and a small `[config]`
badge in the picker. Their entries are reapplied at every launch — you cannot
delete or modify them from the picker, only from your `aimux.config.ts`.

User snippets are created and edited from the picker. They are persisted to
`aimux-snippets.json` and behave as plain text fragments.

The reason for the split is security: the snippet JSON file may be touched by
unrelated tools (backups, sync, restore). Shell execution is only authorized
when the snippet was written into your typed config file — which requires
intent.

## The Snippet Picker

`Ctrl+S` opens the picker. Type to filter, `Enter` to paste the highlighted
snippet into the active terminal. The shipped defaults are AI prompts:
_code review_, _explain_, _write tests_, _refactor_, _fix error_.

| Key                  | Action                                                |
| -------------------- | ----------------------------------------------------- |
| `Enter`              | Paste into active terminal                            |
| `Ctrl+A`             | Paste into every tab in the active group              |
| `Ctrl+O`             | Open the snippet's source file in `$EDITOR`/`$VISUAL` |
| `Ctrl+N` / `↓` / `j` | Move selection down                                   |
| `Ctrl+P` / `↑` / `k` | Move selection up                                     |
| `Esc`                | Close the picker                                      |

`Ctrl+O` routes by snippet origin:

- a `[config]` snippet opens `aimux.config.ts` (or `.js` if only that exists)
- a user snippet opens `aimux-snippets.json`

If `$EDITOR` and `$VISUAL` are both unset, a red status line appears at the
bottom of the picker. Configure `externalEditor` in `aimux.config.ts` or
export `EDITOR=nvim` in your shell rc.

## Inline Macro Triggers

Give a snippet a `trigger` and it expands inline when you type
`<triggerChar><trigger><separator>` in any terminal:

```ts
snippets: [
  {
    name: 'Signature',
    trigger: 'sig',
    text: 'Best,\nNathan',
  },
]
```

In a shell, typing `:sig<space>` becomes:

```text
Best,
Nathan
```

The trigger character defaults to `:` (Espanso-style) and is configurable:

```ts
snippetTriggerChar: ';'
```

A separator must follow the trigger to commit the expansion. Separators are
space, tab, newline, and the punctuation set `. , ; : ! ? ) ] }`. This is what
distinguishes `:sig` from `:signed-off-by`.

Detection is **suppressed in alt-screen apps** (vim, less, htop, etc.) so the
`:` prefix stays available for editor commands.

### Undo with One Backspace

Right after an inline expansion, the next keystroke decides whether to keep
or revert it. If it is a single backspace, the entire injected text is
erased; any other key clears the pending-undo and is passed through normally.
Single-line expansions only.

## Built-in Variables

Reference these inside `text` with `{{name}}`:

| Variable          | Resolves to                                          |
| ----------------- | ---------------------------------------------------- |
| `{{date}}`        | ISO date `YYYY-MM-DD`                                |
| `{{date:FORMAT}}` | custom format with tokens `YYYY MM DD HH mm ss`      |
| `{{cwd}}`         | aimux process working directory                      |
| `{{branch}}`      | active git branch from the git panel (empty if none) |
| `{{clipboard}}`   | macOS clipboard contents (via `pbpaste`)             |

Unknown `{{...}}` tokens are left literal — they do not raise an error.

## Cursor Placement: `$|`

The first occurrence of `$|` in `text` becomes the cursor position after
expansion. Further occurrences are stripped. If absent, the cursor lands at
the end of the expanded text.

```ts
{ trigger: 'gco', text: 'git checkout $|' }
```

Typing `:gco<space>` leaves the cursor right after `checkout ` so you can
type the branch name immediately.

## Shell-Backed Variables (`vars`)

A snippet defined in `aimux.config.ts` can declare named variables resolved
by running a shell command. Use them in `text` like any other variable.

The shape is a dict keyed by variable name, with each value tagged by its
resolver (V1 supports `sh`):

```ts
snippets: [
  {
    name: 'PR full',
    trigger: 'prfull',
    text: 'backend: {{back}}\nfrontend: {{front}}\nJira: {{jira}}',
    vars: {
      back: {
        sh: 'cd ~/Rainpath/back && gh pr list --author @me --limit 1 --json url --jq ".[0].url"',
      },
      front: {
        sh: 'cd ~/Rainpath/front && gh pr list --author @me --limit 1 --json url --jq ".[0].url"',
      },
      jira: { sh: 'jira issue list --plain --columns key --no-headers | head -1', timeout: 10000 },
    },
  },
]
```

### How They Run

- Commands execute via `$SHELL -l -c <cmd>` (login shell), so your
  `.zprofile` / path_helper populate `PATH` — `gh`, `brew`, `jira`, and other
  tools install via Homebrew resolve as they do in your interactive shell.
- All vars on one snippet run **in parallel** (`Promise.all`).
- The trimmed stdout of each command replaces `{{name}}` in `text`.

> **Cost note.** A login shell loads your shell's startup files
> (`.zprofile`, `.zshrc` on zsh; `.bash_profile` / `.profile` on bash). For
> heavy setups (`oh-my-zsh`, many plugins, slow `nvm` / `pyenv` init), each
> spawn can take 100-400ms. Vars on a single snippet run in parallel, so the
> latency floor is roughly the slowest cold-start command. Keep your shell
> init lean if you rely on shell-backed vars frequently.

### Options per Var

| Field     | Default | Behavior                              |
| --------- | ------- | ------------------------------------- |
| `sh`      | —       | The shell command. Required.          |
| `timeout` | `5000`  | Kill the process after this many ms.  |
| `trim`    | `true`  | Trim trailing whitespace from stdout. |

### Failure Modes

A var that times out, exits non-zero, or fails to spawn produces an empty
string — the snippet still expands, just without that value. Errors are
recorded in the debug log (`/tmp/aimux-input-debug.log`, only when
`AIMUX_DEBUG_INPUT=1`):

```text
snippets.shellVar.nonZeroExit  {"cmd":"…","exitCode":127,"stderr":"…"}
snippets.shellVar.timeout      {"cmd":"…","timeoutMs":5000}
snippets.shellVar.spawnError   {"cmd":"…","error":"…"}
```

If your shell command uses `|| echo '[fallback]'`, the fallback always
produces exit 0 — `runShellVar` treats it as success and **no log entry is
written**. To debug a slow / wrong command, remove the `||` fallback
temporarily.

### Name Collisions

If a snippet declares a var named `date`, `cwd`, `branch`, or `clipboard`,
the snippet's value shadows the built-in. This is intentional — your var
declaration is explicit, the built-in is a fallback.

### Async vs Sync Path

A snippet without `vars` and without `{{clipboard}}` resolves synchronously
in a single PTY write: erase the trigger, inject the body, position the
cursor.

A snippet with `vars` (or `{{clipboard}}`) takes the async path:

1. **Eager erase** — `:prfull ` disappears from the terminal immediately,
   before any command runs. You don't stare at the typed trigger while
   `gh` resolves.
2. Commands run in parallel.
3. The body is injected when all resolve.

Any keystrokes you type during the await land at the insertion point and the
body appends after them. This matches Espanso's behavior.

## Variables Surface — Examples

### Append the current branch to a prompt

```ts
{ trigger: 'br', text: "I'm on the {{branch}} branch." }
```

### Insert a `git commit` template with the cursor in the message

```ts
{ trigger: 'gc', text: 'git commit -m "$|"' }
```

### Date-prefixed scratch note

```ts
{ trigger: 'note', text: '[{{date:YYYY-MM-DD HH:mm}}] $|' }
```

### Paste the clipboard with a label

```ts
{ trigger: 'ref', text: 'See: {{clipboard}}' }
```

## Configuration Reference

### `snippetTriggerChar`

```ts
/** Single-character prefix that opens an inline trigger. Default: `:`. */
snippetTriggerChar?: string
```

### `snippets[]`

```ts
interface SnippetDef {
  name: string
  trigger?: string
  text: string
  vars?: Record<string, SnippetVar>
}

interface SnippetShellVar {
  sh: string
  timeout?: number // ms, default 5000
  trim?: boolean // default true
}

type SnippetVar = SnippetShellVar
```

The `vars` key is `Record<string, SnippetVar>` — the dict key is the
variable name. The discriminator on the value (`sh` for now) keeps the shape
extensible for future variable types (`{ env: 'HOME' }`, `{ date: '…' }`,
etc.) without breaking the public surface.

## Limitations and Gotchas

- **Template literals preserve newlines.** A long `sh` command wrapped across
  multiple lines in `aimux.config.ts` becomes a multi-line shell input, which
  is rarely what you want. Keep each command on a single line, or build with
  `[...].join(' ')`.
- **`bash` vi-mode and other apps that own `:`.** Detection only checks
  `isAlternateBuffer`. Apps that consume `:` without an alt-screen
  transition (bash vi-mode, certain TUIs in normal screen) will still see
  expansion if you type the trigger there. Workaround: change `triggerChar`
  or avoid the trigger in those contexts.
- **No hot-reload.** Changes to `aimux.config.ts` require an aimux restart.
- **Single-character trigger char.** Multi-byte / emoji trigger chars are
  not supported in V1.
- **macOS-only clipboard read.** `{{clipboard}}` uses `pbpaste`. Linux
  support would require `xclip` / `wl-paste`; not yet wired.
- **Bash vi-mode workaround.** If `:` clashes with another keymap you use
  often, pick a different `triggerChar` such as `;` or `,`.

## Where Things Live

| Path                                                      | What                                 |
| --------------------------------------------------------- | ------------------------------------ |
| `~/.config/aimux/<profile>/aimux.config.ts`               | Typed snippets + trigger char config |
| `~/.config/aimux/<profile>/aimux-snippets.json`           | User-edited catalog                  |
| `/tmp/aimux-input-debug.log` (when `AIMUX_DEBUG_INPUT=1`) | Shell-var resolution logs            |
