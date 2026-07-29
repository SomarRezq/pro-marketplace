---
name: regression-test
description: After a change, verify nothing else broke — impact analysis plus test runs, report-only. Use whenever the user says things like "check nothing broke", "verify my changes didn't break anything", "run regression", or asks for verification after modifying code. Finds and reports breakage but never fixes it (that's bug-fix's job).
---

# Regression-test

Confidence that recent changes didn't break existing functionality — earned by mapping the blast radius, running the tests, and reporting the gaps honestly.

## Why report-only

Mixing "detect breakage" and "fix breakage" in one pass produces surprise changes on top of changes. This skill keeps roles clean: it finds and reports; the user decides what to send to bug-fix.

## Workflow

1. **Identify what changed**: diff / recent commits / the user's description.
2. Delegate to the **regression-tester** agent (or run inline for tiny changes):
   - **Map the blast radius** (investigate-style impact analysis): every code path, feature, and consumer affected by the changed code — direct callers, shared state, events, DB schema touchpoints.
   - **Run the existing test suite** (full, or the affected scope if the suite is huge — say which).
   - **Write missing regression tests** for impacted areas that lack coverage, in the repo's test style.
3. **Report** (see output format).

## Output format (fixed)

```
## What was analyzed
- <the change + impact map of affected paths/features>

## Tests run
- <suites/scopes run — pass/fail counts, failures listed with location>

## New regression tests added
- <test — what gap it closes>

## Found breakage (not fixed — run /bug-fix)
- <failure — suspected cause>

## Needs manual verification
- <risk areas tests can't reach, with step-by-step manual test instructions>
```

## Example

"I changed the session handler, check nothing broke" → impact map (login, logout, auto-refresh affected) → suite run → 1 failing test found and reported with suspected cause → manual steps for browser session behavior.

## Guardrails

- **Never fix bugs it finds** — report them for /bug-fix.
- **Never modify existing tests to make them pass** — a failing test is a finding, not an obstacle.
- Be explicit about what was NOT covered; false confidence is the worst output this skill can produce.
