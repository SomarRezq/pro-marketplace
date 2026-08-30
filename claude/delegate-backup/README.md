# delegate-backup

When a delegate lane's implementer runs out of quota, walk that lane down a priority
chain of alternatives — and put it back automatically the moment the provider's window
resets.

Built for people running agentic coding around the clock, where every subscription CLI
hits a wall eventually and hitting one shouldn't stop the pipeline.

## Why it exists

Subscription coding CLIs are priced for human-paced interactive use. Sustained agentic
work exhausts them on very different timescales — hours for some, days for others — and
each has its own reset window. Without a fallback, the first wall of the week stops
everything until someone hand-edits a config and remembers to undo it three days later.

## The idea in one line

**End every chain with a free, unmetered model, and "no fallback left" stops being a
state you can reach.**

```
feature:  [0] GLM 5.3-flash  →  [1] Codex  →  [2] nemotron-3-ultra-free
```

Each `apply` advances one position. Position 0 mirrors the lane's primary. The last
position never runs out, so the pipeline degrades instead of stopping.

## The one thing it will not do

**It never decides on its own that a provider is exhausted.** The skill is invoked with
an explicit lane and window, after a human or an orchestrator has read the actual error.

That is deliberate. Provider error messages are not trustworthy classifiers — Z.AI
returns `Insufficient balance or no resource package` (error 1113) for a **misconfigured
endpoint**, not for exhaustion, and `Rate limit reached for requests` is a per-minute
throttle rather than a spent budget. An automatic classifier would silently degrade you
onto a fallback to work around a bug you should have been shown. So the tool automates
the bookkeeping, not the judgment.

## Install

```bash
/plugin marketplace add SomarRezq/pro-marketplace
```

```bash
/plugin install delegate-backup@pro-marketplace
```

Requires a [delegate-skills](https://github.com/amElnagdy/delegate-skills) fleet config.
Copy [`lane-backups.example.json`](lane-backups.example.json) to
`~/.config/delegate-skills/lane-backups.json` and edit the `chains` map.

## Design

`config.json` stays a valid, untouched `delegate-fleet.v1` document — all state lives in
a sidecar, so a delegate-skills upgrade can never collide with this plugin.

```
~/.config/delegate-skills/
├── config.json         delegate-skills owns this — we only rewrite existing lane values
└── lane-backups.json   this plugin owns this — chains, active position, history
```

| Guarantee | How |
|---|---|
| **Cannot run out of fallbacks** | Chains are arbitrary length and end in a free model |
| **Cannot strand a lane** | Every swap records `expiresAt`. `resolve --all` restores anything overdue even if the scheduled task was lost or never fired |
| **Cannot clobber your edits** | A restore only fires if the lane still holds exactly what the swap wrote. Hand-edits win |
| **Restores are deterministic** | `original` is captured on the first swap and preserved across every advance |
| **Runs exactly once** | Restore tasks use `fireAt`, which auto-disables after firing. Missed runs execute on next launch |
| **No half-written config** | Writes go to a temp file and are renamed into place |

## Usage

```bash
node scripts/backup.mjs apply --lane feature --until 3d --reason "GLM: Weekly/Monthly Limit Exhausted"
```

Advances the lane one position and prints a `scheduledTask` spec. The skill creates that
one-shot task; when it fires it runs a single command and deletes itself.

```bash
node scripts/backup.mjs status
node scripts/backup.mjs resolve --all
```

`--until` accepts a duration (`71h37m`, `5h`, `3d`) or an ISO timestamp. Codex and
Antigravity report a duration; Z.AI reports an absolute timestamp.

### `--until` is about the position you're leaving

This is the one non-obvious rule. `--until` is the window of the implementer that *just
failed* — not when the lane comes back. Those are the same thing on the first advance and
different on every one after it, because a restore always returns to **position 0**.

Advance off a primary that's dead for three days, then advance again off a Codex that's
dead for five hours, and a naive reading would schedule the restore in five hours —
putting the lane back on the still-dead primary, where it immediately fails again. So the
restore is always scheduled from position 0's window. Each position's recovery time is
tracked separately in `deadUntil`, and `status` shows them:

```
feature   position 2/2 on opencode   → restores to opencode   in 52h 10m
  recovers  0:52h 10m   1:35m   (restore waits on position 0)
```

Use `--primary-until <window>` to correct position 0's window when you learn it after the
fact. It is the only flag that moves the restore time.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Advanced one position |
| 1 | Usage or config error |
| 2 | No chain configured for that lane |
| 3 | `resolve` found nothing due |
| 4 | Chain exhausted — should be unreachable with a free floor |

## Building a chain

**End it with a free model.** `opencode/nemotron-3-ultra-free` and `opencode/hy3-free`
were both verified writing code that runs with passing assertions, in ~18s, at zero cost
and with no extra credential.

**Never put a shell-incapable implementer on `tests` or `qa`.** `agy` soft-denies every
shell call, so those lanes would report success without executing anything — a
correctness failure, not an efficiency one.

**Change provider at every position.** A same-provider fallback shares the outage. Note
that *all* Z.AI coding-plan models share one bucket: `glm-5.3`, `glm-5.3-flash`,
`glm-5-turbo` and `glm-4.7` exhaust together and reset together, so none can back another.

**For `review`, avoid whoever implemented the code**, or the review stops being an
independent second opinion.

## Known provider messages

| Implementer | Message | Exhaustion? | Window |
|---|---|---|---|
| `codex` | `You've hit your usage limit` | yes | retry time |
| `agy` | `Individual quota reached. Resets in XhYmZs` | yes | duration |
| `opencode` (Z.AI plan) | `Weekly/Monthly Limit Exhausted. Your limit will reset at ...` | yes | timestamp |
| `copilot` | `You have exceeded your premium request allowance` / `402` | yes | none given |
| `opencode` (Z.AI) | `Insufficient balance or no resource package` (1113) | **no — config** | — |
| `opencode` (Z.AI free) | `Rate limit reached for requests` | **no — throttle** | — |

## Upgrading from v1

A `delegate-backups.v1` sidecar is migrated automatically. Each single backup becomes a
two-element chain `[<the lane's current primary>, <the old backup>]`, preserving existing
behaviour. Add a free model to the end of each chain to get the v2 guarantee.

## License

MIT
