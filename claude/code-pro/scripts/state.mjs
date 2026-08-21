#!/usr/bin/env node
// Read and update a develop-fr run's state.json.
//
// This file is the resume anchor: because every artifact lives on disk, the
// orchestrator can be compacted, crash, or be replaced by a fresh session and still
// pick up exactly where it left off.
//
//   node state.mjs latest      --repo <dir>
//   node state.mjs digest      --run <dir>
//   node state.mjs phase       --run <dir> --to <phase>
//   node state.mjs import-plan --run <dir> [--file <plan.json>]
//   node state.mjs step        --run <dir> --id <id> [--status s] [--session s]
//                              [--implementer i] [--lane l] [--note n] [--bump-review]
//   node state.mjs next        --run <dir>
//   node state.mjs checkpoint  --run <dir> [--note n]

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs, die } from "./lib.mjs";

const STATUSES = ["pending", "running", "implemented", "review-changes", "done", "blocked"];
const PHASES = [
  "preflight",
  "planning",
  "approval",
  "implementing",
  "qa",
  "final-review",
  "reporting",
  "done",
];

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = parseArgs(argv.slice(1));

const USAGE = `Read and update a develop-fr run's state.json — the pipeline's resume anchor.

  node state.mjs latest      --repo <dir>
  node state.mjs digest      --run <dir>
  node state.mjs phase       --run <dir> --to <phase>
  node state.mjs import-plan --run <dir> [--file <plan.json>]
  node state.mjs step        --run <dir> --id <id> [--status s] [--session s]
                             [--implementer i] [--lane l] [--note n] [--bump-review]
  node state.mjs next        --run <dir>
  node state.mjs checkpoint  --run <dir> [--note n]

phases   : ${PHASES.join(" -> ")}
statuses : ${STATUSES.join(", ")}
`;

if (!cmd || args.help || args.h) {
  process.stdout.write(USAGE);
  process.exit(cmd ? 0 : 2);
}

function runDirOf() {
  if (typeof args.run !== "string") die("state: --run <dir> is required");
  const dir = path.resolve(args.run);
  if (!existsSync(path.join(dir, "state.json"))) die(`state: no state.json in ${dir}`);
  return dir;
}

function load(dir) {
  return JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8"));
}

