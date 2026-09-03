# System load

CPU and GPU load as sparklines, in a bar widget.

```ts
// aimux.config.ts — place it in a bar like any other widget
bars: {
  left: {
    widgets: ['projects', 'aimux-examples.sysload.load']
  }
}
```

## What it demonstrates

- a **bar widget** (`ctx.ui.widgets`), sized from the width it is handed
- a **daemon half that polls**, with its timer inside `ctx.effect` so an
  unload takes it away
- **daemon → UI broadcast** (`ctx.rpc.broadcast` / `ctx.rpc.handle`), which is
  the shape of every "watch something and show it" plugin
- a **reducer** keeping bounded history in the plugin's own slice

## The part it had to guess

CPU is the one-minute load average over core count. Not "CPU %" — it counts
runnable work rather than busy time — but it needs no subprocess and reads the
same on macOS and Linux.

GPU has no portable answer, so the plugin does not pretend to one: it runs the
command you configure and takes the first number on stdout as a percentage. The
default assumes NVIDIA:

```
nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits
```

On an Apple Silicon machine there is no unprivileged GPU counter at all —
`powermetrics` needs root — so leave `gpuCommand` empty and the row draws as a
gap rather than a lie:

```ts
plugins: [{ id: 'aimux-examples.sysload', config: { gpuCommand: '' } }]
```

## Why the sampling is in the daemon

The UI process is drawing frames, and a subprocess spawned on its timer is jank
you can see. Sampling in the daemon also continues while no UI is attached, so
the graph has history to show when one comes back.
