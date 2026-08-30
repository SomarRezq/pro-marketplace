---
description: Mirror a develop-fr run's plan onto GitHub — a milestone per wave, an issue per step — or show the current mapping
---

Show how the current run maps onto waves and issues.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issues.mjs" list --run "$RUN"
```

`$RUN` is the run directory from `run-init.mjs`. If the user has not named one, ask which
run they mean rather than guessing.

To create the mirror (a milestone per wave, an issue per step):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issues.mjs" sync --run "$RUN" --dry-run
```

**Always dry-run first and show the user what would be created** — issue counts, the
milestone titles, and which steps land in which wave. Creating issues is visible to
everyone with access to the repository, so get an explicit yes before running it without
`--dry-run`.

Then summarise:

1. How many milestones and issues were created, and the issue number per step.
2. Any step reported under `skipped` — it already carried an issue, so `sync` left it
   alone. Re-running after a partial failure is safe and finishes the mirror.
3. Whether `state.json` now carries the issue numbers (it does — that is the mirror).

Closing is not done here; it happens in `develop-fr` phase 3d, after a step's gates
actually pass:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issues.mjs" close --run "$RUN" --id NN
```

Exit 2 means `gh` is missing or unauthenticated — tell the user to run `gh auth login`,
and note that a freshly installed `gh` will not be on an already-running shell's PATH
until the terminal is restarted. Exit 3 from `sync` means every step was already mirrored.

The run directory stays the source of truth for execution. These issues mirror it, so a
GitHub outage costs the mirror, never the pipeline.
