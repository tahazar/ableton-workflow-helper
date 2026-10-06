/**
 * .alc generation via template capture (docs/research/alc-live-library.md).
 *
 * We never hand-construct Live's clip schema: the user saves one real MIDI
 * clip from Live 12 to the User Library (`awh lib capture-template`), and we
 * keep its gunzipped XML as the golden template. Rendering a library clip is
 * string surgery on that template: replace the KeyTracks note data, clip
 * name, loop/length markers, and time signature; leave everything else
 * byte-for-byte as Live wrote it (unknown elements are rejected by older
 * Lives and wrong values crash silently, so we don't improvise).
 */
import { gunzipSync, gzipSync } from "node:zlib";
import type { NoteSpec } from "../bridge/types.js";

/** Gunzip an .alc buffer (or pass through already-decompressed XML). */
export function ungzipAlc(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    return gunzipSync(data).toString("utf8");
  }
  return data.toString("utf8");
}

/** Gzip XML into an .alc buffer (Node writes MTIME=0 like Live itself). */
export function gzipAlc(xml: string): Buffer {
  return gzipSync(Buffer.from(xml, "utf8"));
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface MidiClipBlock {
  before: string;
  clip: string;
  after: string;
}

function splitMidiClip(xml: string): MidiClipBlock {
  const start = xml.indexOf("<MidiClip ");
  if (start < 0) throw new Error("Template has no <MidiClip> — save a MIDI clip, not audio");
  const endTag = "</MidiClip>";
  const end = xml.indexOf(endTag, start);
  if (end < 0) throw new Error("Template <MidiClip> block is unterminated");
  return {
    before: xml.slice(0, start),
    clip: xml.slice(start, end + endTag.length),
    after: xml.slice(end + endTag.length),
  };
}

interface NoteEventPattern {
  /** Attribute name -> template default value, in the template's order. */
  attrs: Map<string, string>;
}

function parseAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) {
    attrs.set(m[1]!, m[2]!);
  }
  return attrs;
}

export interface AlcTemplateInfo {
  clipName: string;
  noteCount: number;
  /** Attribute names Live wrote on MidiNoteEvent (schema fingerprint). */
  noteAttrs: string[];
  creator: string;
}

/**
 * Validate a candidate template: must contain one MIDI clip with at least one
 * note (the note is the schema sample we clone at render time).
 */
export function inspectAlcTemplate(xml: string): AlcTemplateInfo {
  const { clip } = splitMidiClip(xml);
  const events = [...clip.matchAll(/<MidiNoteEvent\b[^>]*\/>/g)];
  if (events.length === 0) {
    throw new Error(
      "Template clip has no notes — capture a clip containing at least one note " +
        "(its note carries the attribute schema we mirror)",
    );
  }
  const nameMatch = clip.match(/<Name Value="([^"]*)"/);
  const creator = xml.match(/<Ableton[^>]*Creator="([^"]*)"/)?.[1] ?? "unknown";
  return {
    clipName: nameMatch?.[1] ?? "",
    noteCount: events.length,
    noteAttrs: [...parseAttrs(events[0]![0]).keys()],
    creator,
  };
}

export interface RenderClipSpec {
  name: string;
  notes: NoteSpec[];
  lengthBeats: number;
  sigNumerator?: number;
  sigDenominator?: number;
}

/** Replace `<Elem Value="...">` for every occurrence of elem inside text. */
function setValues(text: string, elem: string, value: string | number): string {
  return text.replace(new RegExp(`(<${elem} Value=")[^"]*(")`, "g"), `$1${value}$2`);
}

function formatNoteEvent(
  pattern: NoteEventPattern,
  note: NoteSpec,
  noteId: number | undefined,
  indent: string,
): string {
  const attrs = new Map(pattern.attrs);
  const set = (key: string, value: string | number | undefined) => {
    if (attrs.has(key) && value !== undefined) attrs.set(key, String(value));
  };
  set("Time", note.start);
  set("Duration", note.duration);
  set("Velocity", note.velocity ?? 100);
  set("VelocityDeviation", note.velocityDeviation ?? 0);
  set("OffVelocity", note.releaseVelocity ?? attrs.get("OffVelocity"));
  set("Probability", note.probability ?? 1);
  set("IsEnabled", note.muted ? "false" : "true");
  set("NoteId", noteId);
  const parts = [...attrs.entries()].map(([k, v]) => `${k}="${v}"`);
  return `${indent}<MidiNoteEvent ${parts.join(" ")} />`;
}

/**
 * Render a library clip into the golden template. Returns the full XML
 * document (gzip with `gzipAlc` to produce the .alc file).
 */
