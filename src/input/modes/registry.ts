import { isValidTransition } from "./transitions";
import type { KeyResult, ModeContext, ModeHandler, ModeId } from "./types";

const handlers = new Map<ModeId, ModeHandler>();

export function registerMode(handler: ModeHandler): void {
  handlers.set(handler.id, handler);
}

export function getHandler(id: ModeId): ModeHandler | undefined {
  return handlers.get(id);
}

export function transitionTo(from: ModeId, to: ModeId, ctx: ModeContext): KeyResult {
  if (!isValidTransition(from, to)) {
    console.error(`Invalid mode transition: ${from} -> ${to}`);
    return { actions: [], effects: [] };
  }

  const fromHandler = handlers.get(from);
  const toHandler = handlers.get(to);

  const exitResult = fromHandler?.onExit?.(ctx, to) ?? { actions: [], effects: [] };
  const enterResult = toHandler?.onEnter?.(ctx, from) ?? { actions: [], effects: [] };

  return {
    actions: [...exitResult.actions, ...enterResult.actions],
    effects: [...exitResult.effects, ...enterResult.effects],
    transition: to,
  };
}
