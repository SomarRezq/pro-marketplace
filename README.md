# pro-marketplace

Somar's marketplace of AI plugins, skills, and agents.

This repository is a **Claude Code plugin marketplace**. Add it once and you can install
any plugin it hosts with a single command — no manual file copying, and updates arrive
by re-running the marketplace update.

## Install

Add the marketplace:

```bash
/plugin marketplace add somarrezq/pro-marketplace
```

Then install a plugin from it:

```bash
/plugin install code-pro@pro-marketplace
```

Browse everything interactively instead:

```bash
/plugin
```

## Available plugins

| Plugin | Vendor | What it does | Docs |
|---|---|---|---|
| [`code-pro`](claude/code-pro) | Claude Code | Code like a professional senior full-stack developer across the whole development lifecycle — investigate, develop, bug-fix, review, test, refactor, document. Ships 9 skills, 9 slash commands, and 7 specialized subagents. | [README](claude/code-pro/README.md) · [Specification (PDF)](claude/code-pro/docs/Code-pro-Plugin-Specification.pdf) |

## Repository layout

Plugins are grouped by the AI tool they target, so this marketplace can host more than
one vendor's format over time without collisions.

```
pro-marketplace/
├── .claude-plugin/
│   └── marketplace.json     ← marketplace manifest (must stay at repo root)
├── claude/                  ← plugins for Claude Code
│   └── code-pro/
│       ├── .claude-plugin/
│       │   └── plugin.json  ← plugin manifest
│       ├── agents/          ← subagent definitions
│       ├── commands/        ← slash commands
│       ├── skills/          ← skills (one folder per skill, each with SKILL.md)
│       ├── docs/            ← specifications and reference material
│       └── README.md
└── README.md
```

`.claude-plugin/marketplace.json` **must** live at the repository root — that is where
Claude Code looks when you add the marketplace. The `source` field of each entry points
at the plugin folder, which is how plugins can be nested under `claude/`.

## Adding a new plugin

1. Create the plugin folder under the vendor directory, e.g. `claude/<plugin-name>/`.
2. Add `claude/<plugin-name>/.claude-plugin/plugin.json` with at minimum `name`,
   `description`, `version`, and `author`.
3. Add whatever the plugin ships: `skills/`, `commands/`, `agents/`, `hooks/`.
4. Register it in the root `.claude-plugin/marketplace.json` under `plugins`, with
   `source` set to `./claude/<plugin-name>`.
5. Commit and push. Consumers pick it up with `/plugin marketplace update pro-marketplace`.

### Plugin component conventions

| Folder | Contents | Format |
|---|---|---|
| `skills/<name>/SKILL.md` | A skill | Markdown with `name` + `description` YAML frontmatter |
| `commands/<name>.md` | A slash command | Markdown, invoked as `/<name>` |
| `agents/<name>.md` | A subagent | Markdown with `name`, `description`, `tools`, `model` frontmatter |

## Updating

Consumers pull the latest plugin versions with:

```bash
/plugin marketplace update pro-marketplace
```

Bump the `version` field in both the plugin's `plugin.json` and its marketplace entry
whenever you ship changes, so people can tell what they are getting.

## License

MIT — see [LICENSE](LICENSE).
