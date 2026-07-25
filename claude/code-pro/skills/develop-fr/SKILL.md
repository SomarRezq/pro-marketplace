---
name: develop-fr
description: Develop a complete feature, a completely new functionality, or a massive change affecting a big part of the codebase or its structure. Use whenever the user requests a full feature ("build user management", "add a payments module"), brand-new functionality, or structural changes — anything clearly bigger than a small modification (which is develop's job). Orchestrates a solution-architect agent, parallel developer agents, and a QA agent.
---

# Develop-fr (full feature)

Deliver a complete feature fully working through a structured pipeline: Solution Architect plans → Developer agents implement → QA Engineer tests → Solution Architect reviews and reports.

## Why this pipeline

Big changes fail when one context tries to plan, implement, and judge itself. Splitting roles gives an independent plan, focused implementations, and a fresh-eyes test pass — like a real senior team.

## Input

A detailed explanation of the requested feature. If the description is too thin to plan from, ask targeted questions first.

## Workflow (you are the orchestrator)

1. **Planning — spawn the `solution-architect` agent** with the feature request. The SA:
   - checks the codebase: existing structure, conventions, where the feature best fits
   - checks the repo for a constitution/spec file (e.g. spec-kit constitution) and treats its implementation specs as binding
   - researches online how such features are commonly built in this type of project; for completely new functionality, chooses structure based on commonly used structures for this project type, following SOLID
   - if the feature needs UI/UX design, uses available design skills and goes back and forth with the user to settle the design before planning
   - produces numbered development steps covering everything (backend, DB, UI changes, unit tests). Each step includes: definition of done, how to test it, constraints, structure decisions and directions.
2. **Present the SA's plan to the user briefly**, then proceed.
3. **Implementation — spawn one `developer` agent per step** (parallel where steps are independent, sequential where they depend). Each developer follows its step's plan exactly, matches repo style, and reports back what it did — or what decision/investigation it still needs. Resolve escalations (via the SA context) before continuing.
4. **Testing — spawn the `qa-engineer` agent** once all steps are done: it tests the functionality as thoroughly as possible (run test suites, exercise the paths) and reports findings. Route failures back to developer agents to fix.
5. **Final review — return to the `solution-architect`** with the full diff and QA report: verify everything requested is implemented, nothing left undone, and no big loopholes, bug sources, memory leaks, or security breach points in the changes.
6. **Report** (see output format).

## Output format (fixed)

```
## What was done and how
- <per step: what was built, where, and the key decisions>

## What was tested
- <QA results, test suites run, outcomes>

## Needs manual testing
- <step-by-step manual verification instructions for the user>
```

## Example

"develop full user login/logout" → SA plans UI/UX (with user input), backend endpooints, DB tables, session handling, tests → developer agents implement each step → QA verifies all paths → SA final review → report + manual test steps.

## Guardrails

- As simple as possible; follow the repo's existing structure, coding/naming style, and UI style everywhere.
- Do not refactor unrelated existing functionality along the way.
- Honor the repo's constitution/spec file if present — it wins over your preferences.
- Never leave the result structurally incorrect, with obvious bug sources, security holes, memory leaks, or untested parts (when the repo tests similar code).
