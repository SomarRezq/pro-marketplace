---
name: test
description: Write unit tests for a function, module, or feature using the repo's existing test framework and style. Use whenever the user asks to write, add, or improve unit tests, "cover this with tests", or "make sure X is tested". Tests must actually run and pass. Not for post-change verification of the whole system — that's regression-test.
---

# Test

Unit tests that look native to the repo — same framework, same naming, same structure — covering success, failure, and edge paths, and actually passing.

## Why mirroring matters

Tests that follow a different style become second-class citizens nobody maintains. Tests that don't run are decoration. Both are worse than no tests.

## Workflow

1. **Find existing tests** and mirror their framework, file placement, naming, setup/teardown patterns, and assertion style exactly. If the repo has no tests at all, propose a minimal standard setup for the stack and confirm with the user first.
2. **Investigate the code under test**: identify all paths — success, failure, and edge cases (empty input, boundaries, error branches).
3. **Write the tests.**
4. **Run them.** Fix the tests (not the code) until they pass — or report a genuine bug if the code is actually broken (fixing it is bug-fix's job).
5. **Report** (see output format).

This skill runs **inline** with the session's selected model — no subagents.

## Testability seams

If code is genuinely untestable as-is (hard-wired dependencies, no injection point): you may propose a minimal seam (e.g. extract an interface, inject a dependency) — but **present the proposal and wait for the user's approval before touching production code**. If declined, list those paths under "needs manual testing".

## Output format (fixed)

```
## Test cases created
- <test name — what it covers>

## Run results
- <suite output summary: passed/failed>

## Cannot be unit tested
- <paths needing manual or integration testing, and why>
```

## Example

"write tests for the login function" → tests for valid login, wrong password, locked account, empty input — in the existing test file style, all passing — plus a note that session expiry needs manual testing.

## Guardrails

- Never modify production code just to make tests pass — the only exception is an approved testability seam (above).
- No fake or trivial assertions that always pass; every test must be able to fail.
- If a test reveals a real bug, report it clearly — don't silently adjust the test to accept broken behavior.
