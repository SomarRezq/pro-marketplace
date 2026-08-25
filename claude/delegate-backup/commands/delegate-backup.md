---
description: Show which delegate lanes are on a backup, restore any that are due, and swap an exhausted lane
---

Show the current backup state and resolve anything overdue.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/backup.mjs" status
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/backup.mjs" resolve --all
```

Then summarise for the user:

1. Which lanes are on a backup, what they fell back to, and how long until each returns.
2. Anything marked **OVERDUE** — its scheduled task never fired, so `resolve --all` has
   just put it back. Say which lanes were restored.
3. Any lane reported as `lane changed since the swap` — the fleet config was hand-edited
   while a backup was active, so the restore was abandoned deliberately. Tell the user
   the lane is now whatever they set it to.
4. After a restore, delete the scheduled tasks listed in `deleteTaskIds`.

If `$ARGUMENTS` names a lane to swap, load the `delegate-backup` skill and follow it —
in particular, confirm the failure is genuine quota exhaustion and not a configuration
error before swapping anything. Exit code 4 means the lane is already on its backup:
report that and stop, rather than looking for another implementer.

Do not change lane configuration without asking first.
