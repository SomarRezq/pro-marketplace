# Run state, checkpoints, and resuming

Everything the pipeline produces lives on disk inside the target repo. Nothing important
lives only in the orchestrator's context. That is what makes `/compact`, a crash, and a
brand-new session all recoverable in exactly the same way.

## Layout

```
<repo>/.code-pro/runs/<YYYYMMDD-HHMMSS>-<slug>/
  00-request.md              the user's feature request, verbatim
  01-preflight.json          detected CLIs, resolved lanes, degradations applied
  02-architect.brief.md
  02-architect.result.md     the plan, in prose
  plan.json                  machine-readable step index (see below)
  steps/
    step-01.brief.md
    step-01.result.md        implementer report (Digest first)
    step-01.review.md        Codex review (Digest first)
    step-01.rework-1.brief.md
  qa.brief.md
  qa.result.md
  99-final-review.brief.md
  99-final-review.result.md
  state.json                 THE RESUME ANCHOR
  REPORT.md                  the final fixed-format output
```

`.code-pro/` is added to the repo's `.gitignore` automatically on first run.

## plan.json

The solution-architect emits this alongside its prose plan. It is what makes parallelism
safe and resumption possible.

```json
{
  "steps": [
    { "id": 1, "title": "Add /health route handler",   "deps": [],     "lane": "feature" },
    { "id": 2, "title": "Wire route into app router",  "deps": [1],    "lane": "feature" },
    { "id": 3, "title": "Unit tests for /health",      "deps": [1],    "lane": "tests"   },
    { "id": 4, "title": "Health status UI badge",      "deps": [2],    "lane": "ui"      }
  ]
}
```

- `deps` gates parallelism. Steps whose deps are all `done` are dispatched **together**.
- **Any two steps that touch the same file must be dependency-linked.** Parallel writes to
  one file is the single most likely way this pipeline corrupts a run.
- `lane` routes the step to an implementer. Use `tests` for test-writing steps, `ui` for
  frontend work, `feature` for everything else.

`state.mjs import-plan` validates it: unknown deps, self-deps, duplicate ids, and
dependency cycles all fail loudly rather than stalling the run later.

## state.json

```json
{
  "version": "code-pro-run.v1",
  "runId": "20260821-230744-health-endpoint",
  "phase": "implementing",
  "steps": [
    { "id": "01", "title": "...", "deps": [], "lane": "feature",
      "status": "done", "implementer": "agy", "session": "conv-7f2a91", "reviewRounds": 1 }
  ],
  "checkpoints": [],
  "blockers": [],
  "notes": []
}
```

Phases: `preflight → planning → approval → implementing → qa → final-review → reporting → done`

Step statuses: `pending → running → implemented → review-changes → done` (or `blocked`).

`session` is the external implementer's own conversation id (Codex `threadId`, Antigravity
`conversationId`). Recording it is what makes rework cheap — the delta brief resumes that
exact session instead of re-sending the whole context.

## Commands

```bash
S="${CLAUDE_PLUGIN_ROOT}/scripts"

node "$S/state.mjs" latest      --repo .                    # newest run dir
node "$S/state.mjs" digest      --run "$RUN"                # resume summary — read this after /compact
node "$S/state.mjs" import-plan --run "$RUN"                # load plan.json into state
node "$S/state.mjs" next        --run "$RUN"                # steps ready to dispatch NOW, in parallel
node "$S/state.mjs" step        --run "$RUN" --id 03 --status done --session abc123
node "$S/state.mjs" phase       --run "$RUN" --to qa
node "$S/state.mjs" checkpoint  --run "$RUN" --note "after step 3"
```

`next` is the scheduler. Do not decide parallelism by reading the plan yourself — ask
`next`, dispatch everything it returns simultaneously, mark each `done`, ask again.

## Compact checkpoints

Take a checkpoint at these three moments:

1. **After the plan is approved** — the largest single context drop available.
2. **After every 3 completed steps.**
3. **After QA, before the final review.**

At a checkpoint, run `state.mjs checkpoint` and tell the user:

```
Checkpoint: 7/12 steps done. State saved.
Safe to /compact — I resume from state.json with nothing lost.
```

Then keep going. Do not wait for them to answer; compaction is theirs to trigger, and the
run is safe either way.

## Why this keeps Claude usage flat

The orchestrator's context grows only by Digests — about 10 lines per dispatch. A 40-step
feature costs it roughly what a 4-step feature costs, because the code, the diffs, the
reviews, and the test output all live on disk and are read by the *next executor*, never by
the orchestrator.

If you ever find yourself reading a source file, a full diff, or a complete executor
report into the orchestrator's context, the design has failed at that moment. Read the
Digest, and if you need more, put the question in the next brief.

## Resuming

```bash
RUN=$(node "$S/state.mjs" latest --repo .)
node "$S/state.mjs" digest --run "$RUN"
```

The digest tells you the phase, which steps are done, which are ready, and what is
blocked. That is the entire state you need — pick up from there.
