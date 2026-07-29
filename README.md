# pro-marketplace

Somar's marketplace of AI plugins, skills, and agents.

This repository is a **plugin marketplace for both Claude Code and Codex**. Add it once
and you can install any plugin it hosts with a single command — no manual file copying,
and updates arrive by re-running the marketplace update.

## Install

### Claude Code

```bash
/plugin marketplace add SomarRezq/pro-marketplace
/plugin install code-pro@pro-marketplace
```

Browse everything interactively instead: `/plugin`

### Codex

```bash
codex plugin marketplace add SomarRezq/pro-marketplace
```

Then open the plugin directory in Codex, pick the `pro-marketplace-codex` source, and
install `code-pro`. Codex loads custom agents from a config directory rather than from a
plugin, so also copy the agent files once — see the
[Codex plugin README](codex/code-pro/README.md#install).

## Available plugins

| Plugin | Vendor | What it does | Docs |
|---|---|---|---|
| [`code-pro`](claude/code-pro) | Claude Code | Code like a professional senior full-stack developer across the whole development lifecycle — investigate, develop, bug-fix, review, test, refactor, document. Ships 9 skills, 9 slash commands, and 7 specialized subagents. | [README](claude/code-pro/README.md) · [Specification (PDF)](docs/Code-pro-Plugin-Specification.pdf) |
| [`code-pro`](codex/code-pro) | Codex | The same plugin, ported to Codex: identical 9 skills and 7 agents, packaged in Codex formats (TOML agents, `.codex-plugin` manifest) with Codex model names. | [README](codex/code-pro/README.md) · [Specification (PDF)](docs/Code-pro-Plugin-Specification.pdf) |

Both versions share one specification document, which covers the skills, the agents, and
the differences between the two vendor formats.

## Repository layout

Plugins are grouped by the AI tool they target, so this marketplace hosts more than one
vendor's format without collisions.

```
pro-marketplace/
├── .claude-plugin/
│   └── marketplace.json      ← Claude Code marketplace manifest (must be at repo root)
├── .agents/plugins/
│   └── marketplace.json      ← Codex marketplace manifest
├── claude/                   ← plugins for Claude Code
│   └── code-pro/
│       ├── .claude-plugin/plugin.json
│       ├── agents/           ← subagents: Markdown + YAML frontmatter
│       ├── commands/         ← slash commands
│       ├── skills/           ← skills (one folder per skill, each with SKILL.md)
│       └── README.md
├── codex/                    ← plugins for Codex
│   └── code-pro/
│       ├── .codex-plugin/plugin.json
│       ├── agents/           ← custom agents: TOML
│       ├── prompts/          ← manual prompts (copy to ~/.codex/prompts/)
│       ├── skills/           ← skills (identical SKILL.md format)
│       └── README.md
├── docs/                     ← shared specification and reference material
└── README.md
```

Each vendor looks for its own manifest at the repository root. The `source` field of each
entry points at the plugin folder, which is how plugins can be nested under `claude/`
and `codex/`.

## Claude Code vs Codex — what actually differs

The skills are byte-for-byte the same idea in both, because `SKILL.md` (YAML frontmatter
with `name` + `description`, Markdown body) is a shared format. Everything else differs:

| | Claude Code | Codex |
|---|---|---|
| Plugin manifest | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` |
| Marketplace manifest | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json` |
| Skills | `skills/<name>/SKILL.md` | `skills/<name>/SKILL.md` (same) |
| Agents | `agents/<name>.md`, YAML frontmatter | `agents/<name>.toml`, installed to `~/.codex/agents/` |
| Agent model fields | `model:` + `effort:` | `model` + `model_reasoning_effort` |
| Manual invocation | `commands/<name>.md` → `/name` | `prompts/<name>.md` → `~/.codex/prompts/` |
| Strongest model | `opus` | `gpt-5.5` |
| Mid-tier model | `sonnet` | `gpt-5.4` |
| Fast model | `haiku` | `gpt-5.4-mini` |
| Effort values | `low` / `medium` / `high` | `low` / `medium` / `high` / `xhigh` |

## Adding a new plugin

1. Create the plugin folder under the vendor directory, e.g. `claude/<plugin-name>/` or
   `codex/<plugin-name>/`.
2. Add the vendor's plugin manifest (`.claude-plugin/plugin.json` or
   `.codex-plugin/plugin.json`).
3. Add whatever the plugin ships: `skills/`, `commands/` or `prompts/`, `agents/`, `hooks/`.
4. Register it in the matching root marketplace manifest.
5. Commit and push. Consumers pick it up with a marketplace update.

## Updating

```bash
# Claude Code
/plugin marketplace update pro-marketplace

# Codex
codex plugin marketplace upgrade
```

Bump the `version` field in the plugin's manifest and its marketplace entry whenever you
ship changes, so people can tell what they are getting.

## License

MIT — see [LICENSE](LICENSE).
