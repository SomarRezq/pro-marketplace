# delegate-backup

When a delegate lane's implementer runs out of quota, swap that lane onto a configured
backup — and put it back automatically the moment the provider's window resets.

Built for people running agentic coding around the clock, where every subscription CLI
hits a wall eventually and hitting one shouldn't stop the pipeline.

## Why it exists

Subscription coding CLIs are priced for human-paced interactive use. Sustained agentic
work exhausts them on very different timescales — hours for some, days for others — and
each has its own reset window. Without a fallback, the first wall of the week stops
everything until someone hand-edits a config and remembers to undo it three days later.

## The one thing it will not do

**It never decides on its own that a provider is exhausted.** The skill is invoked with
an explicit lane and window, after a human or an orchestrator has read the actual error.

That is deliberate. Provider error messages are not trustworthy classifiers — Z.AI
returns `Insufficient balance or no resource package` (error 1113) for a **misconfigured
endpoint**, not for exhaustion. An automatic classifier would silently degrade you onto a
backup to work around a bug you should have been shown. So the tool automates the
bookkeeping, not the judgment.

## Install

```bash
/plugin marketplace add SomarRezq/pro-marketplace
```

```bash
/plugin install delegate-backup@pro-marketplace
```

Requires a [delegate-skills](https://github.com/amElnagdy/delegate-skills) fleet config.
Copy [`lane-backups.example.json`](lane-backups.example.json) to
`~/.config/delegate-skills/lane-backups.json` and edit the `backups` map.

## Design

`config.json` stays a valid, untouched `delegate-fleet.v1` document — all state lives in
a sidecar, so a delegate-skills upgrade can never collide with this plugin.

```
~/.config/delegate-skills/
├── config.json         delegate-skills owns this — we only rewrite existing lane values
└── lane-backups.json   this plugin owns this — backups, active swaps, history
```

| Guarantee | How |
|---|---|
| **One backup per lane** | `apply` exits 4 if the lane is already swapped. No silent cascading — the user decides. |
| **Can't strand a lane** | Every swap records `expiresAt`. `resolve --all` restores anything overdue even if the scheduled task was lost or never fired. |
| **Can't clobber your edits** | A restore only fires if the lane still holds exactly what the swap wrote. Hand-edits win. |
| **Runs exactly once** | Restore tasks use `fireAt`, which auto-disables after firing. Missed runs execute on next launch. |
| **No half-written config** | Writes go to a temp file and are renamed into place. |

## Usage

```bash
node scripts/backup.mjs apply --lane ui --until 71h37m --reason "agy: Individual quota reached"
```

Swaps the lane and prints a `scheduledTask` spec. The skill creates that one-shot task;
when it fires it runs a single command and deletes itself.

```bash
node scripts/backup.mjs status
node scripts/backup.mjs resolve --all
```

`--until` accepts a duration (`71h37m`, `5h`, `90m`) or an ISO timestamp. Codex and
Antigravity both report their reset window in the exhaustion message, so it is usually
copied straight from the error.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Usage or config error |
| 2 | No backup configured for that lane |
| 3 | `resolve` found nothing due |
| 4 | Lane already on its backup — no further fallback |

## Choosing backups

Two rules that matter more than model quality:

**Never back a shell-dependent lane with an implementer that can't run commands.** `agy`
soft-denies every shell call, so backing `tests` or `qa` with it produces lanes that
report success without executing anything.

**Back a lane with a different provider than its primary** — a same-provider backup shares
the same outage. For `review`, also prefer a different provider than whatever implemented
the code, or the review stops being a second opinion.

## Known exhaustion messages

| Implementer | Message | Reset window in error? |
|---|---|---|
| `codex` | `You've hit your usage limit` | Yes |
| `agy` | `Individual quota reached. Resets in XhYmZs` | Yes |
| `copilot` | `You have exceeded your premium request allowance` / `402 quota_exceeded` | No |
| `opencode` (Z.AI) | ⚠️ `Insufficient balance...` (1113) is **config, not quota** | — |

## License

MIT
