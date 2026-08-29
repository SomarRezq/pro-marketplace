---
name: delegate-backup
description: Walk a delegate lane down its fallback chain when an implementer runs out of quota, and schedule its automatic restore. Use when a dispatch fails because an implementer hit a usage/quota limit ("usage limit reached", "Individual quota reached", "Weekly/Monthly Limit Exhausted", "exceeded your premium request allowance") and work needs to continue on another provider. Also use to check which lanes are on a fallback, or to restore an expired one. Not for dispatch failures caused by bad config, auth, or a failing task.
license: MIT
compatibility: Requires Node 18+ and a delegate-skills fleet config. Creating the restore task needs the scheduled-tasks tools; without them the swap still works but must be undone manually.
metadata:
  version: 2.0.0
---

# Delegate Backup

A lane's implementer ran out of quota. This skill moves that lane one position down its
configured **chain**, then schedules the lane's return for when the provider's window
resets.

`<script>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/backup.mjs`.

## Before you swap: is it actually exhaustion?

**This is the judgment the tooling cannot make for you.** Swapping on a non-quota failure
hides a real bug and burns the next provider on the same broken task.

Genuine exhaustion looks like:

| Implementer | Message | Window in the error |
|---|---|---|
| `codex` | `You've hit your usage limit` | a retry time, or an admin request on Business seats |
| `agy` | `Individual quota reached. Resets in XhYmZs` | duration |
| `opencode` (Z.AI plan) | `Weekly/Monthly Limit Exhausted. Your limit will reset at <timestamp>` | absolute timestamp |
| `copilot` | `You have exceeded your premium request allowance` / `402 quota_exceeded` | none — ask the user |

**Two traps that are NOT exhaustion:**

- **`Insufficient balance or no resource package` (Z.AI error 1113)** — despite the
  wording, plan quota does not fall through to account balance. This means the call did
  not qualify as plan usage: wrong endpoint (`zai` instead of `zai-coding-plan`), a model
  outside the plan, or an unsupported tool. **Fix the config; never swap.**
- **`Rate limit reached for requests`** — a per-minute throttle, not an exhausted budget.
  Retry rather than swap. Z.AI's free Flash models hit this quickly.

If the failure is ambiguous, stop and ask the user. Do not guess.

## Swap a lane

Read the reset window out of the error and pass it to `--until`:

```bash
node "<script>" apply --lane <name> --until 71h37m --reason "<the error text>"
```

`--until` takes a duration (`71h37m`, `5h`, `3d`) or an ISO timestamp
(`2026-09-02T05:29:47+02:00`) — use whichever form the provider gave you. Add
`--dry-run` to show the user what would change first.

Then **create the restore task from the `scheduledTask` object the command printed** —
its `taskId`, `description`, `fireAt`, `notifyOnCompletion`, and `prompt`, exactly as
given. Do not rewrite the prompt: a scheduled run starts with no memory of this
conversation, so it must contain nothing to interpret.

The output also reports `movedTo` (which chain position is now live) and
`fallbacksRemaining`. **When `fallbacksRemaining` is 0, tell the user** — the lane is on
its last entry, and a `warning` field says so.

### Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Advanced one position | Create the scheduled task; report the new position |
| 2 | No chain configured for that lane | Tell the user; offer to add one |
| 4 | **Chain exhausted — every entry spent** | **Stop.** Report it and let the user decide |

Exit 4 should be unreachable in a healthy setup, because **every chain ends in a free,
unmetered model**. If you hit it, the chain is misconfigured — say so rather than editing
the fleet config by hand to work around it, and never substitute an implementer that is
not in the chain.

## Restore a lane

The scheduled task does this on its own. Run it manually only if the user asks, or if a
lane is overdue:

```bash
node "<script>" resolve --lane <name>     # this lane now
node "<script>" resolve --all             # every lane whose window has passed
```

Restore always returns the lane to **position 0**, never to an intermediate position. If
position 0 is still exhausted, the next dispatch fails and you advance again — one wasted
call, in exchange for a state machine with no hidden per-position bookkeeping.

After a successful `resolve`, delete the scheduled tasks named in `deleteTaskIds`. Exit
code 3 means nothing was due — normal, not an error.

Restores are clobber-safe: if the lane changed since the swap, the command leaves it
alone and reports `lane changed since the swap`. That is correct — a deliberate edit
outranks an automatic restore.

## Check state

```bash
node "<script>" status            # chains, with [n:...] marking the live position
node "<script>" status --json     # for programmatic checks
```

Run `resolve --all` at the start of any pipeline that depends on lanes. It is cheap, and
it is what stops a lost or never-fired task from stranding a lane on a fallback.

## Configuring chains

Chains live in `lane-backups.json` next to delegate-skills' `config.json`
(`~/.config/delegate-skills/`, or `$XDG_CONFIG_HOME/delegate-skills/`). The fleet config
is **never** extended with new keys — delegate-skills validates dials strictly and owns
that document.

```json
{
  "version": "delegate-backups.v2",
  "chains": {
    "feature": [
      { "implementer": "opencode", "model": "zai-coding-plan/glm-5.3-flash", "variant": "low" },
      { "implementer": "codex", "effort": "medium" },
      { "implementer": "opencode", "model": "opencode/nemotron-3-ultra-free" }
    ]
  },
  "active": {},
  "history": []
}
```

Position 0 must mirror the lane's primary in `config.json`. A `delegate-backups.v1`
sidecar is upgraded automatically on the next write.

Four rules when building a chain:

- **End it with a free, unmetered model.** This is what makes "no fallback left"
  unreachable. `opencode/nemotron-3-ultra-free` and `opencode/hy3-free` are verified to
  write working code and need no credential.
- **Never put an implementer that cannot run shell commands on `tests` or `qa`.** `agy`
  soft-denies every shell call, so those lanes would report success without running
  anything.
- **Change provider at every position**, or the fallback shares the outage. All Z.AI
  coding-plan models share one bucket — `glm-5.3`, `glm-5.3-flash`, `glm-5-turbo` and
  `glm-4.7` exhaust together, so one cannot back another.
- **For `review`, avoid the provider that implemented the code**, or the review stops
  being an independent second opinion.

Edit `chains` freely. Leave `active` and `history` to the script — `active` records the
position and the original lane value, which is what makes a restore deterministic.
