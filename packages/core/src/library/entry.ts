/**
 * Library entry format: markdown + YAML frontmatter with an executable
 * bar|beat notation block. Grep-able, git-diffable, LLM-readable (see
 * docs/design/library-kb.md).
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type EntryTier = "verified" | "sourced" | "draft";

export interface EntrySource {
  project?: string | null;
  path?: string | null;
  saved?: string | null;
}

export interface ClipEntry {
  slug: string;
  kind: "midi" | "audio";
  category: string;
  tags: string[];
  bpm?: number | null;
  scale?: string | null;
  lengthBeats: number;
  beatsPerBar?: number;
  source?: EntrySource;
  tier: EntryTier;
  title: string;
  /** bar|beat notation (the executable payload). Absent for audio entries. */
  notation?: string;
  /** Free prose after the notation block. */
  prose?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const TIERS: EntryTier[] = ["verified", "sourced", "draft"];

/**
 * Lowercase ASCII letters and digits of `text`, runs of anything else joined
 * by one hyphen; empty when nothing is left. NFKD first, so "Café" keeps its
 * "e" and "ﬁ" becomes "fi" instead of both being dropped as punctuation.
 */
export function asciiSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugify(text: string): string {
  const slug = asciiSlug(text);
  if (!SLUG_RE.test(slug)) throw new Error(`Cannot derive a slug from "${text}"`);
  return slug;
}

export function validateClipEntry(entry: ClipEntry): void {
  if (!SLUG_RE.test(entry.slug)) {
    throw new Error(`Invalid slug "${entry.slug}" (lowercase letters, digits, hyphens)`);
  }
  if (!SLUG_RE.test(entry.category)) {
    throw new Error(`Invalid category "${entry.category}" (lowercase letters, digits, hyphens)`);
  }
  if (!TIERS.includes(entry.tier)) {
    throw new Error(`Invalid tier "${entry.tier}" (expected ${TIERS.join("/")})`);
  }
  if (!(entry.lengthBeats > 0)) {
    throw new Error(`lengthBeats must be positive (got ${entry.lengthBeats})`);
  }
  if (entry.kind === "midi" && !entry.notation?.trim()) {
    throw new Error("MIDI entries need a non-empty awh-notation block");
  }
}

export function serializeClipEntry(entry: ClipEntry): string {
  validateClipEntry(entry);
  const front: Record<string, unknown> = {
    slug: entry.slug,
    kind: entry.kind,
    category: entry.category,
    tags: entry.tags,
    bpm: entry.bpm ?? null,
    scale: entry.scale ?? null,
    lengthBeats: entry.lengthBeats,
    ...(entry.beatsPerBar && entry.beatsPerBar !== 4 ? { beatsPerBar: entry.beatsPerBar } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    tier: entry.tier,
  };
  const parts = [`---\n${stringifyYaml(front).trimEnd()}\n---`, `# ${entry.title}`];
  if (entry.notation !== undefined) {
    parts.push(`\`\`\`awh-notation\n${entry.notation.trim()}\n\`\`\``);
  }
  if (entry.prose?.trim()) parts.push(entry.prose.trim());
  return `${parts.join("\n\n")}\n`;
}

export function parseClipEntry(markdown: string): ClipEntry {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) throw new Error("Missing YAML frontmatter (--- block) in library entry");
  const front = parseYaml(fm[1]!) as Record<string, unknown>;
  const body = markdown.slice(fm[0].length);

  const titleMatch = body.match(/^#\s+(.+)$/m);
  const notationMatch = body.match(/```awh-notation\n([\s\S]*?)```/);
  let prose = body
    .replace(/^#\s+.+$/m, "")
    .replace(/```awh-notation\n[\s\S]*?```/, "")
    .trim();

  const entry: ClipEntry = {
    slug: String(front.slug ?? ""),
    kind: (front.kind as "midi" | "audio" | undefined) ?? "midi",
    category: String(front.category ?? ""),
    tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
    bpm: front.bpm == null ? null : Number(front.bpm),
    scale: front.scale == null ? null : String(front.scale),
    lengthBeats: Number(front.lengthBeats),
    ...(front.beatsPerBar != null ? { beatsPerBar: Number(front.beatsPerBar) } : {}),
    ...(front.source && typeof front.source === "object" ? { source: front.source } : {}),
    tier: (front.tier as EntryTier | undefined) ?? "draft",
    title: titleMatch?.[1]?.trim() ?? String(front.slug ?? "untitled"),
    ...(notationMatch ? { notation: notationMatch[1]!.trimEnd() } : {}),
    ...(prose ? { prose } : {}),
  };
  validateClipEntry(entry);
  return entry;
}