function save(dir, state) {
  state.updatedAt = new Date().toISOString();
  writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** Steps whose dependencies are all done — i.e. dispatchable right now, in parallel. */
function readySteps(state) {
  const done = new Set(state.steps.filter((s) => s.status === "done").map((s) => String(s.id)));
  return state.steps.filter(
    (s) => s.status === "pending" && (s.deps || []).every((d) => done.has(String(d)))
  );
}

switch (cmd) {
  case "latest": {
    const repo = path.resolve(typeof args.repo === "string" ? args.repo : process.cwd());
    const runs = path.join(repo, ".code-pro", "runs");
    if (!existsSync(runs)) die(`state: no runs under ${runs}`, 1);
    const dirs = readdirSync(runs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(runs, e.name, "state.json")))
      .map((e) => e.name)
      .sort();
    if (!dirs.length) die(`state: no runs under ${runs}`, 1);
    process.stdout.write(path.join(runs, dirs[dirs.length - 1]) + "\n");
    break;
  }

  case "digest": {
    const dir = runDirOf();
    const s = load(dir);
    const counts = {};
    for (const st of STATUSES) counts[st] = s.steps.filter((x) => x.status === st).length;
    const ready = readySteps(s);
    const L = [];
    L.push(`run       : ${s.runId}${s.dryRun ? "  (DRY RUN)" : ""}`);
    L.push(`repo      : ${s.repo}`);
    L.push(`phase     : ${s.phase}`);
    L.push(
      `steps     : ${counts.done}/${s.steps.length} done` +
        `${counts.running ? `, ${counts.running} running` : ""}` +
        `${counts["review-changes"] ? `, ${counts["review-changes"]} in rework` : ""}` +
        `${counts.blocked ? `, ${counts.blocked} BLOCKED` : ""}`
    );
    if (s.steps.length) {
      L.push("");
      for (const st of s.steps) {
        const mark =
          st.status === "done" ? "x" : st.status === "blocked" ? "!" : st.status === "running" ? ">" : " ";
        const extra = [
          st.lane ? `lane=${st.lane}` : null,
          st.implementer ? st.implementer : null,
          st.reviewRounds ? `reviews=${st.reviewRounds}` : null,
          (st.deps || []).length ? `deps=${st.deps.join(",")}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        L.push(`  [${mark}] ${String(st.id).padEnd(3)} ${String(st.title).slice(0, 58).padEnd(58)} ${extra}`);
      }
    }
    if (ready.length) {
      L.push("");
      L.push(`ready now : ${ready.map((r) => r.id).join(", ")}  (dispatch these in parallel)`);
    }
    if (s.blockers?.length) {
      L.push("");
      L.push("blockers  :");
      for (const b of s.blockers) L.push(`  - ${b}`);
    }
    if (s.notes?.length) {
      L.push("");
      L.push("notes     :");
      for (const n of s.notes.slice(-6)) L.push(`  - ${n}`);
    }
    process.stdout.write(L.join("\n") + "\n");
    break;
  }

  case "phase": {
    const dir = runDirOf();
    const to = typeof args.to === "string" ? args.to : null;
    if (!to || !PHASES.includes(to)) die(`state: --to must be one of ${PHASES.join(", ")}`);
    const s = load(dir);
    s.phase = to;
    save(dir, s);
    process.stdout.write(`phase -> ${to}\n`);
    break;
  }

  case "import-plan": {
    const dir = runDirOf();
    const file = path.resolve(typeof args.file === "string" ? args.file : path.join(dir, "plan.json"));
    if (!existsSync(file)) die(`state: plan file not found: ${file}`);
    let plan;
    try {
      plan = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      die(`state: plan.json is not valid JSON (${e.message})`);
    }
    const steps = Array.isArray(plan) ? plan : plan.steps;
    if (!Array.isArray(steps) || !steps.length) die("state: plan.json has no steps[]");

    const ids = new Set();
    const imported = steps.map((st, i) => {
      const id = String(st.id ?? i + 1).padStart(2, "0");
      if (ids.has(id)) die(`state: duplicate step id "${id}" in plan.json`);
      ids.add(id);
      if (!st.title) die(`state: step "${id}" has no title`);
      return {
        id,
        title: String(st.title),
        deps: (st.deps || []).map((d) => String(d).padStart(2, "0")),
        lane: st.lane || "feature",
        status: "pending",
        implementer: null,
        session: null,
        reviewRounds: 0,
      };
    });
    for (const st of imported) {
      for (const d of st.deps) {
        if (!ids.has(d)) die(`state: step "${st.id}" depends on unknown step "${d}"`);
        if (d === st.id) die(`state: step "${st.id}" depends on itself`);
      }
    }
    // Cycle check — a dependency cycle would silently stall the pipeline forever.
    const seen = new Map();
    const visit = (id, stack) => {
      if (stack.includes(id)) die(`state: dependency cycle: ${[...stack, id].join(" -> ")}`);
      if (seen.get(id)) return;
      seen.set(id, true);
      const st = imported.find((x) => x.id === id);
      for (const d of st.deps) visit(d, [...stack, id]);
    };
    for (const st of imported) visit(st.id, []);

    const s = load(dir);
    s.steps = imported;
    s.phase = "approval";
    save(dir, s);
    process.stdout.write(`imported ${imported.length} steps; phase -> approval\n`);
    break;
  }

  case "step": {
    const dir = runDirOf();
    const id = typeof args.id === "string" ? String(args.id).padStart(2, "0") : null;
    if (!id) die("state: --id is required");
    const s = load(dir);
    const st = s.steps.find((x) => x.id === id);
    if (!st) die(`state: no step "${id}" (have: ${s.steps.map((x) => x.id).join(", ") || "none"})`);
    if (typeof args.status === "string") {
      if (!STATUSES.includes(args.status)) die(`state: --status must be one of ${STATUSES.join(", ")}`);
      st.status = args.status;
    }
    if (typeof args.session === "string") st.session = args.session;
    if (typeof args.implementer === "string") st.implementer = args.implementer;
    if (typeof args.lane === "string") st.lane = args.lane;
    if (args["bump-review"]) st.reviewRounds = (st.reviewRounds || 0) + 1;
    if (typeof args.note === "string") {
      s.notes = s.notes || [];
      s.notes.push(`step ${id}: ${args.note}`);
    }
    if (st.status === "blocked") {
      s.blockers = s.blockers || [];
      const msg = `step ${id} (${st.title})${typeof args.note === "string" ? `: ${args.note}` : ""}`;
      if (!s.blockers.includes(msg)) s.blockers.push(msg);
    }
    save(dir, s);
    process.stdout.write(`step ${id} -> ${st.status}${st.session ? ` (session ${st.session})` : ""}\n`);
    break;
  }

  case "next": {
    const dir = runDirOf();
    const s = load(dir);
    const ready = readySteps(s);
    if (!ready.length) {
      const left = s.steps.filter((x) => x.status !== "done");
      process.stdout.write(left.length ? "none ready (waiting on in-flight or blocked steps)\n" : "all steps done\n");
      process.exit(left.length ? 1 : 0);
    }
    for (const r of ready) process.stdout.write(`${r.id}\t${r.lane}\t${r.title}\n`);
    break;
  }

  case "checkpoint": {
    const dir = runDirOf();
    const s = load(dir);
    const done = s.steps.filter((x) => x.status === "done").length;
    s.checkpoints = s.checkpoints || [];
    s.checkpoints.push({
      at: new Date().toISOString(),
      phase: s.phase,
      stepsDone: done,
      of: s.steps.length,
      note: typeof args.note === "string" ? args.note : null,
    });
    save(dir, s);
    process.stdout.write(
      `Checkpoint: ${done}/${s.steps.length} steps done, phase ${s.phase}. State saved to\n` +
        `${path.join(dir, "state.json")}\n` +
        `Safe to /compact — resume with: node state.mjs digest --run "${dir}"\n`
    );
    break;
  }

  default:
    die(`state: unknown command "${cmd}"`);
}
