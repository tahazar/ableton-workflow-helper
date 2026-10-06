/**
 * `awh mix advise` helpers (docs/design/mix-advisor.md), kept out of
 * index.ts so the arg-mapping/record-resolution and `--set` device-name
 * enrichment are unit-testable without spawning the Python engine.
 *
 * The rule engine itself lives in Python (analysis/awh_analysis/advise.py).
 * This module only resolves CLI inputs to file paths and, when `--set`
 * is passed, additively renames generic device mentions in the engine's
 * action text to the actual devices sitting on the master chain.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { OpCaller } from "./op.js";

/** Resolve a `--record`/`--layers`/`--compare` argument: an existing file
 *  path, or a name in library/measurements/<name>.json (same convention
 *  `mix records`/`mix report --save` already use). */
export function resolveMeasurementRecordPath(nameOrPath: string, libraryRoot: string): string {
  if (existsSync(nameOrPath)) return nameOrPath;
  const named = join(libraryRoot, "measurements", `${nameOrPath}.json`);
  if (existsSync(named)) return named;
  throw new Error(
    `"${nameOrPath}" is neither a file nor library/measurements/${nameOrPath}.json`,
  );
}

export interface MasterDevice {
  path: string;
  name: string;
}

// The fake bridge and the real gateway (see paths.ts's "main" root) both
// address the master track as `main`, e.g. `main/dev:0`. There is no op to
// list a track's devices by path alone (only `device.get` on a known
// path), so this walks `main/dev:0`, `main/dev:1`, ... until the first
// error. That error is either out of range or an unreachable gateway. In
// both cases an empty or partial list is the right additive-only answer:
// --set degrades to "no device names available" instead of throwing.
const MASTER_CHAIN_PROBE_CAP = 32;

export async function readMasterChainDevices(caller: OpCaller): Promise<MasterDevice[]> {
  const out: MasterDevice[] = [];
  for (let i = 0; i < MASTER_CHAIN_PROBE_CAP; i++) {
    const path = `main/dev:${i}`;
    let detail: { name?: string } | undefined;
    try {
      detail = (await caller("device.get", { path })) as { name?: string };
    } catch {
      break;
    }
    if (!detail?.name) break;
    out.push({ path, name: detail.name });
  }
  return out;
}

/** Generic device-class phrases the engine's action text may use, each
 *  paired with a case-insensitive matcher against a real device's name.
 *  Devices may be renamed (e.g. "Master EQ"), so it matches on the class
 *  word, not an exact string. */
const DEVICE_ENRICH_PATTERNS: { needle: string; match: RegExp }[] = [
  { needle: "EQ Eight", match: /eq eight/i },
  { needle: "Utility", match: /utility/i },
  { needle: "Glue Compressor", match: /glue compressor/i },
  { needle: "Limiter", match: /\blimiter\b/i },
  { needle: "Compressor", match: /\bcompressor\b/i },
];

/** Rewrite the first generic device mention in each item's `action` text
 *  to name a real device on the master chain, when one exists there.
 *  Additive text substitution only; items are returned unchanged when
 *  `masterDevices` is empty (gateway unreachable, or --set not passed). */
export function enrichActionsWithDevices<T extends { action: string }>(
  items: T[],
  masterDevices: MasterDevice[],
): T[] {
  if (masterDevices.length === 0) return items;
  return items.map((item) => {
    for (const { needle, match } of DEVICE_ENRICH_PATTERNS) {
      if (!item.action.includes(needle)) continue;
      const device = masterDevices.find((d) => match.test(d.name));
      if (!device) continue;
      return {
        ...item,
        action: item.action.replace(needle, `your existing "${device.name}" (${device.path})`),
      };
    }
    return item;
  });
}
