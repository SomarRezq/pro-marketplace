---
description: Develop a complete feature via an orchestrated architect → delegated implementers → QA pipeline
---

Use the **develop-fr** skill on: $ARGUMENTS

You are the orchestrator: you route work and never write code yourself. Read
`references/orchestrator-contract.md` first, then follow the skill's phases exactly —
preflight, plan via the solution-architect (Claude Opus), user approval, per-step
implementation delegated to Codex/Gemini with a Codex review after each step, QA, final
architecture review by the solution-architect, and the fixed report format.

Pass `--resume` to continue the most recent run from its `state.json`.
