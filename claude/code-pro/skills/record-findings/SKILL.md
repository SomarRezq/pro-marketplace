---
name: record-findings
description: Record a durable lesson about a model or the delegation workflow into the findings and models-performance logs. Use ONLY when something happened that changes how lanes or models should be configured in future — a lane that kept getting the work wrong after rework, a model burning a quota window far faster than expected, a model ignoring explicit brief constraints, or a fallback that was unavailable when needed. Not for routine runs, single rework rounds, or ordinary quota exhaustion.
license: MIT
compatibility: Requires the two log files to exist. Their directory comes from $CODE_PRO_FINDINGS_DIR; if that is unset, ask the user where they live rather than guessing.
metadata:
  version: 1.0.0
---

# Record Findings

Two logs hold what has been learned about running this pipeline:

| File | Holds |
|---|---|
| `models-performance.md` | How a **specific model** behaves — quality, speed, quota appetite, whether it follows instructions, how many lanes it can hold |
| `findings-and-suggestions.md` | Lessons about the **workflow, setup and tooling** — what broke and why, rules worth following, recommendations |

Both files open with their own "How to use this file" block. **Read that block before
writing** — it is the authority on format, and it may have been updated since this skill
was written.

Locate them at `$CODE_PRO_FINDINGS_DIR`. If that variable is not set, **ask the user
where the logs live**. Do not create a second copy somewhere else — a split log is worse
than no log.

## The bar for recording — read this first

**Most runs produce nothing worth writing down.** A log that captures every run becomes
noise, and noise is not read. The default is to record nothing.

Record only when a future decision about lanes or models would change because of it.

### Record

- **A lane kept getting it wrong.** Two rework rounds spent and the step still failed
  review, so it escalated. That is a signal about the model, not the task.
- **A quota window vanished far faster than expected** — a week's allowance gone in an
  hour, or one lane visibly starving the others on the same provider.
- **A model ignored an explicit constraint in a brief** — edited files it was told not to
  touch, ran commands it was told not to run, committed when the brief forbade it.
- **A fallback was not there when needed** — a chain position retired, unavailable, or
  erroring; a restore that fired onto a still-dead provider.
- **A model's behaviour changed materially** from what the log already claims — much
  slower, much worse, newly unable to do something it used to do.
- **A structural lesson about the setup** — something that would still be true with every
  model swapped out.

### Do not record

- A single rework round. That is the process working, not a finding.
- One slow response, one timeout, one flaky call.
- Routine quota exhaustion **at roughly the expected time**. Expected walls are not news.
- A model performing exactly as the log already says it does. Nothing to add.
- Anything you cannot state a **cause** for. "Codex was bad today" is not a finding.
  *Why* it was bad is. If the cause is unknown, say the cause is unknown — explicitly.
- Praise. "GLM did well again" is not worth a line unless it contradicts the log.

### Rhythm

At most **one recording pass per run**, and normally at the **end** — during the report,
not mid-pipeline. Do not interrupt implementation to write a log entry.

The exception is something that will be forgotten or overwritten: exact error text, a
precise timestamp, a measured duration. Capture those into the run directory as you go,
and write the entry properly at the end.

## Which file

> **If swapping the model would make the note irrelevant, it goes in
> `models-performance.md`. If the note would still be true with a different model, it goes
> in `findings-and-suggestions.md`.**

Some events produce an entry in **both**, and that is correct — the same event, seen at
two levels:

| The event | Models file | Findings file |
|---|---|---|
| Codex burned its week in 30 minutes on three lanes | "This model cannot hold three lanes" | "Never put a high-effort per-step lane on a provider already carrying two high-volume lanes" |
| The free floor model was retired | "This model is gone, removed from chains" | "A chain's guarantee is only as good as its floor still existing — verify floors" |

Write both when both are true. Do not duplicate the same text into each; each entry
should say the thing at its own level.

## How to write it

Follow the format in each file's header. Beyond that:

1. **Mark the source.** `[measured]` you have numbers · `[observed]` you watched it happen
   repeatedly · `[reported]` the user said so from their own use · `[untested]` from docs,
   never run. This is not optional — an unmarked claim is unusable later.
2. **Never invent a number.** If a duration or token count was not measured, write
   `unknown`. A wrong number is worse than no number, because it will be trusted.
3. **Say what to do about it.** A finding with no consequence is an anecdote. End with the
   change made, or mark it **Still open** if nothing was done yet.
4. **Update, do not duplicate.** If the model already has a section, add a dated line to
   its **Log** or revise the verdict. A second section for the same model splits the
   record.
5. **Plain language.** These get read while working, not while studying. If a sentence
   needs jargon to survive, rewrite the sentence.
6. **Quote real error text** rather than paraphrasing it. `Weekly/Monthly Limit
   Exhausted` is searchable; "it ran out" is not.

## Before you finish

Tell the user, in one line, what you recorded and where. They may disagree with the
reading — these are their logs, and a finding they reject should come back out.

If you changed lane configuration as a result (swapped a floor, moved a lane off a
provider), say that too. The log entry and the config change belong together.
