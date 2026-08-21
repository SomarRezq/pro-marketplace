# code-pro Refactor — Execution Plan

**Status:** awaiting approval · **Date:** 2026-08-21 · **Target version:** code-pro `2.0.0`

Refactor `claude/code-pro` so that Claude is spent only where reasoning is scarce, and the
bulk of implementation, test-writing, QA, and per-step review is burned on Codex and
Gemini. Remove the `codex/` plugin port. Nothing here is implemented yet.

---

## 1. Goal

Turn `develop-fr` into a real production-feature pipeline in which:

- The session model you talk to is a **pure orchestrator** — it routes, it never codes.
- **Claude Opus (high)** is reserved for two moments only: the architecture plan and the
  final architecture review.
- **Codex and Gemini** do all implementation, test-writing, and QA.
- **Codex** performs an independent code review after every development step.
- The orchestrator's context stays nearly flat, so Claude usage tracks the number of
  *decisions*, not the size of the codebase.

## 2. Findings from the machine + upstream check

Verified on this machine on 2026-08-21, before planning.

| Check | Result |
|---|---|
| `codex` | ✅ `codex-cli 0.80.0`, configured `model = "gpt-5.2-codex"`, `model_reasoning_effort = "xhigh"` |
| `gemini` | ✅ `0.56.0` |
| `agy` (Antigravity) | ✅ installed; `agy models` lists `gemini-3.1-pro-high`, `gemini-3.7-flash-{high,medium,low}`, and others |
| `claude`, `copilot` | ✅ installed |
| `cursor-agent`, `opencode` | ❌ not installed (unused by this plan) |
| delegate-skills | ✅ installed at `~/.claude/skills/` — `codex-delegate`, `claude-delegate`, `agy-delegate`, `copilot-delegate`, `cursor-delegate`, `opencode-delegate`, `delegate-setup` |
| Fleet config | ✅ exists at `~/.config/delegate-skills/config.json` |

**Three findings that shaped the design:**

1. **There is no `gemini-delegate` skill.** The upstream repo
   (`amElnagdy/delegate-skills`) ships 17 implementers; the only Google one is
   `agy-delegate` (Antigravity). Antigravity *is* the Gemini lane — it exposes
   `gemini-3.1-pro-high` and the Gemini 3.x Flash tiers via `--model`. **Decision: use
   `agy` as the Gemini lane. No `gemini/` folder is created.**
2. **There is no "compact skill"** — not installed, not in superpowers, not in the
   official marketplace. Claude Code has built-in `/compact` and autocompact, but no
   skill or hook can *force* compaction at a 40 % threshold. **Decision: make the
   orchestrator's context structurally small and make compaction lossless, rather than
   trying to trigger it.** See §6.
3. **Your fleet config already defines lanes** — `feature`→agy/gemini-3.1-pro-high,
   `ui`→codex, `tests`→codex, `docs`→agy/flash, `design`→claude/sonnet. **Decision: the
   plugin drives *lanes*, never hardcoded CLI names.** Retuning the whole pipeline then
   means editing one config file, not the plugin.

## 3. Current vs. target

### Current

```
you ──▶ Claude session (orchestrator AND worker)
          ├─ solution-architect  (Claude opus)   ← plan
          ├─ developer × N       (Claude sonnet) ← ALL implementation on Claude
          ├─ qa-engineer         (Claude sonnet) ← ALL QA on Claude
          └─ solution-architect  (Claude opus)   ← final review
```

Every token of implementation, every file read, every test run is Claude. The orchestrator
also holds all of it in context, because subagents report back inline.

### Target

```
you ──▶ ORCHESTRATOR (Claude, routing only — never reads or writes code)
   │
   │  every hop is: write a brief file ──▶ executor ──▶ read a result file
   │
   ├─0─ PREFLIGHT ............ bash script, no model
   ├─1─ PLAN ................. Claude Opus / high      [solution-architect subagent]
   ├─2─ APPROVAL GATE ........ you
   ├─3─ PER STEP (parallel where independent):
   │      3a IMPLEMENT ....... lane → agy/Gemini 3.1 Pro  or  Codex
   │      3b REVIEW .......... Codex gpt-5.2-codex, --read-only
   │      3c REWORK .......... same Codex/agy session, ≤2 rounds, then escalate
   │      3d GATES ........... orchestrator runs repo test/lint itself (cheap bash)
   ├─4─ QA ................... lane → Codex (or agy)
   ├─5─ FINAL REVIEW ......... Claude Opus / high      [solution-architect subagent]
   └─6─ REPORT
```

Claude is touched at exactly three points: plan, final review, and the orchestrator's own
short routing turns.

