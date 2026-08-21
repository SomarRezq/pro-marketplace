#!/usr/bin/env node
// Send a brief to whichever implementer the lane resolves to, and normalize whatever
// comes back into code-pro's Digest format.
//
// This does NOT reimplement delegate-skills — it calls their relays. Its three jobs:
//   1. lane -> implementer (via the delegate-setup fleet config, with degradation)
//   2. locate that implementer's relay.mjs
//   3. normalize its result.json into a Digest the orchestrator can read in ~20 lines
//
//   node dispatch.mjs --brief <file> --lane <name> [--cd <repo>] [--result <file>]
//                     [--session <id>] [--timeout <dur>] [--allow-shell] [--dry-run] [--json]
//
// Exit codes: 0 done · 1 executor failed/needs-changes · 2 usage · 3 no external
// implementer for this lane (orchestrator must use the in-Claude fallback agent).

import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  availableImplementers,
  loadFleet,
  resolveLane,
  IMPLEMENTER_LABELS,
  IMPLEMENTER_CAPS,
  NO_SHELL_NOTE,
  parseArgs,
  run,
  gitRoot,
  die,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  process.stdout.write(
    "Usage: node dispatch.mjs --brief <file> --lane <name> [--cd <repo>] [--result <file>]\n" +
      "                        [--session <id>] [--timeout <dur>] [--allow-shell]\n" +
      "                        [--dry-run] [--json]\n\n" +
      "Exit 3 means no external implementer is available for this lane and the\n" +
      "orchestrator must fall back to the in-Claude subagent for that role.\n\n" +
      "--allow-shell lets an implementer that cannot otherwise run commands do so\n" +
      "(Antigravity: --dangerously-skip-permissions). That is full access, so opt in\n" +
      "only with the user's explicit consent. Without it, such a brief is augmented to\n" +
      "tell the implementer not to run the gates, and the orchestrator runs them.\n"
  );
  process.exit(0);
}

const briefPath = typeof args.brief === "string" ? path.resolve(args.brief) : null;
if (!briefPath) die("dispatch: --brief <file> is required");
if (!existsSync(briefPath)) die(`dispatch: brief not found: ${briefPath}`);
if (!readFileSync(briefPath, "utf8").trim()) die(`dispatch: brief is empty: ${briefPath}`);

const laneName = typeof args.lane === "string" ? args.lane : null;
if (!laneName) die("dispatch: --lane <name> is required");

const cd = path.resolve(typeof args.cd === "string" ? args.cd : process.cwd());
const repo = gitRoot(cd) || cd;

const fleet = loadFleet(cd);
const available = availableImplementers();
const lane = resolveLane(laneName, fleet, available);

if (!lane.ok) {
  const payload = {
    verdict: "unavailable",
    lane: laneName,
    error: lane.error,
    known: lane.known,
    fallbackToClaude: Boolean(lane.fallbackToClaude),
  };
  if (args.json) process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  else {
    process.stderr.write(`dispatch: ${lane.error}\n`);
    if (lane.known) process.stderr.write(`known lanes: ${lane.known.join(", ")}\n`);
    if (lane.fallbackToClaude)
      process.stderr.write("Use the in-Claude fallback agent for this role.\n");
  }
  process.exit(lane.fallbackToClaude ? 3 : 2);
}

// ---- adapt the brief to the implementer's capabilities -------------------
// Antigravity's print mode denies every shell command, then dies with no report the
// moment a brief tells it to run the gates. Rather than lose the work and the
// explanation, tell it not to run them — the orchestrator re-runs gates anyway.
const caps = IMPLEMENTER_CAPS[lane.implementer] || { shell: true };
const allowShell = Boolean(args["allow-shell"]);
let effectiveBrief = briefPath;
let briefAugmented = false;

if (!caps.shell && !allowShell) {
  const augmented = readFileSync(briefPath, "utf8").replace(/\s*$/, "") + NO_SHELL_NOTE;
  // Written next to the result so the exact text sent is auditable, never hidden.
  effectiveBrief = typeof args.result === "string"
    ? path.resolve(args.result).replace(/(\.md)?$/, ".effective-brief.md")
    : path.join(mkdtempSync(path.join(tmpdir(), "code-pro-brief-")), "brief.md");
  mkdirSync(path.dirname(effectiveBrief), { recursive: true });
  writeFileSync(effectiveBrief, augmented, "utf8");
  briefAugmented = true;
}

// ---- build the relay invocation -----------------------------------------
const outDir = mkdtempSync(path.join(tmpdir(), `code-pro-${laneName}-`));
const relayArgs = [lane.relay, "--brief", effectiveBrief, "--cd", repo, "--out-dir", outDir];

// Opt-in only, and only for an implementer that documents such a flag. The relays treat
// this as full access, so it must be the human's explicit choice, never a default.
if (allowShell && caps.shellOptIn) relayArgs.push(caps.shellOptIn);

// The relay resolves its own dials from the fleet config when --lane is usable;
// otherwise we pass the dials explicitly so a default lane still gets its settings.
if (lane.useLaneFlag) {
  relayArgs.push("--lane", laneName);
} else {
  if (lane.dials.model) relayArgs.push("--model", String(lane.dials.model));
  if (lane.dials.effort) relayArgs.push("--effort", String(lane.dials.effort));
  if (lane.dials.variant) relayArgs.push("--variant", String(lane.dials.variant));
}
if (lane.dials.readOnly === true) relayArgs.push("--read-only");
if (typeof args.timeout === "string") relayArgs.push("--timeout", args.timeout);

