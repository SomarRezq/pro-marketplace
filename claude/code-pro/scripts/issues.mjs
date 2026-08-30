#!/usr/bin/env node
// Mirror an approved plan onto GitHub: one milestone per wave, one issue per step.
//
//   node issues.mjs sync  --run <dir> [--repo owner/name] [--dry-run]
//   node issues.mjs close --run <dir> --id NN [--comment "..."]
//   node issues.mjs list  --run <dir>
//
// Node built-ins only — this ships inside a plugin and must never need an install.
//
// Design notes:
//
//  * The run directory stays the execution source of truth. `state.mjs` still drives
//    scheduling, resume and checkpoints; this script only annotates each step with the
//    `wave` and `issue` it was mirrored to. GitHub being unreachable must never block a
//    run — it costs you the mirror, not the pipeline.
//  * Waves are derived, not authored. A step's wave is 1 + the deepest wave among its
//    dependencies, which is exactly the batching `state.mjs next` already dispatches in
//    parallel. Nothing new is being scheduled here; the existing schedule is being named.
//  * `sync` is idempotent. A step that already carries an issue number is skipped, so
//    re-running after a partial failure completes the mirror instead of duplicating it.
//
// Exit codes: 0 ok, 1 usage/error, 2 gh unavailable or unauthenticated, 3 nothing to do.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const EXIT = { ok: 0, usage: 1, noGh: 2, nothingToDo: 3 };

function die(msg, code = EXIT.usage) {
  process.stderr.write(`issues: ${msg}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// gh
// ---------------------------------------------------------------------------

/**
 * Resolve the gh binary. A fresh install does not appear on an already-running
 * shell's PATH, which is a confusing way to fail, so fall back to the standard
 * install locations before giving up.
 */
function findGh() {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["gh"], {
    encoding: "utf8",
  });
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).find(Boolean);
    if (first) return first.trim();
  }
  const env = process.env;
  const candidates =
    process.platform === "win32"
      ? [
          `${env.ProgramFiles}\\GitHub CLI\\gh.exe`,
          `${env["ProgramFiles(x86)"]}\\GitHub CLI\\gh.exe`,
          `${env.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`,
          `${env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\gh.exe`,
          `${env.USERPROFILE}\\scoop\\shims\\gh.exe`,
        ]
      : ["/usr/local/bin/gh", "/usr/bin/gh", "/opt/homebrew/bin/gh"];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

const GH = findGh();

function gh(args, { allowFail = false } = {}) {
  if (!GH) {
    die(
      "the GitHub CLI (gh) was not found. Install it, then run `gh auth login`.\n" +
        "If you just installed it, this shell's PATH is stale — restart the terminal.",
      EXIT.noGh,
    );
  }
  const r = spawnSync(GH, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.error) die(`could not run gh (${r.error.message})`, EXIT.noGh);
  if (r.status !== 0 && !allowFail) {
    die(`gh ${args.slice(0, 3).join(" ")} failed:\n${(r.stderr || r.stdout || "").trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function ghJson(args) {
  const { out } = gh(args);
  try {
    return JSON.parse(out || "null");
  } catch {
    die(`gh returned non-JSON for: gh ${args.join(" ")}`);
  }
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

function runDir(args) {
  const d = args.run;
  if (typeof d !== "string" || !d) die("--run <dir> is required");
  if (!existsSync(d)) die(`run directory not found: ${d}`);
  return d;
}

function statePath(dir) {
  const p = path.join(dir, "state.json");
  if (!existsSync(p)) die(`no state.json in ${dir} — run state.mjs import-plan first`);
  return p;
}

function loadState(dir) {
  return JSON.parse(readFileSync(statePath(dir), "utf8"));
}

/** Atomic — a half-written state.json would strand the run. */
function saveState(dir, s) {
  const p = statePath(dir);
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, "utf8");
  renameSync(tmp, p);
}

/** Optional richer per-step detail from the architect's plan, for the issue body. */
function loadPlan(dir) {
  const p = path.join(dir, "plan.json");
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const steps = Array.isArray(raw) ? raw : raw.steps || [];
    const by = {};
    for (const [i, st] of steps.entries()) {
      by[String(st.id ?? i + 1).padStart(2, "0")] = st;
    }
    return by;
  } catch {
    return {};
  }
}

/**
 * Wave = 1 + the deepest wave among a step's dependencies. This reproduces the
 * batching `state.mjs next` already performs; it does not invent a new schedule.
 */
function computeWaves(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const memo = new Map();
  const waveOf = (id, stack = []) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.includes(id)) die(`dependency cycle through step ${id}`); // state.mjs also checks
    const st = byId.get(id);
    const deps = (st?.deps || []).filter((d) => byId.has(d));
    const w = deps.length ? 1 + Math.max(...deps.map((d) => waveOf(d, [...stack, id]))) : 1;
    memo.set(id, w);
    return w;
  };
  for (const s of steps) s.wave = waveOf(s.id);
  return steps;
}

// ---------------------------------------------------------------------------
// GitHub objects
// ---------------------------------------------------------------------------

function resolveRepo(args) {
  if (typeof args.repo === "string" && args.repo.includes("/")) return args.repo;
  const r = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    allowFail: true,
  });
  if (!r.ok || !r.out) {
    die("could not determine the repository — run inside a git repo with a GitHub remote, or pass --repo owner/name");
  }
  return r.out;
}

