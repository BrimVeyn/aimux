// Times one commit that hands a component a new multi-megabyte typed array, the
// shape of a PDF diff moving from one document to the next. Run as its own
// process so the reconciler is evaluated fresh: `off` loads it the way the UI
// does, anything else loads it plainly. Prints `{ ms }` as JSON.
import { withoutReactPerformanceTrack } from '../../src/app-runtime/react-performance-track'

const SIZE = 2_000_000

const load = async () => import('@opentui/react/test-utils')
const { testRender } =
  process.argv[2] === 'off' ? await withoutReactPerformanceTrack(load) : await load()
const { act, useState } = await import('react')

let swap: (bytes: Uint8Array) => void = () => {}

function Leaf({ bytes }: { bytes: Uint8Array }) {
  return <text>{bytes.byteLength}</text>
}

function Holder() {
  const [bytes, setBytes] = useState<Uint8Array>(() => new Uint8Array(SIZE))
  swap = setBytes
  return <Leaf bytes={bytes} />
}

const { renderOnce } = await testRender(<Holder />, { height: 2, width: 20 })
await renderOnce()
const start = performance.now()
await act(async () => swap(new Uint8Array(SIZE)))
await renderOnce()
process.stdout.write(JSON.stringify({ ms: performance.now() - start }))
process.exit(0)
