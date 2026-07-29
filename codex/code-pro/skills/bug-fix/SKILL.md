---
name: bug-fix
description: Fix a reported bug at its root cause with the smallest possible change. Use whenever the user reports a bug, error, exception, crash, or unexpected behavior and wants it fixed — "X fails when...", "this throws...", "why is this broken, fix it". Adds a regression test when the repo tests similar code. Not for new features (develop) or code cleanup (refactor).
---

# Bug-fix

Find the root cause — not the symptom — and fix it with the smallest change that fully resolves it, in repo style, protected by a regression test.

## Why root cause matters

A symptom patch (a try/catch, a special case) makes the bug invisible instead of gone, and it will return wearing a different error message. The fix must make the original failure impossible.

## Workflow

1. **Reproduce/understand the bug**: from the report, the code, and if possible an actual reproduction.
2. **Investigate all related code paths** to locate the root cause. Distinguish "where it crashes" from "why it crashes".
3. **Fix directly — no confirmation needed**: apply the minimal fix at the root cause, following repo conventions exactly.
4. **Regression test**: if similar code parts in the repo are tested, add a test that reproduces the original bug (fails before the fix, passes after), in the repo's test style.
5. **Verify**: run the tests; check connected code paths for side effects of the fix.
6. **Report** (see output format).

This skill runs **inline** with the session's selected model — no subagents.

## Output format (fixed)

```
## Root cause
- <what was actually wrong and why it produced the reported behavior>

## What was changed and why
- <file: change — reasoning>

## What was tested
- <regression test + suite results>

## Manual verification steps
- <how the user confirms the bug is gone>
```

## Example

"login fails when email has uppercase letters" → root cause: case-sensitive DB lookup → minimal fix (normalize email at lookup), regression test with mixed-case email, report + manual steps.

## Guardrails

- Never patch symptoms: no swallowing exceptions, no special-case hacks that hide the failure.
- No refactoring beyond the fix; don't "improve" nearby code even if tempting — mention improvement ideas in the report instead.
- Keep the diff as small as possible while fully fixing the root cause.
