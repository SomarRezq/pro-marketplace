#!/usr/bin/env node
// Mirror an approved plan onto GitHub: one milestone per wave, one issue per step.
//
//   node issues.mjs sync   --run <dir> [--repo owner/name] [--dry-run]
//   node issues.mjs start  --run <dir> --wave N
//   node issues.mjs push   --run <dir> (--waves 1,2 | --through N) [--commit <sha>]
//   node issues.mjs list   --run <dir>
//   node issues.mjs verify --run <dir>
//
// Node built-ins only — this ships inside a plugin and must never need an install.
//
// Design notes:
//
//  * The run directory is the execution source of truth. `state.mjs` drives scheduling,
//    resume and checkpoints; GitHub mirrors it. An unreachable GitHub costs the mirror,
//    never the run.
//  * The mapping lives in its own file, `$RUN/issues.json`, keyed by step id — NOT on
//    the steps in state.json. `state.mjs import-plan` rebuilds steps[] from plan.json,
//    so anything stored there is lost on a re-plan. Keeping it separate means a re-plan
//    keeps every existing issue and only new step ids get new issues.
//  * Nothing is ever reconciled by reading GitHub. Every write is caused by a local
//    state transition, so the two cannot drift through normal use. `verify` exists for
//    the abnormal case and costs exactly one read, only when asked.
//  * Three states, deliberately few. `in-progress` is set once when a WAVE starts and is
//    never touched again — not for reviews, not for rework. The next and last transition
//    is closing at push.
//
// Exit codes: 0 ok, 1 usage/error, 2 gh unavailable, 3 nothing to do.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const MAP_VERSION = "code-pro-issues.v1";
const LABEL_IN_PROGRESS = "status:in-progress";
const EXIT = { ok: 0, usage: 1, noGh: 2, nothingToDo: 3 };

