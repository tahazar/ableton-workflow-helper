/**
 * File-backed knowledge store: `knowledge/<topic-path>/<slug>.md`, topics
 * discovered from the directory tree, so the topic set is open-ended.
 * Measurement records (library/measurements/*.json) are knowledge citizens:
 * indexed and listed alongside entries.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { parseKnowledgeEntry, serializeKnowledgeEntry, type KnowledgeEntry } from "./entry.js";

export interface StoredKnowledgeEntry extends KnowledgeEntry {
  /** Path relative to the knowledge root. */
  relPath: string;
}

export interface KnowledgeFilter {
  topic?: string; // prefix match: "rhythm" matches "rhythm/garage"
  tag?: string;
  tier?: string;
}

export interface MeasurementRecordSummary {
  name: string;
  saved: string;
  file: string;
  lufsIntegrated: number;
  tiltDbPerOct: number;
  bpm?: number;
  findingsCount: number;
}

export interface ReferenceRecordSummary {
  name: string;
  saved?: string;
  file?: string;
  bpm?: number;
  sectionCount?: number;
}

export interface DrumStatsRecordSummary {
  name: string;
  saved: string;
  dataset: string;
  nLoops: number;
  nSources: number;
}

export interface ChopMapRecordSummary {
  name: string;
  saved: string;
  file: string;
  nSlices: number;
  bpm: number;
}

/**
 * `loadEntry` found no entry with the slug, so callers can treat "no such
 * entry" as normal (an unknown style name) without also hiding a store
 * that failed to read, a malformed entry, or an ambiguous slug.
 */
export class KnowledgeEntryNotFoundError extends Error {
  constructor(readonly slug: string) {
    super(`No knowledge entry with slug "${slug}"`);
    this.name = "KnowledgeEntryNotFoundError";
  }
}

export class KnowledgeStore {
  /**
   * @param root the knowledge/ directory
   * @param measurementsDir library/measurements (records surface); optional
   * @param referencesDir library/references (reference-track maps); optional
   */
  constructor(
    readonly root: string,
    readonly measurementsDir?: string,
    readonly referencesDir?: string,
  ) {}

  entryFilePath(topic: string, slug: string): string {
    return join(this.root, ...topic.split("/"), `${slug}.md`);
  }

  async listEntries(filter: KnowledgeFilter = {}): Promise<StoredKnowledgeEntry[]> {
    if (!existsSync(this.root)) return [];
    const files = (await readdir(this.root, { recursive: true }))
      .map(String)
      .filter((f) => f.endsWith(".md") && !f.endsWith("INDEX.md") && basename(f) !== "README.md");
    const entries: StoredKnowledgeEntry[] = [];
    for (const rel of files.toSorted()) {
      const abs = join(this.root, rel);
      if (!(await stat(abs)).isFile()) continue;
      try {
        const entry = parseKnowledgeEntry(await readFile(abs, "utf8"));
        const dirTopic = dirname(rel).split(sep).join("/");
        if (dirTopic !== "." && entry.topic !== dirTopic) {
          throw new Error(
            `frontmatter topic "${entry.topic}" does not match directory "${dirTopic}"`,
          );
        }
        entries.push({ ...entry, relPath: rel });
      } catch (err) {
        throw new Error(`Bad knowledge entry ${abs}: ${(err as Error).message}`, { cause: err });
      }
    }
    return entries.filter(
      (e) =>
        (filter.topic === undefined ||
          e.topic === filter.topic ||
          e.topic.startsWith(`${filter.topic}/`)) &&
        (filter.tag === undefined || e.tags.includes(filter.tag)) &&
        (filter.tier === undefined || e.tier === filter.tier),
    );
  }

  async loadEntry(slug: string): Promise<StoredKnowledgeEntry> {
    const matches = (await this.listEntries()).filter((e) => e.slug === slug);
    if (matches.length === 0) throw new KnowledgeEntryNotFoundError(slug);
    if (matches.length > 1) {
      throw new Error(`Slug "${slug}" is ambiguous: ${matches.map((m) => m.relPath).join(", ")}`);
    }
    return matches[0]!;
  }

  async saveEntry(entry: KnowledgeEntry, opts: { overwrite?: boolean } = {}): Promise<string> {
    const file = this.entryFilePath(entry.topic, entry.slug);
    if (!opts.overwrite && existsSync(file)) {
      throw new Error(`${file} already exists — pass overwrite to replace it`);
    }
    const clash = (await this.listEntries()).find(
      (e) => e.slug === entry.slug && e.topic !== entry.topic,
    );
    if (clash) throw new Error(`Slug "${entry.slug}" already used by ${clash.relPath}`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, serializeKnowledgeEntry(entry), "utf8");
    return file;
  }

