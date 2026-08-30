#!/usr/bin/env node
// delegate-backup — walk a lane down a priority chain of implementers as each one runs
// out of quota, and put it back when the provider's window resets.
//
// Node built-ins only — this ships inside a plugin and must never need an install.
//
// Design constraints that shaped this file:
//
//  * `config.json` is delegate-skills' document and stays a valid `delegate-fleet.v1`
//    file at all times. Every piece of state this feature needs lives in the sidecar
//    `lane-backups.json`, so a delegate-skills upgrade can never collide with us.
//  * A lane has a CHAIN, not a single backup. `apply` advances one position each time
//    it is called. Position 0 mirrors the lane's primary in config.json.
//  * End every chain with a free, unmetered model. Then the chain cannot be walked off
//    the end, and "no fallback left" stops being a state the user can reach.
//  * Restores are clobber-safe: we only put a lane back if it still holds exactly what
//    we wrote. A hand-edit since the swap wins over us.
//  * Expiry is recorded as a timestamp, so a lost or never-fired scheduled task cannot
//    strand a lane on a fallback — `resolve --all` catches it on the next preflight.
//  * Restore always returns to position 0. It must therefore wait for POSITION 0 to
//    recover — never for the window of some intermediate position we happen to be
//    leaving. `--until` describes the position that just failed, so it is recorded
//    against that position in `deadUntil`, and the restore is scheduled from
//    `deadUntil["0"]`. Scheduling on a mid-chain window puts the lane back on a
//    still-dead primary, which is the one bug this file exists to avoid.
//
// This script cannot create or delete scheduled tasks; those are MCP tools only the
// orchestrator can call. `apply` therefore prints the exact task spec to create, and
// `resolve` prints the task ids to delete. The skill wires those two ends together.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BACKUPS_VERSION = "delegate-backups.v2";
const LEGACY_VERSION = "delegate-backups.v1";
const FLEET_VERSION = "delegate-fleet.v1";

