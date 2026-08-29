#!/usr/bin/env node
// Detect what the develop-fr pipeline can actually use on this machine, and what it
// will have to degrade to. Writes 01-preflight.json when --out is given.
//
//   node preflight.mjs [--cwd <repo>] [--out <file>] [--json]
//
// Exit codes: 0 = fully delegating, 1 = running degraded, 2 = usage error.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  REQUIRED_LANES,
  IMPLEMENTER_BINARIES,
  IMPLEMENTER_LABELS,
  availableImplementers,
  loadFleet,
  resolveLane,
  findDelegateSetup,
  globalFleetPath,
  parseArgs,
  gitRoot,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  process.stdout.write(
    "Usage: node preflight.mjs [--cwd <repo>] [--out <file>] [--json]\n" +
      "\nReports which implementers are usable, how each pipeline lane resolves,\n" +
      "and every degradation that will be applied. Exit 1 means degraded.\n"
  );
  process.exit(0);
}

const cwd = path.resolve(typeof args.cwd === "string" ? args.cwd : process.cwd());
const available = availableImplementers();
const fleet = loadFleet(cwd);
const setupDir = findDelegateSetup();

const lanes = {};
const degradations = [];
for (const lane of Object.keys(REQUIRED_LANES)) {
  const r = resolveLane(lane, fleet, available);
  lanes[lane] = r;
  for (const d of r.degradations || []) degradations.push(d);
  if (!fleet.lanes[lane]) {
    degradations.push(
      `lane "${lane}" is not in your fleet config — using the plugin default (${
        r.implementer || "in-Claude fallback"
      })`
    );
  }
}

const usable = Object.entries(available)
  .filter(([, v]) => v.usable)
  .map(([k]) => k);

const report = {
  generatedAt: new Date().toISOString(),
  cwd,
  gitRoot: gitRoot(cwd),
  delegateSkillsInstalled: Boolean(setupDir),
  delegateSetupDir: setupDir,
  fleetSource: fleet.source,
  fleetPath: globalFleetPath(),
  usableImplementers: usable,
  implementers: available,
  lanes,
  degradations,
  degraded: degradations.length > 0 || usable.length === 0,
};

if (typeof args.out === "string") {
  mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 2) + "\n", "utf8");
}

if (args.json) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(report.degraded ? 1 : 0);
}

// ---- human summary -------------------------------------------------------
const L = [];
const tick = (ok) => (ok ? "OK  " : "MISS");

L.push("code-pro preflight");
L.push("");
L.push("Implementers");
for (const [key, v] of Object.entries(available)) {
  if (!v.binaryPath && !v.relay) continue; // don't list a wall of CLIs nobody has
  const label = IMPLEMENTER_LABELS[key] || key;
  const bits = [];
  bits.push(v.binaryPath ? `${IMPLEMENTER_BINARIES[key]} on PATH` : `${IMPLEMENTER_BINARIES[key]} NOT on PATH`);
  bits.push(v.relay ? `${key}-delegate installed` : `${key}-delegate MISSING`);
  L.push(`  ${tick(v.usable)} ${label.padEnd(22)} ${bits.join(", ")}`);
}
if (!usable.length) L.push("  (none usable — every phase will fall back to in-Claude subagents)");

L.push("");
L.push(`delegate-skills : ${setupDir ? `OK   ${setupDir}` : "MISS not installed — https://github.com/amElnagdy/delegate-skills"}`);
L.push(`fleet config    : ${fleet.source === "plugin-default" ? "MISS using plugin defaults" : `OK   ${fleet.source}`}`);

L.push("");
L.push("Lanes");
for (const [lane, r] of Object.entries(lanes)) {
  const purpose = REQUIRED_LANES[lane];
  if (!r.ok) {
    L.push(`  MISS ${lane.padEnd(8)} → in-Claude fallback   (${purpose})`);
    continue;
  }
  const dials = Object.entries(r.dials)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const configured = fleet.lanes[lane] ? "" : "  [plugin default]";
  const swapped = r.implementer !== r.configuredImplementer ? `  [was ${r.configuredImplementer}]` : "";
  L.push(
    `  OK   ${lane.padEnd(8)} → ${r.implementer.padEnd(8)} ${dials.padEnd(28)}${configured}${swapped}`
  );
}

const missingLanes = Object.keys(REQUIRED_LANES).filter((l) => !fleet.lanes[l]);
if (missingLanes.length && fleet.source !== "plugin-default") {
  L.push("");
  L.push(`To add the missing lane(s) — ${missingLanes.join(", ")} — run the delegate-setup skill`);
  L.push(`and approve the write, or edit ${globalFleetPath()} directly. Suggested:`);
  L.push("");
  for (const lane of missingLanes) {
    const suggestion =
      lane === "review"
        ? '{ "implementer": "codex", "readOnly": true, "effort": "high" }'
        : lane === "qa"
          ? '{ "implementer": "codex" }'
          : '{ "implementer": "codex" }';
    L.push(`    "${lane}": ${suggestion},`);
  }
}

// Lane backups (delegate-backup plugin) — a SOFT dependency. We read its sidecar
// directly rather than shelling out, so a missing plugin costs one informational line
// instead of a failure. A lane sitting on a backup changes which provider runs the
// work, so it must never be invisible at the top of a run.
const backupsPath = path.join(path.dirname(globalFleetPath()), "lane-backups.json");
if (existsSync(backupsPath)) {
  try {
    const doc = JSON.parse(readFileSync(backupsPath, "utf8"));
    const active = Object.entries(doc.active ?? {});
    if (active.length) {
      L.push("");
      L.push("Lane backups (active)");
      for (const [lane, a] of active) {
        const due = new Date(a.expiresAt).getTime();
        const overdue = due <= Date.now();
        const mins = Math.max(0, Math.round((due - Date.now()) / 60000));
        // v2 chains carry a position; v1 had a single backup and no position.
        const chain = doc.chains?.[lane];
        const pos =
          a.position != null && Array.isArray(chain)
            ? ` [${a.position}/${chain.length - 1}]`
            : "";
        L.push(
          `  ${overdue ? "DUE " : "OK  "} ${lane.padEnd(8)} on ${String(a.wrote?.implementer).padEnd(9)}${pos}` +
            ` → back to ${String(a.original?.implementer).padEnd(9)}` +
            (overdue
              ? "  OVERDUE — run: delegate-backup resolve --all"
              : `  in ${Math.floor(mins / 60)}h ${mins % 60}m`)
        );
      }
    }
  } catch {
    L.push("");
    L.push(`  WARN lane-backups.json is unreadable (${backupsPath})`);
  }
}

L.push("");
if (report.degraded) {
  L.push(`DEGRADED — ${degradations.length} adjustment(s):`);
  for (const d of degradations) L.push(`  - ${d}`);
} else {
  L.push("Fully delegating. Claude is reserved for planning and final review.");
}

process.stdout.write(L.join("\n") + "\n");
process.exit(report.degraded ? 1 : 0);
