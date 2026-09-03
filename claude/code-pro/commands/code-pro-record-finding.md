---
description: Record a durable lesson about a model or the delegation workflow into the findings and models-performance logs
---

Load the `record-findings` skill and follow it.

Before writing anything, check the bar. Record only if a future decision about lanes or
models would change because of this:

- a lane still got the work wrong after two rework rounds and had to escalate
- a quota window vanished far faster than expected, or one lane starved others on the
  same provider
- a model ignored an explicit constraint in its brief
- a fallback position was missing, retired, or erroring when it was needed
- a model behaved materially differently from what the logs already claim
- a structural lesson that would still be true with every model swapped out

**If `$ARGUMENTS` describes something below that bar, say so and write nothing.** A single
rework round, one slow dispatch, or a quota wall arriving on schedule are the process
working. The logs are only useful while they stay short enough to read.

The two files live in `$CODE_PRO_FINDINGS_DIR`. If that is unset, ask the user where they
are — never create a second copy somewhere else.

Read each file's own "How to use this file" header before writing; those headers are the
authority on format and may be newer than the skill.

Finish by telling the user in one line what was recorded and where, plus any lane
configuration you changed as a result. They may disagree with the reading — it is their
log, and a finding they reject should come back out.