/** Exit codes callers branch on. Keep these stable — the skill documents them. */
const EXIT = {
  ok: 0,
  usage: 1,
  noChain: 2, // lane has no chain configured
  nothingToDo: 3, // resolve found nothing due
  exhausted: 4, // chain walked to its end — should be unreachable with a free floor
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

function fail(msg, code = EXIT.usage) {
  process.stderr.write(`delegate-backup: ${msg}\n`);
  process.exit(code);
}

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

/**
 * Load the sidecar, upgrading a v1 document in memory.
 *
 * v1 stored one backup per lane and no notion of the primary. A v1 lane therefore
 * becomes the two-element chain [<the lane as it stands in config.json>, <the backup>],
 * which preserves exactly the behaviour the user already had.
 */
function loadBackups(fleet) {
  const doc = readJson(BACKUPS_PATH, {
    version: BACKUPS_VERSION,
    chains: {},
    active: {},
    history: [],
  });

  if (doc.version === LEGACY_VERSION) {
    const chains = {};
    for (const [lane, backup] of Object.entries(doc.backups ?? {})) {
      const primary = fleet.lanes[lane];
      chains[lane] = primary ? [laneDials(primary), backup] : [backup];
    }
    // A v1 active entry has no position; it was always the single backup, i.e. index 1.
    const active = {};
    for (const [lane, a] of Object.entries(doc.active ?? {})) {
      active[lane] = { ...a, position: a.position ?? 1 };
    }
    return {
      version: BACKUPS_VERSION,
      chains,
      active,
      history: doc.history ?? [],
      migratedFrom: LEGACY_VERSION,
    };
  }

  doc.version ??= BACKUPS_VERSION;
  doc.chains ??= {};
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

/**
 * Parse `--until`. Accepts a provider-style duration ("71h37m", "5h", "90m", "45s")
 * or an absolute ISO 8601 timestamp. Providers report the reset window in their
 * exhaustion message, so both forms occur in practice — Codex and Antigravity give a
 * duration, Z.AI gives an absolute timestamp.
 */
function parseUntil(value) {
  if (!value) fail("--until is required (e.g. 71h37m, or 2026-09-02T05:29:47+02:00)");
  const duration = /^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i.exec(
    String(value).trim(),
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

/** Stable comparison for the clobber-safety check and for locating a chain position. */
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
 * offset-qualified timestamp, and a bare `toISOString()` (always Z) is easy to misread
 * when the user reasons about it in local time.
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

function label(entry) {
  const dials = Object.entries(laneDials(entry))
    .filter(([k]) => k !== "implementer")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `${entry.implementer}${dials ? ` (${dials})` : ""}`;
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
 * Advance one lane to the next position in its chain and record how to undo it.
 * Prints the scheduled-task spec for the orchestrator to create.
 */
function cmdApply(args) {
  const lane = args.lane || args._[0];
  if (!lane) fail("apply needs --lane <name>");

  const fleet = loadFleet();
  const doc = loadBackups(fleet);

  const current = fleet.lanes[lane];
  if (!current) fail(`lane "${lane}" is not in ${FLEET_PATH}`);

  const chain = doc.chains[lane];
  if (!Array.isArray(chain) || chain.length < 2) {
    process.stderr.write(
      `lane "${lane}" has no fallback chain in ${BACKUPS_PATH}.\n` +
        `Add one under "chains" as an array of at least two entries, ending in a free model.\n`,
    );
    process.exit(EXIT.noChain);
  }

  const active = doc.active[lane];
  // Where are we now? Trust the recorded position; otherwise locate the live lane in
  // the chain. An unrecognised lane means someone edited config.json by hand, and
  // position 0 is the safe reading — advance to 1 rather than skip ahead.
  const from = active ? active.position : Math.max(0, chain.findIndex((e) => sameLane(e, current)));
  const next = from + 1;

  if (next >= chain.length) {
    process.stderr.write(
      `lane "${lane}": the fallback chain is exhausted (position ${from} of ${chain.length - 1}).\n` +
        `Chain: ${chain.map((e, i) => `${i}:${e.implementer}`).join(" -> ")}\n` +
        `Every entry is spent. This needs a decision from the user.\n` +
        `Chains should end in a free, unmetered model so this state is unreachable.\n`,
    );
    process.exit(EXIT.exhausted);
  }

  const target = chain[next];
  if (typeof target?.implementer !== "string" || !target.implementer) {
    fail(`chain entry ${next} for lane "${lane}" has no implementer`);
  }

  const until = parseUntil(args.until);
  // The original is whatever the lane held before we ever touched it — preserved across
  // every advance, so a restore always returns to the user's own configuration.
  const original = active ? active.original : laneDials(current);
  const wrote = laneDials(target);

  // `--until` describes the window of the position we are LEAVING — the one whose
  // provider just reported exhaustion. Record it against `from`, not against the
  // position we are moving to.
  const deadUntil = { ...(active?.deadUntil ?? {}) };
  // An entry written before deadUntil existed only knew its own expiresAt, which at
  // that point was position 0's window. Seed from it so upgrades keep working.
  if (active && !active.deadUntil && active.expiresAt) deadUntil["0"] ??= active.expiresAt;
  deadUntil[String(from)] = isoLocal(until);

  // `--primary-until` corrects position 0's window when you learn it after the fact —
  // e.g. the primary's real reset turns out to be days away, not hours.
  if (typeof args["primary-until"] === "string") {
    deadUntil["0"] = isoLocal(parseUntil(args["primary-until"]));
  }

  // THE RULE: the restore returns this lane to position 0, so it waits for position 0.
  const restoreAt = new Date(deadUntil["0"] ?? isoLocal(until));

  // Advancing mid-chain with a window shorter than the primary's is normal and correct;
  // say so, because the natural expectation is that --until sets the restore time.
  const notes = [];
  if (from > 0 && until.getTime() < restoreAt.getTime()) {
    notes.push(
      `--until (${isoLocal(until)}) describes position ${from}, which is not where this lane ` +
        `restores to. The restore stays scheduled for position 0's window ` +
        `(${deadUntil["0"]}) so the lane is not put back on a still-exhausted primary. ` +
        `Use --primary-until to correct position 0's window.`,
    );
  }

  if (args["dry-run"]) {
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: true,
          lane,
          fromPosition: from,
          toPosition: next,
          chainLength: chain.length,
          from: laneDials(current),
          to: wrote,
          deadUntil,
          restoreAt: isoLocal(restoreAt),
          notes,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  // Build the whole result BEFORE touching disk. A throw between the two writes would
  // otherwise leave the lane advanced while reporting failure — and the caller, seeing
  // an error, would retry and advance it a second time.
  const remaining = chain.length - 1 - next;
  const spec = {
    lane,
    movedTo: { position: next, of: chain.length - 1, implementer: target.implementer },
    fallbacksRemaining: remaining,
    swapped: { from: laneDials(current), to: wrote },
    deadUntil,
    expiresAt: isoLocal(restoreAt),
    scheduledTask: {
      taskId: taskIdFor(lane),
      description: `Restore delegate lane "${lane}" to its primary once the quota window resets`,
      fireAt: isoLocal(restoreAt),
      notifyOnCompletion: true,
      prompt:
        `Run this exact command and report its output verbatim:\n\n` +
        `node "${path.resolve(process.argv[1])}" resolve --lane ${lane}\n\n` +
        `Then delete this scheduled task (taskId: ${taskIdFor(lane)}). ` +
        `If deleting is not possible, stop — the task is one-shot and will not fire again.`,
    },
  };
  if (remaining === 0) {
    spec.warning =
      "This is the last entry in the chain. If it also fails there is nowhere left to go — " +
      "consider ending this chain with a free, unmetered model.";
  }
  if (notes.length) spec.notes = notes;

  // Everything is computed; now commit it. Sidecar last, so a failure between the two
  // leaves the sidecar describing the older (less advanced) state rather than a
  // position the fleet config never reached.
  fleet.lanes[lane] = { ...wrote };
  writeJson(FLEET_PATH, fleet);

  doc.active[lane] = {
    original,
    position: next,
    wrote,
    appliedAt: isoLocal(new Date()),
    expiresAt: isoLocal(restoreAt),
    deadUntil,
    reason: typeof args.reason === "string" ? args.reason : "",
    taskId: taskIdFor(lane),
  };
  delete doc.migratedFrom;
  writeJson(BACKUPS_PATH, doc);

  process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
}

/**
 * Return lanes to position 0. With --lane, restores that lane regardless of clock (the
 * scheduled task fired). With --all, restores every lane whose window has passed — the
 * safety net that stops a lost task from stranding a lane indefinitely.
 */
function cmdResolve(args) {
  const fleet = loadFleet();
  const doc = loadBackups(fleet);
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
      skipped.push({ lane, why: "no active fallback" });
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
    const entry = { lane, to: active.original, fromPosition: active.position, taskId: active.taskId };
    // Defensive: --force (or a hand-edited window) can restore onto a primary we know
    // is still exhausted. Say so rather than let the next dispatch fail mysteriously.
    const primaryDead = active.deadUntil?.["0"];
    if (primaryDead && new Date(primaryDead).getTime() > now) {
      entry.warning =
        `position 0 is recorded as exhausted until ${primaryDead} — this lane will likely ` +
        `fail its next dispatch and need advancing again`;
    }
    restored.push(entry);
  }

  const abandoned = skipped.some((s) => s.why.startsWith("lane changed"));
  if (restored.length) writeJson(FLEET_PATH, fleet);
  if (restored.length || abandoned || doc.migratedFrom) {
    delete doc.migratedFrom;
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

/** What is swapped right now, how far down each chain, and when it comes back. */
function cmdStatus(args) {
  const fleet = loadFleet();
  const doc = loadBackups(fleet);

  const active = Object.entries(doc.active).map(([lane, a]) => ({
    lane,
    position: a.position,
    of: (doc.chains[lane]?.length ?? 1) - 1,
    on: a.wrote.implementer,
    restoreTo: a.original.implementer,
    expiresAt: a.expiresAt,
    remaining: humanRemaining(a.expiresAt),
    overdue: new Date(a.expiresAt).getTime() <= Date.now(),
    deadUntil: a.deadUntil ?? null,
    reason: a.reason,
  }));

  const lanesWithoutChain = Object.keys(fleet.lanes).filter(
    (l) => !Array.isArray(doc.chains[l]) || doc.chains[l].length < 2,
  );

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        { version: doc.version, active, chains: doc.chains, lanesWithoutChain, path: BACKUPS_PATH },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const L = [];
  L.push(`delegate-backup status   (${doc.version})`);
  if (doc.migratedFrom) {
    L.push(`  NOTE  migrated in memory from ${doc.migratedFrom}; the next write persists v2`);
  }
  L.push("");
  if (!active.length) L.push("  Every lane is on its primary.");
  else {
    L.push("  Active fallbacks");
    for (const a of active) {
      L.push(
        `    ${a.lane.padEnd(9)} position ${a.position}/${a.of} on ${a.on.padEnd(10)}` +
          ` → restores to ${a.restoreTo.padEnd(10)} ` +
          `${a.overdue ? "OVERDUE — run: resolve --all" : `in ${a.remaining}`}`,
      );
      if (a.deadUntil) {
        const parts = Object.entries(a.deadUntil)
          .sort(([x], [y]) => Number(x) - Number(y))
          .map(([pos, iso]) => `${pos}:${humanRemaining(iso)}`);
        L.push(`      recovers  ${parts.join("   ")}   (restore waits on position 0)`);
      }
      if (a.reason) L.push(`      reason: ${a.reason}`);
    }
  }
  L.push("");
  L.push("  Chains");
  const laneNames = Object.keys(doc.chains);
  if (!laneNames.length) L.push(`    (none — add them to ${BACKUPS_PATH})`);
  for (const lane of laneNames) {
    const chain = doc.chains[lane];
    const pos = doc.active[lane]?.position ?? 0;
    const rendered = chain
      .map((e, i) => (i === pos ? `[${i}:${label(e)}]` : `${i}:${label(e)}`))
      .join("  ->  ");
    L.push(`    ${lane.padEnd(9)} ${rendered}`);
  }
  if (lanesWithoutChain.length) {
    L.push("");
    L.push(`  Lanes with no usable chain: ${lanesWithoutChain.join(", ")}`);
  }
  L.push("");
  L.push("  [n:...] marks the position currently live in config.json.");
  process.stdout.write(`${L.join("\n")}\n`);
}

// ---------------------------------------------------------------------------

const USAGE = `delegate-backup — walk a lane down its fallback chain, and put it back later

  apply   --lane <name> --until <71h37m|ISO> [--primary-until <win>]
          [--reason "..."] [--dry-run]
          Advance the lane one position down its chain. Prints the scheduled-task spec
          to create. Exits ${EXIT.exhausted} only when the chain has no entries left,
          ${EXIT.noChain} when the lane has no chain configured.

          --until is the window of the position that JUST FAILED — the one being left.
          The restore is scheduled from position 0's window instead, because that is
          where the lane returns to. Use --primary-until to correct position 0's window
          if you learn it later (e.g. the primary turns out to be dead for days, not
          hours). Without this, a short mid-chain window would restore the lane onto a
          still-exhausted primary.

  resolve [--lane <name>] [--all] [--force]
          Return lanes to position 0. --lane restores that lane now (the task fired).
          --all restores every lane whose window has passed (the safety net).
          Exits ${EXIT.nothingToDo} when nothing was due.

  status  [--json]
          Show each chain, the live position, and any active fallback.

Chains live under "chains" in the sidecar, as an ordered array per lane. Position 0 is
the lane's primary. End every chain with a free, unmetered model so it cannot run out.

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
