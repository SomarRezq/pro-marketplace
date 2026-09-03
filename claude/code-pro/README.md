# Code-pro

Exportable, editable Claude Code plugin that helps you code like a professional senior
full-stack developer across the whole development lifecycle.

Its flagship skill, `develop-fr`, spends **Claude Opus only on architecture** and delegates
implementation, test-writing, QA, and per-step review to **Codex** and **Gemini**.

## Skills & commands

| Command | Skill | What it does |
|---|---|---|
| `/investigate` | investigate | Visual workflow charts of existing code, read-only |
| `/develop` | develop | Small features/modifications, inline |
| `/develop-fr` | develop-fr | **Full features via the delegating pipeline** |
| `/bug-fix` | bug-fix | Root-cause fix with minimal change + regression test |
| `/code-review` | code-review | Severity-ranked read-only review + commit message |
| `/test` | test | Unit tests mirroring repo test conventions |
| `/regression-test` | regression-test | Impact analysis + suite run after a change, report-only |
| `/refactor` | refactor | Behavior-preserving restructure, plan approval required |
| `/create-docs` | create-docs | Accurate docs with workflow charts, investigated not assumed |
| `/code-pro-doctor` | — | Verify the delegation setup: implementers, lanes, degradations |
| `/code-pro-issues` | — | Mirror a run onto GitHub: milestone per wave, issue per step |
| `/code-pro-record-finding` | record-findings | Record a durable lesson about a model or the workflow |

## The develop-fr pipeline

```
you ──▶ ORCHESTRATOR (Claude — routing only, never reads or writes code)
   │
   │   every hop: write a brief file ──▶ executor ──▶ read a result Digest
   │
   ├─0─ PREFLIGHT ....... script, no model
   ├─1─ PLAN ............ Claude Opus / high      ← reasoning
   ├─2─ APPROVAL ........ you
   ├─3─ PER STEP (parallel where dependencies allow):
   │      3a IMPLEMENT .. Gemini 3.1 Pro (agy) or Codex
   │      3b REVIEW ..... Codex, read-only
   │      3c REWORK ..... same session, ≤2 rounds, then escalate
   │      3d GATES ...... the orchestrator re-runs them itself
   ├─4─ QA .............. Codex
   ├─5─ FINAL REVIEW .... Claude Opus / high      ← reasoning
   └─6─ REPORT
```

Claude is touched at exactly three points: the plan, the final review, and the
orchestrator's own short routing turns.

**One brief format, two transports.** Every hop — including the Claude-to-Claude ones — is
`write a brief file → executor runs → read a result file`. External models go through the
delegate-skills relays; Claude subagents get the same brief and result paths. The executor's
identity is a config detail, so swapping a lane from Gemini to Codex changes one config line
and nothing in the plugin.

**Why your Claude usage stays flat.** Every result file opens with a ≤30-line Digest, and
the orchestrator reads only that. Source files, diffs, reviews, and test output live on
disk and are read by the *next executor*, never by the orchestrator. A 40-step feature costs
the orchestrator roughly what a 4-step feature costs.

**Compaction is lossless.** All run state lives in `.code-pro/runs/<id>/` inside your repo
(auto-gitignored). The skill takes checkpoints after the plan, after every 3 steps, and
after QA, and tells you when it is safe to `/compact`. `/develop-fr --resume` picks up from
`state.json` — after a compaction, a crash, or in a brand-new session.

## Prerequisites for full delegation

`develop-fr` works without any of this — it just falls back to Claude subagents and says so.
For the token savings you want all three:

