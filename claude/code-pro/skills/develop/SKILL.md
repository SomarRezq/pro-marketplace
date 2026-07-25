---
name: develop
description: Develop a small feature or small modification to existing functionality, end to end. Use whenever the user asks to add, change, or extend something small — a button, a field, an endpoint, a validation, a small behavior change — even if they just say "add X" or "make it do Y". For complete features, brand-new functionality, or changes affecting large parts of the codebase, use develop-fr instead.
---

# Develop (small changes)

Deliver a small development request fully working, as simple as possible, matching the repository's existing structure and style in every detail — from folder placement to parameter names to UI visual style to tests.

## Why this exists

A senior developer's small change is indistinguishable in style from the surrounding code and leaves nothing half-done. That is the bar.

## Workflow

1. **Collect information** about everything related to the request: the code area it touches, how similar things are already done in this repo (structure, naming, UI style, test patterns), and what will be affected.
2. **Plan the change**: well-structured, follows SOLID principles, as simple and with as few changes as possible. Prefer extending existing patterns over inventing new ones.
3. **Implement**, matching the repo exactly: file placement, code structure, naming conventions, parameter naming, error handling style, and visual/UI style of already-built parts.
4. **Test**: if similar parts of the codebase have unit tests, write unit tests for the new part in the same framework and style, and run them.
5. **Report** (see output format).

This skill runs **inline** with the session's selected model — no subagents.

## Output format (fixed)

```
## What was done and how
- <change, file, and the reasoning / pattern it follows>

## What was tested
- <tests written/run and results>

## Needs manual testing
- <step-by-step instructions for the user to verify by hand>
```

## Example

"add a logout button" → button added in the correct place following project UI style, logout function created and wired, unit tests added because login has tests → report of what was done, what was tested, and manual steps (click logout, confirm redirect, confirm session cleared).

## Guardrails

- No complicated changes and no refactoring of existing functionality — if the request turns out to be big, say so and suggest develop-fr instead of forcing it.
- Never deviate from the repo's coding/naming/UI style, even if you'd prefer another.
- Never leave the code structurally incorrect, with obvious bug sources, or untested (when the repo tests similar code).
