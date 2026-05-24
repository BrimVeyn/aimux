---
title: Toasts
description: The transient notification system — imperative API, options, and architecture.
---

# Toasts

Toasts are transient, app-wide notifications that slide in from a corner. Use
them for the **outcome of an action** — especially one that can happen outside
git mode, where the git-pane message bar isn't visible.

This page is for contributors adding feedback to a feature.

## When to use a toast (and when not to)

Use a toast when the result needs to be seen no matter where the user is — a
push result, a worktree created/moved, a workspace deleted, a background failure.

**Leave it inline** when the message belongs to a surface the user is already
looking at: git-pane status (staging, commit, `HEAD~N`), or a modal's own
validation (the new-tab branch-name error, the worktree-delete confirm). A toast
there would just duplicate it.

## API

Importable anywhere — components or side effects, no React required:

```ts
import { toast } from '../state/toast-store'

toast.success('Pushed')
toast.error('Push failed: rejected (non-fast-forward)')
toast.info('…')
toast.warning('…')

// Full control:
const id = toast.show({ title: 'Moved', message: 'feat/x → main', variant: 'success' })
toast.dismiss(id)
```

The variant shortcuts take a `message` plus optional overrides:
`toast.success(message, { position, durationMs, title, content })`.

## Options

| Option       | Default                 | Notes                                                                  |
| ------------ | ----------------------- | ---------------------------------------------------------------------- |
| `variant`    | `'info'`                | `info` / `success` / `warning` / `error` — themed color + icon         |
| `message`    | —                       | Body text                                                              |
| `title`      | —                       | Optional bold heading above the message                                |
| `content`    | —                       | A `ReactNode` rendered inside the toast shell instead of title/message |
| `durationMs` | per-variant (see below) | Auto-dismiss delay; `0` = sticky (until dismissed)                     |
| `position`   | `'top-right'`           | `top\|bottom` × `left\|center\|right`                                  |

**Composition:** for anything beyond a title + message, pass `content`. The
component still owns the chrome (border, padding), positioning, slide animation,
and the dismiss timer — you just supply the body.

**Durations** default by variant so important things linger longer; an explicit
`durationMs` always wins:

| Variant            | Default |
| ------------------ | ------- |
| `error`            | 7000 ms |
| `warning`          | 5000 ms |
| `info` / `success` | 3500 ms |

## Architecture

- `src/state/toast-store.ts` — a standalone vanilla-zustand store (same pattern
  as `ai-usage-store`), so toasts stay decoupled from the main `AppState`/reducer.
  It holds `toasts`, `show`/`dismiss`/`clear`, the `toast` convenience object, and
  `TOAST_CONFIG`.
- `src/ui/components/overlays/toast/`
  - `toast-viewport.tsx` — mounted once at the root (`RootView`, both the git and
    normal branches). Groups active toasts by position and renders one stack per
    occupied corner, on top of everything.
  - `toast-stack.tsx` — an absolutely-positioned column at a corner; newest sits
    nearest the edge, capped at `maxVisible`.
  - `toast-item.tsx` — owns the bordered card, the auto-dismiss timer, and the
    slide-in/out lifecycle; renders the default body or `content`.
  - `use-toast-animation.ts` — the slide. Terminals have no opacity or transform,
    so motion is a stepped integer **cell offset** driven by a frame loop, applied
    as a negative edge margin (clipped at the screen edge).
  - `toast-position.ts` — pure helpers mapping a position to its corner box props
    and slide direction.

## Global config

`TOAST_CONFIG` (in the store) holds the defaults: `defaultPosition`, per-variant
`durations`, `maxVisible` per stack, `gap`, card `width`, and `reduceMotion`.
Set `reduceMotion: true` to make toasts appear/disappear instantly (used in
tests and for reduced-motion preferences).
