/**
 * Read notes back out of an .alc / .als MIDI clip (the reverse flow:
 * `awh lib import-alc`). Traversal per alcmixer (MIT):
 * MidiClip > Notes > KeyTracks > KeyTrack { MidiKey, Notes > MidiNoteEvent }.
 */
import type { NoteSpec } from "../bridge/types.js";

export interface ParsedAlcClip {
  name: string;
  lengthBeats: number;
  notes: NoteSpec[];
  sigNumerator?: number;
  sigDenominator?: number;
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function unescapeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseAlcClip(xml: string): ParsedAlcClip {
  const start = xml.indexOf("<MidiClip ");
  if (start < 0) {
    throw new Error("No MIDI clip found — only MIDI .alc files can be imported");
  }
  const end = xml.indexOf("</MidiClip>", start);
  const clip = xml.slice(start, end < 0 ? xml.length : end);

  const notes: NoteSpec[] = [];
  for (const kt of clip.matchAll(/<KeyTrack Id="\d+">([\s\S]*?)<\/KeyTrack>/g)) {
    const body = kt[1]!;
    const pitch = Number(body.match(/<MidiKey Value="(\d+)"/)?.[1]);
    if (!Number.isFinite(pitch)) continue;
    for (const ev of body.matchAll(/<MidiNoteEvent\b[^>]*\/>/g)) {
      const tag = ev[0];
      const velocity = Number(attr(tag, "Velocity") ?? 100);
      const probability = Number(attr(tag, "Probability") ?? 1);
      const offVelocity = Number(attr(tag, "OffVelocity") ?? 64);
      const velocityDeviation = Number(attr(tag, "VelocityDeviation") ?? 0);
      const enabled = (attr(tag, "IsEnabled") ?? "true") === "true";
      notes.push({
        pitch,
        start: Number(attr(tag, "Time") ?? 0),
        duration: Number(attr(tag, "Duration") ?? 0),
        velocity: Math.round(velocity),
        ...(probability !== 1 ? { probability } : {}),
        ...(offVelocity !== 64 ? { releaseVelocity: Math.round(offVelocity) } : {}),
        ...(velocityDeviation !== 0 ? { velocityDeviation } : {}),
        ...(enabled ? {} : { muted: true }),
      });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  const loopStart = Number(clip.match(/<LoopStart Value="([^"]*)"/)?.[1] ?? 0);
  const loopEnd = clip.match(/<LoopEnd Value="([^"]*)"/)?.[1];
  const lengthBeats =
    loopEnd !== undefined
      ? Number(loopEnd) - loopStart
      : Math.max(1, ...notes.map((n) => n.start + n.duration));

  const sigNumerator = clip.match(/<Numerator Value="(\d+)"/)?.[1];
  const sigDenominator = clip.match(/<Denominator Value="(\d+)"/)?.[1];

  return {
    name: unescapeXml(clip.match(/<Name Value="([^"]*)"/)?.[1] ?? ""),
    lengthBeats,
    notes,
    ...(sigNumerator ? { sigNumerator: Number(sigNumerator) } : {}),
    ...(sigDenominator ? { sigDenominator: Number(sigDenominator) } : {}),
  };
}
