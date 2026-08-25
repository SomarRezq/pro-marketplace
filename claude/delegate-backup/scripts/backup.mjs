#!/usr/bin/env node
// delegate-backup — swap an exhausted lane to its configured backup, and put it back
// when the provider's quota window resets.
//
// Node built-ins only — this ships inside a plugin and must never need an install.
//
// Design constraints that shaped this file:
//
//  * `config.json` is delegate-skills' document and stays a valid `delegate-fleet.v1`
//    file at all times. Every piece of state this feature needs lives in the sidecar
//    `lane-backups.json`, so a delegate-skills upgrade can never collide with us.
//  * One backup per lane. When the backup is exhausted too there is nowhere left to
//    go, so `apply` refuses and tells the orchestrator to ask the user. It never
//    cascades silently.
//  * Restores are clobber-safe: we only put a lane back if it still holds exactly what
//    we wrote. A hand-edit since the swap wins over us.
//  * Expiry is recorded as a timestamp, so a lost or never-fired scheduled task cannot
//    strand a lane on its backup — `resolve --all` catches it on the next preflight.
//
// This script cannot create or delete scheduled tasks; those are MCP tools only the
// orchestrator can call. `apply` therefore prints the exact task spec to create, and
// `resolve` prints the task ids to delete. The skill wires those two ends together.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BACKUPS_VERSION = "delegate-backups.v1";
const FLEET_VERSION = "delegate-fleet.v1";

/** Exit codes callers branch on. Keep these stable — the skill documents them. */
const EXIT = {
  ok: 0,
  usage: 1,
  noBackup: 2, // lane has no backup configured
  nothingToDo: 3, // resolve found nothing due
  exhausted: 4, // lane already on its backup — no further fallback
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** delegate-skills' global config directory. Mirrors its own resolution order. */
function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg && xdg.trim()
    ? path.join(xdg, "delegate-skills")
    : path.join(homedir(), ".config", "delegate-skills");
}

const FLEET_PATH = path.join(configDir(), "config.json");
const BACKUPS_PATH = path.join(configDir(), "lane-backups.json");
const TASKS_DIR = path.join(homedir(), ".claude", "scheduled-tasks");

/** Scheduled-task id for a lane. Deterministic, so re-applying targets the same task. */
function taskIdFor(lane) {
  return `delegate-restore-${lane}`;
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    fail(`${file} is not valid JSON (${err.message})`);
  }
}

/** Write atomically — a half-written lane config would break every dispatch. */
function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function loadFleet() {
  const fleet = readJson(FLEET_PATH, null);
  if (!fleet) fail(`no delegate-skills config at ${FLEET_PATH} — run delegate-setup first`);
  if (fleet.version !== FLEET_VERSION) {
    fail(`${FLEET_PATH} has version "${fleet.version}", expected "${FLEET_VERSION}"`);
  }
  if (!fleet.lanes || typeof fleet.lanes !== "object") fail(`${FLEET_PATH} has no lanes object`);
  return fleet;
}

