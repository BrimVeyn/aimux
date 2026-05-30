# State ownership (host vs client)

aimux's GUI is a thin React shell over a shared Bun host. Two halves share
state via WebSocket, and the **rule of thumb** for who owns what is:

- **Host owns committed state.** AppState slices that the reducer mutates and
  that survive across restarts (snippets catalog, sessions, layout, themeId,
  `modal.type`, `modal.sessionTargetId`, etc.) live in `appStore` and are
  projected to the client.
- **Client owns in-flight UI state.** Things the user is _currently editing_
  with no commit yet (snippet name/trigger/content while the modal is open,
  the cursor in a future palette, hover preview) can live in React
  `useState` on the client. The host doesn't need to know.

This is **roadmap P1.3**. The first migrated modal is the snippet editor
(`src/components/modals/SnippetEditorModal.tsx`).

## Migration pattern (client-authoritative modals)

When a modal becomes client-authoritative:

1. **Seed** React `useState` from the projection in a lazy initializer
   (`useState(() => readInitialBuffer(modal, 'name'))`). The projection is
   consulted ONCE at mount. After that, host updates to the same fields are
   ignored — the user's typing wins.
2. **Handle all per-keystroke input locally.** Native `<input>` / `<textarea>`
   give us selection, IME, clipboard, undo, accessibility for free.
3. **Emit a single intent on submit/cancel.** For snippets:
   `{ kind: 'modal.snippet.submit', name, trigger, content, snippetId? }` or
   `{ kind: 'modal.cancel' }`. The host commits the value, dispatches
   `close-modal`, and the projection unmounts the component.
4. **Stop bubbling to App.tsx's window-level key handler** for these inputs.
   App.tsx now early-returns on `INPUT`/`TEXTAREA`/`contentEditable` targets;
   modals should also `stopPropagation()` defensively in their own key
   handlers so a stray bubble can't reach the host.

## Boundary (never cross these)

- **Never write to AppState from the client.** No client-side reducer, no
  shadow store. If you need a host-side change, it goes through an intent.
- **Never trust the host's projection of fields you've taken ownership of**
  after mount. Reading them would create a brief flicker on the next
  broadcast and a divergence if the host's view ever drifted.
- **Don't migrate the TUI's snippet editor.** The TUI (`src/ui/`) keeps the
  char-by-char `editBuffer` flow driven by the shared keymap — that path is
  untouched and must remain so.

## Why this exists

- **Latency.** Every keystroke used to round-trip to the host and back.
  Local React state is one frame; WS round-trip is variable and adds tail
  latency on top of the reducer + projection encode.
- **Projection size.** The old per-keystroke flow rebroadcasted the full
  `AppStateProjection`. Reducing per-keystroke broadcasts to zero is a
  prerequisite for P1.2's split channels.
- **Divergence from the TUI.** The GUI has real form elements; the TUI has
  a keymap. Forcing the GUI to mimic the TUI step-by-step gave up most of
  what the platform offers. P1.3 makes the GUI authoritative for its UI
  surface while keeping the **committed** state shared.

## What to read next

- `src/components/modals/SnippetEditorModal.tsx` — the canonical pilot.
- `src/App.tsx` (`onKeyDown` / `onPaste`) — the form-input carve-out.
- `packages/gui-protocol/src/intents.ts` — `modal.snippet.submit` payload.
- `src/gui/intent-handlers.ts` — host-side `handleSnippetSubmit`.
- `GUI_ROADMAP.md` § P1.3 / P1.4 — the broader plan.