export function renderAlcClip(templateXml: string, spec: RenderClipSpec): string {
  if (spec.notes.length === 0) throw new Error("Refusing to render an empty clip");
  const { before, clip, after } = splitMidiClip(templateXml);

  // --- KeyTracks replacement -------------------------------------------
  const ktMatch = clip.match(/([\t ]*)<KeyTracks>[\s\S]*?<\/KeyTracks>/);
  if (!ktMatch) throw new Error("Template clip has no <KeyTracks> block");
  const baseIndent = ktMatch[1] ?? "";
  const sampleEvent = clip.match(/<MidiNoteEvent\b[^>]*\/>/);
  if (!sampleEvent) {
    throw new Error("Template clip has no MidiNoteEvent to mirror — recapture with notes");
  }
  const pattern: NoteEventPattern = { attrs: parseAttrs(sampleEvent[0]) };
  const hasNoteIds = pattern.attrs.has("NoteId");

  // Template child order inside KeyTrack (Live writes Notes before MidiKey).
  const firstKeyTrack = clip.match(/<KeyTrack Id="\d+">([\s\S]*?)<\/KeyTrack>/);
  const midiKeyFirst = firstKeyTrack
    ? firstKeyTrack[1]!.indexOf("<MidiKey") < firstKeyTrack[1]!.indexOf("<Notes")
    : false;

  const byPitch = new Map<number, NoteSpec[]>();
  for (const note of [...spec.notes].toSorted((a, b) => a.start - b.start || a.pitch - b.pitch)) {
    const list = byPitch.get(note.pitch) ?? [];
    list.push(note);
    byPitch.set(note.pitch, list);
  }

  const i1 = `${baseIndent}\t`;
  const i2 = `${baseIndent}\t\t`;
  const i3 = `${baseIndent}\t\t\t`;
  let nextNoteId = 1;
  const keyTrackBlocks: string[] = [];
  let trackId = 0;
  for (const pitch of [...byPitch.keys()].toSorted((a, b) => a - b)) {
    const events = byPitch
      .get(pitch)!
      .map((n) => formatNoteEvent(pattern, n, hasNoteIds ? nextNoteId++ : undefined, i3))
      .join("\n");
    const notesBlock = `${i2}<Notes>\n${events}\n${i2}</Notes>`;
    const midiKey = `${i2}<MidiKey Value="${pitch}" />`;
    const children = midiKeyFirst ? [midiKey, notesBlock] : [notesBlock, midiKey];
    keyTrackBlocks.push(
      `${i1}<KeyTrack Id="${trackId++}">\n${children.join("\n")}\n${i1}</KeyTrack>`,
    );
  }
  const newKeyTracks = `${baseIndent}<KeyTracks>\n${keyTrackBlocks.join("\n")}\n${baseIndent}</KeyTracks>`;

  let newClip = clip.replace(/[\t ]*<KeyTracks>[\s\S]*?<\/KeyTracks>/, newKeyTracks);

  // --- clip name (first <Name> inside the clip block) -------------------
  newClip = newClip.replace(/<Name Value="[^"]*"/, `<Name Value="${escapeXml(spec.name)}"`);

  // --- length / loop markers (template-driven: only touch what exists) --
  const len = spec.lengthBeats;
  newClip = setValues(newClip, "CurrentStart", 0);
  newClip = setValues(newClip, "CurrentEnd", len);
  newClip = setValues(newClip, "LoopStart", 0);
  newClip = setValues(newClip, "LoopEnd", len);
  newClip = setValues(newClip, "StartRelative", 0);
  newClip = setValues(newClip, "OutMarker", len);
  newClip = setValues(newClip, "HiddenLoopStart", 0);
  newClip = setValues(newClip, "HiddenLoopEnd", len);

  // --- time signature ---------------------------------------------------
  if (spec.sigNumerator !== undefined) {
    newClip = setValues(newClip, "Numerator", spec.sigNumerator);
  }
  if (spec.sigDenominator !== undefined) {
    newClip = setValues(newClip, "Denominator", spec.sigDenominator);
  }

  // --- note id counters (both spellings seen in the wild; scoped so the
  // ProbabilityGroupIdGenerator's NextId is left alone) -------------------
  if (hasNoteIds) {
    newClip = setValues(newClip, "NextNoteId", nextNoteId);
    newClip = newClip.replace(
      /(<NoteIdGenerator>\s*<NextId Value=")[^"]*(")/g,
      `$1${nextNoteId}$2`,
    );
  }

  return `${before}${newClip}${after}`;
}