function loadBackups() {
  const doc = readJson(BACKUPS_PATH, {
    version: BACKUPS_VERSION,
    backups: {},
    active: {},
    history: [],
  });
  doc.version ??= BACKUPS_VERSION;
  doc.backups ??= {};
  doc.active ??= {};
  doc.history ??= [];
  if (doc.version !== BACKUPS_VERSION) {
    fail(`${BACKUPS_PATH} has version "${doc.version}", expected "${BACKUPS_VERSION}"`);
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(msg, code = EXIT.usage) {
  process.stderr.write(`delegate-backup: ${msg}\n`);
  process.exit(code);
}

/**
 * Parse `--until`. Accepts a provider-style duration ("71h37m", "5h", "90m", "45s")
 * or an absolute ISO 8601 timestamp. Providers report the reset window in their
 * exhaustion message, so the duration form is what callers normally have.
 */
function parseUntil(value) {
  if (!value) fail("--until is required (e.g. 71h37m, 5h, or an ISO timestamp)");
  const duration = /^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i.exec(
    value.trim(),
  );
  if (duration && duration.slice(1).some(Boolean)) {
    const [, d, h, m, s] = duration;
    const ms =
      (Number(d || 0) * 86400 + Number(h || 0) * 3600 + Number(m || 0) * 60 + Number(s || 0)) * 1000;
    if (ms <= 0) fail(`--until "${value}" is not a positive duration`);
    return new Date(Date.now() + ms);
  }
  const abs = new Date(value);
  if (Number.isNaN(abs.getTime())) fail(`--until "${value}" is neither a duration nor a timestamp`);
  if (abs.getTime() <= Date.now()) fail(`--until "${value}" is in the past`);
  return abs;
}

/** Strip bookkeeping keys delegate-skills never wrote, so comparisons are apples to apples. */
function laneDials(lane) {
  const { source, ...rest } = lane ?? {};
  return rest;
}

/** Stable stringify for the clobber-safety comparison. */
function sameLane(a, b) {
  const norm = (o) =>
    JSON.stringify(
      Object.fromEntries(Object.entries(laneDials(o)).sort(([x], [y]) => x.localeCompare(y))),
    );
  return norm(a) === norm(b);
}

function humanRemaining(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * ISO 8601 with the machine's local UTC offset. `create_scheduled_task` wants an
 * offset-qualified timestamp, and a bare `toISOString()` (always Z) is easy to
 * misread when the user reasons about it in local time.
 */
function isoLocal(date) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

function parseArgs(argv) {
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Swap one lane onto its configured backup and record how to undo it.
 * Prints the scheduled-task spec for the orchestrator to create.
 */
function cmdApply(args) {
  const lane = args.lane || args._[0];
  if (!lane) fail("apply needs --lane <name>");

  const fleet = loadFleet();
  const doc = loadBackups();

  const current = fleet.lanes[lane];
  if (!current) fail(`lane "${lane}" is not in ${FLEET_PATH}`);

  // Depth 1: if this lane is already on its backup there is no further fallback.
  // Refuse loudly rather than cascade — the user decides what happens next.
  const active = doc.active[lane];
  if (active) {
    process.stderr.write(
      `lane "${lane}": primary (${active.original.implementer}) and backup ` +
        `(${active.wrote.implementer}) are both exhausted.\n` +
        `No further fallback is configured. Scheduled restore: ${active.expiresAt} ` +
        `(${humanRemaining(active.expiresAt)}).\n` +
        `This needs a decision from the user — do not swap again automatically.\n`,
    );
    process.exit(EXIT.exhausted);
  }

  const backup = doc.backups[lane];
  if (!backup) {
    process.stderr.write(
      `lane "${lane}" has no backup configured in ${BACKUPS_PATH}.\n` +
        `Add one under "backups", then re-run.\n`,
    );
    process.exit(EXIT.noBackup);
  }
  if (typeof backup.implementer !== "string" || !backup.implementer) {
    fail(`backup for lane "${lane}" has no implementer`);
  }
  if (sameLane(backup, current)) {
    fail(`backup for lane "${lane}" is identical to its current config — nothing to swap to`);
  }

  const expiresAt = parseUntil(args.until);
  const original = laneDials(current);
  const wrote = laneDials(backup);

  if (args["dry-run"]) {
    process.stdout.write(
      `${JSON.stringify(
        { dryRun: true, lane, from: original, to: wrote, expiresAt: isoLocal(expiresAt) },
        null,
        2,
      )}\n`,
    );
    return;
  }

  fleet.lanes[lane] = { ...wrote };
  writeJson(FLEET_PATH, fleet);

  doc.active[lane] = {
    original,
    wrote,
    appliedAt: isoLocal(new Date()),
    expiresAt: isoLocal(expiresAt),
    reason: typeof args.reason === "string" ? args.reason : "",
    taskId: taskIdFor(lane),
  };
  writeJson(BACKUPS_PATH, doc);

  // The orchestrator creates the task; we only describe it. Keeping the prompt to a
  // single command is deliberate — a scheduled run starts with no context, so there
  // must be nothing for it to interpret.
  const spec = {
    lane,
    swapped: { from: original, to: wrote },
    expiresAt: isoLocal(expiresAt),
    scheduledTask: {
      taskId: taskIdFor(lane),
      description: `Restore delegate lane "${lane}" from its backup once the quota window resets`,
      fireAt: isoLocal(expiresAt),
      notifyOnCompletion: true,
      prompt:
        `Run this exact command and report its output verbatim:\n\n` +
        `node "${path.resolve(process.argv[1])}" resolve --lane ${lane}\n\n` +
        `Then delete this scheduled task (taskId: ${taskIdFor(lane)}). ` +
        `If deleting is not possible, stop — the task is one-shot and will not fire again.`,
    },
  };
  process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
}

/**
 * Put lanes back. With --lane, restores that lane regardless of clock (the scheduled
 * task fired). With --all, restores every lane whose window has passed — the safety
 * net that stops a lost task from stranding a lane forever.
 */
function cmdResolve(args) {
  const doc = loadBackups();
  const fleet = loadFleet();
  const now = Date.now();

  let lanes;
  if (args.lane && typeof args.lane === "string") lanes = [args.lane];
  else if (args.all || args._.length === 0) {
    lanes = Object.keys(doc.active).filter(
      (l) => args.force || new Date(doc.active[l].expiresAt).getTime() <= now,
    );
  } else lanes = args._;

  const restored = [];
  const skipped = [];

  for (const lane of lanes) {
    const active = doc.active[lane];
    if (!active) {
      skipped.push({ lane, why: "no active backup" });
      continue;
    }
    if (!args.force && !args.lane && new Date(active.expiresAt).getTime() > now) {
      skipped.push({ lane, why: `not due for ${humanRemaining(active.expiresAt)}` });
      continue;
    }

    // Clobber safety: only undo our own edit. If the lane changed since we wrote it,
    // someone made a deliberate choice and it outranks our restore.
    const current = fleet.lanes[lane];
    if (current && !sameLane(current, active.wrote)) {
      skipped.push({ lane, why: "lane changed since the swap — leaving it alone" });
      delete doc.active[lane];
      doc.history.push({ ...active, lane, restoredAt: isoLocal(new Date()), outcome: "abandoned" });
      continue;
    }

    fleet.lanes[lane] = { ...active.original };
    delete doc.active[lane];
    doc.history.push({ ...active, lane, restoredAt: isoLocal(new Date()), outcome: "restored" });
    restored.push({ lane, to: active.original, taskId: active.taskId });
  }

  if (restored.length) writeJson(FLEET_PATH, fleet);
  if (restored.length || skipped.some((s) => s.why.startsWith("lane changed"))) {
    writeJson(BACKUPS_PATH, doc);
  }

  // Prune the task folders we created. `delete_scheduled_task` leaves SKILL.md behind
  // by design, so without this they accumulate.
  const prunedDirs = [];
  for (const r of restored) {
    const dir = path.join(TASKS_DIR, r.taskId);
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        prunedDirs.push(dir);
      } catch {
        /* leaving a stale folder is harmless — never fail a restore over it */
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      { restored, skipped, prunedDirs, deleteTaskIds: restored.map((r) => r.taskId) },
      null,
      2,
    )}\n`,
  );
  if (!restored.length) process.exit(EXIT.nothingToDo);
}

/** What is swapped right now, what it costs, and when it comes back. */
function cmdStatus(args) {
  const doc = loadBackups();
  const fleet = loadFleet();

  const active = Object.entries(doc.active).map(([lane, a]) => ({
    lane,
    on: a.wrote.implementer,
    restoreTo: a.original.implementer,
    expiresAt: a.expiresAt,
    remaining: humanRemaining(a.expiresAt),
    overdue: new Date(a.expiresAt).getTime() <= Date.now(),
    reason: a.reason,
  }));

  const configured = Object.entries(doc.backups).map(([lane, b]) => ({
    lane,
    backup: b.implementer,
    inFleet: Boolean(fleet.lanes[lane]),
  }));

  const lanesWithoutBackup = Object.keys(fleet.lanes).filter((l) => !doc.backups[l]);

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ active, configured, lanesWithoutBackup, path: BACKUPS_PATH }, null, 2)}\n`,
    );
    return;
  }

  const L = [];
  L.push("delegate-backup status");
  L.push("");
  if (!active.length) L.push("  No lane is on a backup right now.");
  else {
    L.push("  Active backups");
    for (const a of active) {
      L.push(
        `    ${a.lane.padEnd(9)} on ${a.on.padEnd(10)} → restores to ${a.restoreTo.padEnd(10)} ` +
          `${a.overdue ? "OVERDUE — run: resolve --all" : `in ${a.remaining}`}`,
      );
      if (a.reason) L.push(`      reason: ${a.reason}`);
    }
  }
  L.push("");
  L.push("  Configured backups");
  if (!configured.length) L.push(`    (none — add them to ${BACKUPS_PATH})`);
  for (const c of configured) {
    L.push(`    ${c.lane.padEnd(9)} → ${c.backup}${c.inFleet ? "" : "   [lane not in fleet]"}`);
  }
  if (lanesWithoutBackup.length) {
    L.push("");
    L.push(`  Lanes with no backup: ${lanesWithoutBackup.join(", ")}`);
  }
  process.stdout.write(`${L.join("\n")}\n`);
}

// ---------------------------------------------------------------------------

const USAGE = `delegate-backup — swap an exhausted lane to its backup, and put it back later

  apply   --lane <name> --until <71h37m|ISO> [--reason "..."] [--dry-run]
          Swap the lane onto its configured backup. Prints the scheduled-task spec
          to create. Exits ${EXIT.exhausted} if the lane is already on its backup,
          ${EXIT.noBackup} if no backup is configured for it.

  resolve [--lane <name>] [--all] [--force]
          Put lanes back. --lane restores that lane now (the task fired).
          --all restores every lane whose window has passed (the safety net).
          Exits ${EXIT.nothingToDo} when nothing was due.

  status  [--json]
          Show active and configured backups.

Files
  fleet   ${FLEET_PATH}
  sidecar ${BACKUPS_PATH}
`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = parseArgs(argv.slice(1));

if (!cmd || cmd === "--help" || cmd === "-h") {
  process.stdout.write(USAGE);
  process.exit(cmd ? EXIT.ok : EXIT.usage);
}

switch (cmd) {
  case "apply":
    cmdApply(args);
    break;
  case "resolve":
    cmdResolve(args);
    break;
  case "status":
    cmdStatus(args);
    break;
  default:
    fail(`unknown command "${cmd}"\n\n${USAGE}`);
}