function findOrCreateMilestone(repo, title, description, dryRun) {
  const existing = ghJson(["api", `repos/${repo}/milestones?state=all&per_page=100`]);
  const hit = (existing || []).find((m) => m.title === title);
  if (hit) return { number: hit.number, created: false };
  if (dryRun) return { number: null, created: true };
  const made = ghJson([
    "api", `repos/${repo}/milestones`, "--method", "POST",
    "-f", `title=${title}`, "-f", `description=${description}`,
  ]);
  return { number: made.number, created: true };
}

/** Labels are cosmetic; never fail a sync because one could not be created. */
function ensureLabel(repo, name, color) {
  gh(["label", "create", name, "--repo", repo, "--color", color, "--force"], { allowFail: true });
}

function issueBody(step, plan, runSlug) {
  const p = plan || {};
  const L = [];
  if (p.summary || p.description) L.push(String(p.summary || p.description), "");
  if (p.definitionOfDone) {
    L.push("## Definition of done", "");
    const dod = Array.isArray(p.definitionOfDone) ? p.definitionOfDone : [p.definitionOfDone];
    for (const d of dod) L.push(`- [ ] ${d}`);
    L.push("");
  }
  if (p.howToTest) {
    L.push("## How to test", "");
    const ht = Array.isArray(p.howToTest) ? p.howToTest : [p.howToTest];
    for (const h of ht) L.push(`- ${h}`);
    L.push("");
  }
  if (p.constraints) {
    L.push("## Constraints", "");
    const cs = Array.isArray(p.constraints) ? p.constraints : [p.constraints];
    for (const c of cs) L.push(`- ${c}`);
    L.push("");
  }
  L.push("---", "");
  L.push(`| | |`, `|---|---|`);
  L.push(`| Step | \`${step.id}\` |`);
  L.push(`| Wave | ${step.wave} |`);
  L.push(`| Lane | \`${step.lane}\` |`);
  L.push(`| Depends on | ${step.deps?.length ? step.deps.map((d) => `\`${d}\``).join(", ") : "—"} |`);
  L.push("");
  L.push(`<sub>Created by code-pro \`develop-fr\` — run \`${runSlug}\`. The run directory remains`);
  L.push(`the source of truth for execution; this issue mirrors it.</sub>`);
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdSync(args) {
  const dir = runDir(args);
  const state = loadState(dir);
  if (!Array.isArray(state.steps) || !state.steps.length) {
    die("state.json has no steps — run state.mjs import-plan first");
  }
  const dryRun = Boolean(args["dry-run"]);
  const repo = resolveRepo(args);
  const plan = loadPlan(dir);
  const slug = state.slug || path.basename(dir);

  computeWaves(state.steps);

  const waves = [...new Set(state.steps.map((s) => s.wave))].sort((a, b) => a - b);
  const created = [];
  const skipped = [];
  const milestones = {};

  for (const w of waves) {
    const inWave = state.steps.filter((s) => s.wave === w);
    const title = `${slug} — Wave ${w}`;
    const desc = `${inWave.length} step(s), dispatchable in parallel once wave ${w - 1 || "0"} is done.`;
    const ms = findOrCreateMilestone(repo, title, desc, dryRun);
    milestones[w] = { title, number: ms.number, created: ms.created, steps: inWave.length };
  }

  const lanes = [...new Set(state.steps.map((s) => s.lane))];
  if (!dryRun) for (const l of lanes) ensureLabel(repo, `lane:${l}`, "0e8a16");

  for (const step of state.steps) {
    if (step.issue) {
      skipped.push({ id: step.id, issue: step.issue, why: "already mirrored" });
      continue;
    }
    const title = `step-${step.id} · ${step.title}`;
    if (dryRun) {
      created.push({ id: step.id, wave: step.wave, title, issue: null });
      continue;
    }
    const out = gh([
      "issue", "create", "--repo", repo,
      "--title", title,
      "--body", issueBody(step, plan[step.id], slug),
      "--milestone", milestones[step.wave].title,
      "--label", `lane:${step.lane}`,
    ]).out;
    const num = Number((out.match(/\/issues\/(\d+)/) || [])[1]);
    if (!Number.isFinite(num)) die(`could not parse the issue number from: ${out}`);
    step.issue = num;
    step.milestone = milestones[step.wave].number;
    created.push({ id: step.id, wave: step.wave, title, issue: num });
    saveState(dir, state); // persist per issue so a mid-run failure is resumable
  }

  if (!dryRun) saveState(dir, state);
  process.stdout.write(
    `${JSON.stringify({ dryRun, repo, slug, milestones, created, skipped }, null, 2)}\n`,
  );
  if (!created.length && !dryRun) process.exit(EXIT.nothingToDo);
}

