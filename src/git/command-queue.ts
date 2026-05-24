let tail: Promise<unknown> = Promise.resolve()

export async function enqueueGitOp<T>(op: () => Promise<T>): Promise<T> {
  const previous = tail
  const run = async (): Promise<T> => {
    try {
      await previous
    } catch {
      // Previous op already surfaced its own failure; keep the queue moving.
    }
    return op()
  }
  const next = run()
  // Advance the queue tail without letting this op's rejection break the chain.
  tail = (async () => {
    try {
      await next
    } catch {
      // Swallow so the next enqueued op still runs.
    }
  })()
  return next
}
