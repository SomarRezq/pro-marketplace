# pro-marketplace

Somar's marketplace of AI plugins, skills, and agents.

This repository is a **plugin marketplace for Claude Code**. Add it once and you can
install any plugin it hosts with a single command — no manual file copying, and updates
arrive by re-running the marketplace update.

## Install

```bash
/plugin marketplace add SomarRezq/pro-marketplace
/plugin install code-pro@pro-marketplace
```

Browse everything interactively instead: `/plugin`

## Available plugins

| Plugin | What it does | Docs |
|---|---|---|
| [`code-pro`](claude/code-pro) | Code like a professional senior full-stack developer across the whole development lifecycle — investigate, develop, bug-fix, review, test, refactor, document. Its `develop-fr` pipeline reserves Claude Opus for architecture and delegates implementation, testing, and per-step review to Codex and Gemini. Ships 9 skills, 10 slash commands, and 7 specialized subagents. | [README](claude/code-pro/README.md) · [Spec (PDF)](docs/Code-pro-Plugin-Specification.pdf) · [Refactor plan](docs/REFACTOR-PLAN.md) |

## Repository layout

Plugins are grouped by the AI tool they target, so this marketplace can host more than one
vendor's format without collisions.

```
pro-marketplace/
├── .claude-plugin/
│   └── marketplace.json      ← Claude Code marketplace manifest (must be at repo root)
├── claude/                   ← plugins for Claude Code
│   └── code-pro/
│       ├── .claude-plugin/plugin.json
│       ├── agents/           ← subagents: Markdown + YAML frontmatter
│       ├── commands/         ← slash commands
│       ├── scripts/          ← Node helpers the skills shell out to
│       ├── skills/           ← skills (one folder per skill, each with SKILL.md)
│       └── README.md
├── docs/                     ← shared specification and reference material
└── README.md
```

Claude Code looks for its manifest at the repository root. The `source` field of each entry
points at the plugin folder, which is how plugins can be nested under `claude/`.

> **A Codex port of `code-pro` used to live under `codex/`.** It was removed in v2.0.0 and
> is recoverable from the `codex-port-v1` git tag. Note that this is unrelated to `code-pro`
> *using* the `codex` CLI as an implementer, which is a core part of the current design.

## Adding a new plugin

1. Create the plugin folder under the vendor directory, e.g. `claude/<plugin-name>/`.
2. Add the plugin manifest (`.claude-plugin/plugin.json`).
3. Add whatever the plugin ships: `skills/`, `commands/`, `agents/`, `scripts/`, `hooks/`.
4. Register it in the root marketplace manifest.
5. Commit and push. Consumers pick it up with a marketplace update.

## Updating

```bash
/plugin marketplace update pro-marketplace
```

Bump the `version` field in the plugin's manifest and its marketplace entry whenever you
ship changes, so people can tell what they are getting.

## License

MIT — see [LICENSE](LICENSE).