## 4. The uniform delegation contract

This is the heart of the refactor, and it answers your request directly: *"the delegate
skills pass a file containing what the agent has to do — do something similar for the
Claude modules too."*

**One brief format. Two transports. Same result contract.**

A **brief** is a markdown file. It is self-contained — the executor sees nothing else: no
chat history, no repo memory. Sections:

```markdown
# Brief: <phase or step id>
## Goal            — one paragraph, what "done" means
## Context         — the slice of the plan / repo facts this executor needs
## Do              — the exact change, files, and boundaries
## Do NOT          — scope fences (no unrelated refactors, no commits)
## Conventions     — repo style facts discovered by the orchestrator, quoted
## Gates           — the project's REAL commands (from CLAUDE.md/AGENTS.md/Makefile)
## Definition of done
## Report contract — write your result to <path>, using the Digest format below
```

**Transport A — external model** (Codex, Gemini/agy):

```bash
node ~/.claude/skills/<impl>-delegate/scripts/relay.mjs \
  --brief .code-pro/runs/<id>/steps/step-03.brief.md \
  --lane feature --cd <repo> --timeout 2h
```

**Transport B — Claude module** (solution-architect):

```
Agent(subagent_type: "code-pro:solution-architect",
      prompt: "Your brief is at <abs path>. Write your result to <abs path>. Reply with the Digest only.")
```

Both write a `*.result.md` whose **first section is a ≤30-line Digest**. The orchestrator
reads *only the Digest*. Full detail stays on disk for the next executor to read directly.

```markdown
## Digest
verdict: done | needs-decision | blocked | needs-changes
files: <paths touched>
gates: <command → pass/fail>
open: <questions for the orchestrator, or "none">
```

Why this matters: the executor's identity becomes an implementation detail. Swapping the
`feature` lane from Gemini to Codex changes one config line and nothing in the plugin.

## 5. Run state on disk

Created inside the *target* repo, auto-added to its `.gitignore` on first run.

```
.code-pro/runs/<YYYYMMDD-HHMMSS>-<slug>/
  00-request.md              your feature request, verbatim
  01-preflight.json          detected CLIs, resolved lanes, degradations applied
  02-architect.brief.md
  02-architect.result.md     the plan, prose
  plan.json                  machine-readable: [{id, title, deps[], lane, status}]
  steps/
    step-01.brief.md   step-01.result.md   step-01.review.md   step-01.rework-1.brief.md
  qa.brief.md   qa.result.md
  99-final-review.brief.md   99-final-review.result.md
  state.json                 phase, step statuses, session ids, compact checkpoints
  REPORT.md                  final fixed-format output
```

`state.json` is the resume anchor. Session ids (Codex `threadId`, Antigravity
`conversationId`) are recorded so rework continues the *same* external session cheaply
instead of re-sending context.

## 6. Context strategy — the honest version

You asked for a compact skill firing at 40 %. **No such skill exists, and no skill or hook
can force `/compact`** — only you or Claude Code's built-in autocompact can. So the plan
attacks the problem from the other side:

**Primary — the orchestrator's context barely grows.**
It never reads source files, never reads a full diff, never receives a subagent's prose.
It reads Digests (≤30 lines) and `state.json`. A 40-step feature costs the orchestrator
roughly what a 4-step feature costs.

**Secondary — compaction is made lossless.**
Because every artifact is on disk, `/compact` can never destroy pipeline state. The skill
defines **compact checkpoints** — after the plan, after every 3 completed steps, and after
QA. At a checkpoint the orchestrator flushes `state.json` and prints:

```
Checkpoint: 7/12 steps done. State saved. Safe to /compact — I resume from state.json.
```

**Tertiary — a resume path.** `/develop-fr --resume` reads the newest run dir and picks up
from `state.json`, so a compaction, a crash, or a new session all recover identically.

**Not doing:** a hook that reads context percentage. Advisory-only, fragile across Claude
Code versions, and made largely moot by the primary measure. Revisit if real runs show the
orchestrator still bloating.

## 7. Lanes this pipeline expects

| Lane | Used for | Your config today | Action |
|---|---|---|---|
| `feature` | backend/logic implementation steps | ✅ agy · `gemini-3.1-pro-high` | keep |
| `ui` | UI implementation steps | ✅ codex | keep |
| `tests` | test-writing steps | ✅ codex | keep |
| `docs` | doc steps | ✅ agy · `gemini-3.7-flash-high` | keep |
| `design` | design Q&A | ✅ claude · sonnet/high | keep |
| **`review`** | **per-step Codex review** | ❌ **missing** | **add: codex, `readOnly: true`, `effort: high`** |
| **`qa`** | **end-to-end QA pass** | ❌ **missing** | **add: codex** (or agy to spread cost) |

