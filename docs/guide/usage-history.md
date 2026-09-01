---
title: Usage History
description: Long-term AI usage statistics built from the assistants' own transcripts, with a contributions-style heatmap and per-branch token attribution.
---

# Usage History

The **History** page of the AI usage modal shows how much you have actually used
Claude Code and Codex over time: a contributions-style heatmap of daily activity,
plus token, model, and git-branch breakdowns.

Open it with `<Leader>u`, then press `l` to switch from **Live** to **History**
(`h` goes back, `Esc` closes).

This is the historical counterpart to the live quota bars documented in
`ai-usage-indicator.md`. The two share a modal but nothing else: the indicator
polls an OAuth endpoint for your current window, this page reads what the
assistants left on disk.

## Why aimux Keeps Its Own Copy

Claude Code prunes its own transcripts. On a working machine roughly a month
survives; everything older is gone. The `stats-cache.json` it used to maintain
alongside them stopped being written in February 2026.

So aimux cannot _read_ a year of history — it **builds** one. A background
rollup aggregates whatever is on disk into per-day totals and merges them into a
file aimux owns. After a few months that file is the only long-term record of
your usage that still exists anywhere.

The practical consequence: the heatmap is complete from day one, but the
**token** figures only deepen as the rollup keeps running. A fresh install shows
tokens for the last month or so and prompt activity for as far back as
`history.jsonl` goes.

## What It Shows

| Row        | Source                             | Coverage                                     |
| ---------- | ---------------------------------- | -------------------------------------------- |
| Heatmap    | `~/.claude/history.jsonl`          | full prompt history, no gaps                 |
| `Prompts`  | same                               | total, busiest day, average over active days |
| `Tokens`   | `~/.claude/projects/**/*.jsonl`    | only the days whose transcripts survive      |
| `Models`   | same                               | tokens per model, busiest first              |
| `Branches` | same, via each entry's `gitBranch` | tokens per git branch                        |
| `Codex`    | `~/.codex/sessions/**/*.jsonl`     | active days and total tokens                 |

Heatmap cells count **prompts**, never tokens. The two sources have different
retention, and mixing them would make cells from different periods measure
different things. Cell intensity is bucketed by quartile of the non-empty days,
so one exceptional day cannot flatten the rest of the year.

The grid needs about 57 columns for a full year. On a narrower terminal it shows
the most recent weeks that fit and says so under the grid.

## Where The Data Lives

```text
~/.config/aimux/usage-history.json
```

At the profile **root**, not under `~/.config/aimux/<profile>/`: your assistant
usage belongs to the machine, not to an aimux profile, and per-profile copies
would each hold half the history.

Deliberately not in `~/.cache/`. A cache is something that can be rebuilt, and
once the transcripts behind a given day are pruned, nothing can rebuild it.

The file is written atomically (temp file plus rename) and a failed rollup writes
nothing at all, so a crash mid-parse leaves the previous contents intact.

## How It Works

1. On launch, aimux checks `lastRollupAt` in that file. If it is more than 20
   hours old, it spawns `aimux usage-rollup` as a **detached process**. The
   parse walks hundreds of megabytes of JSONL, which would visibly stall the
   render loop if it ran in the UI process.
2. The rollup streams every transcript line by line, keeps the entries carrying
   token usage, and buckets them by **local** calendar day.
3. Entries are de-duplicated on `message.id` + `requestId`. Claude Code copies
   earlier turns into a new transcript when you resume or fork a session, so the
   same billed request legitimately appears in several files.
4. The result is merged into the stored file, per tool and per day.

20 hours rather than 24 so that opening aimux at roughly the same time each
morning does not sit exactly on the boundary and skip every other day.

### The Merge Rule

Days are **replaced**, never accumulated — that is what makes running the rollup
twice a no-op instead of doubling every total.

Pruning only ever removes data, so a freshly parsed day whose token total is
_smaller_ than the stored one means the source was pruned in the meantime, and
the stored copy is kept. Prompt counts are merged separately (highest wins),
because they come from `history.jsonl`, which outlives the transcripts.

This doubles as crash protection: a rollup that dies halfway through produces
totals smaller than what is stored, and they are discarded.

## Fault Tolerance

- An assistant that is not installed contributes nothing; no error is shown.
- An unreadable or half-written transcript is skipped, not fatal — the file an
  assistant is appending to right now has a truncated last line by definition.
- A history file written by a **newer** aimux is displayed but never rewritten,
  so a dev build sharing your `$HOME` cannot silently drop fields it does not
  know about.
- Every failure path leaves `lastRollupAt` untouched, so the next launch retries.

## Known Limitation

Days are bucketed in the machine's local timezone **at rollup time** and are
never re-bucketed. Moving across timezones leaves a seam at the point of the
move; fixing it would mean storing every raw event rather than daily totals.

## Turning It Off

```bash
AIMUX_NO_USAGE_ROLLUP=1
```

Set it in your shell profile and no rollup is ever spawned. Nothing is deleted —
the History page keeps rendering whatever was already collected. Remove the
existing data with:

```bash
rm ~/.config/aimux/usage-history.json
```

Note that this is not recoverable: the transcripts behind the older days are
very likely gone.