  /** Topics currently present (discovered, never hardcoded). */
  async listTopics(): Promise<string[]> {
    const topics = new Set((await this.listEntries()).map((e) => e.topic));
    return [...topics].toSorted();
  }

  /**
   * library/measurements/ holds three record kinds sharing one directory:
   * single-file mix reports (`report.save_record`, no `kind` field),
   * multi-file drum-stats records (`drumstats.save_record`, `kind:
   * "drumstats"`, from `awh drums mine --save`) and chop maps (`kind:
   * "chopmap"`, from `awh breaks chop --save`). This lists only the
   * mix-report kind; the others are surfaced by `listDrumStatsRecords` and
   * `listChopMapRecords`, so no reader crashes on fields another kind
   * doesn't have.
   */
  async listMeasurementRecords(): Promise<MeasurementRecordSummary[]> {
    if (!this.measurementsDir || !existsSync(this.measurementsDir)) return [];
    const out: MeasurementRecordSummary[] = [];
    for (const f of (await readdir(this.measurementsDir))
      .filter((x) => x.endsWith(".json"))
      .toSorted()) {
      try {
        const raw = JSON.parse(await readFile(join(this.measurementsDir, f), "utf8")) as {
          kind?: string;
          saved: string;
          file: string;
          measurements: {
            bpm?: number | null;
            loudness: { lufs_integrated: number };
            spectrum: { tilt_db_per_oct: number };
          };
          findings: unknown[];
        };
        if (raw.kind === "drumstats" || raw.kind === "chopmap") continue;
        out.push({
          name: f.replace(/\.json$/, ""),
          saved: raw.saved,
          file: raw.file,
          lufsIntegrated: raw.measurements.loudness.lufs_integrated,
          tiltDbPerOct: raw.measurements.spectrum.tilt_db_per_oct,
          ...(raw.measurements.bpm ? { bpm: raw.measurements.bpm } : {}),
          findingsCount: raw.findings.length,
        });
      } catch (err) {
        throw new Error(`Bad measurement record ${f}: ${(err as Error).message}`, { cause: err });
      }
    }
    return out;
  }

  /** The `awh drums mine --save` records in library/measurements/. See
   * `listMeasurementRecords` for why the kinds are split. */
  async listDrumStatsRecords(): Promise<DrumStatsRecordSummary[]> {
    if (!this.measurementsDir || !existsSync(this.measurementsDir)) return [];
    const out: DrumStatsRecordSummary[] = [];
    for (const f of (await readdir(this.measurementsDir))
      .filter((x) => x.endsWith(".json"))
      .toSorted()) {
      try {
        const raw = JSON.parse(await readFile(join(this.measurementsDir, f), "utf8")) as {
          kind?: string;
          saved: string;
          n_sources: number;
          stats: { dataset: string; n_loops: number };
        };
        if (raw.kind !== "drumstats") continue;
        out.push({
          name: f.replace(/\.json$/, ""),
          saved: raw.saved,
          dataset: raw.stats.dataset,
          nLoops: raw.stats.n_loops,
          nSources: raw.n_sources,
        });
      } catch (err) {
        throw new Error(`Bad drum-stats record ${f}: ${(err as Error).message}`, { cause: err });
      }
    }
    return out;
  }

  /** The `awh breaks chop --save` records (`kind: "chopmap"`) in
   *  library/measurements/. See `listMeasurementRecords` for why the kinds
   *  are split. */
  async listChopMapRecords(): Promise<ChopMapRecordSummary[]> {
    if (!this.measurementsDir || !existsSync(this.measurementsDir)) return [];
    const out: ChopMapRecordSummary[] = [];
    for (const f of (await readdir(this.measurementsDir))
      .filter((x) => x.endsWith(".json"))
      .toSorted()) {
      try {
        const raw = JSON.parse(await readFile(join(this.measurementsDir, f), "utf8")) as {
          kind?: string;
          saved: string;
          file: string;
          chopmap: { n_slices: number; bpm: number };
        };
        if (raw.kind !== "chopmap") continue;
        out.push({
          name: f.replace(/\.json$/, ""),
          saved: raw.saved,
          file: raw.file,
          nSlices: raw.chopmap.n_slices,
          bpm: raw.chopmap.bpm,
        });
      } catch (err) {
        throw new Error(`Bad chop-map record ${f}: ${(err as Error).message}`, { cause: err });
      }
    }
    return out;
  }