Adding the two lanes is a **machine setup task**, not a repo change — run
`delegate-setup` and approve the write. The plugin ships a documented default lane map used
when no fleet config exists at all.

## 8. Agent inventory after the refactor

| Agent | Model / effort | Change |
|---|---|---|
| `solution-architect` | **opus / high** | **Rewritten.** Adds the brief-in/result-out file contract, emits `plan.json` with per-step `deps[]` and a suggested `lane`, and in final-review mode consumes the diff + QA digest rather than re-reading the repo. |
| `developer` | sonnet / high | **Repurposed as fallback only.** Used when preflight finds no external implementer. Gains the brief/result file contract. |
| `qa-engineer` | sonnet / high | **Repurposed as fallback only.** Same contract. |
| `code-reviewer` | sonnet / high | **Repurposed as fallback only** for step review; Codex is the default reviewer. |
| `investigator` | sonnet / high | unchanged (out of scope) |
| `regression-tester` | sonnet / high | unchanged (out of scope) |
| `doc-writer` | haiku / high | unchanged (out of scope) |

No new agents. Dispatching *is* orchestration, so the orchestrator runs the relays itself —
adding a "delegation lead" agent would just add a hop and a context copy.

## 9. New files

```
claude/code-pro/
  skills/develop-fr/
    SKILL.md                          ← rewritten
    references/
      brief-format.md                 ← the brief contract + a fill-in template
      run-state.md                    ← run dir layout, state.json, compact checkpoints
      lanes-and-fallbacks.md          ← lane map, degradation matrix, setup instructions
      orchestrator-contract.md        ← the "you MUST NOT" list, verbatim
  scripts/
    preflight.mjs                     ← detect CLIs + delegate skills + lanes → 01-preflight.json
    run-init.mjs                      ← create run dir, seed state.json, gitignore .code-pro/
    dispatch.mjs                      ← lane → implementer → correct relay.mjs; normalize result → Digest
    state.mjs                         ← read/update state.json; print resume digest
  commands/
    code-pro-doctor.md                ← /code-pro-doctor — verify setup, print lane map
```

`dispatch.mjs` does not duplicate delegate-skills — it *calls* their relays. Its only jobs
are (a) resolve lane → implementer via `delegate-setup`'s `config.mjs load`, (b) locate
`~/.claude/skills/<impl>-delegate/scripts/relay.mjs`, (c) normalize the relay's
`result.json` into our Digest format. Small, and the reason the pipeline is
implementer-agnostic.

## 10. Preflight and graceful degradation

`/develop-fr` runs `preflight.mjs` first and records what it found. The pipeline always
runs; it just reports honestly what it degraded to.

| Missing | Degrades to |
|---|---|
| delegate-skills not installed | in-Claude `developer` / `qa-engineer` / `code-reviewer` subagents |
| fleet config absent | plugin's built-in default lane map (feature→codex, tests→codex, review→codex, qa→codex) |
| `agy` absent | `feature` lane → codex |
| `codex` absent | all lanes → agy |
| both absent | fully in-Claude, with a loud warning that the token-saving intent is lost |

Degradations are printed once at the start of a run and recorded in `01-preflight.json` —
never silent.

## 11. Removing the Codex port

Delete `codex/` and the Codex marketplace manifest. Git history preserves it; tag first so
it is trivially recoverable.

- `git tag codex-port-v1` before deleting.
- Delete `codex/` (18 files) and `.agents/plugins/marketplace.json` (and the empty `.agents/`).
- Root `README.md`: drop the Codex install section, the Codex table row, and the `codex/`
  entries in the layout tree.
- `.claude-plugin/marketplace.json`: bump marketplace `version` to `1.2.0`, update the
  description (drop "and Codex"), bump the `code-pro` plugin `version` to `2.0.0`.
- `claude/code-pro/.claude-plugin/plugin.json`: version `2.0.0`, updated description.

**Note for the future:** removing the Codex *port* is unrelated to using Codex as an
*implementer*. The port is a code-pro build for Codex users; the implementer is the `codex`
CLI doing our work. Do not let one be re-added by confusion with the other.

## 12. Execution steps

Each step has a definition of done. Steps 2–5 are independent of each other once step 1
lands; 6–8 are sequential.

