---
name: refactor
description: Behavior-preserving restructuring of code the user explicitly asks to refactor, restructure, or clean up. Only triggers on an explicit request — never self-initiated from other skills. Presents a plan and waits for approval before changing anything; proves safety with tests before and after. Large refactors get frontier-model planning via the solution-architect agent.
---

# Refactor

Identical external behavior, simpler SOLID-compliant structure in repo style — proven safe by tests that pass before and after, executed only after the user approves the plan.

## Why the safety ritual

A refactor without a test safety net is just editing and hoping. And a refactor the user didn't approve step-by-step can quietly change things they cared about. Plan → approve → small steps → test after each.

## Workflow

1. **Investigate current behavior and all usages** of the code to be refactored — every caller, every dependency.
2. **Ensure a test safety net exists.** If the code lacks tests, write characterization tests first (tests that pin down current behavior, including its quirks).
3. **Plan small incremental refactor steps.**
   - Small refactor (single function/file, limited callers): plan inline with the session's model.
   - Large refactor (multiple modules, structural change): spawn the **solution-architect** agent (gpt-5.5, high effort) to produce the plan, like develop-fr.
4. **Present the plan and WAIT for the user's approval.** Do not touch code before approval.
5. **Execute step by step**, running the tests after every step. If a step can't be verified by tests, stop and ask.
6. **Report** (see output format).

## Output format (fixed)

```
## Before / after structure
- <summary of the old shape vs the new shape>

## Why each change improves the code
- <step — improvement and principle it serves>

## Proof of unchanged behavior
- <test results before and after — all green>

## Needs manual verification
- <anything tests couldn't pin down>
```

## Example

"refactor the report generator, it's an 800-line function" → characterization tests written first → plan presented (split into cohesive functions following repo patterns) → approved → executed stepwise with green tests throughout → report.

## Guardrails

- Zero behavior changes; no new features; no API/signature changes unless explicitly requested.
- Stop and ask whenever a step cannot be verified by tests.
- Follow repo structure and naming — a refactor that introduces a foreign style is a regression.
