/**
 * Loads the React renderer with its component performance track switched off.
 *
 * aimux runs from source with nothing setting NODE_ENV, so the UI gets React's
 * development build. That build ships a "performance track": after every
 * commit it diffs the old and new props of each component that re-rendered,
 * to label the entry it hands `console.timeStamp`. Typed arrays are walked
 * index by index. A PDF diff passes both documents as props — up to 15 MB
 * each — so moving from one PDF to another, or the same PDF being fetched
 * again, built tens of millions of entries on the main thread: the UI froze at
 * full CPU, its memory swinging between one and five gigabytes, and did not
 * come back.
 *
 * The track only exists if `console.timeStamp` is a function when the
 * reconciler module is first evaluated, and nothing in a terminal reads it, so
 * the function is hidden for the length of that import and put back after.
 *
 * Not the production build instead: Bun picks `jsxDEV` for every file at
 * startup, and `@opentui/react` ships compiled against `react/jsx-dev-runtime`,
 * whose production build exports no `jsxDEV` at all.
 */
export async function withoutReactPerformanceTrack<T>(load: () => Promise<T>): Promise<T> {
  const timeStamp = Reflect.get(console, 'timeStamp')
  Reflect.set(console, 'timeStamp', undefined)
  try {
    return await load()
  } finally {
    Reflect.set(console, 'timeStamp', timeStamp)
  }
}
