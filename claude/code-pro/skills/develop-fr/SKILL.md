---
name: develop-fr
description: Develop a complete feature, brand-new functionality, or a massive change affecting a big part of the codebase or its structure. Use whenever the user requests a full feature ("build user management", "add a payments module"), brand-new functionality, or structural changes — anything clearly bigger than a small modification (which is develop's job). Orchestrates Claude Opus for architecture and delegates implementation, testing, and per-step review to Codex and Gemini.
---

# Develop-fr (full feature)

Deliver a complete feature through a pipeline that spends the strongest model only where
reasoning is scarce, and burns cheaper external models on the volume work.

```
you ──▶ ORCHESTRATOR (you — routing only, never reads or writes code)
   │
   │   every hop: write a brief file ──▶ executor ──▶ read a result Digest
   │
   ├─0─ PREFLIGHT ....... script, no model
   ├─1─ PLAN ............ Claude Opus / high     [solution-architect]
   ├─2─ APPROVAL ........ the user
   ├─2b ISSUES .......... gh, optional (--issues): milestone/wave, issue/step
   ├─3─ PER STEP (parallel where deps allow):
   │      3a IMPLEMENT .. lane → the wave's implementer  (wave → in-progress)
   │      3b REVIEW ..... read-only lane
   │      3c REWORK ..... same session, ≤2 rounds, then escalate
   │      3d GATES ...... you re-run them yourself
   │      3e PUSH ....... current branch; closes the pushed waves' issues
   ├─4─ QA .............. lane → Codex
   ├─5─ FINAL REVIEW .... Claude Opus / high     [solution-architect]
   └─6─ REPORT .......... + record a finding, only if the run earned one

   throughout: context past ~50% → compact with intent, then re-read the digest
```

## Read first

- [references/orchestrator-contract.md](references/orchestrator-contract.md) — what you
  must never do. Read this before anything else; it is the whole discipline.
- [references/brief-format.md](references/brief-format.md) — how to write a brief an
  external model can execute blind.
- [references/run-state.md](references/run-state.md) — run directory, `state.json`,
  checkpoints, resuming.
- [references/lanes-and-fallbacks.md](references/lanes-and-fallbacks.md) — lanes, dials,
  degradation ladder, environment traps.

Throughout, `S="${CLAUDE_PLUGIN_ROOT}/scripts"`.

## Input

A detailed explanation of the requested feature. If the description is too thin to plan
from, ask targeted questions first — a thin request produces a thin plan, and every
downstream model inherits it.

**Resuming?** `/develop-fr --resume` → skip to [Resuming](#resuming).

## Phase 0 — Preflight

```bash
RUN=$(node "$S/run-init.mjs" --slug "<kebab-slug>" --cwd . --request <(cat <<'EOF'
<the user's feature request, verbatim>
EOF
))
node "$S/preflight.mjs" --cwd . --out "$RUN/01-preflight.json"
```

Exit 1 means degraded. **Tell the user once, plainly, what degraded and why**, then
continue. A silently-Claude run defeats the entire purpose of this pipeline and the user
deserves the chance to fix their setup first.

## Phase 1 — Plan

Write `$RUN/02-architect.brief.md` (goal, the verbatim request, repo path, and the
instruction to emit `plan.json`), then:

```
Agent(subagent_type: "code-pro:solution-architect",
      prompt: "Your brief is at <abs>/02-architect.brief.md.
               Write your plan to <abs>/02-architect.result.md and plan.json to <abs>/plan.json.
               Reply with the Digest only.")
```

The architect is the one participant allowed to read the codebase broadly. Then:

```bash
node "$S/state.mjs" import-plan --run "$RUN"     # validates deps, ids, cycles
node "$S/state.mjs" digest --run "$RUN"
```

## Phase 2 — Approval gate

Present the plan digest — step titles, what runs in parallel, risks, and any open design
questions. Get the user's approval before dispatching anything.

Then take the first checkpoint; this is the biggest context drop available:

```bash
node "$S/state.mjs" checkpoint --run "$RUN" --note "plan approved"
node "$S/state.mjs" phase --run "$RUN" --to implementing
```

### Phase 2b — Mirror the plan to GitHub (optional)

Only when the user asked for it (`/develop-fr --issues`) — never by default, since a
twelve-step plan is twelve issues on someone's board.

```bash
node "$S/issues.mjs" sync --run "$RUN"
```

Creates a **milestone per wave** and an **issue per step**, and records the issue number
on each step. A wave is derived from the dependency graph — it is the same batch
`state.mjs next` already dispatches in parallel, just named. Show the user the milestone
list and issue numbers.

The run directory stays the source of truth for execution. These issues mirror it, so if
GitHub is unreachable, say so and carry on — losing the mirror must never stop the run.
`sync` is idempotent: re-run it to finish a partial mirror.

Exit 2 means `gh` is missing or unauthenticated. Report that and continue without the
mirror rather than failing the run.

## Phase 3 — Implement, review, rework

Loop until `state.mjs next` reports all steps done.

**3a — dispatch every ready step at once.** Ask the scheduler; never decide parallelism by
reading the plan yourself:

```bash
node "$S/state.mjs" next --run "$RUN"      # → id, lane, title per ready step
```

For each ready step, write `$RUN/steps/step-NN.brief.md` following
[brief-format.md](references/brief-format.md) — the executor sees **nothing** but this
file — then dispatch all of them in parallel (background Bash calls, one per step):

```bash
node "$S/dispatch.mjs" --brief "$RUN/steps/step-NN.brief.md" --lane <lane> \
     --cd . --result "$RUN/steps/step-NN.result.md" --timeout 2h
```

If the run was mirrored (phase 2b), mark the whole wave in progress as you dispatch its
**first** step — one call for every issue in the wave:

```bash
node "$S/issues.mjs" start --run "$RUN" --wave N
```

Set it once and leave it. Review rounds, rework and re-dispatches do **not** touch it —
the next and only other transition is closing at push.

Exit 3 means no external implementer for that lane — spawn `code-pro:developer` with the
same brief and result paths instead.

Record what came back:

```bash
node "$S/state.mjs" step --run "$RUN" --id NN --status implemented \
     --implementer <impl> --session <session-from-digest>
```

**3b — review it.** Write `$RUN/steps/step-NN.review-brief.md` asking for a severity-ranked
review of *this step's* changes against *this step's* definition of done, then:

```bash
node "$S/dispatch.mjs" --brief "$RUN/steps/step-NN.review-brief.md" --lane review \
     --cd . --result "$RUN/steps/step-NN.review.md" --timeout 30m
```

Exit 3 → spawn `code-pro:code-reviewer` instead.

**3c — rework if needed.** On `needs-changes`, write a short delta brief naming only the
findings and dispatch it with `--session <the step's session>` so the implementer keeps its
context and you pay only for the delta. Cap at **2 rounds**:

```bash
node "$S/state.mjs" step --run "$RUN" --id NN --status review-changes --bump-review
```

A third failure means the plan step is wrong, not the code. Escalate to the
solution-architect with both reviews attached, and mark the step `blocked` if it stays
unresolved.

**3d — verify the gates yourself.** This is the one place you touch the repo directly, and
it is cheap — a command and an exit code. Some implementers cannot run shell commands at
all (Antigravity/Gemini), so for those steps the Digest says `gates: not run (orchestrator
verifies)` — this phase is the only thing standing between that step and a broken build:

```bash
<the project's real test/lint/build commands>
```

Never take "gates passed" from an executor on faith. Only when the gates actually pass:

```bash
node "$S/state.mjs" step --run "$RUN" --id NN --status done
```

Gates passing does **not** close the issue. A step that works but is not yet pushed is
still open work as far as the repository is concerned — closing happens at push, below.

When you commit this step, put `Refs #<issue>` in the trailer so the commit and the
ticket are linked. The relays never commit — that is yours.

**Checkpoint after every 3 completed steps:**

```bash
node "$S/state.mjs" checkpoint --run "$RUN"
```

### Context discipline — compact at 50%, and compact *with intent*

This pipeline is built so that compaction is safe: the plan, every step's status, the
briefs and the results all live in `$RUN` on disk, not in the conversation. Losing the
conversation loses nothing that matters. **So compact early rather than late** — a run
that hits the wall mid-wave is far more disruptive than one that compacts at a checkpoint.

**When context passes ~50%, say so and hand the user a focused instruction.** A bare
`/compact` keeps whatever the summariser thinks is interesting, which is often the last
noisy dispatch rather than the goal. Give it the goal explicitly:

```
Context is over 50% and we're at a checkpoint — good moment to compact.

/compact Keep: the run directory $RUN, the feature goal from 00-request.md, the numbered
plan with each step's status, which steps are in flight and with which implementer, the
definition of done for anything unfinished, and any unresolved review findings. Drop:
dispatch chatter, tool output, and the contents of files already written.
```

Then **keep working — do not wait for an answer.** Compaction is the user's call and
their timing; stalling the pipeline on it wastes the window you were trying to protect.

**After any compaction, re-orient from disk before dispatching anything:**

```bash
node "$S/state.mjs" digest --run "$RUN"
```

That restores the plan, the statuses and what is ready — authoritatively, not from
memory. Never resume a run from a recollection of what you were doing; the digest is the
source of truth and it costs one command.

**3e — push, and close what you pushed.** Only when the user says the work can go. Some
waves are complete but not safely pushable alone; those wait and go out together with a
later wave. You work on **whatever branch is already checked out** — never create a
branch, open a PR, or merge anything.

```bash
node "$S/issues.mjs" push --run "$RUN" --waves 1,2 --commit "$(git rev-parse --short HEAD)"
```

`--through N` closes every wave up to and including N, for the common case of catching
up several at once. Closing is explicit rather than relying on a `Closes #` keyword,
because GitHub only auto-closes from commits on the default branch and this pipeline
does not assume which branch you are on.

## Phase 4 — QA

Once every step is `done`. Write `$RUN/qa.brief.md`: the full plan, every step's definition
of done and how-to-test, and an instruction to exercise success **and** failure paths,
realistic edge cases, and the seams between steps — that is where independently-implemented
steps diverge.

```bash
node "$S/state.mjs" phase --run "$RUN" --to qa
node "$S/dispatch.mjs" --brief "$RUN/qa.brief.md" --lane qa --cd . \
     --result "$RUN/qa.result.md" --timeout 1h
```

Exit 3 → spawn `code-pro:qa-engineer`. Route failures back to phase 3c on the owning step's
session. Then checkpoint.

## Phase 5 — Final architecture review

```bash
git --no-pager diff > "$RUN/final.diff"
node "$S/state.mjs" phase --run "$RUN" --to final-review
```

Write `$RUN/99-final-review.brief.md` pointing at the plan, `final.diff`, and the QA
digest, then:

```
Agent(subagent_type: "code-pro:solution-architect",
      prompt: "Final review. Your brief is at <abs>/99-final-review.brief.md.
               Write to <abs>/99-final-review.result.md. Reply with the Digest only.")
```

On `needs-changes`, its blocking items become delta briefs back through phase 3.

## Phase 6 — Report

Write `$RUN/REPORT.md` and give the user this exact structure:

```
## What was done and how
- <per step: what was built, where, key decisions, and which model implemented it>

## What was tested
- <QA results, test suites run, outcomes>

## Needs manual testing
- <step-by-step manual verification instructions for the user>
```

Add a one-line delegation summary — which steps went to which model — so the user can see
where their Claude usage actually went. Then `state.mjs phase --to done`.

Commit only if the user asks.

### Record a finding — only if the run earned one

Now ask once: **did anything happen in this run that should change how lanes or models are
configured in future?**

Load the `record-findings` skill **only if the answer is yes.** Its bar:

- a lane that still got the work wrong after two rework rounds and had to escalate
- a quota window that vanished far faster than expected, or one lane starving others on
  the same provider
- a model that ignored an explicit constraint in its brief
- a fallback position that was missing, retired, or erroring when it was needed
- a model behaving materially differently from what the logs already claim

**Most runs meet none of these, and that is the normal outcome.** A single rework round,
one slow dispatch, or a quota wall arriving on schedule are all the process working —
recording them turns the logs into noise nobody reads. If nothing qualifies, say nothing
and finish.

Never write to the logs without loading the skill first; it carries the format, the
source-marking rules, and which of the two files an entry belongs in.

## Resuming

```bash
RUN=$(node "$S/state.mjs" latest --repo .)
node "$S/state.mjs" digest --run "$RUN"
```

The digest gives you the phase, what is done, what is ready, and what is blocked. That is
the complete state — resume from the matching phase above. A compaction, a crash, and a
brand-new session all recover identically, because nothing important ever lived only in
your context.

## Guardrails

- As simple as the request allows; follow the repo's existing structure, naming, and UI
  style everywhere. No unrequested refactoring.
- Honor the repo's constitution/spec file if present — it wins over any model's preference.
- Never leave the result structurally broken, with obvious bug sources, security holes,
  memory leaks, or untested parts (when the repo tests similar code).
- Three different models will touch this codebase in one run. The plan's quoted conventions
  are the only thing keeping their output coherent — never let a brief ship without them.
