/**
 * Knowledge entries looked up by a name the user typed: data styles
 * (`--style`), break patterns and operator recipes. Only a missing slug is
 * "unknown"; a malformed entry, an ambiguous slug or an unreadable
 * knowledge base surfaces with the failed lookup named and the store's
 * error (which carries the file path) as `cause`.
 */
import {
  KnowledgeEntryNotFoundError,
  extractFencedBlock,
  listArpStyles,
  listBass808Styles,
  listBreakStyles,
  listDrumStyles,
  listPhraseStyles,
  type KnowledgeStore,
  type StoredKnowledgeEntry,
} from "@awh/core";

interface StyleKind {
  /** Slug is `<slugPrefix><name>`. */
  slugPrefix: string;
  /** The fenced block the entry must carry. */
  block: string;
  /** How messages name the kind, e.g. "arp style". */
  label: string;
  /** Built-in names listed in the "unknown" message; absent for kinds
   *  that only exist as knowledge entries. */
  builtins?: () => string[];
}

const STYLE_KINDS = {
  drum: {
    slugPrefix: "drum-style-",
    block: "awh-style-spec",
    label: "drum style",
    builtins: listDrumStyles,
  },
  phrase: {
    slugPrefix: "phrase-style-",
    block: "awh-phrase-spec",
    label: "phrase style",
    builtins: listPhraseStyles,
  },
  arp: {
    slugPrefix: "arp-style-",
    block: "awh-arp-spec",
    label: "arp style",
    builtins: listArpStyles,
  },
  break: {
    slugPrefix: "break-style-",
    block: "awh-break-spec",
    label: "break style",
    builtins: listBreakStyles,
  },
  "808": {
    slugPrefix: "808-style-",
    block: "awh-808-spec",
    label: "808 bass style",
    builtins: listBass808Styles,
  },
  "break-pattern": { slugPrefix: "break-pattern-", block: "awh-notation", label: "break pattern" },
} satisfies Record<string, StyleKind>;

export type StyleKindName = keyof typeof STYLE_KINDS;

/**
 * Loads the entry with `slug`. A missing slug throws `unknownMessage`;
 * anything else is rethrown as "looking up <what> failed: ..." with the
 * store's error as `cause`.
 */
export async function loadNamedEntry(
  store: KnowledgeStore,
  slug: string,
  what: string,
  unknownMessage: string,
): Promise<StoredKnowledgeEntry> {
  try {
    return await store.loadEntry(slug);
  } catch (err) {
    if (err instanceof KnowledgeEntryNotFoundError) throw new Error(unknownMessage, { cause: err });
    throw new Error(`looking up ${what} failed: ${(err as Error).message}`, { cause: err });
  }
}

/**
 * Resolves a data style (or break pattern) `name` of `kind` to its
 * knowledge entry and the text of the kind's fenced block. Callers check
 * built-ins first; this is the knowledge-base half.
 */
export async function resolveStyleSpec(
  store: KnowledgeStore,
  kindName: StyleKindName,
  name: string,
): Promise<{ specText: string; entry: StoredKnowledgeEntry }> {
  const kind: StyleKind = STYLE_KINDS[kindName];
  const slug = `${kind.slugPrefix}${name}`;
  const unknownMessage = kind.builtins
    ? `unknown ${kind.label} "${name}" — built-ins: ${kind.builtins().join(", ")}; ` +
      `data styles need a knowledge entry with slug ${slug} (see knowledge/README.md)`
    : `unknown ${kind.label} "${name}" — needs a knowledge entry with slug ${slug} ` +
      "(see knowledge/README.md)";
  const entry = await loadNamedEntry(store, slug, `${kind.label} "${name}"`, unknownMessage);
  const specText = extractFencedBlock(entry.body, kind.block);
  if (!specText) {
    throw new Error(`knowledge entry ${entry.relPath} has no \`\`\`${kind.block} block`);
  }
  return { specText, entry };
}