function cmdClose(args) {
  const dir = runDir(args);
  const state = loadState(dir);
  const id = String(args.id ?? "").padStart(2, "0");
  const step = state.steps?.find((s) => s.id === id);
  if (!step) die(`no step "${id}" in this run`);
  if (!step.issue) die(`step ${id} has no mirrored issue — run sync first`);
  const repo = resolveRepo(args);
  const comment =
    typeof args.comment === "string"
      ? args.comment
      : `Gates passed. Implemented by \`${step.implementer || "unknown"}\` on lane \`${step.lane}\`.`;
  gh(["issue", "close", String(step.issue), "--repo", repo, "--comment", comment]);
  process.stdout.write(`${JSON.stringify({ closed: step.issue, step: id }, null, 2)}\n`);
}

function cmdList(args) {
  const dir = runDir(args);
  const state = loadState(dir);
  const steps = state.steps || [];
  if (!steps.some((s) => s.wave)) computeWaves(steps);
  const L = [];
  const waves = [...new Set(steps.map((s) => s.wave))].sort((a, b) => a - b);
  for (const w of waves) {
    const inWave = steps.filter((s) => s.wave === w);
    const open = inWave.filter((s) => s.status !== "done").length;
    L.push(`Wave ${w}   (${inWave.length - open}/${inWave.length} done)`);
    for (const s of inWave) {
      L.push(
        `  ${s.status === "done" ? "x" : " "} ${s.id}  ${(s.issue ? `#${s.issue}` : "—").padEnd(6)} ` +
          `${String(s.lane).padEnd(8)} ${s.title}`,
      );
    }
  }
  if (!steps.some((s) => s.issue)) L.push("", "No issues mirrored yet — run: issues.mjs sync --run <dir>");
  process.stdout.write(`${L.join("\n")}\n`);
}

// ---------------------------------------------------------------------------

const USAGE = `issues — mirror an approved plan onto GitHub (milestone per wave, issue per step)

  sync  --run <dir> [--repo owner/name] [--dry-run]
        Derive waves from step dependencies, create a milestone per wave and an issue
        per step, and record the issue number on each step in state.json. Idempotent:
        steps that already carry an issue are skipped.

  close --run <dir> --id NN [--comment "..."]
        Close the issue mirroring one step. Call this after its gates pass.

  list  --run <dir>
        Show the wave / issue / status table for the run.

The run directory stays the source of truth for execution. These issues mirror it, so
GitHub being unreachable costs you the mirror, never the pipeline.
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) out[k] = true;
      else {
        out[k] = n;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = parseArgs(argv.slice(1));

if (!cmd || cmd === "--help" || cmd === "-h") {
  process.stdout.write(USAGE);
  process.exit(cmd ? EXIT.ok : EXIT.usage);
}

switch (cmd) {
  case "sync": cmdSync(args); break;
  case "close": cmdClose(args); break;
  case "list": cmdList(args); break;
  default: die(`unknown command "${cmd}"\n\n${USAGE}`);
}
