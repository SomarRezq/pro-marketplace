---
name: delegate-backup
description: Swap a delegate lane onto its backup implementer when the primary runs out of quota, and schedule its automatic restore. Use when a dispatch fails because an implementer hit a usage/quota limit ("usage limit reached", "Individual quota reached", "exceeded your premium request allowance") and work needs to continue on another provider. Also use to check which lanes are currently on backup, or to restore an expired one. Not for dispatch failures caused by bad config, auth, or a failing task.
license: MIT
compatibility: Requires Node 18+ and a delegate-skills fleet config. Creating the restore task needs the scheduled-tasks tools; without them the swap still works but must be undone manually.
metadata:
  version: 1.0.0
---

# Delegate Backup

A lane's implementer ran out of quota. This skill moves that lane onto a pre-configured
backup, then schedules the lane's return for the moment the provider's window resets.

`<script>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/backup.mjs`.

## Before you swap: is it actually exhaustion?

**This is the judgment the tooling cannot make for you.** Swapping on a non-quota failure
hides a real bug and burns a second provider on the same broken task.

Genuine exhaustion looks like:

| Implementer | Message |
|---|---|
| `codex` | `You've hit your usage limit` (+ a retry time, or "send a request to your admin") |
| `agy` | `Individual quota reached. Resets in XhYmZs` |
| `copilot` | `You have exceeded your premium request allowance` / HTTP `402 quota_exceeded` |

**The trap:** Z.AI/GLM returns `Insufficient balance or no resource package` (error 1113).
Despite the wording this is **not** exhaustion — plan quota does not fall through to
account balance. 1113 means the call did not qualify as plan usage: wrong endpoint
(`zai` instead of `zai-coding-plan`), a model the plan does not cover (only GLM-5.3,
GLM-5-Turbo, GLM-4.7 do), or an unsupported tool. **Fix the config; never swap on 1113.**

If the failure is ambiguous, stop and ask the user. Do not guess.

## Swap a lane

Read the reset window out of the error message — every implementer except Copilot
reports one — and pass it to `--until`:

```bash
node "<script>" apply --lane <name> --until 71h37m --reason "<the error text>"
```

`--until` takes a duration (`71h37m`, `5h`, `90m`) or an ISO timestamp. Add `--dry-run`
first if you want to show the user what will change before it changes.

Then **create the restore task from the `scheduledTask` object the command printed** —
use its `taskId`, `description`, `fireAt`, `notifyOnCompletion`, and `prompt` exactly as
given. Do not rewrite the prompt: a scheduled run starts with no memory of this
conversation, so it must contain nothing to interpret.

If the scheduled-tasks tools are unavailable, say so plainly — the lane is swapped but
nothing will put it back except `resolve`.

### Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Swapped | Create the scheduled task |
| 2 | No backup configured for that lane | Tell the user; offer to add one to the sidecar |
| 4 | **Lane is already on its backup** | **Stop.** Report it and let the user decide |

Exit 4 is the depth limit. One backup per lane, so when both are exhausted there is
nowhere left to go. Relay the message and let the user choose — never swap another lane's
implementer in as a substitute, and never edit the fleet config by hand to work around it.

## Restore a lane

The scheduled task does this on its own. Run it manually only if the user asks, or if a
lane is overdue:

```bash
node "<script>" resolve --lane <name>     # this lane now
node "<script>" resolve --all             # every lane whose window has passed
```

After a successful `resolve`, delete the scheduled tasks named in `deleteTaskIds`. Exit
code 3 means nothing was due — that is normal, not an error.

Restores are clobber-safe: if the lane changed since the swap, the command leaves it
alone and reports `lane changed since the swap`. That is correct behaviour — a
deliberate edit outranks an automatic restore.

## Check state

```bash
node "<script>" status            # human-readable
node "<script>" status --json     # for programmatic checks
```

Run `resolve --all` at the start of any pipeline that depends on lanes. It is cheap, and
it is what stops a lost or never-fired task from stranding a lane on its backup
indefinitely.

## Configuring backups

Backups live in `lane-backups.json` next to delegate-skills' `config.json`
(`~/.config/delegate-skills/`, or `$XDG_CONFIG_HOME/delegate-skills/`). The fleet config
is **never** extended with new keys — delegate-skills validates dials strictly and owns
that document.

```json
{
  "version": "delegate-backups.v1",
  "backups": {
    "ui": { "implementer": "opencode", "model": "zai-coding-plan/glm-5.3", "variant": "low" }
  },
  "active": {},
  "history": []
}
```

A backup entry takes the same shape as a lane: `implementer` plus whatever dials that
implementer supports. Two rules when choosing one:

- **Never back a shell-dependent lane with an implementer that cannot run commands.**
  `agy` soft-denies every shell call, so it must not back `tests` or `qa` — those lanes
  would report success without running anything.
- **Prefer a different provider than the lane's primary**, or the backup shares the
  outage. For `review`, prefer a different provider than whoever implemented the code.

Edit `backups` freely. Leave `active` and `history` to the script — `active` is what
makes a restore deterministic and clobber-safe.
