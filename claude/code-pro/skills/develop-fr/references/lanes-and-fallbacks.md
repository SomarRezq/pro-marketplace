# Lanes, implementers, and what happens when they are missing

## Lanes

A **lane** binds a kind of work to an implementer CLI plus optional dials (model, effort,
read-only). Lanes live in *your* delegate-skills fleet config, not in this plugin — so
retuning the whole pipeline is one config edit, and the plugin never hardcodes a vendor.

| Lane | Used for |
|---|---|
| `feature` | backend / logic implementation steps |
| `ui` | UI implementation steps |
| `tests` | test-writing steps |
| `review` | per-step independent code review (read-only) |
| `qa` | end-to-end QA pass |
| `docs` | documentation steps |

Config paths (delegate-skills owns these):

- Global: `~/.config/delegate-skills/config.json`
- Project: `<git-root>/.delegate/config.json` (overrides by whole-lane replace)

```json
{
  "version": "delegate-fleet.v1",
  "lanes": {
    "feature": { "implementer": "agy",   "model": "gemini-3.1-pro-high" },
    "ui":      { "implementer": "codex" },
    "tests":   { "implementer": "codex" },
    "review":  { "implementer": "codex", "readOnly": true, "effort": "high" },
    "qa":      { "implementer": "codex" },
    "docs":    { "implementer": "agy",   "model": "gemini-3.7-flash-high" }
  }
}
```

Edit it through the `delegate-setup` skill (it validates dials per implementer and handles
the project-config trust hash), or by hand for the global file.

## Gemini

There is no `gemini-delegate` skill — delegate-skills has no Google implementer other than
**`agy`** (Antigravity), which is how Gemini reaches this pipeline. `agy models` lists the
labels; `gemini-3.1-pro-high` is the strong one, `gemini-3.7-flash-high` the cheap one.

The standalone `gemini` CLI has no relay and is not used.

## Implementer capabilities

Implementers differ in what they can do in the non-interactive mode the relays use. One
difference matters enough to be encoded in `dispatch.mjs`:

| Implementer | Edits files | Runs shell commands |
|---|---|---|
| `codex` | yes | **yes** — runs the gates and reports real results |
| `agy` (Gemini) | yes | **no** — print mode soft-denies every `RunCommand` |
| `claude`, `copilot`, `opencode`, `cursor` | yes | yes |

**Antigravity cannot run your gates.** In print mode it denies every shell command, and if
a brief tells it to run one, the run ends with *no final message at all* — you lose the
report even though the file edits succeeded. Verified against `agy 1.1.17`; passing
`--sandbox` does **not** change it.

`dispatch.mjs` handles this automatically. For an implementer with `shell: false` it
appends an execution-environment note to the brief telling it not to run the gates and to
report `gates: not run (orchestrator verifies)`. The exact text sent is written next to the
result as `<result>.effective-brief.md`, so nothing is hidden from you, and the Digest
carries a line reminding you the gates are yours to run:

```
note: implementer cannot run shell — gates were NOT run by it, you must run them
```

This costs nothing, because phase 3d has the orchestrator re-run the gates regardless — a
self-reported "gates passed" was never trusted anyway.

**Opting out:** `dispatch.mjs --allow-shell` passes Antigravity's
`--dangerously-skip-permissions` instead, which auto-approves its tool permission requests.
The relay documents that as full access. Use it only when the user has explicitly asked
for it — never as a default.

## Dials

Only dials that implementer supports are valid. The ones this pipeline uses:

| Implementer | Binary | Dials |
|---|---|---|
| `codex` | `codex` | model, effort, sandbox, timeout, readOnly |
| `agy` | `agy` | model, effort, timeout, readOnly |
| `claude` | `claude` | model, effort, timeout, readOnly |
| `copilot` | `copilot` | model, effort, timeout, readOnly |

`dispatch.mjs` passes `--lane <name>` to the relay when the lane genuinely exists in your
fleet config (letting the relay resolve dials itself). For a lane that came from the
plugin's built-in defaults, the relay cannot see it, so dispatch passes `--model` /
`--effort` / `--read-only` explicitly instead.

## Degradation ladder

The pipeline always runs. It just tells you what it gave up.

| Missing | Degrades to |
|---|---|
| delegate-skills not installed | in-Claude `developer` / `qa-engineer` / `code-reviewer` subagents |
| fleet config absent | plugin's built-in default lane map (all Codex) |
| the lane's implementer unusable | the first usable one from: codex, agy, copilot, opencode, cursor, claude |
| no external implementer at all | fully in-Claude, with a loud warning that the token saving is lost |

When an implementer is swapped, `model` and `variant` dials are **dropped** — a model label
for one CLI is meaningless to another, and passing it through would fail the run.

`dispatch.mjs` exits **3** when a lane has no external implementer. That is the
orchestrator's signal to spawn the in-Claude fallback agent for that role instead:

| Lane | Fallback agent |
|---|---|
| `feature`, `ui`, `tests` | `code-pro:developer` |
| `review` | `code-pro:code-reviewer` |
| `qa` | `code-pro:qa-engineer` |
| `docs` | `code-pro:doc-writer` |

Every degradation is printed once at the start of a run and recorded in
`01-preflight.json`. Never let one be silent — a silently-Claude run defeats the purpose of
the whole pipeline, and the user should get to decide whether to proceed.

## Checking your setup

```bash
/code-pro-doctor
```

It reports which implementers are usable, how each lane resolves, and prints the exact JSON
for any lane you are missing. Exit 1 means the pipeline will run degraded.

## Known environment traps

- **A stale `codex` CLI.** Codex's server-side default model moves; an old CLI gets
  `The '<model>' model requires a newer version of Codex`. Fix with
  `npm i -g @openai/codex`, then `codex --version`.
- **Account-gated models.** A ChatGPT-account Codex login rejects some model labels
  outright (`not supported when using Codex with a ChatGPT account`). Leave `model` unset
  on that lane and let Codex pick, or set one your account allows.
- **Unauthenticated CLIs.** `agy models` and `codex --version` succeeding is not proof of
  auth. A first real dispatch is.
- **Pre-existing untracked files** show up in a relay's `touchedFiles` (it reads git
  porcelain). Judge what changed from the diff and the gates, not from that list.
