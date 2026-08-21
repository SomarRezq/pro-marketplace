---
description: Verify the code-pro delegation setup — implementers, lanes, and what would degrade
---

Run the preflight check and explain the result to the user.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs" --cwd .
```

Then, in a short summary:

1. State whether `develop-fr` would run **fully delegating** or **degraded**.
2. For anything missing, give the exact fix:
   - a CLI not on PATH → its install command, then its login command
   - a `*-delegate` skill missing → https://github.com/amElnagdy/delegate-skills
   - a lane missing from the fleet config → the JSON snippet preflight printed, added via
     the `delegate-setup` skill or by editing `~/.config/delegate-skills/config.json`
3. Note that a CLI being on PATH is not proof it is authenticated — only a real dispatch
   is. If the user wants certainty, offer to run one throwaway read-only dispatch per lane.

Do not change any configuration without asking first.
