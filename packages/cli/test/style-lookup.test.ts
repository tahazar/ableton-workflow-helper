import { describe, expect, it } from "vitest";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipDetail } from "@awh/core";
import { makeTestLibrary, runCli, startFakeGateway } from "./helpers.js";

/**
 * Data styles, break patterns and operator recipes are knowledge entries
 * looked up by slug. Only a missing slug is an "unknown style"; an entry
 * that fails to parse, or a slug two entries share, must reach the user
 * with the file path instead of hiding behind "unknown". The "unknown"
 * direction for each kind is pinned in arp, bass and breaks tests; this
 * file adds the failure direction per command, plus the cases the shared
 * lookup handles once for all of them.
 */

function entryText(slug: string, topic: string, tier: string, body: string[]): string {
  return [
    "---",
    `slug: ${slug}`,
    `topic: ${topic}`,
    `tier: ${tier}`,
    "tags: []",
    "sources: []",
    "related: []",
    "---",
    "# Test entry",
    "",
    ...body,
    "",
  ].join("\n");
}

/** Writes `knowledge/<topic>/<slug>.md` beside `libraryRoot`; returns its path. */
async function writeEntry(dir: string, topic: string, slug: string, text: string): Promise<string> {
  const topicDir = join(dir, "knowledge", ...topic.split("/"));
  await mkdir(topicDir, { recursive: true });
  const file = join(topicDir, `${slug}.md`);
  await writeFile(file, text);
  return file;
}

interface LookupCase {
  name: string;
  slug: string;
  argv: string[];
}

// `-p` is filled in per test; every command looks the entry up before it
// writes anything.
const CASES: LookupCase[] = [
  {
    name: "arp --style",
    slug: "arp-style-broken",
    argv: ["arp", "--prog", "i-VI", "--key", "A minor", "--style", "broken", "track:0"],
  },
  {
    name: "bass 808 --style",
    slug: "808-style-broken",
    argv: ["bass", "808", "track:0", "--key", "A minor", "--style", "broken", "--at-bar", "1"],
  },
  {
    name: "drums gen --style",
    slug: "drum-style-broken",
    argv: ["drums", "gen", "track:0", "--style", "broken", "--at-bar", "1"],
  },
  {
    name: "breaks place",
    slug: "break-pattern-broken",
    argv: ["breaks", "place", "broken", "track:0", "--at-bar", "1"],
  },
  {
    name: "op apply",
    slug: "operator-recipe-broken",
    argv: ["op", "apply", "broken", "track:0/device:0", "--dry-run"],
  },
];

describe("knowledge-entry lookup by name", () => {
  it.each(CASES)(
    "$name: a malformed entry is reported with its path, not as unknown",
    async (c) => {
      const { port } = await startFakeGateway();
      const { dir, libraryRoot } = await makeTestLibrary("style-lookup");
      try {
        const file = await writeEntry(
          dir,
          "rhythm",
          c.slug,
          entryText(c.slug, "rhythm", "bogus", ["body"]),
        );
        const result = await runCli(["-p", String(port), ...c.argv], { AWH_LIBRARY: libraryRoot });
        expect(result.status).toBe(1);
        expect(result.stderr).not.toMatch(/unknown/);
        expect(result.stderr).toMatch(/looking up .*"broken" failed: Bad knowledge entry/);
        expect(result.stderr).toContain(file);
        expect(result.stderr).toMatch(/Invalid tier "bogus"/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it("a malformed entry elsewhere in the knowledge base is reported, since the lookup cannot see past it", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("style-lookup");
    try {
      const file = await writeEntry(dir, "mixing", "other", "no frontmatter here\n");
      const result = await runCli(
        ["-p", "9", "arp", "--prog", "i-VI", "--key", "A minor", "--style", "nope", "track:0"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/looking up arp style "nope" failed: Bad knowledge entry/);
      expect(result.stderr).toContain(file);
      expect(result.stderr).toMatch(/Missing YAML frontmatter/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a slug two entries share is reported as ambiguous, not unknown", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("style-lookup");
    try {
      for (const topic of ["rhythm", "workflow"]) {
        await writeEntry(
          dir,
          topic,
          "arp-style-twice",
          entryText("arp-style-twice", topic, "draft", ["body"]),
        );
      }
      const result = await runCli(
        ["-p", "9", "arp", "--prog", "i-VI", "--key", "A minor", "--style", "twice", "track:0"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(
        /looking up arp style "twice" failed: Slug "arp-style-twice" is ambiguous/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an entry without the kind's fenced block names the block it needs", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("style-lookup");
    try {
      await writeEntry(
        dir,
        "rhythm",
        "arp-style-blockless",
        entryText("arp-style-blockless", "rhythm", "draft", ["no spec block"]),
      );
      const result = await runCli(
        ["-p", "9", "arp", "--prog", "i-VI", "--key", "A minor", "--style", "blockless", "track:0"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(
        /knowledge entry rhythm\/arp-style-blockless\.md has no ```awh-arp-spec block/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(["nope", "operator-recipe-nope"])(
    "op apply %s: a missing recipe is still unknown",
    async (name) => {
      const { dir, libraryRoot } = await makeTestLibrary("style-lookup");
      try {
        const result = await runCli(["-p", "9", "op", "apply", name, "track:0/device:0"], {
          AWH_LIBRARY: libraryRoot,
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(
          new RegExp(
            `unknown operator recipe "${name}" — run \`awh op recipes\` to list them ` +
              `\\(slug "operator-recipe-nope" not found\\)`,
          ),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it("drums gen: a data style found in the knowledge base is written, tier named", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("style-lookup");
    try {
      const topicDir = join(dir, "knowledge", "rhythm");
      await mkdir(topicDir, { recursive: true });
      await copyFile(
        fileURLToPath(
          new URL("../../../knowledge/rhythm/drum-style-dusty-garage.md", import.meta.url),
        ),
        join(topicDir, "drum-style-dusty-garage.md"),
      );
      const env = { AWH_LIBRARY: libraryRoot };
      const gen = (target: string[]) =>
        runCli(
          ["-p", String(port), "drums", "gen", "track:0", "--style", "dusty-garage", ...target],
          env,
        );

      const atBar = await gen(["--at-bar", "1"]);
      expect(atBar.status, atBar.stderr).toBe(0);
      expect(atBar.stdout).toMatch(
        /dusty-garage pattern -> track:0 @ bar 1 \(\d+ hits, 4 bars, seed 1\)/,
      );
      expect(atBar.stdout).toMatch(/knowledgeStyle: drum-style-dusty-garage \[draft\]/);
      const arrClip = (await caller("clip.get", { path: "track:0/arr:0" })) as ClipDetail;
      expect(arrClip.name).toBe("dusty-garage-drums");
      expect(arrClip.notes!.length).toBeGreaterThan(0);

      // no --slot or --at-bar: the first empty session slot
      const autoSlot = await gen([]);
      expect(autoSlot.status, autoSlot.stderr).toBe(0);
      expect(autoSlot.stdout).toMatch(/dusty-garage pattern -> track:0\/slot:\d+ /);

      const slot = await gen(["--slot", "track:0/slot:3"]);
      expect(slot.status, slot.stderr).toBe(0);
      expect(slot.stdout).toMatch(/dusty-garage pattern -> track:0\/slot:3 /);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drums gen: a missing data style is still unknown", async () => {
    const { port } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("style-lookup");
    try {
      const result = await runCli(
        ["-p", String(port), "drums", "gen", "track:0", "--style", "nope", "--at-bar", "1"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/unknown drum style "nope" — built-ins: /);
      expect(result.stderr).toMatch(/slug drum-style-nope/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