function die(msg, code = EXIT.usage) {
  process.stderr.write(`issues: ${msg}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// gh
// ---------------------------------------------------------------------------

/**
 * Resolve the gh binary. A freshly installed gh is absent from an already-running
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
  const e = process.env;
  const candidates =
    process.platform === "win32"
      ? [
          `${e.ProgramFiles}\\GitHub CLI\\gh.exe`,
          `${e["ProgramFiles(x86)"]}\\GitHub CLI\\gh.exe`,
          `${e.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`,
          `${e.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\gh.exe`,
          `${e.USERPROFILE}\\scoop\\shims\\gh.exe`,
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
// Run state + mapping
// ---------------------------------------------------------------------------

function runDir(args) {
  const d = args.run;
  if (typeof d !== "string" || !d) die("--run <dir> is required");
  if (!existsSync(d)) die(`run directory not found: ${d}`);
  return d;
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function loadState(dir) {
  const p = path.join(dir, "state.json");
  if (!existsSync(p)) die(`no state.json in ${dir} — run state.mjs import-plan first`);
  const s = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(s.steps) || !s.steps.length) {
    die("state.json has no steps — run state.mjs import-plan first");
  }
  return s;
}

function mapPath(dir) {
  return path.join(dir, "issues.json");
}

function loadMap(dir) {
  const p = mapPath(dir);
  if (!existsSync(p)) return { version: MAP_VERSION, repo: null, slug: null, milestones: {}, steps: {} };
  const m = JSON.parse(readFileSync(p, "utf8"));
  if (m.version !== MAP_VERSION) die(`${p} has version "${m.version}", expected "${MAP_VERSION}"`);
  m.milestones ??= {};
  m.steps ??= {};
  return m;
}

const saveMap = (dir, m) => writeAtomic(mapPath(dir), m);

/** Optional richer per-step detail from the architect's plan, for the issue body. */
function loadPlan(dir) {
  const p = path.join(dir, "plan.json");
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const steps = Array.isArray(raw) ? raw : raw.steps || [];
    const by = {};
    for (const [i, st] of steps.entries()) by[String(st.id ?? i + 1).padStart(2, "0")] = st;
    return by;
  } catch {
    return {};
  }
}

/**
 * Wave = 1 + the deepest wave among a step's dependencies. This reproduces the batch
 * `state.mjs next` already dispatches in parallel; it does not invent a new schedule.
 */
function computeWaves(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const memo = new Map();
  const waveOf = (id, stack = []) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.includes(id)) die(`dependency cycle through step ${id}`);
    const deps = (byId.get(id)?.deps || []).filter((d) => byId.has(d));
    const w = deps.length ? 1 + Math.max(...deps.map((d) => waveOf(d, [...stack, id]))) : 1;
    memo.set(id, w);
    return w;
  };
  for (const s of steps) s.wave = waveOf(s.id);
  return steps;
}

function resolveRepo(args, map) {
  if (typeof args.repo === "string" && args.repo.includes("/")) return args.repo;
  if (map.repo) return map.repo; // recorded at sync — avoids a call on every later command
  const r = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    allowFail: true,
  });
  if (!r.ok || !r.out) {
    die("could not determine the repository — run inside a git repo with a GitHub remote, or pass --repo owner/name");
  }
  return r.out;
}

function issueBody(step, plan, slug) {
  const p = plan || {};
  const L = [];
  if (p.summary || p.description) L.push(String(p.summary || p.description), "");
  const section = (heading, val, bullet = "-") => {
    if (!val) return;
    L.push(`## ${heading}`, "");
    for (const v of Array.isArray(val) ? val : [val]) L.push(`${bullet} ${v}`);
    L.push("");
  };
  section("Definition of done", p.definitionOfDone, "- [ ]");
  section("How to test", p.howToTest);
  section("Constraints", p.constraints);
  L.push("---", "", "| | |", "|---|---|");
  L.push(`| Step | \`${step.id}\` |`);
  L.push(`| Wave | ${step.wave} |`);
  L.push(`| Lane | \`${step.lane}\` |`);
  L.push(`| Depends on | ${step.deps?.length ? step.deps.map((d) => `\`${d}\``).join(", ") : "—"} |`);
  L.push("");
  L.push(`<sub>Created by code-pro \`develop-fr\` — run \`${slug}\`. The run directory remains`);
  L.push("the source of truth for execution; this issue mirrors it.</sub>");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdSync(args) {
  const dir = runDir(args);
  const state = loadState(dir);
  const map = loadMap(dir);
  const dryRun = Boolean(args["dry-run"]);
  const repo = resolveRepo(args, map);
  const plan = loadPlan(dir);
  const slug = state.slug || path.basename(dir);

  computeWaves(state.steps);
  const waves = [...new Set(state.steps.map((s) => s.wave))].sort((a, b) => a - b);

  // Milestone numbers are recorded, so a re-sync needs no read at all. The list call
  // happens only for a wave we have never created, and only to avoid a duplicate title.
  const needLookup = waves.some((w) => !map.milestones[w]);
  const existing = needLookup && !dryRun ? ghJson(["api", `repos/${repo}/milestones?state=all&per_page=100`]) || [] : [];

  const milestones = {};
  for (const w of waves) {
    const title = `${slug} — Wave ${w}`;
    if (map.milestones[w]) {
      milestones[w] = { title, number: map.milestones[w], created: false };
      continue;
    }
    if (dryRun) {
      milestones[w] = { title, number: null, created: true };
      continue;
    }
    const hit = existing.find((m) => m.title === title);
    const number =
      hit?.number ??
      ghJson([
        "api", `repos/${repo}/milestones`, "--method", "POST",
        "-f", `title=${title}`,
        "-f", `description=${state.steps.filter((s) => s.wave === w).length} step(s), dispatchable in parallel.`,
      ]).number;
    map.milestones[w] = number;
    milestones[w] = { title, number, created: !hit };
  }

  if (!dryRun) {
    gh(["label", "create", LABEL_IN_PROGRESS, "--repo", repo, "--color", "fbca04", "--force"], { allowFail: true });
    for (const lane of new Set(state.steps.map((s) => s.lane))) {
      gh(["label", "create", `lane:${lane}`, "--repo", repo, "--color", "0e8a16", "--force"], { allowFail: true });
    }
  }

  const created = [];
  const skipped = [];
  for (const step of state.steps) {
    const known = map.steps[step.id];
    if (known?.issue) {
      skipped.push({ id: step.id, issue: known.issue, why: "already mirrored" });
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
    map.steps[step.id] = { issue: num, wave: step.wave, state: "pending" };
    created.push({ id: step.id, wave: step.wave, title, issue: num });
    map.repo = repo;
    map.slug = slug;
    saveMap(dir, map); // persist per issue so a mid-run failure resumes, never duplicates
  }

  if (!dryRun) {
    map.repo = repo;
    map.slug = slug;
    saveMap(dir, map);
  }
  process.stdout.write(`${JSON.stringify({ dryRun, repo, slug, milestones, created, skipped }, null, 2)}\n`);
  if (!created.length && !dryRun) process.exit(EXIT.nothingToDo);
}

/**
 * Mark a whole wave in progress, once, as its first step is dispatched.
 * Set here and never touched again — rework and review rounds do not move it.
 * `gh issue edit` accepts several numbers, so this is one call per wave.
 */
function cmdStart(args) {
  const dir = runDir(args);
  const map = loadMap(dir);
  const wave = Number(args.wave);
  if (!Number.isFinite(wave)) die("start needs --wave <n>");
  const repo = resolveRepo(args, map);

  const targets = Object.entries(map.steps).filter(
    ([, v]) => v.wave === wave && v.state === "pending" && v.issue,
  );
  if (!targets.length) {
    process.stdout.write(`${JSON.stringify({ wave, marked: [], why: "nothing pending in this wave" }, null, 2)}\n`);
    process.exit(EXIT.nothingToDo);
  }
  const numbers = targets.map(([, v]) => String(v.issue));
  const marked = targets.map(([id, v]) => ({ id, issue: v.issue }));
  if (args["dry-run"]) {
    process.stdout.write(`${JSON.stringify({ dryRun: true, wave, calls: 1, wouldMark: marked }, null, 2)}\n`);
    return;
  }
  gh(["issue", "edit", ...numbers, "--repo", repo, "--add-label", LABEL_IN_PROGRESS]);
  for (const [id] of targets) map.steps[id].state = "in-progress";
  saveMap(dir, map);
  process.stdout.write(`${JSON.stringify({ wave, calls: 1, marked }, null, 2)}\n`);
}

/**
 * Close every issue in the given waves, because the work is now pushed.
 * Closing is explicit rather than relying on a commit keyword: GitHub only auto-closes
 * from commits on the DEFAULT branch, and this pipeline works on whatever branch you
 * are already on. An explicit close behaves the same everywhere.
 */
function cmdPush(args) {
  const dir = runDir(args);
  const map = loadMap(dir);
  const repo = resolveRepo(args, map);

  let waves;
  if (typeof args.waves === "string") waves = args.waves.split(",").map((n) => Number(n.trim()));
  else if (args.through !== undefined) {
    const t = Number(args.through);
    if (!Number.isFinite(t)) die("--through needs a number");
    waves = [...new Set(Object.values(map.steps).map((v) => v.wave))].filter((w) => w <= t);
  } else die("push needs --waves 1,2 or --through N");
  if (waves.some((w) => !Number.isFinite(w))) die("--waves must be a comma-separated list of numbers");

  const targets = Object.entries(map.steps).filter(
    ([, v]) => waves.includes(v.wave) && v.state !== "closed" && v.issue,
  );
  if (!targets.length) {
    process.stdout.write(`${JSON.stringify({ waves, closed: [], why: "nothing open in those waves" }, null, 2)}\n`);
    process.exit(EXIT.nothingToDo);
  }

  const sha = typeof args.commit === "string" ? args.commit : null;
  const comment = sha ? `Pushed in ${sha}.` : "Pushed to the working branch.";

  if (args["dry-run"]) {
    process.stdout.write(
      `${JSON.stringify(
        { dryRun: true, waves, calls: targets.length, comment,
          wouldClose: targets.map(([id, v]) => ({ id, issue: v.issue, wave: v.wave })) },
        null, 2,
      )}\n`,
    );
    return;
  }

  const closed = [];
  for (const [id, v] of targets) {
    gh(["issue", "close", String(v.issue), "--repo", repo, "--comment", comment]);
    map.steps[id].state = "closed";
    saveMap(dir, map); // per issue: a failure halfway leaves an accurate map
    closed.push({ id, issue: v.issue, wave: v.wave });
  }
  process.stdout.write(`${JSON.stringify({ waves, calls: closed.length, closed }, null, 2)}\n`);
}

/** Local view. Costs nothing — reads the mapping, never GitHub. */
function cmdList(args) {
  const dir = runDir(args);
  const state = loadState(dir);
  const map = loadMap(dir);
  computeWaves(state.steps);

  const L = [];
  const waves = [...new Set(state.steps.map((s) => s.wave))].sort((a, b) => a - b);
  for (const w of waves) {
    const inWave = state.steps.filter((s) => s.wave === w);
    const closed = inWave.filter((s) => map.steps[s.id]?.state === "closed").length;
    L.push(`Wave ${w}   (${closed}/${inWave.length} closed)`);
    for (const s of inWave) {
      const m = map.steps[s.id];
      const mark = m?.state === "closed" ? "x" : m?.state === "in-progress" ? ">" : " ";
      L.push(
        `  [${mark}] ${s.id}  ${(m?.issue ? `#${m.issue}` : "—").padEnd(6)} ` +
          `${String(m?.state || "not mirrored").padEnd(13)} ${String(s.lane).padEnd(8)} ${s.title}`,
      );
    }
  }
  L.push("");
  L.push("  [ ] pending    [>] in-progress    [x] closed (pushed)");
  if (!Object.keys(map.steps).length) L.push("", "Not mirrored yet — run: issues.mjs sync --run <dir>");
  process.stdout.write(`${L.join("\n")}\n`);
}

/**
 * Opt-in drift check. One read for the whole run. Reports mismatches; never fixes them,
 * because a human closing an issue by hand is a decision, not an error to undo.
 */
function cmdVerify(args) {
  const dir = runDir(args);
  const map = loadMap(dir);
  const repo = resolveRepo(args, map);
  const nums = Object.values(map.steps).map((v) => v.issue).filter(Boolean);
  if (!nums.length) die("nothing mirrored yet", EXIT.nothingToDo);

  const remote = ghJson([
    "issue", "list", "--repo", repo, "--state", "all", "--limit", "200",
    "--json", "number,state,labels",
  ]) || [];
  const byNum = new Map(remote.map((i) => [i.number, i]));

  const drift = [];
  for (const [id, v] of Object.entries(map.steps)) {
    const r = byNum.get(v.issue);
    if (!r) {
      drift.push({ id, issue: v.issue, local: v.state, remote: "not found" });
      continue;
    }
    const remoteClosed = r.state === "CLOSED";
    const remoteInProgress = (r.labels || []).some((l) => l.name === LABEL_IN_PROGRESS);
    const expectedClosed = v.state === "closed";
    const expectedInProgress = v.state === "in-progress";
    if (remoteClosed !== expectedClosed || (!remoteClosed && remoteInProgress !== expectedInProgress)) {
      drift.push({
        id, issue: v.issue, local: v.state,
        remote: remoteClosed ? "closed" : remoteInProgress ? "in-progress" : "pending",
      });
    }
  }
  process.stdout.write(`${JSON.stringify({ repo, calls: 1, checked: nums.length, drift }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------

const USAGE = `issues — mirror an approved plan onto GitHub (milestone per wave, issue per step)

  sync   --run <dir> [--repo owner/name] [--dry-run]
         Create a milestone per wave and an issue per step. Idempotent: only step ids
         absent from issues.json get an issue, so a re-plan keeps existing tickets.

  start  --run <dir> --wave N
         Mark every pending issue in wave N as in progress. Call this once, as the
         wave's first step is dispatched. One gh call for the whole wave.

  push   --run <dir> (--waves 1,2 | --through N) [--commit <sha>]
         Close the issues for those waves, because the work is now pushed. Waves that
         had to wait for others can be closed together in a single command.

  list   --run <dir>      Local view: wave, issue, state. Costs no API calls.
  verify --run <dir>      Opt-in drift check against GitHub. Exactly one read.

State: pending -> in-progress (wave start) -> closed (push). in-progress is set once and
never revisited; review rounds and rework do not move it.

Works on whatever branch you are on. No branches are created, no PRs, no merges.
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) out[k] = true;
      else { out[k] = n; i++; }
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
  case "start": cmdStart(args); break;
  case "push": cmdPush(args); break;
  case "list": cmdList(args); break;
  case "verify": cmdVerify(args); break;
  default: die(`unknown command "${cmd}"\n\n${USAGE}`);
}
