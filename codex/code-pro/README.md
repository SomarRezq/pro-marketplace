# Code-pro (Codex)

Codex port of the Code-pro plugin — code like a professional senior full-stack developer across the whole development lifecycle.

Functionally identical to the [Claude Code version](../../claude/code-pro): same 9 skills, same 7 specialized agents, same philosophy. Only the packaging formats and model names differ, because Codex and Claude Code define agents and manifests differently.

## Skills & prompts

| Prompt | Skill | What it does |
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

Skills load automatically when the task matches their description. The files in `prompts/` are the manual equivalents — copy them into `~/.codex/prompts/` to invoke a workflow explicitly by name.

## ⚙️ MODEL & EFFORT CONFIGURATION — EDIT HERE

Each agent's model and reasoning effort live in its TOML file in `agents/`.
This table is the map. To retune, edit the two lines (`model` / `model_reasoning_effort`) in each listed file — nothing else needs changing.

| Agent file | Role | model | model_reasoning_effort |
|---|---|---|---|
| `agents/investigator.toml` | Read-only code investigation | `gpt-5.4` | `high` |
| `agents/solution-architect.toml` | Feature planning & final review (develop-fr, large refactors) | `gpt-5.5` | `high` |
| `agents/developer.toml` | Implements one planned development step | `gpt-5.4` | `high` |
| `agents/qa-engineer.toml` | Tests implemented features | `gpt-5.4` | `high` |
| `agents/code-reviewer.toml` | Read-only code review | `gpt-5.4` | `high` |
| `agents/regression-tester.toml` | Impact analysis + regression runs | `gpt-5.4` | `high` |
| `agents/doc-writer.toml` | Documentation writing (fast/efficient) | `gpt-5.4-mini` | `high` |

Model tiers used: `gpt-5.5` (newest frontier — deepest planning and final review), `gpt-5.4` (flagship — implementation, review, testing), `gpt-5.4-mini` (fast and efficient — built for subagents).
Valid `model_reasoning_effort`: `low`, `medium`, `high`, `xhigh`. Consider `xhigh` for the solution-architect on very large features.

`investigator` and `code-reviewer` are pinned to `sandbox_mode = "read-only"` — they must never modify files, and the sandbox enforces it rather than relying on instructions alone.

## Install

**1. The plugin (skills):** add this repo as a Codex marketplace, then install:

```bash
codex plugin marketplace add SomarRezq/pro-marketplace
```

Then open the plugin directory in Codex, pick the `pro-marketplace-codex` source, and install `code-pro`.

**2. The agents:** Codex loads custom agents from a config directory, not from a plugin, so copy them once:

```bash
# personal (all projects)
cp agents/*.toml ~/.codex/agents/

# or project-scoped
mkdir -p .codex/agents && cp agents/*.toml .codex/agents/
```

**3. The prompts (optional):**

```bash
cp prompts/*.md ~/.codex/prompts/
```

Restart Codex after installing.

## Note on subagents in Codex

Codex spawns subagents only when you explicitly ask it to. The `develop-fr` and `refactor` skills instruct it to do so, but if you want the pipeline to run, phrase your request as a delegation (e.g. "use develop-fr to build X, spawning one agent per step"). Default caps: 6 concurrent agent threads, nesting depth 1 — raise `agents.max_threads` / `agents.max_depth` in your Codex config if a large feature plan needs more.

## Coding philosophy (applies to every skill)

1. Match the repo, don't impose — structure, naming, UI style, and test conventions come from the existing codebase.
2. Smallest change that fully works — simplicity, SOLID, no unrequested refactoring.
3. Tests mirror the codebase — if similar code is tested, new code gets tests too.
4. Always end with a report — what was done and how, what was tested, what needs manual testing.
5. Never leave behind — obvious bug sources, exception sources, memory leaks, security holes, or structural mess.
6. Understand before touching — investigate code paths first; visualize when useful.
