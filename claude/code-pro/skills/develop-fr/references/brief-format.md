# The brief contract

Every hop in the develop-fr pipeline is the same shape:

```
write a brief file  ──▶  executor runs  ──▶  read a result file
```

That holds whether the executor is Codex, Gemini via Antigravity, or a Claude subagent.
One format, two transports. The executor's identity is a config detail.

## The iron rule

**The executor sees the brief and nothing else.** No chat history. No memory of your
conversation with the user. No knowledge of the other steps. No idea what the repo's
conventions are unless you wrote them down.

If a fact is needed to do the work, it is in the brief or the work is wrong. This is the
single biggest determinant of output quality — a vague brief produces vague code, and you
will pay for it twice: once in the failed step, once in the rework round.

## Brief template

Write to `.code-pro/runs/<run-id>/steps/step-NN.brief.md`.

```markdown
# Brief: step-NN — <short title>

## Goal
One paragraph. What must be true when this is finished. Written so someone who has never
seen this repo could recognize success.

## Context
The slice of the plan this executor needs — and only that slice. Include:
- what already exists that this builds on (with real file paths)
- the shape of the data/interfaces it must fit
- what the steps before it produced, if it depends on them

## Do
The specific change. Name files. Name functions. Be concrete about the boundary between
"you decide" and "already decided".

## Do NOT
- do not refactor anything outside the files listed above
- do not rename existing public interfaces
- do not commit — the orchestrator commits
- do not add dependencies without reporting it as `verdict: needs-decision`
- <plus any fence specific to this step>

## Conventions
Quote the repo's actual conventions — do not describe them abstractly. For example:

    Tests live beside the source as `<name>.test.ts` and use vitest:
        import { describe, it, expect } from "vitest";
    Handlers return `Result<T, AppError>`, never throw:
        return err(new AppError("not_found", 404));

## Gates
The project's REAL commands, discovered from CLAUDE.md / AGENTS.md / package.json /
Makefile. Never invent them.

    npm run lint
    npm test -- src/health

Run these yourself before reporting. Report the actual output, not your belief about it.

## Definition of done
- [ ] <checkable condition>
- [ ] <checkable condition>
- [ ] gates above pass

## Report contract
Write your full report to: <abs path to step-NN.result.md>

End your final message with these four lines exactly, as the last thing you output:

    verdict: done | needs-decision | needs-changes | blocked
    files: <comma-separated paths you changed>
    gates: <command → pass/fail, for each gate above>
    open: <the question you need answered, or "none">
```

## The Digest

The first section of every result file is a Digest of at most 30 lines. **The orchestrator
reads only this.** Everything else on disk exists for the next executor, not for the
orchestrator's context.

```markdown
## Digest
verdict: done
lane: feature
implementer: agy (gemini-3.1-pro-high)
status: completed · exit 0 · 214s
session: conv-7f2a91
files: src/routes/health.ts, src/app.ts
gates: npm run lint → pass, npm test → pass
open: none
```

`dispatch.mjs` builds this automatically from the relay's `result.json`, preferring the
executor's own `verdict:` line over an inferred one — so a `needs-decision` is never
silently downgraded to `done`.

## Verdicts

| Verdict | Means | Orchestrator does |
|---|---|---|
| `done` | Step complete, gates pass | Re-run gates, then dispatch the review |
| `needs-decision` | Hit a choice the brief didn't cover | Answer it (ask the user if it is theirs), send a delta brief on the same session |
| `needs-changes` | Review found problems | Send a delta brief on the same session; count the round |
| `blocked` | Cannot proceed | Escalate to the solution-architect — the plan step may be wrong |

## Delta briefs for rework

Rework continues the **same** external session (`--session` for Codex, `--conversation`
for Antigravity), so the implementer still has its context and you pay only for the delta.
A delta brief is short and names only what changed:

```markdown
# Brief: step-03 rework 1

Your previous work on this step was reviewed. Fix exactly these findings, change nothing
else, then re-run the gates and report in the same format.

## Findings
1. `src/routes/health.ts:24` — the DB check swallows the exception, so a dead database
   still reports healthy. Let it surface as a 503.
2. `src/routes/health.ts:31` — no timeout on the DB ping; a hung connection hangs the
   endpoint. Use the 2s timeout convention from `src/db/client.ts:88`.

## Do NOT
Do not restructure the handler. Do not touch the tests that already pass.
```

Cap rework at **2 rounds**. A third failure means the plan step is wrong, not the code —
escalate to the solution-architect with both reviews attached.

## Worked example

For a real 2-file change, `step-02.brief.md`:

```markdown
# Brief: step-02 — Wire the /health route into the app router

## Goal
`GET /health` responds 200 with `{"status":"ok","db":"ok"}` when the database is
reachable, and 503 with `{"status":"degraded","db":"down"}` when it is not.

## Context
Step 01 created `src/routes/health.ts`, exporting `healthHandler(req, res)`. It is not
reachable yet — nothing imports it. The app's router is assembled in `src/app.ts:41-58`,
where each route is registered with `router.get(path, handler)`.

## Do
In `src/app.ts`, import `healthHandler` from `./routes/health` and register it at
`/health`, placed with the other unauthenticated routes (above the `requireAuth`
middleware at line 52 — registering below it would put /health behind auth).

## Do NOT
- do not modify `src/routes/health.ts` — step 01 owns that file
- do not reorder the existing route registrations
- do not commit

## Conventions
Routes are registered one per line, alphabetically within their auth group:

    router.get("/health", healthHandler);

Imports are grouped stdlib / external / internal, separated by a blank line.

## Gates
    npm run lint
    npm test -- src/app

## Definition of done
- [ ] `GET /health` returns 200 without a session cookie
- [ ] existing route tests still pass
- [ ] gates pass

## Report contract
Write your full report to:
  <run>/steps/step-02.result.md
End your final message with the four-line block (verdict/files/gates/open).
```

Notice what the brief does *not* assume: it gives the line numbers, states which file the
executor must not touch and why, explains the consequence of getting the placement wrong,
and quotes the registration style rather than saying "follow the existing style".
