/**
 * Knowledge entry format: markdown + YAML frontmatter, tiered and
 * executable-first (see docs/design/library-kb.md). Topics are open-ended:
 * an entry's topic is its directory path under knowledge/, so a new domain
 * is a new directory, never an edit to a hardcoded list.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { EntryTier } from "../library/entry.js";

export interface KnowledgeEntry {
  slug: string;
  /** Directory path under knowledge/, e.g. "setup" or "rhythm/garage". */
  topic: string;
  tier: EntryTier;
  tags: string[];
  /** Citations: URLs, "own analysis of <x>", "owner description <date>". */
  sources: string[];
  /** Related entries/files, repo-relative. */
  related: string[];
  title: string;
  /**
   * The `## Executable` section's raw markdown (notation blocks, pipeline
   * specs, style specs, recipes). Whenever knowledge can be expressed
   * executably it must be; prose alone is a last resort.
   */
  executable?: string;
  /** Everything else after the title (including the Executable section). */
  body: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const TOPIC_RE = /^[a-z0-9][a-z0-9/-]*$/;
const TIERS: EntryTier[] = ["verified", "sourced", "draft"];

export function validateKnowledgeEntry(entry: KnowledgeEntry): void {
  if (!SLUG_RE.test(entry.slug)) {
    throw new Error(`Invalid slug "${entry.slug}" (lowercase letters, digits, hyphens)`);
  }
  if (!TOPIC_RE.test(entry.topic)) {
    throw new Error(`Invalid topic "${entry.topic}" (lowercase path segments, e.g. rhythm/garage)`);
  }
  if (!TIERS.includes(entry.tier)) {
    throw new Error(`Invalid tier "${entry.tier}" (expected ${TIERS.join("/")})`);
  }
  if (entry.tier === "sourced" && entry.sources.length === 0) {
    throw new Error(`Tier "sourced" requires at least one citation in sources`);
  }
  if (!entry.body.trim()) {
    throw new Error("Knowledge entry needs a body");
  }
}

export function serializeKnowledgeEntry(entry: KnowledgeEntry): string {
  validateKnowledgeEntry(entry);
  const front = {
    slug: entry.slug,
    topic: entry.topic,
    tier: entry.tier,
    tags: entry.tags,
    sources: entry.sources,
    related: entry.related,
  };
  return `---\n${stringifyYaml(front).trimEnd()}\n---\n# ${entry.title}\n\n${entry.body.trim()}\n`;
}

export function parseKnowledgeEntry(markdown: string): KnowledgeEntry {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) throw new Error("Missing YAML frontmatter (--- block) in knowledge entry");
  const front = parseYaml(fm[1]!) as Record<string, unknown>;
  const rest = markdown.slice(fm[0].length);
  const titleMatch = rest.match(/^#\s+(.+)$/m);
  const body = rest.replace(/^#\s+.+$/m, "").trim();
  const execMatch = body.match(/##\s+Executable\s*\n([\s\S]*?)(?=\n##\s|$)/);

  const entry: KnowledgeEntry = {
    slug: String(front.slug ?? ""),
    topic: String(front.topic ?? ""),
    tier: (front.tier as EntryTier) ?? "draft",
    tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
    sources: Array.isArray(front.sources) ? front.sources.map(String) : [],
    related: Array.isArray(front.related) ? front.related.map(String) : [],
    title: titleMatch?.[1]?.trim() ?? String(front.slug ?? "untitled"),
    ...(execMatch ? { executable: execMatch[1]!.trim() } : {}),
    body,
  };
  validateKnowledgeEntry(entry);
  return entry;
}

/**
 * Extract a named fenced code block (e.g. "awh-style-spec", "awh-notation")
 * from an entry's markdown; the executable payload loaders use this.
 */
export function extractFencedBlock(markdown: string, language: string): string | undefined {
  const match = markdown.match(new RegExp("```" + language + "\\n([\\s\\S]*?)```"));
  return match?.[1]?.trimEnd();
}
