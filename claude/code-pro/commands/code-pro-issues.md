---
description: Mirror a develop-fr run onto GitHub — milestone per wave, issue per step — and drive the pending → in-progress → closed lifecycle
---

Show how the current run maps onto waves and issues. This costs **no API calls** — it
reads the local mapping.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issues.mjs" list --run "$RUN"
```

`$RUN` is the run directory from `run-init.mjs`. If the user has not named one, ask which
run they mean rather than guessing.

## The lifecycle

| State | GitHub | Set when |
|---|---|---|
| pending | open, no status label | `sync` |
| in-progress | open + `status:in-progress` | the wave's **first** step is dispatched |
| closed | closed | the wave's work is **pushed** |

`in-progress` is set once per wave and never revisited — review rounds and rework do not
move it. Gates passing does not close anything; only pushing does.

## Creating the mirror

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issues.mjs" sync --run "$RUN" --dry-run
```

**Always dry-run first and show the user what would be created** — the milestone titles,
the issue count, and which steps land in which wave. Issues are visible to everyone with
repository access, so get an explicit yes before running without `--dry-run`.

`sync` only creates issues for step ids missing from `$RUN/issues.json`, so re-running
after a partial failure — or after a re-plan — finishes the mirror instead of duplicating
it. It never reads GitHub to compare state.

## Driving it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issues.mjs" start --run "$RUN" --wave N
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issues.mjs" push --run "$RUN" --through N --commit "$(git rev-parse --short HEAD)"
```

`push` also takes `--waves 1,2` for closing several waves that were held back and pushed
together. Both support `--dry-run`.

This works on **whatever branch is checked out**. It never creates a branch, opens a PR,
or merges anything.

## Checking for drift

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issues.mjs" verify --run "$RUN"
```

One read for the entire run. Use it only when the user suspects someone edited issues by
hand — it reports mismatches and deliberately does not "fix" them, since a person closing
an issue is a decision, not an error.

## Reporting back

1. Milestones and issue numbers per wave, and the state of each.
2. Anything under `skipped` — already mirrored, left alone.
3. For `push`, which issues closed and under which commit.

Exit 2 means `gh` is missing or unauthenticated — tell the user to run `gh auth login`,
and note that a freshly installed `gh` is absent from an already-running shell's PATH
until the terminal restarts. Exit 3 means there was nothing to do.

The run directory stays the source of truth for execution. These issues mirror it, so a
GitHub outage costs the mirror, never the pipeline.
