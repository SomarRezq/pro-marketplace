---
description: Show each lane's fallback chain and live position, restore anything due, and advance an exhausted lane
---

Show the current chain state and resolve anything overdue.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/backup.mjs" status
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/backup.mjs" resolve --all
```

Then summarise for the user:

1. Which lanes are on a fallback, **which chain position** (`[n/last]`), what they fell
   back to, and how long until each returns. Call out any lane sitting on the last
   position — it has no headroom left.
2. Anything marked **OVERDUE** — its scheduled task never fired, so `resolve --all` has
   just put it back. Say which lanes were restored.
3. Any lane reported as `lane changed since the swap` — the fleet config was hand-edited
   while a fallback was active, so the restore was abandoned deliberately. Tell the user
   the lane is now whatever they set it to.
4. Any lane listed under **no usable chain** — it has fewer than two entries, so it cannot
   fall back at all. Offer to add one.
5. After a restore, delete the scheduled tasks listed in `deleteTaskIds`.

If `$ARGUMENTS` names a lane to advance, load the `delegate-backup` skill and follow it.
Before advancing anything, confirm the failure is genuine quota exhaustion — **not** Z.AI's
`Insufficient balance` (error 1113, a wrong-endpoint configuration fault) and **not**
`Rate limit reached for requests` (a per-minute throttle that should be retried).

Exit code 4 means the chain has no entries left. That should be unreachable, because every
chain is meant to end in a free, unmetered model — report it as a misconfigured chain and
stop, rather than substituting an implementer that is not in the chain.

Do not change lane configuration without asking first.