  async listReferenceRecords(): Promise<ReferenceRecordSummary[]> {
    if (!this.referencesDir || !existsSync(this.referencesDir)) return [];
    const out: ReferenceRecordSummary[] = [];
    for (const f of (await readdir(this.referencesDir))
      .filter((x) => x.endsWith(".json"))
      .toSorted()) {
      try {
        const raw = JSON.parse(await readFile(join(this.referencesDir, f), "utf8")) as {
          saved?: string;
          file?: string;
          bpm?: number;
          sections?: unknown[];
          reference?: { bpm?: number; sections?: unknown[] };
        };
        const analysis = raw.reference ?? raw;
        out.push({
          name: f.replace(/\.json$/, ""),
          ...(raw.saved ? { saved: raw.saved } : {}),
          ...(raw.file ? { file: raw.file } : {}),
          ...(analysis.bpm !== undefined ? { bpm: analysis.bpm } : {}),
          ...(analysis.sections ? { sectionCount: analysis.sections.length } : {}),
        });
      } catch (err) {
        throw new Error(`Bad reference record ${f}: ${(err as Error).message}`, { cause: err });
      }
    }
    return out;
  }

  /** Regenerate knowledge/INDEX.md: entries by topic + measurement records. */
  async buildIndex(): Promise<string> {
    const entries = await this.listEntries();
    const byTopic = new Map<string, StoredKnowledgeEntry[]>();
    for (const e of entries) {
      const list = byTopic.get(e.topic) ?? [];
      list.push(e);
      byTopic.set(e.topic, list);
    }
    const lines = [
      "# Knowledge index",
      "",
      `${entries.length} entries · generated by \`awh kb index\` — do not edit by hand.`,
      "Cite slug + tier when applying an entry. Executable sections are the contract.",
    ];
    for (const topic of [...byTopic.keys()].toSorted()) {
      lines.push(
        "",
        `## ${topic}`,
        "",
        "| slug | tier | tags | executable | sources |",
        "|---|---|---|---|---|",
      );
      for (const e of byTopic.get(topic)!) {
        lines.push(
          `| [${e.slug}](${e.relPath.split(sep).join("/")}) | ${e.tier} | ${e.tags.join(", ")} | ` +
            `${e.executable ? "yes" : "PROSE-ONLY"} | ${e.sources.length} |`,
        );
      }
    }
    const records = await this.listMeasurementRecords();
    if (records.length > 0) {
      lines.push(
        "",
        "## measurements (library/measurements/ — mix report records)",
        "",
        "| record | saved | LUFS-I | tilt | bpm | findings | source file |",
        "|---|---|---|---|---|---|---|",
      );
      for (const r of records) {
        lines.push(
          `| [${r.name}](../library/measurements/${r.name}.json) | ${r.saved} | ` +
            `${r.lufsIntegrated.toFixed(1)} | ${r.tiltDbPerOct.toFixed(1)} | ${r.bpm ?? ""} | ` +
            `${r.findingsCount} | ${basename(r.file)} |`,
        );
      }
    }
    const drumStats = await this.listDrumStatsRecords();
    if (drumStats.length > 0) {
      lines.push(
        "",
        "## drum-stats records (library/measurements/ — `awh drums mine --save` records)",
        "",
        "| record | saved | dataset | loops | sources |",
        "|---|---|---|---|---|",
      );
      for (const r of drumStats) {
        lines.push(
          `| [${r.name}](../library/measurements/${r.name}.json) | ${r.saved} | ` +
            `${r.dataset} | ${r.nLoops} | ${r.nSources} |`,
        );
      }
    }
    const chopMaps = await this.listChopMapRecords();
    if (chopMaps.length > 0) {
      lines.push(
        "",
        "## chop maps (library/measurements/ — `awh breaks chop --save` records)",
        "",
        "| record | saved | slices | bpm | source file |",
        "|---|---|---|---|---|",
      );
      for (const r of chopMaps) {
        lines.push(
          `| [${r.name}](../library/measurements/${r.name}.json) | ${r.saved} | ` +
            `${r.nSlices} | ${r.bpm.toFixed(1)} | ${basename(r.file)} |`,
        );
      }
    }
    const references = await this.listReferenceRecords();
    if (references.length > 0) {
      lines.push(
        "",
        "## references (library/references/ — deconstructed reference maps)",
        "",
        "| reference | saved | bpm | sections | source file |",
        "|---|---|---|---|---|",
      );
      for (const r of references) {
        lines.push(
          `| [${r.name}](../library/references/${r.name}.json) | ${r.saved ?? ""} | ` +
            `${r.bpm?.toFixed(1) ?? ""} | ${r.sectionCount ?? ""} | ${r.file ? basename(r.file) : ""} |`,
        );
      }
    }
    const content = `${lines.join("\n")}\n`;
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, "INDEX.md"), content, "utf8");
    return content;
  }
}
