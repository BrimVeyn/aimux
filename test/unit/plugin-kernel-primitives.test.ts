import { createTestContext, EffectStack, PluginEventBus } from '@brimveyn/aimux-plugin'
import { describe, expect, test } from 'bun:test'

import { ServiceRegistry } from '../../src/plugins/kernel'

/**
 * The three primitives every other guarantee rests on: dispatch semantics,
 * total reversible disposal, and single-owner services.
 */

describe('PluginEventBus', () => {
  test('emit runs synchronous listeners synchronously', () => {
    const bus = new PluginEventBus()
    const seen: number[] = []
    bus.on<number>('e', (n) => {
      seen.push(n)
    })
    bus.emit('e', 1)
    // No await: a plugin that emits and then reads its own state must not
    // have to know the bus deferred the listener.
    expect(seen).toEqual([1])
  })

  test('emit routes a listener error to onError instead of throwing', async () => {
    const errors: string[] = []
    const bus = new PluginEventBus({
      onError: (error, ctx) => errors.push(`${ctx.event}:${String(error)}`),
    })
    bus.on('e', () => {
      throw new Error('sync boom')
    })
    bus.on('e', async () => {
      throw new Error('async boom')
    })
    expect(() => bus.emit('e')).not.toThrow()
    await Bun.sleep(1)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('sync boom')
    expect(errors[1]).toContain('async boom')
  })

  test('serial preserves registration order; parallel collects every result', async () => {
    const bus = new PluginEventBus()
    const order: string[] = []
    bus.on('e', async () => {
      await Bun.sleep(5)
      order.push('slow')
      return 1
    })
    bus.on('e', () => {
      order.push('fast')
      return 2
    })
    expect(await bus.serial('e')).toEqual([1, 2])
    expect(order).toEqual(['slow', 'fast'])
    expect((await bus.parallel('e')).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2])
  })

  test('bail stops at the first defined result', async () => {
    const bus = new PluginEventBus()
    let reached = false
    bus.on('e', () => {
      /* no opinion */
    })
    bus.on('e', () => 'answer')
    bus.on('e', () => {
      reached = true
      return 'never'
    })
    expect(await bus.bail<string>('e')).toBe('answer')
    expect(reached).toBe(false)
  })

  test('waterfall threads the value; undefined means "no opinion"', async () => {
    const bus = new PluginEventBus()
    bus.on<number>('e', (n) => n + 1)
    bus.on<number>('e', () => {
      /* no opinion */
    })
    bus.on<number>('e', (n) => n * 10)
    expect(await bus.waterfall('e', 1)).toBe(20)
  })

  test('a listener unsubscribing mid-dispatch does not skip its neighbour', () => {
    const bus = new PluginEventBus()
    const seen: string[] = []
    const off = bus.on('e', () => {
      seen.push('first')
      off()
    })
    bus.on('e', () => {
      seen.push('second')
    })
    bus.emit('e')
    expect(seen).toEqual(['first', 'second'])
    expect(bus.listenerCount('e')).toBe(1)
  })
})

describe('EffectStack', () => {
  test('disposes in reverse registration order', async () => {
    const stack = new EffectStack()
    const order: number[] = []
    stack.add(() => {
      order.push(1)
    })
    stack.add(() => {
      order.push(2)
    })
    stack.add(() => {
      order.push(3)
    })
    await stack.dispose()
    expect(order).toEqual([3, 2, 1])
    expect(stack.size).toBe(0)
  })

  test('a throwing disposer does not abort the unwind', async () => {
    const stack = new EffectStack()
    const order: string[] = []
    stack.add(() => {
      order.push('first')
    })
    stack.add(() => {
      throw new Error('bad disposer')
    })
    stack.add(() => {
      order.push('third')
    })
    const errors = await stack.dispose()
    // A half-disposed fiber is the one state reload cannot recover from, so
    // everything still runs and the errors are reported together.
    expect(order).toEqual(['third', 'first'])
    expect(errors).toHaveLength(1)
  })

  test('a disposer registered after disposal runs immediately rather than leaking', async () => {
    const stack = new EffectStack()
    await stack.dispose()
    let ran = false
    stack.add(() => {
      ran = true
    })
    await Bun.sleep(1)
    expect(ran).toBe(true)
    expect(stack.size).toBe(0)
  })

  test('run registers whatever the setup returns', async () => {
    const stack = new EffectStack()
    let disposed = false
    await stack.run(async () => {
      await Bun.sleep(1)
      return () => {
        disposed = true
      }
    })
    expect(stack.size).toBe(1)
    await stack.dispose()
    expect(disposed).toBe(true)
  })
})

describe('ServiceRegistry', () => {
  test('provides, reads, and withdraws', () => {
    const registry = new ServiceRegistry()
    const withdraw = registry.provide('tabs', { n: 1 }, 'acme.a')
    expect(registry.get<{ n: number }>('tabs')?.n).toBe(1)
    expect(registry.ownedBy('acme.a')).toEqual(['tabs'])
    withdraw()
    expect(registry.has('tabs')).toBe(false)
  })

  test('refuses a second owner for one name', () => {
    const registry = new ServiceRegistry()
    registry.provide('tabs', 1, 'acme.a')
    // Silent shadowing would make load order decide behaviour.
    expect(() => registry.provide('tabs', 2, 'acme.b')).toThrow(/already provided by acme\.a/)
  })

  test('missing reports only what is absent', () => {
    const registry = new ServiceRegistry()
    registry.provide('tabs', 1)
    expect(registry.missing(['tabs', 'ui', 'themes'])).toEqual(['ui', 'themes'])
  })

  test('notifies on both provide and withdraw', () => {
    const registry = new ServiceRegistry()
    const seen: string[] = []
    registry.onChange((name, present) => seen.push(`${name}:${String(present)}`))
    const withdraw = registry.provide('ui', 1)
    withdraw()
    expect(seen).toEqual(['ui:true', 'ui:false'])
  })
})

describe('createTestContext', () => {
  test('collects registrations and releases them all on dispose', async () => {
    const harness = createTestContext({ config: { greeting: 'hi' }, onCall: () => 'answered' })

    await harness.apply({
      apply(ctx) {
        ctx.on('e', () => 'seen')
        ctx.rpc.handle('greet', (name) => `${String(ctx.config.greeting)} ${String(name)}`)
        ctx.provide('thing', 1)
        ctx.effect(() => () => {})
        void ctx.rpc.call('remote', { a: 1 })
        ctx.rpc.broadcast('shout')
      },
    })

    expect(await harness.invoke<string>('greet', 'world')).toBe('hi world')
    expect(harness.handledVerbs()).toEqual(['greet'])
    expect(harness.provided.has('thing')).toBe(true)
    expect(harness.calls).toEqual([{ payload: { a: 1 }, verb: 'remote' }])
    expect(harness.broadcasts).toEqual([{ payload: undefined, verb: 'shout' }])
    expect(harness.bus.listenerCount('e')).toBe(1)

    await harness.dispose()

    expect(harness.effectCount()).toBe(0)
    expect(harness.handledVerbs()).toEqual([])
    expect(harness.provided.size).toBe(0)
    expect(harness.bus.listenerCount('e')).toBe(0)
  })

  test('rejects a call when the test declares no other half', async () => {
    const harness = createTestContext()
    await harness.apply({ apply: () => {} })
    expect(harness.ctx.rpc.call('anything')).rejects.toThrow(/no handler/)
  })
})
