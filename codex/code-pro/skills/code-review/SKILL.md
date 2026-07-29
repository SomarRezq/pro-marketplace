---
name: code-review
description: Review a change, diff, branch, PR, or specific file before merging — read-only, severity-ranked. Use whenever the user asks to review code, check a branch/PR, "look over my changes", "is this safe to merge", or wants a second pair of eyes before committing. Never modifies code; also produces a suggested commit message.
---

# Code-review

An honest, prioritized review that catches what actually matters — without touching the code.

## Why this shape

Reviews fail in two ways: rubber-stamping (missing real problems) and noise (50 nitpicks burying 2 critical issues). Severity ranking with reasoning fixes both. Every finding must state *why* it matters — a finding without a consequence is an opinion.

## Workflow

1. **Understand the intent of the change**: what is it trying to accomplish? Read the diff against that intent.
2. Delegate the deep pass to the **code-reviewer** agent (or review inline for tiny diffs). Review against, in priority order:
   - **Correctness** — does it do what it intends? Missed edge cases? Broken paths?
   - **Security** — injection, unvalidated input, exposed secrets, authz gaps
   - **Resource/memory handling** — leaks, unclosed connections/handles
   - **Error handling** — swallowed exceptions, missing failure paths
   - **Repo conventions & SOLID** — structure, naming, style deviations from the surrounding code
   - **Test coverage** — is the change tested to the repo's usual standard?
3. **Rank findings by severity** with file/location references and a concrete suggested fix for each.
4. **Verdict + suggested commit message.**

## Output format (fixed)

```
## Summary
<what the change does, 1-3 sentences>

## Findings
### Critical
- <file:line — issue — why it matters — suggested fix>
### Major
- ...
### Minor
- ...

## Test coverage gaps
- <untested paths introduced by this change>

## Verdict
Approve / Needs changes — <one-line reason>

## Suggested commit message
<short title>
<1-2 sentences: general purpose of the change; per changed file: one-line description>
```

## Example

"review my payment branch" → 2 critical (unvalidated amount input, unclosed DB connection), 3 minor naming issues, missing failure-path test → verdict: needs changes → suggested commit message describing each changed file.

## Guardrails

- **Read-only — never modify code.** Suggestions live in the review, not in the files.
- Don't nitpick style that matches the repo's existing conventions, even if unusual.
- Every finding states why it matters; if you can't articulate the consequence, drop the finding.
