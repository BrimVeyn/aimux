let tail: Promise<unknown> = Promise.resolve()

export function enqueueGitOp<T>(op: () => Promise<T>): Promise<T> {
  const next = tail.then(op, op)
  tail = next.catch(() => {})
  return next
}
