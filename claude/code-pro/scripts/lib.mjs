// Shared helpers for the code-pro scripts.
// Node built-ins only — this ships inside a plugin and must never need an install.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Lanes the develop-fr pipeline asks for, and what each is used for. */
export const REQUIRED_LANES = {
  feature: "backend / logic implementation steps",
  ui: "UI implementation steps",
  tests: "test-writing steps",
  review: "per-step independent code review (read-only)",
  qa: "end-to-end QA pass",
  docs: "documentation steps",
};

/**
 * Built-in lane map, used ONLY when no delegate-skills fleet config exists.
 * Deliberately all-Codex: it is the one implementer most likely to be present,
 * and a single-vendor default is easier to reason about than a guessed split.
 */
export const DEFAULT_LANES = {
  feature: { implementer: "codex" },
  ui: { implementer: "codex" },
  tests: { implementer: "codex" },
  review: { implementer: "codex", readOnly: true, effort: "high" },
  qa: { implementer: "codex" },
  docs: { implementer: "codex" },
};

/** Implementer key -> the binary that must be on PATH. */
export const IMPLEMENTER_BINARIES = {
  claude: "claude",
  codex: "codex",
  agy: "agy",
  copilot: "copilot",
  cursor: "cursor-agent",
  opencode: "opencode",
  cline: "cline",
  grok: "grok",
  kimi: "kimi",
  qoder: "qodercli",
  vibe: "vibe",
  pi: "pi",
  aider: "aider",
  warp: "oz",
};

/** Human labels, for reports. */
export const IMPLEMENTER_LABELS = {
  codex: "Codex",
  agy: "Antigravity (Gemini)",
  claude: "Claude Code",
  copilot: "GitHub Copilot",
  cursor: "Cursor Agent",
  opencode: "OpenCode",
};

/** Cross-platform `which`, without shelling out. */
export function which(bin) {
  const isWin = process.platform === "win32";
  const exts = isWin
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const dirs = (process.env.PATH || "").split(isWin ? ";" : ":").filter(Boolean);
  for (const dir of dirs) {
    for (const ext of ["", ...exts]) {
      const candidate = path.join(dir, bin + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        /* unreadable PATH entry — skip */
      }
    }
  }
  return null;
}

/** Directories that may hold installed delegate skills. */
function skillSearchRoots() {
  const home = homedir();
  const roots = [
    path.join(home, ".claude", "skills"),
    path.join(home, ".config", "claude", "skills"),
  ];
  const cache = path.join(home, ".claude", "plugins", "cache");
  if (existsSync(cache)) {
    for (const market of safeReaddir(cache)) {
      const marketDir = path.join(cache, market);
      for (const plugin of safeReaddir(marketDir)) {
        for (const version of safeReaddir(path.join(marketDir, plugin))) {
          roots.push(path.join(marketDir, plugin, version, "skills"));
        }
      }
    }
  }
  return roots.filter((r) => existsSync(r));
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Absolute path to an implementer's relay.mjs, or null if the skill is not installed. */
export function findRelay(implementer) {
  for (const root of skillSearchRoots()) {
    const relay = path.join(root, `${implementer}-delegate`, "scripts", "relay.mjs");
    if (existsSync(relay)) return relay;
  }
  return null;
}

/** Absolute path to delegate-setup's scripts dir, or null. */
export function findDelegateSetup() {
  for (const root of skillSearchRoots()) {
    const dir = path.join(root, "delegate-setup", "scripts");
    if (existsSync(path.join(dir, "config.mjs"))) return dir;
  }
  return null;
}

/** Where delegate-skills keeps its global fleet config. */
export function globalFleetPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(base, "delegate-skills", "config.json");
}

/**
 * Load the effective lane map.
 * Prefers delegate-setup's own `config.mjs load` (it applies project overlays and
 * trust checks); falls back to reading the global config directly; falls back to
 * DEFAULT_LANES. Always reports which source won, because a silent fallback would
 * hide the whole point of the pipeline.
 */
