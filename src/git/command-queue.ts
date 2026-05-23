let tail: Promise<unknown> = Promise.resolve()

export async function enqueueGitOp<T>(op: () => Promise<T>): Promise<T> {
  const next = tail.then(op, op)
  tail = next.catch(() => {})
  return next
}
