import type { DrumKit, DrumRole } from "./types.js";

/**
 * Maps drum pads (from a Drum Rack) to semantic roles (kick, snare, ...) so
 * pattern generators and variation ops can address "the kick" without caring
 * which MIDI note the user's kit happens to use.
 */

/** General MIDI drum-map fallback, used when a pad has no usable name. */
export const GM_DRUM_KIT: DrumKit = {
  kick: 36,
  snare: 38,
  clap: 39,
  "hat-closed": 42,
  "hat-open": 46,
  ride: 51,
  crash: 49,
  tom: 45,
  shaker: 70,
  perc: 63,
};

// Keyword matchers, checked in precedence order. Short/ambiguous tokens
// ("sd", "sn", "cp", "bd", "ch", "hh", "oh") are matched on word boundaries
// so they don't fire inside unrelated words; longer, less ambiguous words
// match anywhere in the name.
const KICK_RE = /\b(kick|bd|808)\b/i;
const CLAP_RE = /\b(clap|cp)\b/i;
const SNARE_RE = /\b(snare|sd|sn)\b/i;
const HAT_RE = /\b(hat|hh)\b/i;
const OPEN_RE = /\b(open|oh)\b/i;
const CLOSED_RE = /\b(hat|hh|closed|ch)\b/i;
const RIDE_RE = /ride/i;
const CRASH_RE = /(crash|cym)/i;
const TOM_RE = /tom/i;
const SHAKER_RE = /(shaker|shk|cabasa|maraca)/i;

/** Best-effort role match from a pad's name, in fixed precedence order. */
function roleFromName(name: string | undefined): DrumRole | undefined {
  if (!name) return undefined;
  if (KICK_RE.test(name)) return "kick";
  if (CLAP_RE.test(name)) return "clap";
  if (SNARE_RE.test(name)) return "snare";
  if (HAT_RE.test(name) && OPEN_RE.test(name)) return "hat-open";
  if (CLOSED_RE.test(name)) return "hat-closed";
  if (RIDE_RE.test(name)) return "ride";
  if (CRASH_RE.test(name)) return "crash";
  if (TOM_RE.test(name)) return "tom";
  if (SHAKER_RE.test(name)) return "shaker";
  return undefined;
}

/** Role whose GM_DRUM_KIT note matches, if any. */
function roleFromGmNote(note: number): DrumRole | undefined {
  for (const role of Object.keys(GM_DRUM_KIT) as DrumRole[]) {
    if (GM_DRUM_KIT[role] === note) return role;
  }
  return undefined;
}

/**
 * Build a DrumKit from a Drum Rack's pads. Names are matched case-insensitively
 * by keyword first; pads with no usable name fall back to a GM note match;
 * anything left over is "perc". The first pad to claim a role wins; later
 * pads matching the same role are left unassigned (they can still be reached
 * directly by note/path, just not through the role kit).
 */
export function mapPadRoles(pads: { note: number; name?: string }[]): DrumKit {
  const kit: DrumKit = {};
  for (const pad of pads) {
    const role = roleFromName(pad.name) ?? roleFromGmNote(pad.note) ?? "perc";
    if (kit[role] === undefined) {
      kit[role] = pad.note;
    }
  }
  return kit;
}

/** Reverse lookup: which role (if any) does this MIDI note play in `kit`. */
export function roleOfNote(kit: DrumKit, note: number): DrumRole | undefined {
  for (const role of Object.keys(kit) as DrumRole[]) {
    if (kit[role] === note) return role;
  }
  return undefined;
}