// Rework continues the SAME external session, so the implementer keeps its context
// and we only pay for the delta brief.
if (typeof args.session === "string" && args.session) {
  relayArgs.push(lane.implementer === "agy" ? "--conversation" : "--session", args.session);
}

if (args["dry-run"]) {
  const preview = {
    dryRun: true,
    lane: laneName,
    implementer: lane.implementer,
    dials: lane.dials,
    shell: caps.shell || allowShell,
    briefAugmented,
    effectiveBrief,
    command: [process.execPath, ...relayArgs],
    degradations: lane.degradations,
  };
  process.stdout.write(
    args.json
      ? JSON.stringify(preview, null, 2) + "\n"
      : `DRY RUN  lane=${laneName} → ${lane.implementer}\n  ${[process.execPath, ...relayArgs].join(" ")}\n`
  );
  process.exit(0);
}

const started = Date.now();
const res = run(process.execPath, relayArgs, { cwd: repo });
const elapsed = Math.round((Date.now() - started) / 1000);

// ---- read what the relay produced ---------------------------------------
const resultJson = path.join(outDir, "result.json");
let raw = null;
if (existsSync(resultJson)) {
  try {
    raw = JSON.parse(readFileSync(resultJson, "utf8"));
  } catch (e) {
    process.stderr.write(`dispatch: result.json is not valid JSON (${e.message})\n`);
  }
}

if (!raw) {
  // A pre-run usage error writes no result file — that is a real failure, not a stall.
  const digest = [
    "## Digest",
    "verdict: blocked",
    `lane: ${laneName}`,
    `implementer: ${lane.implementer}`,
    `error: relay produced no result.json (exit ${res.code})`,
    "open: dispatch failed before the implementer ran — check the relay invocation",
    "",
    "## Relay stderr",
    "",
    "```",
    (res.stderr || "(empty)").trim().slice(0, 4000),
    "```",
  ].join("\n");
  emit(digest, { verdict: "blocked", lane: laneName, implementer: lane.implementer, exitCode: res.code });
  process.exit(1);
}

const sessionId = raw.threadId || raw.conversationId || raw.sessionId || null;
const finalMessage = String(raw.finalMessage || "").trim();
const touched = Array.isArray(raw.touchedFiles) ? raw.touchedFiles : [];

// Prefer the executor's own verdict — the brief asks for it explicitly. Only fall back
// to inferring one from the relay status, so a "needs-decision" is never swallowed.
const stated = finalMessage.match(/^\s*verdict:\s*(done|needs-decision|needs-changes|blocked)\s*$/im);
let verdict = stated ? stated[1].toLowerCase() : null;
if (!verdict) {
  if (raw.status === "completed" && res.code === 0) verdict = "done";
  else if (raw.status === "timeout") verdict = "blocked";
  else verdict = "blocked";
}
if (raw.readOnlyViolation) verdict = "blocked";

const openMatch = finalMessage.match(/^\s*open:\s*(.+)$/im);
const gatesMatch = finalMessage.match(/^\s*gates:\s*(.+)$/im);

const digestLines = [
  "## Digest",
  `verdict: ${verdict}`,
  `lane: ${laneName}`,
  `implementer: ${lane.implementer}${lane.dials.model ? ` (${lane.dials.model})` : ""}`,
  `status: ${raw.status} · exit ${raw.exitCode ?? res.code} · ${elapsed}s`,
  sessionId ? `session: ${sessionId}` : "session: (none reported)",
  `files: ${touched.length ? touched.join(", ") : "none reported"}`,
  `gates: ${gatesMatch ? gatesMatch[1].trim() : "not reported — orchestrator must re-run them"}`,
  `open: ${openMatch ? openMatch[1].trim() : "none"}`,
];
if (raw.readOnlyViolation) digestLines.push("WARNING: read-only lane reported a write violation");
if (briefAugmented)
  digestLines.push("note: implementer cannot run shell — gates were NOT run by it, you must run them");
for (const d of lane.degradations || []) digestLines.push(`degraded: ${d}`);

const body = [
  digestLines.join("\n"),
  "",
  "---",
  "",
  `## Executor report — ${IMPLEMENTER_LABELS[lane.implementer] || lane.implementer}`,
  "",
  finalMessage || "_(the implementer returned no final message)_",
  "",
  "---",
  "",
  "## Raw",
  "",
  "```json",
  JSON.stringify(
    { status: raw.status, exitCode: raw.exitCode, session: sessionId, touchedFiles: touched, artifacts: outDir },
    null,
    2
  ),
  "```",
].join("\n");

emit(body, {
  verdict,
  lane: laneName,
  implementer: lane.implementer,
  session: sessionId,
  files: touched,
  status: raw.status,
  artifacts: outDir,
});

process.exit(verdict === "done" ? 0 : 1);

// -------------------------------------------------------------------------
function emit(fullBody, summary) {
  if (typeof args.result === "string") {
    const target = path.resolve(args.result);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, fullBody.endsWith("\n") ? fullBody : fullBody + "\n", "utf8");
    summary.resultFile = target;
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  // stdout is deliberately ONLY the digest: this is what lands in the orchestrator's
  // context, and keeping it short is the entire point of the pipeline.
  process.stdout.write(fullBody.split("\n---\n")[0].trim() + "\n");
  if (summary.resultFile) process.stdout.write(`\nfull report: ${summary.resultFile}\n`);
}
