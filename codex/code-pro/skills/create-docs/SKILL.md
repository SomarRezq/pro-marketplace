---
name: create-docs
description: Document code, a feature, an API, or create a README/guide — accurate to how the code actually works, with visual workflow charts. Use whenever the user asks to document something, write a README, create developer or end-user docs, or "explain X in a doc". Investigates first, never assumes; makes no code changes.
---

# Create-docs

Docs that reflect how the code *actually* works — investigated, not assumed — in the repo's existing docs style, with visual workflow charts where they help.

## Why investigate first

Docs written from assumptions describe the intended behavior; users hit the real behavior. The gap between those two is exactly where docs fail. So: read the code first, document what it does.

## Workflow

1. **Investigate the relevant code paths first** (investigate-style): real flows, real inputs/outputs, real failure paths.
2. **Identify audience and doc type.** Default: developer docs; produce end-user docs too when the feature is user-facing or the user asks.
3. **Follow existing docs style and location** if the repo has any (format, headings, file placement, tone).
4. Delegate the writing to the **doc-writer** agent for large docs (token-efficient), or write inline for small ones.
5. **Include visual flow charts** (Mermaid, investigate-style: user interaction / backend call / DB call, success and failure paths) for any workflow being documented.
6. **Flag ambiguities and undocumented behaviors** discovered along the way — these go in the report, not swept under the rug.

## Output format

The doc file(s), placed per the repo's docs convention, plus:

```
## Docs created
- <file — audience — contents summary>

## Open questions / ambiguities found
- <undocumented or surprising behavior discovered in the code>
```

## Example

"document the auth module" → `auth.md` with flow charts of login/logout/refresh paths, function reference, config options — plus a note about an undocumented timeout behavior found in the code.

## Guardrails

- **No code changes.**
- Document real behavior, never intended behavior; never invent details not verified in the code.
- If the code and existing docs contradict each other, the code wins — and the contradiction is flagged.
