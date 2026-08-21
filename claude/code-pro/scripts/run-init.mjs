#!/usr/bin/env node
// Create a develop-fr run directory and seed its state.json.
//
//   node run-init.mjs --slug <slug> [--cwd <repo>] [--request <file|->] [--dry-run]
//
// Prints the absolute run directory on stdout (last line), so the orchestrator can
// capture it in one shot. Idempotently adds .code-pro/ to the repo's .gitignore.

import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, gitRoot, die } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  process.stdout.write(
    "Usage: node run-init.mjs --slug <slug> [--cwd <repo>] [--request <file|->] [--dry-run]\n"
  );
  process.exit(0);
}

const slugRaw = typeof args.slug === "string" ? args.slug : "";
if (!slugRaw.trim()) die("run-init: --slug is required (a short kebab-case name for this feature)");

const slug =
  slugRaw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "run";

const cwd = path.resolve(typeof args.cwd === "string" ? args.cwd : process.cwd());
const repo = gitRoot(cwd) || cwd;

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const runId = `${stamp}-${slug}`;
const runDir = path.join(repo, ".code-pro", "runs", runId);
if (existsSync(runDir)) die(`run-init: ${runDir} already exists`);

mkdirSync(path.join(runDir, "steps"), { recursive: true });

// --- the feature request, verbatim ---------------------------------------
let request = "";
if (args.request === "-") {
  request = readFileSync(0, "utf8");
} else if (typeof args.request === "string") {
  if (!existsSync(args.request)) die(`run-init: --request file not found: ${args.request}`);
  request = readFileSync(args.request, "utf8");
}
writeFileSync(
  path.join(runDir, "00-request.md"),
  `# Feature request\n\n_Captured ${now.toISOString()}_\n\n${request.trim() || "_(not supplied at init — the orchestrator must fill this in before planning)_"}\n`,
  "utf8"
);

// --- state ---------------------------------------------------------------
const state = {
  version: "code-pro-run.v1",
  runId,
  runDir,
  repo,
  slug,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  phase: "preflight",
  dryRun: Boolean(args["dry-run"]),
  steps: [],
  checkpoints: [],
  notes: [],
};
writeFileSync(path.join(runDir, "state.json"), JSON.stringify(state, null, 2) + "\n", "utf8");

// --- keep run artifacts out of the user's commits ------------------------
const gi = path.join(repo, ".gitignore");
const entry = ".code-pro/";
let added = false;
try {
  const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const has = current
    .split(/\r?\n/)
    .some((l) => l.trim() === entry || l.trim() === ".code-pro" || l.trim() === "/.code-pro/");
  if (!has) {
    const prefix = current.length && !current.endsWith("\n") ? "\n" : "";
    appendFileSync(gi, `${prefix}\n# code-pro run artifacts\n${entry}\n`, "utf8");
    added = true;
  }
} catch (e) {
  process.stderr.write(`run-init: could not update .gitignore (${e.message})\n`);
}

process.stderr.write(
  `run-init: created ${runId}${state.dryRun ? " (dry run)" : ""}` +
    `${added ? `, added ${entry} to .gitignore` : ""}\n`
);
process.stdout.write(runDir + "\n");
