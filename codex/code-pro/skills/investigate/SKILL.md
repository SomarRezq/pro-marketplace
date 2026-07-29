---
name: investigate
description: Investigate and visualize how existing code works, read-only. Use whenever the user asks to investigate existing code or current behavior, asks "how does X work", "what happens when", "trace this flow", "show me how these parts connect", or wants to understand a pre-existing feature before changing it — even if they don't say "investigate". Produces visual workflow charts of code paths plus notes on risks found.
---

# Investigate

Understand and visualize already-built functionality: how functions, windows, and services connect and exchange data right now — without changing anything.

## Why this exists

Before touching code, the user wants to *see* it: every use case, every path, where the user interacts, where the backend is called, where the database is hit, and what comes out. A chart beats ten paragraphs.

## Workflow

1. Clarify scope if genuinely ambiguous (whole feature vs. one path). Otherwise proceed.
2. Delegate deep code exploration to the **investigator** agent (or explore inline for small scopes): find ALL code paths related to the feature — every use case, every branch (success and failure), entry points, function-to-function calls, UI↔backend↔DB boundaries.
3. Build one visual workflow chart per use case (Mermaid flowchart). Each chart must show:
   - each step as a function or logical step, with its input → output
   - where **user interaction** happens
   - where a **backend call** is made
   - where a **DB call** is made
   - all outcome paths: success AND failure
4. Add notes below the charts for anything worth mentioning found during investigation:
   - clear bug sources, obvious exception sources
   - security loopholes
   - memory-leak sources
   - big costly architectural mistakes
   Only report what the code actually shows — no speculation.

## Output format (fixed)

```
## <Feature> — investigation

### Use case: <name>
<mermaid flowchart with labeled nodes: [UI] user interaction, [API] backend call, [DB] db call, inputs/outputs on edges>

(repeat per use case)

### Notes & findings
- <file:line — observation and why it matters>

### Worth knowing
- <non-risk details worth mentioning: hidden config, side effects, coupling>
```

## Example

"investigate user login flow" → charts for: normal login (UI form → validate() → POST /auth/login → SELECT user → session created → redirect), failed password path, locked-account path; then notes like "password comparison is case-insensitive at db lookup (auth.js:42) — possible security loophole".

## Guardrails

- **Read-only. Never modify, create, or delete any file.** Investigation only — this is the whole contract of the skill.
- Trace real code; if a path can't be confirmed from the code, mark it "unverified" on the chart rather than guessing.