| # | Step | Definition of done |
|---|---|---|
| 1 | **Remove the Codex port** (§11) | `codex/` and `.agents/` gone, tag created, root README + both manifests consistent, no dangling links anywhere in the repo |
| 2 | **Write `references/brief-format.md`** | Brief template + Digest contract + a worked example brief for a real 2-file change; states plainly that the executor sees nothing but this file |
| 3 | **Write `references/run-state.md` + `scripts/run-init.mjs`, `scripts/state.mjs`** | `node run-init.mjs --slug x` creates the tree and a valid `state.json`; `state.mjs digest` prints a resume summary; `.code-pro/` appended to the target repo's `.gitignore` idempotently |
| 4 | **Write `scripts/preflight.mjs` + `references/lanes-and-fallbacks.md` + `/code-pro-doctor`** | On this machine, doctor reports codex ✅ agy ✅ delegate-skills ✅ and flags `review`/`qa` lanes as missing with the exact `delegate-setup` fix; on a machine with nothing it prints the full-degradation path without crashing |
| 5 | **Write `scripts/dispatch.mjs`** | `dispatch.mjs --brief b.md --lane feature` resolves agy, runs its relay, and emits a normalized Digest; `--lane review` resolves codex with `--read-only`; unknown lane fails loud with the lane list; missing relay triggers the documented fallback exit code |
| 6 | **Rewrite `agents/solution-architect.md`** | Reads a brief file, writes a result file, emits valid `plan.json` with `deps[]` and a `lane` per step; final-review mode consumes diff + QA digest only. Verified by running it once on a real feature request |
| 7 | **Rewrite `skills/develop-fr/SKILL.md` + `references/orchestrator-contract.md`** | Full phase flow, explicit orchestrator "MUST NOT" list (no reading source, no writing code, no accepting prose reports), compact checkpoints, `--resume` and `--dry-run` documented, fixed report format preserved |
| 8 | **Repurpose `developer` / `qa-engineer` / `code-reviewer` as fallbacks** | Each states it is the degraded path, carries the brief/result contract, and is only spawned by the documented fallback rules |
| 9 | **Update `claude/code-pro/README.md`** | New pipeline diagram, lane table, model/effort table, delegate-skills prerequisite with install link, degradation matrix, `/code-pro-doctor` documented |
| 10 | **Add the `review` and `qa` lanes** (machine setup, not repo) | `config.mjs load` shows both lanes; `/code-pro-doctor` goes fully green |

## 13. How we verify the refactor itself

Not "it looks right" — these are the actual checks before calling it done.

1. `/code-pro-doctor` reports fully green on this machine after step 10.
2. **Dry run:** `/develop-fr --dry-run "add a health endpoint"` produces a complete run
   directory with plan and briefs and dispatches nothing. Inspect the briefs by hand: is
   each one executable by a model with zero other context?
3. **End-to-end smoke** on a throwaway git repo with a real 2-step feature: one step
   implemented by agy/Gemini, one by Codex, each Codex-reviewed, QA'd, final-reviewed.
   Result must compile, pass gates, and produce a `REPORT.md`.
4. **The token check — the whole point.** Record the orchestrator's context size before and
   after the smoke run. If it grew by more than a few thousand tokens, a Digest boundary is
   leaking prose and the design has failed its purpose.
5. **Degradation check:** run with `PATH` stripped of `codex` and `agy` and confirm the
   in-Claude fallback path completes and warns.
6. **Resume check:** kill the run mid-pipeline, start a fresh session, `/develop-fr
   --resume`, and confirm it continues from the right step.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Brief quality becomes the bottleneck — a blind executor fails on a vague brief | `brief-format.md` mandates quoted repo conventions and the project's *real* gate commands; step 13.2 inspects briefs by hand before any dispatch |
| Two Codex rework rounds still fail | Escalate to the solution-architect with the review findings; the plan step may be wrong, not the code |
| External implementer claims gates passed but they did not | The orchestrator re-runs the repo's gates itself in phase 3d. Self-reports are never trusted — this mirrors delegate-skills' own rule |
| Parallel steps touching the same files collide | `plan.json` `deps[]` gates parallelism; the architect is instructed to serialize any steps sharing a file |
| Antigravity/Codex model labels drift | Lanes live in *your* config, not the plugin; `/code-pro-doctor` surfaces an unresolvable model rather than failing mid-run |
| `.code-pro/` litters user repos | Auto-gitignored on first run; documented; `--dry-run` writes to the same place so it is inspectable |

## 15. Explicitly out of scope

- `investigate`, `create-docs`, `bug-fix`, `refactor`, `develop`, `regression-test` — unchanged this round.
- No `gemini/` folder and no custom Gemini relay (Gemini arrives via `agy`).
- No context-percentage hook.
- No changes to delegate-skills itself; we consume it as-is.

---

**Next step:** review this plan. On approval, execution starts at §12 step 1.