1. **[delegate-skills](https://github.com/amElnagdy/delegate-skills)** installed
   (`codex-delegate`, `agy-delegate`, `delegate-setup`).
2. **The CLIs**, installed and authenticated:
   - `codex` — `npm i -g @openai/codex && codex login` *(keep it current; a stale CLI is
     rejected by the server for newer default models)*
   - `agy` — the Google Antigravity CLI, which is how Gemini reaches this pipeline. There
     is no `gemini-delegate`; the standalone `gemini` CLI is not used.
3. **A fleet config** at `~/.config/delegate-skills/config.json` defining the lanes below.

Run `/code-pro-doctor` to check all of it at once.

### Optional: surviving quota exhaustion

The degradation ladder handles an implementer that is *missing*. It does not handle one
that is installed, authenticated, and **out of quota** — that just fails the dispatch.

[`delegate-backup`](https://github.com/SomarRezq/pro-marketplace/tree/main/claude/delegate-backup)
(`/plugin install delegate-backup@pro-marketplace`) gives each lane an ordered **chain** of
implementers and walks it one position down per exhaustion, scheduling the lane's return
for when the provider's window resets. End every chain with a free, unmetered model and
the pipeline can never run out of fallbacks.

It is a **soft dependency** — without it nothing changes; with it, preflight additionally
reports any lane running on a fallback, its chain position, and when it comes back.

### What each implementer can do

| Implementer | Edits files | Runs your gates |
|---|---|---|
| `codex` | yes | **yes** — runs tests/lint and reports real results |
| `agy` (Gemini) | yes | **no** — Antigravity's print mode denies every shell command |

`dispatch.mjs` handles the difference automatically: a brief bound for Antigravity gets an
appended note telling it not to run the gates (the exact text sent is saved as
`<result>.effective-brief.md`), and the Digest reminds the orchestrator that the gates are
its job. This costs nothing — the orchestrator re-runs the gates on every step anyway,
because a self-reported pass was never proof. `dispatch.mjs --allow-shell` opts into
Antigravity's `--dangerously-skip-permissions` instead; that is full access, so only use it
if you explicitly want it.

### Verified on

Confirmed working end to end on 2026-08-21 with live dispatches in both directions:

| | Version | Live test |
|---|---|---|
| `codex` | 0.149.0 (`gpt-5.2-codex`, xhigh) | read-only review ✅ · wrote a test file, ran `node --test`, reported the real pass ✅ |
| `agy` | 1.1.17 (`gemini-3.1-pro-high`) | read-only review ✅ · wrote code matching the quoted convention, deferred gates ✅ |

Codex **must** be reasonably current — an old CLI is rejected server-side for newer default
models. 0.80.0 failed both ways; 0.149.0 works.

## ⚙️ LANE CONFIGURATION — EDIT HERE

Lanes bind a kind of work to an implementer. They live in **your** delegate-skills fleet
config, not in this plugin, so retuning the entire pipeline is one file.

| Lane | Used for | Suggested |
|---|---|---|
| `feature` | backend / logic steps | `{ "implementer": "opencode", "model": "zai-coding-plan/glm-5.3-flash", "variant": "low" }` |
| `ui` | UI steps | `{ "implementer": "opencode", "model": "zai-coding-plan/glm-5.3-flash", "variant": "low" }` |
| `tests` | test-writing steps | `{ "implementer": "opencode", "model": "opencode/muse-spark-1.3-contributor-free" }` |
| `review` | per-step review | `{ "implementer": "codex", "effort": "medium" }` |
| `qa` | end-to-end QA | `{ "implementer": "codex", "effort": "medium" }` |
| `docs` | documentation steps | `{ "implementer": "agy", "model": "gpt-oss-120b-medium" }` |

**On `review` and `readOnly`.** The reviewer's report is written by the *relay*, not by the
implementer — so `readOnly` never blocked it. Setting `readOnly: true` sandboxes the
reviewer out of your working tree, which is what stops a reviewer quietly fixing what it
was asked to judge. It is omitted above because that is the current default here, but it
is the safer setting and worth restoring unless you specifically want the reviewer able to
edit.

**Spread lanes across independent quota buckets.** The suggestion above uses three: GLM,
Codex, and Antigravity's GPT-OSS pool. Putting several lanes on one provider is what
exhausts it — and note that *all* Z.AI coding-plan models (`glm-5.3`, `glm-5.3-flash`,
`glm-5-turbo`, `glm-4.7`) share a single bucket, while Antigravity has two independent
ones (Gemini, and Claude/GPT which includes `gpt-oss-120b-medium`).

Edit through the `delegate-setup` skill, or by hand. If a lane is missing, the plugin uses
an all-Codex default and tells you. Details and the degradation ladder:
[`skills/develop-fr/references/lanes-and-fallbacks.md`](skills/develop-fr/references/lanes-and-fallbacks.md).

## ⚙️ MODEL & EFFORT CONFIGURATION — EDIT HERE

Each subagent's model and effort live in the YAML frontmatter of its file in `agents/`.
This table is the map — edit the two frontmatter lines to retune.

| Agent file | Role | model | effort |
|---|---|---|---|
| `agents/solution-architect.md` | **Planning & final review — the reasoning budget** | `opus` | `high` |
| `agents/investigator.md` | Read-only code investigation | `sonnet` | `high` |
| `agents/developer.md` | *Fallback* implementer (when no external CLI) | `sonnet` | `high` |
| `agents/qa-engineer.md` | *Fallback* QA (when no external CLI) | `sonnet` | `high` |
| `agents/code-reviewer.md` | Code review; *fallback* per-step reviewer | `sonnet` | `high` |
| `agents/regression-tester.md` | Impact analysis + regression runs | `sonnet` | `high` |
| `agents/doc-writer.md` | Documentation writing (token-efficient) | `haiku` | `high` |

Valid models: `haiku`, `sonnet`, `opus`, `inherit`. Valid effort: `low`, `medium`, `high`.

Skills without an agent (`develop`, `bug-fix`, `test`, small `refactor`) run inline with
whatever model you selected for the session — by design.

## Scripts

`scripts/` holds the Node helpers the pipeline shells out to. No dependencies — Node
built-ins only.

| Script | Purpose |
|---|---|
| `preflight.mjs` | Detect CLIs, relays, and lanes; report degradations |
| `run-init.mjs` | Create the run directory, seed `state.json`, gitignore `.code-pro/` |
| `dispatch.mjs` | lane → implementer → its relay; normalize the result into a Digest |
| `state.mjs` | Read/update run state; schedule ready steps; checkpoints |

## Install

```bash
/plugin marketplace add SomarRezq/pro-marketplace
/plugin install code-pro@pro-marketplace
```

## Coding philosophy (applies to every skill)

1. Match the repo, don't impose — structure, naming, UI style, and test conventions come from the existing codebase.
2. Smallest change that fully works — simplicity, SOLID, no unrequested refactoring.
3. Tests mirror the codebase — if similar code is tested, new code gets tests too.
4. Always end with a report — what was done and how, what was tested, what needs manual testing.
5. Never leave behind — obvious bug sources, exception sources, memory leaks, security holes, or structural mess.
6. Understand before touching — investigate code paths first; visualize when useful.
7. Never trust a self-report — re-run the gates yourself before believing anything passed.

## Full specification

The complete specification — updated to v2.0, covering the delegation pipeline, the brief
contract, lanes, and build instructions — is in
[`docs/Code-pro-Plugin-Specification.pdf`](../../docs/Code-pro-Plugin-Specification.pdf)
([editable .docx](../../docs/Code-pro-Plugin-Specification.docx)).

The refactor that produced v2.0, including what live testing taught and what remains
unverified, is in [`docs/REFACTOR-PLAN.md`](../../docs/REFACTOR-PLAN.md).
