# Code-pro

Exportable, editable Claude Code plugin that helps you code like a professional senior full-stack developer across the whole development lifecycle.

## Skills & commands

| Command | Skill | What it does |
|---|---|---|
| `/investigate` | investigate | Visual workflow charts of existing code, read-only |
| `/develop` | develop | Small features/modifications, inline |
| `/develop-fr` | develop-fr | Full features via architect → developers → QA pipeline |
| `/bug-fix` | bug-fix | Root-cause fix with minimal change + regression test |
| `/code-review` | code-review | Severity-ranked read-only review + commit message |
| `/test` | test | Unit tests mirroring repo test conventions |
| `/regression-test` | regression-test | Impact analysis + suite run after a change, report-only |
| `/refactor` | refactor | Behavior-preserving restructure, plan approval required |
| `/create-docs` | create-docs | Accurate docs with workflow charts, investigated not assumed |

## ⚙️ MODEL & EFFORT CONFIGURATION — EDIT HERE

Each subagent's model and effort live in the YAML frontmatter of its file in `agents/`.
This table is the map. To retune for a different model generation, edit the two
frontmatter lines (`model:` / `effort:`) in each listed file — nothing else needs changing.

| Agent file | Role | model | effort |
|---|---|---|---|
| `agents/investigator.md` | Read-only code investigation | `sonnet` | `high` |
| `agents/solution-architect.md` | Feature planning & final review (develop-fr, large refactors) | `opus` | `high` |
| `agents/developer.md` | Implements one planned development step | `sonnet` | `high` |
| `agents/qa-engineer.md` | Tests implemented features | `sonnet` | `high` |
| `agents/code-reviewer.md` | Read-only code review | `sonnet` | `high` |
| `agents/regression-tester.md` | Impact analysis + regression runs | `sonnet` | `high` |
| `agents/doc-writer.md` | Documentation writing (token-efficient) | `haiku` | `high` |

Valid models: `haiku`, `sonnet`, `opus`, `inherit` (inherit = use the main conversation's model).
Valid effort: `low`, `medium`, `high`.

Skills without an agent (`develop`, `bug-fix`, `test`, small `refactor`) run inline with whatever model you selected for the session — by design.

## Install

From the `pro-marketplace` marketplace:

```bash
/plugin marketplace add SomarRezq/pro-marketplace
```

```bash
/plugin install code-pro@pro-marketplace
```

For local use instead, add the marketplace root as a local marketplace
(`/plugin marketplace add <path-to-pro-marketplace>`) or copy the
`skills/`, `agents/`, and `commands/` contents into your `.claude/` directory.

## Full specification

The complete design specification for this plugin is in
[`docs/Code-pro-Plugin-Specification.pdf`](docs/Code-pro-Plugin-Specification.pdf).

## Coding philosophy (applies to every skill)

1. Match the repo, don't impose — structure, naming, UI style, and test conventions come from the existing codebase.
2. Smallest change that fully works — simplicity, SOLID, no unrequested refactoring.
3. Tests mirror the codebase — if similar code is tested, new code gets tests too.
4. Always end with a report — what was done and how, what was tested, what needs manual testing.
5. Never leave behind — obvious bug sources, exception sources, memory leaks, security holes, or structural mess.
6. Understand before touching — investigate code paths first; visualize when useful.