export function loadFleet(cwd = process.cwd()) {
  const setup = findDelegateSetup();
  if (setup) {
    const res = run(process.execPath, [path.join(setup, "config.mjs"), "load", "--cwd", cwd]);
    if (res.code === 0 && res.stdout.trim()) {
      try {
        const parsed = JSON.parse(res.stdout);
        const lanes = parsed.lanes || parsed;
        if (lanes && typeof lanes === "object" && Object.keys(lanes).length) {
          return { lanes, source: "delegate-setup", projectTrusted: parsed.projectTrusted };
        }
      } catch {
        /* fall through to direct read */
      }
    }
  }
  const direct = globalFleetPath();
  if (existsSync(direct)) {
    try {
      const parsed = JSON.parse(readFileSync(direct, "utf8"));
      if (parsed.lanes && Object.keys(parsed.lanes).length) {
        return { lanes: parsed.lanes, source: "global-config" };
      }
    } catch {
      /* fall through to defaults */
    }
  }
  return { lanes: { ...DEFAULT_LANES }, source: "plugin-default" };
}

/** Which implementers are actually usable right now: binary on PATH AND relay installed. */
export function availableImplementers() {
  const out = {};
  for (const [key, bin] of Object.entries(IMPLEMENTER_BINARIES)) {
    const binPath = which(bin);
    const relay = findRelay(key);
    out[key] = { binary: bin, binaryPath: binPath, relay, usable: Boolean(binPath && relay) };
  }
  return out;
}

/**
 * Resolve one lane to something runnable, applying the degradation ladder from the
 * plugin README. Never throws for a missing implementer — it degrades and says so.
 */
export function resolveLane(laneName, fleet, available) {
  const fromFleet = Boolean(fleet.lanes[laneName]);
  const configured = fleet.lanes[laneName] || DEFAULT_LANES[laneName];
  if (!configured) {
    return {
      lane: laneName,
      ok: false,
      error: `unknown lane "${laneName}"`,
      known: Object.keys(fleet.lanes).sort(),
    };
  }
  const wanted = configured.implementer;
  const degradations = [];
  let chosen = wanted;

  if (!available[wanted]?.usable) {
    const why = !available[wanted]
      ? `unknown implementer "${wanted}"`
      : !available[wanted].binaryPath
        ? `${IMPLEMENTER_BINARIES[wanted]} not on PATH`
        : `${wanted}-delegate skill not installed`;
    // Ladder: prefer the other configured external implementer, then any usable one.
    const preference = ["codex", "agy", "copilot", "opencode", "cursor", "claude"];
    const alt = preference.find((k) => k !== wanted && available[k]?.usable);
    if (alt) {
      degradations.push(`lane "${laneName}": ${wanted} unusable (${why}) → using ${alt}`);
      chosen = alt;
    } else {
      return {
        lane: laneName,
        ok: false,
        fallbackToClaude: true,
        error: `no usable external implementer for lane "${laneName}" (${why})`,
        degradations: [`lane "${laneName}": no external implementer → in-Claude subagent fallback`],
      };
    }
  }

  const dials = { ...configured };
  delete dials.implementer;
  delete dials.source;
  // Dials are implementer-specific; a model label for one CLI is meaningless to another.
  if (chosen !== wanted) {
    delete dials.model;
    delete dials.variant;
  }

  return {
    lane: laneName,
    ok: true,
    implementer: chosen,
    configuredImplementer: wanted,
    dials,
    relay: available[chosen].relay,
    fromFleet,
    // `--lane` makes the relay resolve dials itself, but it only works when the relay
    // can find THIS lane in a real fleet config and that lane names the implementer we
    // are about to run. A plugin-default lane is invisible to the relay, so we must
    // pass its dials as explicit flags instead.
    useLaneFlag: fromFleet && fleet.source !== "plugin-default" && chosen === wanted,
    degradations,
  };
}

/** spawnSync wrapper that always returns strings and never throws on a missing binary. */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    ...opts,
  });
  return {
    code: res.status === null ? 1 : res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || (res.error ? String(res.error.message) : ""),
    signal: res.signal || null,
  };
}

/** Minimal flag parser: --key value, --flag, and bare positionals. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

/** Nearest git root at or above `from`, or null. */
export function gitRoot(from = process.cwd()) {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function die(msg, code = 2) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}
