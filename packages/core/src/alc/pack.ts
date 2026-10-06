/**
 * Live 12 directory-Pack writer, behavior ported from alpax (MIT,
 * https://github.com/kmontag/alpax), formats verified in
 * docs/research/alc-live-library.md.
 *
 * A plain folder becomes a browser Pack via `Ableton Folder Info/
 * Properties.cfg`; bumping PackRevision there makes Live re-index the pack
 * (our "notice my changes" trigger). Tags ride in the pack XMP as
 * `Group|Tag|Sub Tag` keyword paths; Live auto-creates unknown tags on scan.
 *
 * Safety: writes are confined to the pack directory, and an existing
 * directory is only reused when it carries our own Properties.cfg marker.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const FOLDER_INFO_DIR = "Ableton Folder Info";
export const PROPERTIES_FILE = "Properties.cfg";
/** Live's fixed filename for a pack's first XMP metadata file (per alpax). */
export const PACK_XMP_FILE = "c55d131f-2661-5add-aece-29afb7099dfa.xmp";

export interface PackProperties {
  uniqueId: string;
  name: string;
  vendor?: string;
  majorVersion?: number;
  minorVersion?: number;
  revision?: number;
}

export interface PackItem {
  /** Path inside the pack, forward slashes (e.g. "hats/rolling-hats.alc"). */
  relPath: string;
  content: Buffer;
  /** Tag paths: [group, tag, subtag?], e.g. ["AWH", "hats"]. */
  keywords: string[][];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const jsonStr = (s: string) => JSON.stringify(s);

/** Exact Properties.cfg text as alpax/Live produce it. */
export function packPropertiesCfg(props: PackProperties): string {
  return [
    "Ableton#04I",
    "",
    "FolderConfigData",
    "{",
    `  String PackUniqueID = ${jsonStr(props.uniqueId)};`,
    `  String PackDisplayName = ${jsonStr(props.name)};`,
    `  String PackVendor = ${jsonStr(props.vendor ?? "")};`,
    "  Bool FolderHiddenInBrowseGroups = false;",
    `  Int PackMinorVersion = ${props.minorVersion ?? 0};`,
    `  Int PackMajorVersion = ${props.majorVersion ?? 1};`,
    `  Int PackRevision = ${props.revision ?? 0};`,
    "  Int ProductId = 0;",
    "  Int MinSoftwareProductId = 0;",
    "}",
    "",
  ].join("\n");
}

/** Pack XMP (structure mirrors alpax's, which Live accepts). */
export function packXmp(props: PackProperties, items: PackItem[]): string {
  const itemBlocks = items
    .filter((item) => item.keywords.length > 0)
    .map((item) => {
      const keywords = item.keywords
        .map((path) => {
          if (path.length === 0 || path.some((p) => !p.trim())) {
            throw new Error(`Empty tag segment for ${item.relPath}`);
          }
          return `            <rdf:li>${path.map(escapeXml).join("|")}</rdf:li>`;
        })
        .join("\n");
      return [
        '          <rdf:li rdf:parseType="Resource">',
        `            <ablFR:filePath>${escapeXml(item.relPath)}</ablFR:filePath>`,
        "            <ablFR:keywords>",
        "              <rdf:Bag>",
        keywords,
        "              </rdf:Bag>",
        "            </ablFR:keywords>",
        "          </rdf:li>",
      ].join("\n");
    })
    .join("\n");

  const version = `${props.majorVersion ?? 1}.${props.minorVersion ?? 0}.${props.revision ?? 0}`;
  return [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 5.6.0">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '    <rdf:Description rdf:about=""',
    '        xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '        xmlns:ablFR="https://ns.ableton.com/xmp/fs-resources/1.0/"',
    '        xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    "      <dc:format>application/vnd.ableton.factory-pack</dc:format>",
    "      <ablFR:resource>pack</ablFR:resource>",
    "      <ablFR:platform>mac</ablFR:platform>",
    `      <ablFR:packUniqueId>${escapeXml(props.uniqueId)}</ablFR:packUniqueId>`,
    `      <ablFR:packVersion>${version}</ablFR:packVersion>`,
    "      <ablFR:items>",
    "        <rdf:Bag>",
    itemBlocks,
    "        </rdf:Bag>",
    "      </ablFR:items>",
    "      <xmp:CreatorTool>Updated by Ableton Index 12.0.1</xmp:CreatorTool>",
    "      <xmp:CreateDate>2024-03-14T17:40:51-06:00</xmp:CreateDate>",
    "      <xmp:MetadataDate>2024-03-15T11:55:05-06:00</xmp:MetadataDate>",
    "    </rdf:Description>",
    "  </rdf:RDF>",
    "</x:xmpmeta>",
    "",
  ].join("\n");
}

/**
 * (Re)generate a pack directory. Refuses a non-empty directory that is not
 * one of our packs (missing Properties.cfg): we only clobber a mirror
 * we generated. Stale files from previous exports are removed.
 */
export async function writePack(
  dir: string,
  props: PackProperties,
  items: PackItem[],
): Promise<void> {
  const marker = join(dir, FOLDER_INFO_DIR, PROPERTIES_FILE);
  if (existsSync(dir)) {
    const existing = await readdir(dir);
    if (existing.length > 0 && !existsSync(marker)) {
      throw new Error(
        `${dir} exists, is not empty, and has no ${FOLDER_INFO_DIR}/${PROPERTIES_FILE} — ` +
          "refusing to overwrite a directory we didn't generate",
      );
    }
    if (existsSync(marker)) {
      const cfg = await readFile(marker, "utf8");
      if (!cfg.includes(`String PackUniqueID = ${jsonStr(props.uniqueId)};`)) {
        throw new Error(
          `${dir} belongs to a different pack — refusing to overwrite`,
        );
      }
      // Our pack: clear stale content, keep nothing.
      for (const name of await readdir(dir)) {
        await rm(join(dir, name), { recursive: true });
      }
    }
  }
  for (const item of items) {
    const dest = join(dir, item.relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, item.content);
  }
  await mkdir(join(dir, FOLDER_INFO_DIR), { recursive: true });
  await writeFile(marker, packPropertiesCfg(props), "utf8");
  await writeFile(
    join(dir, FOLDER_INFO_DIR, PACK_XMP_FILE),
    packXmp(props, items),
    "utf8",
  );
}
