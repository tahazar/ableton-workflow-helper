import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  gzipAlc,
  inspectAlcTemplate,
  packPropertiesCfg,
  packXmp,
  parseAlcClip,
  renderAlcClip,
  ungzipAlc,
  writePack,
  type NoteSpec,
} from "../src/index.js";

const templateXml = readFileSync(
  fileURLToPath(new URL("./fixtures/alc-template.xml", import.meta.url)),
  "utf8",
);

const notes: NoteSpec[] = [
  { pitch: 60, start: 0, duration: 1, velocity: 100 },
  { pitch: 60, start: 2, duration: 0.5, velocity: 90, probability: 0.85 },
  { pitch: 63, start: 1, duration: 1, velocity: 80, muted: true },
];

describe("alc template engine", () => {
  it("inspects a valid template", () => {
    const info = inspectAlcTemplate(templateXml);
    expect(info.clipName).toBe("Template Clip");
    expect(info.noteCount).toBe(2);
    expect(info.noteAttrs).toContain("Time");
    expect(info.noteAttrs).toContain("NoteId");
  });

  it("rejects templates without notes or MIDI clips", () => {
    expect(() => inspectAlcTemplate("<Ableton></Ableton>")).toThrowError(/MidiClip/);
    const empty = templateXml.replace(/<MidiNoteEvent[^>]*\/>\s*/g, "");
    expect(() => inspectAlcTemplate(empty)).toThrowError(/no notes/);
  });

  it("renders notes, name, length, and signature into the template", () => {
    const xml = renderAlcClip(templateXml, {
      name: 'Hats & "loop" <1>',
      notes,
      lengthBeats: 16,
      sigNumerator: 3,
      sigDenominator: 4,
    });
    // grouped per pitch, sorted
    expect(xml.match(/<KeyTrack Id="\d+">/g)).toHaveLength(2);
    expect(xml.indexOf('<MidiKey Value="60"')).toBeGreaterThan(-1);
    expect(xml.indexOf('<MidiKey Value="60"')).toBeLessThan(xml.indexOf('<MidiKey Value="63"'));
    // attribute schema mirrored from the template's sample note
    expect(xml).toContain('Time="2" Duration="0.5" Velocity="90" VelocityDeviation="0" OffVelocity="64" Probability="0.85" IsEnabled="true"');
    expect(xml).toContain('IsEnabled="false"'); // the muted note
    // name escaped
    expect(xml).toContain('<Name Value="Hats &amp; &quot;loop&quot; &lt;1&gt;"');
    // loop/length markers rewritten everywhere they exist
    expect(xml).toContain('<LoopEnd Value="16"');
    expect(xml).toContain('<CurrentEnd Value="16"');
    expect(xml).toContain('<OutMarker Value="16"');
    expect(xml).toContain('<HiddenLoopEnd Value="16"');
    // signature
    expect(xml).toContain('<Numerator Value="3"');
    // note ids sequential + counters updated (both spellings, probability
    // group generator untouched)
    expect(xml).toContain('NoteId="3"');
    expect(xml).toContain('<NextNoteId Value="4"');
    expect(xml).toMatch(/<NoteIdGenerator>\s*<NextId Value="4"/);
    expect(xml).toMatch(/<ProbabilityGroupIdGenerator>\s*<NextId Value="1"/);
    // untouched scaffolding survives byte-for-byte
    expect(xml).toContain('<OverwriteProtectionNumber Value="3072" />');
    expect(xml).toContain("<PerNoteEventStore>");
  });

  it("round-trips through gzip and parseAlcClip", () => {
    const xml = renderAlcClip(templateXml, { name: "RT", notes, lengthBeats: 8 });
    const parsed = parseAlcClip(ungzipAlc(gzipAlc(xml)));
    expect(parsed.name).toBe("RT");
    expect(parsed.lengthBeats).toBe(8);
    expect(parsed.sigNumerator).toBe(4);
    expect(parsed.notes).toEqual([
      { pitch: 60, start: 0, duration: 1, velocity: 100 },
      { pitch: 63, start: 1, duration: 1, velocity: 80, muted: true },
      { pitch: 60, start: 2, duration: 0.5, velocity: 90, probability: 0.85 },
    ]);
  });

  it("refuses empty clips", () => {
    expect(() => renderAlcClip(templateXml, { name: "x", notes: [], lengthBeats: 4 })).toThrowError(/empty/);
  });
});

describe("pack writer", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "awh-pack-"));
    await rm(dir, { recursive: true }); // writePack creates it
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const props = { uniqueId: "com.awh.library", name: "AWH Library", revision: 3 };
  const items = [
    {
      relPath: "hats/rolling.alc",
      content: Buffer.from("fake"),
      keywords: [["AWH", "hats"], ["AWH Tags", "garage & 2step"]],
    },
  ];

  it("writes the exact alpax Properties.cfg shape", () => {
    const cfg = packPropertiesCfg(props);
    expect(cfg.startsWith("Ableton#04I\n\nFolderConfigData\n{\n")).toBe(true);
    expect(cfg).toContain('  String PackUniqueID = "com.awh.library";');
    expect(cfg).toContain('  String PackDisplayName = "AWH Library";');
    expect(cfg).toContain("  Int PackRevision = 3;");
    expect(cfg).toContain("  Int MinSoftwareProductId = 0;");
    expect(cfg.trimEnd().endsWith("}")).toBe(true);
  });

  it("writes XMP keywords as escaped Group|Tag paths", () => {
    const xmp = packXmp(props, items);
    expect(xmp).toContain("<ablFR:resource>pack</ablFR:resource>");
    expect(xmp).toContain("<ablFR:packVersion>1.0.3</ablFR:packVersion>");
    expect(xmp).toContain("<ablFR:filePath>hats/rolling.alc</ablFR:filePath>");
    expect(xmp).toContain("<rdf:li>AWH|hats</rdf:li>");
    expect(xmp).toContain("<rdf:li>AWH Tags|garage &amp; 2step</rdf:li>");
    expect(() => packXmp(props, [{ ...items[0]!, keywords: [["", "x"]] }])).toThrowError(/Empty tag/);
  });

  it("creates, regenerates, and protects foreign directories", async () => {
    await writePack(dir, props, items);
    expect(existsSync(join(dir, "hats", "rolling.alc"))).toBe(true);
    expect(existsSync(join(dir, "Ableton Folder Info", "Properties.cfg"))).toBe(true);

    // regenerate: stale files removed, revision bumped
    await writePack(dir, { ...props, revision: 4 }, [
      { relPath: "kicks/deep.alc", content: Buffer.from("x"), keywords: [["AWH", "kicks"]] },
    ]);
    expect(existsSync(join(dir, "hats", "rolling.alc"))).toBe(false);
    expect(existsSync(join(dir, "kicks", "deep.alc"))).toBe(true);
    expect(
      await readFile(join(dir, "Ableton Folder Info", "Properties.cfg"), "utf8"),
    ).toContain("Int PackRevision = 4;");

    // a different pack id in the same dir is refused
    await expect(
      writePack(dir, { ...props, uniqueId: "other.pack" }, items),
    ).rejects.toThrowError(/different pack/);

    // a non-empty non-pack directory is refused
    const foreign = await mkdtemp(join(tmpdir(), "awh-foreign-"));
    try {
      await writeFile(join(foreign, "precious.txt"), "user data");
      await expect(writePack(foreign, props, items)).rejects.toThrowError(/refusing/);
    } finally {
      await rm(foreign, { recursive: true, force: true });
    }
  });
});
