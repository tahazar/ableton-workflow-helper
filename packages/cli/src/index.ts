#!/usr/bin/env node
/**
 * awh — Ableton Workflow Helper CLI.
 *
 * Every command is a deterministic operation against the gateway (the
 * extension running inside Live, or `awh serve-fake` for offline dev).
 * The same commands are what a Claude Code skill drives — no AI-only paths.
 */
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { TAP_PORT, sendToTap } from "./osc.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  listForms,
  planFromForm,
  planFromReferenceSections,
  renderSections,
  validateSectionsPlan,
  type SectionsPlan,
  type SourceClip,
  DEFAULT_GATEWAY_PORT,
  FakeLiveBridge,
  LibraryStore,
  applyPipeline,
  createGatewayServer,
  findLibraryRoot,
  gzipAlc,
  inspectAlcTemplate,
  listTransforms,
  makeRng,
  parseAlcClip,
  parseNotation,
  parsePipeline,
  parseScale,
  renderAlcClip,
  serializeNotation,
  slugify,
  tileNotes,
  ungzipAlc,
  variantSeed,
  writePack,
  GM_DRUM_KIT,
  KnowledgeStore,
  drumFill,
  extractFencedBlock,
  generateDrumPatternDetailed,
  humanizeDrums,
  listDrumStyles,
  listDrumVariants,
  mapPadRoles,
  midiToPitch,
  parseDrumStyleSpec,
  parseProgression,
  renderChords,
  voiceProgression,
  varyDrums,
  type TrapFamilyStyleSpec,
  type ClipDetail,
  type ClipEntry,
  type DrumContext,
  type DrumKit,
  type NoteSpec,
  type PackItem,
  type SetSummary,
  type TransformContext,
} from "@awh/core";

const program = new Command();

program
  .name("awh")
  .description("Ableton Workflow Helper — CLI-first Live workflow tools")
  .option(
    "-p, --port <port>",
    "gateway port",
    String(process.env.AWH_PORT ?? DEFAULT_GATEWAY_PORT),
  )
  .option("--json", "machine-readable JSON output", false);

interface GlobalOpts {
  port: string;
  json: boolean;
}

function gatewayBase(opts: GlobalOpts): string {
  return `http://127.0.0.1:${Number(opts.port)}`;
}

async function callGateway(
  opts: GlobalOpts,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = `${gatewayBase(opts)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(
      `Could not reach the gateway at ${url}.\n` +
        `Is Live running with the AWH extension loaded (or \`awh serve-fake\` for offline dev)?`,
    );
  }
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `Gateway error ${res.status}: ${body.error ?? "unknown"}${
        body.message ? ` — ${body.message}` : ""
      }`,
    );
  }
  return body;
}

function output(opts: GlobalOpts, data: unknown, pretty: () => string): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${pretty()}\n`);
  }
}

program
  .command("ping")
  .description("Check the gateway is alive and which bridge is behind it")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const body = (await callGateway(opts, "/ping")) as {
      bridge: { kind: string; name: string; liveApiVersion?: string };
      uptimeMs: number;
    };
    output(
      opts,
      body,
      () =>
        `gateway OK — bridge: ${body.bridge.name} (${body.bridge.kind}` +
        `${body.bridge.liveApiVersion ? `, Live API ${body.bridge.liveApiVersion}` : ""})` +
        `, up ${Math.round(body.uptimeMs / 1000)}s`,
    );
  });

program
  .command("ops")
  .description("List operations the gateway exposes")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const body = (await callGateway(opts, "/api/ops")) as {
      ops: { name: string; description: string }[];
    };
    output(opts, body, () =>
      body.ops.map((o) => `${o.name.padEnd(20)} ${o.description}`).join("\n"),
    );
  });

program
  .command("call <op>")
  .description("Invoke a gateway operation with optional JSON args")
  .option("-a, --args <json>", "JSON arguments for the op")
  .action(async (op: string, cmdOpts: { args?: string }) => {
    const opts = program.opts<GlobalOpts>();
    let args: unknown;
    if (cmdOpts.args !== undefined) {
      try {
        args = JSON.parse(cmdOpts.args);
      } catch {
        throw new Error("--args must be valid JSON");
      }
    }
    const body = (await callGateway(opts, `/api/ops/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: args === undefined ? undefined : JSON.stringify(args),
    })) as { result: unknown };
    output(opts, body.result, () => JSON.stringify(body.result, null, 2));
  });

program
  .command("status")
  .description("Summary of the open Live Set")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const body = (await callGateway(opts, "/api/ops/set.summary", {
      method: "POST",
    })) as {
      result: {
        tempo: number;
        trackCount: number;
        sceneCount: number;
        tracks: {
          path: string;
          kind: string;
          name: string;
          sessionClips: unknown[];
          arrangementClips: unknown[];
          devices: { name: string }[];
        }[];
      };
    };
    const s = body.result;
    output(opts, s, () =>
      [
        `tempo ${s.tempo} BPM · ${s.trackCount} tracks · ${s.sceneCount} scenes`,
        ...s.tracks.map(
          (t) =>
            `  ${t.path.padEnd(10)} [${t.kind}] ${t.name}` +
            ` — ${t.sessionClips.length} session, ${t.arrangementClips.length} arr clips` +
            (t.devices.length ? ` · ${t.devices.map((d) => d.name).join(", ")}` : ""),
        ),
      ].join("\n"),
    );
  });

async function readNotationInput(file: string | undefined): Promise<string> {
  if (file !== undefined) return readFile(file, "utf8");
  if (process.stdin.isTTY) {
    throw new Error(
      "No notation given: pass a file argument or pipe bar|beat text on stdin.",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const clip = program
  .command("clip")
  .description("Read and write MIDI clips in bar|beat notation");

clip
  .command("read <path>")
  .description("Print a MIDI clip as bar|beat notation (or --json for raw notes)")
  .option("--sig <beatsPerBar>", "beats per bar for bar|beat math", "4")
  .action(async (path: string, cmdOpts: { sig: string }) => {
    const opts = program.opts<GlobalOpts>();
    const body = (await callGateway(opts, "/api/ops/clip.get", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    })) as { result: ClipDetail };
    const detail = body.result;
    if (detail.kind !== "midi" || !detail.notes) {
      throw new Error(`${path} is not a MIDI clip`);
    }
    output(opts, detail, () =>
      [
        `# ${detail.name || "(unnamed)"} — ${detail.duration} beats, ${detail.notes!.length} notes`,
        serializeNotation(detail.notes!, { beatsPerBar: Number(cmdOpts.sig) }),
      ].join("\n"),
    );
  });

clip
  .command("write <path> [file]")
  .description("Replace a MIDI clip's notes from bar|beat notation (file or stdin)")
  .option("--sig <beatsPerBar>", "beats per bar for bar|beat math", "4")
  .action(async (path: string, file: string | undefined, cmdOpts: { sig: string }) => {
    const opts = program.opts<GlobalOpts>();
    const text = await readNotationInput(file);
    const { notes } = parseNotation(text, { beatsPerBar: Number(cmdOpts.sig) });
    await callGateway(opts, "/api/ops/clip.notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, notes }),
    });
    output(opts, { path, noteCount: notes.length }, () =>
      `wrote ${notes.length} notes to ${path}`,
    );
  });

clip
  .command("create <target> [file]")
  .description(
    "Create a MIDI clip from bar|beat notation. Target: a slot path (track:0/slot:2) " +
      "or a track path with --at-bar for the arrangement",
  )
  .option("--at-bar <bar>", "arrangement position (1-based bar) — required for track targets")
  .option("--length <beats>", "clip length in beats (default: notation span, whole bars)")
  .option("--name <name>", "clip name")
  .option("--sig <beatsPerBar>", "beats per bar for bar|beat math", "4")
  .action(
    async (
      target: string,
      file: string | undefined,
      cmdOpts: { atBar?: string; length?: string; name?: string; sig: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const beatsPerBar = Number(cmdOpts.sig);
      const text = await readNotationInput(file);
      const parsed = parseNotation(text, { beatsPerBar });
      const lengthBeats = cmdOpts.length
        ? Number(cmdOpts.length)
        : parsed.suggestedLengthBeats;

      const isSlot = /\/slot:\d+$/.test(target);
      if (!isSlot && cmdOpts.atBar === undefined) {
        throw new Error(
          "Track targets need --at-bar <bar> (or pass a slot path like track:0/slot:2).",
        );
      }
      const targetSpec = isSlot
        ? { type: "session", slotPath: target }
        : {
            type: "arrangement",
            trackPath: target,
            startBeat: (Number(cmdOpts.atBar) - 1) * beatsPerBar,
          };

      const body = (await callGateway(opts, "/api/ops/clip.create-midi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: targetSpec,
          lengthBeats,
          notes: parsed.notes,
          ...(cmdOpts.name ? { name: cmdOpts.name } : {}),
        }),
      })) as { result: { path: string } };
      output(opts, body.result, () =>
        `created ${body.result.path} (${lengthBeats} beats, ${parsed.notes.length} notes)`,
      );
    },
  );

program
  .command("transforms")
  .description("List the deterministic variation transforms")
  .action(() => {
    const opts = program.opts<GlobalOpts>();
    const all = listTransforms();
    output(opts, all, () =>
      all.map((t) => `${t.name.padEnd(18)} ${t.description}`).join("\n"),
    );
  });

program
  .command("vary <clipPath>")
  .description(
    "Generate N variations of a MIDI clip into empty session slots on the same " +
      "(or --dest) track, named <prefix>-v1..N for auditioning",
  )
  .requiredOption("--ops <pipeline>", 'transform pipeline, e.g. "transpose-scale:degrees=2 humanize"')
  .option("-n, --count <n>", "number of variations", "4")
  .option("--seed <seed>", "base random seed (same seed = same variations)", "1")
  .option("--dest <trackPath>", "destination track (default: the source clip's track)")
  .option(
    "--arrange",
    "lay variations out SEQUENTIALLY on the arrangement timeline instead of session slots",
  )
  .option(
    "--at-bar <bar>",
    "with --arrange: 1-based bar to start at (default: right after the track's last arrangement clip)",
  )
  .option("--prefix <prefix>", "variation name prefix (default: source clip name or 'var')")
  .option("--scale <scale>", 'scale for scale-aware transforms, e.g. "C minor" (default: the Set scale if active)')
  .action(
    async (
      clipPath: string,
      cmdOpts: {
        ops: string;
        count: string;
        seed: string;
        dest?: string;
        arrange?: boolean;
        atBar?: string;
        prefix?: string;
        scale?: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const count = Number(cmdOpts.count);
      const baseSeed = Number(cmdOpts.seed);
      const steps = parsePipeline(cmdOpts.ops);

      const source = (
        (await callGateway(opts, "/api/ops/clip.get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: clipPath }),
        })) as { result: ClipDetail }
      ).result;
      if (source.kind !== "midi" || !source.notes) {
        throw new Error(`${clipPath} is not a MIDI clip`);
      }

      const summary = (
        (await callGateway(opts, "/api/ops/set.summary", { method: "POST" })) as {
          result: SetSummary;
        }
      ).result;
      const scale = cmdOpts.scale
        ? parseScale(cmdOpts.scale)
        : summary.scale.active
          ? { rootNote: summary.scale.rootNote, intervals: summary.scale.intervals }
          : undefined;

      const destTrackPath = cmdOpts.dest ?? clipPath.replace(/\/(slot|arr):\d+$/, "");
      const destTrack = [...summary.tracks, ...summary.returnTracks].find(
        (t) => t.path === destTrackPath,
      );
      if (!destTrack) throw new Error(`destination track not found: ${destTrackPath}`);

      const beatsPerBar = 4;
      // Destination plan: session slots (default) or sequential arrangement lay-out.
      let targets: { target: unknown; path: string }[];
      if (cmdOpts.arrange) {
        const lastEnd = destTrack.arrangementClips.reduce(
          (max, c) => Math.max(max, c.endTime ?? 0),
          0,
        );
        const startBeat = cmdOpts.atBar
          ? (Number(cmdOpts.atBar) - 1) * beatsPerBar
          : Math.ceil(lastEnd / beatsPerBar) * beatsPerBar;
        targets = Array.from({ length: count }, (_, i) => {
          const at = startBeat + i * source.duration;
          return {
            target: { type: "arrangement", trackPath: destTrackPath, startBeat: at },
            path: `${destTrackPath} @ bar ${at / beatsPerBar + 1}`,
          };
        });
      } else {
        const occupied = new Set(
          destTrack.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])),
        );
        const emptySlots = Array.from({ length: destTrack.slotCount }, (_, i) => i).filter(
          (i) => !occupied.has(i),
        );
        if (emptySlots.length < count) {
          throw new Error(
            `need ${count} empty session slots on ${destTrackPath}, found ${emptySlots.length} — ` +
              `add scenes, use --dest, --arrange, or awh sweep`,
          );
        }
        targets = emptySlots.slice(0, count).map((slot) => {
          const slotPath = `${destTrackPath}/slot:${slot}`;
          return { target: { type: "session", slotPath }, path: slotPath };
        });
      }

      const prefix = cmdOpts.prefix ?? (source.name ? source.name : "var");
      const created: { path: string; name: string; notes: number }[] = [];
      for (let i = 0; i < count; i++) {
        const ctx: TransformContext = {
          lengthBeats: source.duration,
          beatsPerBar,
          rng: makeRng(variantSeed(baseSeed, i + 1)),
          ...(scale ? { scale } : {}),
        };
        const notes = applyPipeline(steps, source.notes, ctx);
        const name = `${prefix}-v${i + 1}`;
        const t = targets[i]!;
        await callGateway(opts, "/api/ops/clip.create-midi", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: t.target,
            lengthBeats: source.duration,
            notes,
            name,
          }),
        });
        created.push({ path: t.path, name, notes: notes.length });
      }
      output(opts, created, () =>
        [
          `${count} variations of ${clipPath} (seed ${baseSeed})${cmdOpts.arrange ? " on the arrangement" : ""}:`,
          ...created.map((c) => `  ${c.path.padEnd(22)} ${c.name} (${c.notes} notes)`),
          `audition them, then keep favourites and run: awh sweep ${destTrackPath} --prefix ${prefix}-v`,
        ].join("\n"),
      );
    },
  );

program
  .command("sweep <trackPath>")
  .description("Delete session clips on a track whose name starts with --prefix")
  .requiredOption("--prefix <prefix>", "name prefix to match (e.g. bass-v)")
  .action(async (trackPath: string, cmdOpts: { prefix: string }) => {
    const opts = program.opts<GlobalOpts>();
    const summary = (
      (await callGateway(opts, "/api/ops/set.summary", { method: "POST" })) as {
        result: SetSummary;
      }
    ).result;
    const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === trackPath);
    if (!track) throw new Error(`track not found: ${trackPath}`);
    // Session AND arrangement clips; delete in DESCENDING index order so
    // earlier deletions can't shift the paths of later ones.
    const doomed = [...track.sessionClips, ...track.arrangementClips].filter((c) =>
      c.name.startsWith(cmdOpts.prefix),
    );
    doomed.sort((a, b) => {
      const index = (p: string) => Number(p.match(/(\d+)$/)?.[1] ?? 0);
      return index(b.path) - index(a.path);
    });
    for (const clipToDelete of doomed) {
      await callGateway(opts, "/api/ops/clip.delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: clipToDelete.path }),
      });
    }
    output(opts, { deleted: doomed.map((c) => c.path) }, () =>
      doomed.length === 0
        ? `no clips matching "${cmdOpts.prefix}*" on ${trackPath}`
        : `deleted ${doomed.length} clips: ${doomed.map((c) => c.name).join(", ")}`,
    );
  });

const sections = program
  .command("sections")
  .description("Build an arrangement skeleton from source clips via a YAML plan");

sections
  .command("plan")
  .description(
    "Emit an editable YAML sections plan from a genre form preset, or " +
      "--from-ref a corrected reference map (bars sourced from the reference " +
      "instead of a preset — every layer verbatim, no genre ops guessed)",
  )
  .option("--form <form>", `genre form: ${listForms().join(" | ")}`)
  .option(
    "--from-ref <file>",
    "a `ref sections read -o <file>` JSON (or a saved library/references/*.json) " +
      "— mutually exclusive with --form",
  )
  .requiredOption(
    "--role <role=clipPath...>",
    "role bindings, repeatable: --role drums=track:1/slot:0 --role bass=track:2/slot:0",
    (value: string, acc: string[]) => [...acc, value],
    [] as string[],
  )
  .option("-o, --out <file>", "write the plan to a file (default: stdout)")
  .action(async (cmdOpts: { form?: string; fromRef?: string; role: string[]; out?: string }) => {
    if (!cmdOpts.form === !cmdOpts.fromRef) {
      throw new Error("pass exactly one of --form <house|trap> or --from-ref <file>");
    }
    const roles: Record<string, { trackPath: string; source: string }> = {};
    for (const binding of cmdOpts.role) {
      const [role, source] = binding.split("=", 2);
      if (!role || !source) throw new Error(`bad --role "${binding}" (expected role=clipPath)`);
      const trackPath = source.replace(/\/(slot|arr):\d+$/, "");
      if (trackPath === source) throw new Error(`--role ${role}: "${source}" is not a clip path`);
      roles[role] = { trackPath, source };
    }
    let plan: SectionsPlan;
    if (cmdOpts.form) {
      plan = planFromForm(cmdOpts.form, roles);
    } else {
      const parsed = JSON.parse(await readFile(cmdOpts.fromRef!, "utf8")) as {
        sections?: { name: string; start_bar: number; end_bar: number }[];
        reference?: { sections: { name: string; start_bar: number; end_bar: number }[] };
      };
      const refSections = parsed.reference?.sections ?? parsed.sections;
      if (!refSections) throw new Error(`${cmdOpts.fromRef} has no sections`);
      plan = planFromReferenceSections(refSections, roles);
    }
    const text = stringifyYaml(plan);
    if (cmdOpts.out) {
      await writeFile(cmdOpts.out, text, "utf8");
      process.stdout.write(`wrote ${cmdOpts.out} — edit it, then: awh sections apply ${cmdOpts.out}\n`);
    } else {
      process.stdout.write(text);
    }
  });

sections
  .command("apply <planFile>")
  .description("Render a YAML sections plan into arrangement clips (create-at-position)")
  .option("--at-bar <bar>", "1-based bar to start the skeleton at", "1")
  .option("--seed <seed>", "base seed (same seed + plan = same skeleton)", "1")
  .option("--scale <scale>", 'scale for scale-aware ops (default: Set scale if active)')
  .option("--clear", "clear each target track's arrangement span first (truncates boundary clips)")
  .option("--dry-run", "print what would be created without writing")
  .action(
    async (
      planFile: string,
      cmdOpts: { atBar: string; seed: string; scale?: string; clear?: boolean; dryRun?: boolean },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const beatsPerBar = 4;
      const atBar = Number(cmdOpts.atBar);
      const plan = validateSectionsPlan(parseYaml(await readFile(planFile, "utf8")));

      const summary = (
        (await callGateway(opts, "/api/ops/set.summary", { method: "POST" })) as {
          result: SetSummary;
        }
      ).result;
      const scale = cmdOpts.scale
        ? parseScale(cmdOpts.scale)
        : summary.scale.active
          ? { rootNote: summary.scale.rootNote, intervals: summary.scale.intervals }
          : undefined;

      // Fetch every distinct source once.
      const sourcePaths = new Set<string>();
      for (const section of plan.sections) {
        for (const directive of Object.values(section.tracks)) {
          if (directive !== "off") sourcePaths.add(directive.source);
        }
      }
      const sources = new Map<string, SourceClip>();
      for (const path of sourcePaths) {
        const clip = (
          (await callGateway(opts, "/api/ops/clip.get", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
          })) as { result: ClipDetail }
        ).result;
        if (clip.kind !== "midi" || !clip.notes) throw new Error(`source ${path} is not a MIDI clip`);
        sources.set(path, { notes: clip.notes, lengthBeats: clip.duration });
      }

      const rendered = renderSections(plan, sources, {
        atBar,
        beatsPerBar,
        seed: Number(cmdOpts.seed),
        ...(scale ? { scale } : {}),
      });
      const startBeat = (atBar - 1) * beatsPerBar;
      const endBeat = startBeat + rendered.totalBars * beatsPerBar;

      // Safety: refuse to write over existing arrangement material unless --clear.
      const targetTracks = [...new Set(rendered.clips.map((c) => c.trackPath))];
      for (const trackPath of targetTracks) {
        const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === trackPath);
        if (!track) throw new Error(`plan targets unknown track ${trackPath}`);
        const collision = track.arrangementClips.some(
          (c) => (c.startTime ?? 0) < endBeat && (c.endTime ?? 0) > startBeat,
        );
        if (collision && !cmdOpts.clear && !cmdOpts.dryRun) {
          throw new Error(
            `${trackPath} already has arrangement clips in bars ${atBar}-${atBar + rendered.totalBars} — ` +
              `re-run with --clear to clear that span, or --at-bar past the song's end`,
          );
        }
      }

      if (cmdOpts.dryRun) {
        output(opts, rendered, () =>
          [
            `${plan.name}: ${rendered.totalBars} bars, ${rendered.clips.length} clips (dry run)`,
            ...rendered.clips.map(
              (c) =>
                `  bar ${c.startBeat / beatsPerBar + 1}`.padEnd(10) +
                `${c.name.padEnd(22)} ${c.trackPath} (${c.lengthBeats} beats, ${c.notes.length} notes)`,
            ),
          ].join("\n"),
        );
        return;
      }

      if (cmdOpts.clear) {
        for (const trackPath of targetTracks) {
          await callGateway(opts, "/api/ops/track.clear-range", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: trackPath, startBeat, endBeat }),
          });
        }
      }

      for (const clip of rendered.clips) {
        await callGateway(opts, "/api/ops/clip.create-midi", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: { type: "arrangement", trackPath: clip.trackPath, startBeat: clip.startBeat },
            lengthBeats: clip.lengthBeats,
            notes: clip.notes,
            name: clip.name,
          }),
        });
      }
      output(opts, rendered, () =>
        [
          `${plan.name}: ${rendered.totalBars} bars, ${rendered.clips.length} clips written from bar ${atBar}`,
          ...plan.sections.map((s) => `  ${s.name}`),
          `press play — and re-run with the same --seed to reproduce exactly`,
        ].join("\n"),
      );
    },
  );

// ---------------------------------------------------------------------------
// Drums (M5): pad-aware pattern generation and drum-specialized rework.
// ---------------------------------------------------------------------------

/** Find the drum-rack pads on a track (first device that has any). */
function trackDrumKit(summary: SetSummary, trackPath: string): {
  kit: DrumKit;
  usedRack: boolean;
} {
  const track = [...summary.tracks, ...summary.returnTracks].find(
    (t) => t.path === trackPath,
  );
  if (!track) throw new Error(`track not found: ${trackPath}`);
  const pads = track.devices.find((d) => d.drumPads?.length)?.drumPads;
  if (pads?.length) return { kit: mapPadRoles(pads), usedRack: true };
  return { kit: GM_DRUM_KIT, usedRack: false };
}

function drumContext(cmdOpts: {
  bars?: string;
  density?: string;
  seed?: string;
  sig?: string;
}, seedOffset = 0): DrumContext {
  return {
    bars: Number(cmdOpts.bars ?? 4),
    beatsPerBar: Number(cmdOpts.sig ?? 4),
    density: Number(cmdOpts.density ?? 0.5),
    rng: makeRng(variantSeed(Number(cmdOpts.seed ?? 1), seedOffset)),
  };
}

const drums = program
  .command("drums")
  .description("Pad-map-aware drum pattern tools (generate, fill, humanize, vary)");

drums
  .command("gen <trackPath>")
  .description(
    "Generate a genre drum pattern for a track's drum rack (GM fallback) into " +
      "an empty session slot, --slot, or --at-bar on the arrangement",
  )
  .requiredOption("--style <style>", `one of: ${listDrumStyles().join(", ")}`)
  .option("--bars <bars>", "pattern length in bars", "4")
  .option("--density <density>", "0..1 — busyness of the top end", "0.5")
  .option("--seed <seed>", "random seed (same seed = same pattern)", "1")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .option("--slot <slotPath>", "explicit session slot target")
  .option("--at-bar <bar>", "arrangement position (1-based bar)")
  .option("--name <name>", "clip name (default: <style>-drums)")
  .option(
    "--variant <variant>",
    "force a named groove variant (e.g. trap kick cell: hold, double-tap, " +
      "late-lean, rolling, sparse, syncopated) or its index",
  )
  .action(
    async (
      trackPath: string,
      cmdOpts: {
        style: string;
        bars: string;
        density: string;
        seed: string;
        sig: string;
        slot?: string;
        atBar?: string;
        name?: string;
        variant?: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const summary = (await op(opts, "set.summary")) as SetSummary;
      const { kit, usedRack } = trackDrumKit(summary, trackPath);
      const ctx = drumContext(cmdOpts);

      // built-in style, or a data-driven one from the knowledge base:
      // a `drum-style-<name>` entry with an ```awh-style-spec``` block
      let styleSpec: TrapFamilyStyleSpec | undefined;
      let styleTier: string | undefined;
      if (!listDrumStyles().includes(cmdOpts.style)) {
        let entry;
        try {
          entry = await knowledgeStore().loadEntry(`drum-style-${cmdOpts.style}`);
        } catch {
          throw new Error(
            `unknown drum style "${cmdOpts.style}" — built-ins: ${listDrumStyles().join(", ")}; ` +
              `data styles need a knowledge entry with slug drum-style-${cmdOpts.style} ` +
              "(see knowledge/README.md)",
          );
        }
        const specText = extractFencedBlock(entry.body, "awh-style-spec");
        if (!specText) {
          throw new Error(
            `knowledge entry ${entry.relPath} has no \`\`\`awh-style-spec block`,
          );
        }
        styleSpec = parseDrumStyleSpec(specText);
        styleTier = entry.tier;
      }

      let variant: number | undefined;
      if (cmdOpts.variant !== undefined) {
        const names = listDrumVariants(cmdOpts.style, styleSpec);
        if (names.length === 0) {
          throw new Error(`style "${cmdOpts.style}" has no named variants (seed-only)`);
        }
        variant = /^\d+$/.test(cmdOpts.variant)
          ? Number(cmdOpts.variant)
          : names.indexOf(cmdOpts.variant);
        if (variant < 0) {
          throw new Error(
            `unknown variant "${cmdOpts.variant}" (available: ${names.join(", ")})`,
          );
        }
      }

      const { notes, meta } = generateDrumPatternDetailed(cmdOpts.style, kit, ctx, {
        ...(variant !== undefined ? { variant } : {}),
        ...(styleSpec ? { styleSpec } : {}),
      });
      if (styleTier) meta.knowledgeStyle = `drum-style-${cmdOpts.style} [${styleTier}]`;
      const lengthBeats = ctx.bars * ctx.beatsPerBar;

      let target: unknown;
      let where: string;
      if (cmdOpts.atBar !== undefined) {
        const startBeat = (Number(cmdOpts.atBar) - 1) * ctx.beatsPerBar;
        target = { type: "arrangement", trackPath, startBeat };
        where = `${trackPath} @ bar ${cmdOpts.atBar}`;
      } else if (cmdOpts.slot) {
        target = { type: "session", slotPath: cmdOpts.slot };
        where = cmdOpts.slot;
      } else {
        const track = summary.tracks.find((t) => t.path === trackPath)!;
        const occupied = new Set(
          track.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])),
        );
        const free = Array.from({ length: track.slotCount }, (_, i) => i).find(
          (i) => !occupied.has(i),
        );
        if (free === undefined) {
          throw new Error(`no empty session slot on ${trackPath} — pass --slot or --at-bar`);
        }
        const slotPath = `${trackPath}/slot:${free}`;
        target = { type: "session", slotPath };
        where = slotPath;
      }

      const name = cmdOpts.name ?? `${cmdOpts.style}-drums`;
      const result = (await op(opts, "clip.create-midi", {
        target,
        lengthBeats,
        notes,
        name,
      })) as { path: string };
      const metaLine = Object.entries(meta)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
      output(opts, { path: result.path, notes: notes.length, usedRack, meta }, () =>
        [
          `${cmdOpts.style} pattern -> ${where} (${notes.length} hits, ${ctx.bars} bars, seed ${cmdOpts.seed})`,
          ...(metaLine ? [metaLine] : []),
          usedRack
            ? `pad roles mapped from the track's drum rack`
            : `NOTE: no drum rack on ${trackPath} — used General MIDI note numbers`,
        ].join("\n"),
      );
    },
  );

drums
  .command("detect-onsets <audio>")
  .description(
    "Detect real drum-hit positions in an audio capture (for audio one-shot " +
      "kits with no MIDI Trigger clip) — prints trigger BEATS at the Set " +
      "tempo; --make-clip writes them as a MIDI Trigger clip",
  )
  .option("--min-gap-ms <ms>", "minimum gap between onsets", "80")
  .option("--quantize <grid>", "snap beats to a grid (e.g. 0.25 = 16ths; 'off' to keep raw)", "0.25")
  .option("--make-clip <target>", "create a Trigger MIDI clip (slot path, or track path + --at-bar)")
  .option("--at-bar <bar>", "arrangement position for --make-clip track targets")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .action(
    async (
      audio: string,
      cmdOpts: {
        minGapMs: string;
        quantize: string;
        makeClip?: string;
        atBar?: string;
        sig: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const result = (await runAnalysisJson([
        "onsets",
        audio,
        "--min-gap-ms",
        cmdOpts.minGapMs,
      ])) as unknown as { onsets_s: number[] };
      const summary = (await op(opts, "set.summary")) as SetSummary;
      const beatsPerSec = summary.tempo / 60;
      let beats = result.onsets_s.map((s) => s * beatsPerSec);
      if (cmdOpts.quantize !== "off") {
        const grid = Number(cmdOpts.quantize);
        beats = [...new Set(beats.map((b) => Math.round(b / grid) * grid))];
      }
      const beatsPerBar = Number(cmdOpts.sig);
      const pretty = () =>
        [
          `${beats.length} onsets at ${summary.tempo} BPM (capture assumed to start on the beat):`,
          `  beats: ${beats.map((b) => b.toFixed(2)).join(",")}`,
          `use with: awh mix duck fit <drums> --triggers "${beats.map((b) => b.toFixed(3)).join(",")}"`,
        ].join("\n");

      if (!cmdOpts.makeClip) {
        output(opts, { beats, tempo: summary.tempo }, pretty);
        return;
      }
      const lengthBeats = Math.ceil(Math.max(...beats) / beatsPerBar + 0.001) * beatsPerBar;
      const isSlot = /\/slot:\d+$/.test(cmdOpts.makeClip);
      if (!isSlot && cmdOpts.atBar === undefined) {
        throw new Error("--make-clip with a track path needs --at-bar");
      }
      const created = (await op(opts, "clip.create-midi", {
        target: isSlot
          ? { type: "session", slotPath: cmdOpts.makeClip }
          : {
              type: "arrangement",
              trackPath: cmdOpts.makeClip,
              startBeat: (Number(cmdOpts.atBar) - 1) * beatsPerBar,
            },
        lengthBeats,
        notes: beats.map((b) => ({ pitch: 36, start: b, duration: 0.25, velocity: 100 })),
        name: "Trigger (detected)",
      })) as { path: string };
      output(opts, { beats, clip: created.path }, () =>
        `${pretty()}\nTrigger clip -> ${created.path} (${beats.length} notes, C1)`,
      );
    },
  );

/** Shared read-transform-write for in-place drum rework commands. */
async function reworkDrumClip(
  clipPath: string,
  cmdOpts: { density?: string; seed?: string; sig?: string },
  rework: (notes: NoteSpec[], kit: DrumKit, ctx: DrumContext) => NoteSpec[],
): Promise<{ before: number; after: number; usedRack: boolean }> {
  const opts = program.opts<GlobalOpts>();
  const detail = (await op(opts, "clip.get", { path: clipPath })) as ClipDetail;
  if (detail.kind !== "midi" || !detail.notes) {
    throw new Error(`${clipPath} is not a MIDI clip`);
  }
  const summary = (await op(opts, "set.summary")) as SetSummary;
  const trackPath = clipPath.replace(/\/(slot|arr):\d+$/, "");
  const { kit, usedRack } = trackDrumKit(summary, trackPath);
  const beatsPerBar = Number(cmdOpts.sig ?? 4);
  const ctx: DrumContext = {
    bars: Math.max(1, Math.round(detail.duration / beatsPerBar)),
    beatsPerBar,
    density: Number(cmdOpts.density ?? 0.5),
    rng: makeRng(variantSeed(Number(cmdOpts.seed ?? 1), 0)),
  };
  const notes = rework(detail.notes, kit, ctx);
  await op(opts, "clip.notes", { path: clipPath, notes });
  return { before: detail.notes.length, after: notes.length, usedRack };
}

drums
  .command("fill <clipPath>")
  .description("Replace the clip's last-bar tail with a fill (in place; one undo)")
  .option("--style <style>", "fill flavour (house/techno/trap)", "house")
  .option("--density <density>", "0..1 — 0.7+ replaces the whole last bar", "0.5")
  .option("--seed <seed>", "random seed", "1")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .action(async (clipPath: string, cmdOpts: { style: string; density: string; seed: string; sig: string }) => {
    const opts = program.opts<GlobalOpts>();
    const r = await reworkDrumClip(clipPath, cmdOpts, (notes, kit, ctx) =>
      drumFill(notes, kit, ctx, { style: cmdOpts.style }),
    );
    output(opts, r, () =>
      `fill written into ${clipPath} (${r.before} -> ${r.after} notes) — one undo reverts`,
    );
  });

drums
  .command("humanize <clipPath>")
  .description("Role-aware groove: kick stays tight, hats loosen (in place)")
  .option("--timing <beats>", "max timing jitter in beats", "0.02")
  .option("--velocity <amount>", "max velocity jitter", "8")
  .option("--seed <seed>", "random seed", "1")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .action(
    async (
      clipPath: string,
      cmdOpts: { timing: string; velocity: string; seed: string; sig: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const r = await reworkDrumClip(clipPath, cmdOpts, (notes, kit, ctx) =>
        humanizeDrums(notes, kit, ctx, {
          timing: Number(cmdOpts.timing),
          velocity: Number(cmdOpts.velocity),
        }),
      );
      output(opts, r, () => `humanized ${clipPath} (${r.after} notes) — one undo reverts`);
    },
  );

drums
  .command("vary <clipPath>")
  .description(
    "N drum-specialized variations into empty session slots (kick anchors kept, " +
      "hats re-rolled, ghost snares) — like awh vary but role-aware",
  )
  .option("-n, --count <n>", "number of variations", "4")
  .option("--amount <amount>", "0..1 — how far to stray", "0.5")
  .option("--seed <seed>", "base random seed", "1")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .option("--prefix <prefix>", "variation name prefix (default: clip name or 'drums')")
  .action(
    async (
      clipPath: string,
      cmdOpts: { count: string; amount: string; seed: string; sig: string; prefix?: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const count = Number(cmdOpts.count);
      const detail = (await op(opts, "clip.get", { path: clipPath })) as ClipDetail;
      if (detail.kind !== "midi" || !detail.notes) {
        throw new Error(`${clipPath} is not a MIDI clip`);
      }
      const summary = (await op(opts, "set.summary")) as SetSummary;
      const trackPath = clipPath.replace(/\/(slot|arr):\d+$/, "");
      const { kit, usedRack } = trackDrumKit(summary, trackPath);
      const track = summary.tracks.find((t) => t.path === trackPath)!;
      const occupied = new Set(
        track.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])),
      );
      const free = Array.from({ length: track.slotCount }, (_, i) => i).filter(
        (i) => !occupied.has(i),
      );
      if (free.length < count) {
        throw new Error(
          `need ${count} empty session slots on ${trackPath}, found ${free.length} — ` +
            "add scenes or sweep old auditions",
        );
      }
      const beatsPerBar = Number(cmdOpts.sig);
      const prefix = cmdOpts.prefix ?? (detail.name || "drums");
      const created: { path: string; name: string }[] = [];
      for (let i = 0; i < count; i++) {
        const ctx: DrumContext = {
          bars: Math.max(1, Math.round(detail.duration / beatsPerBar)),
          beatsPerBar,
          density: 0.5,
          rng: makeRng(variantSeed(Number(cmdOpts.seed), i + 1)),
        };
        const notes = varyDrums(detail.notes, kit, ctx, { amount: Number(cmdOpts.amount) });
        const name = `${prefix}-v${i + 1}`;
        const slotPath = `${trackPath}/slot:${free[i]}`;
        await op(opts, "clip.create-midi", {
          target: { type: "session", slotPath },
          lengthBeats: detail.duration,
          notes,
          name,
        });
        created.push({ path: slotPath, name });
      }
      output(opts, { created, usedRack }, () =>
        [
          `${count} drum variations of ${clipPath} (seed ${cmdOpts.seed}):`,
          ...created.map((c) => `  ${c.path.padEnd(22)} ${c.name}`),
          `audition, keep favourites, then: awh sweep ${trackPath} --prefix ${prefix}-v`,
        ].join("\n"),
      );
    },
  );

// ---------------------------------------------------------------------------
// Library (B3): save clips from the Set, browse, place back, mirror to Live.
// ---------------------------------------------------------------------------

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

async function op(opts: GlobalOpts, name: string, args?: unknown): Promise<unknown> {
  const body = (await callGateway(opts, `/api/ops/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: args === undefined ? undefined : JSON.stringify(args),
  })) as { result: unknown };
  return body.result;
}

function libraryStore(cmdOpts: { library?: string }): LibraryStore {
  return new LibraryStore(cmdOpts.library ?? findLibraryRoot());
}

function splitTags(tags: string | undefined): string[] {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

program
  .command("save <clipPath>")
  .description("Save a MIDI clip from the open Set into the library (notes + context)")
  .requiredOption("--category <category>", "library category, e.g. hats, kicks, bass")
  .option("--as <slug>", "slug (default: derived from the clip name)")
  .option("--tags <tags>", "comma-separated tags")
  .option("--tier <tier>", "verified | sourced | draft", "draft")
  .option("--title <title>", "entry title (default: clip name or slug)")
  .option("--project <name>", "source project name for provenance")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .option("--overwrite", "replace an existing entry with the same slug")
  .option("--library <dir>", "library root (default: ./library, walking up)")
  .action(
    async (
      clipPath: string,
      cmdOpts: {
        category: string;
        as?: string;
        tags?: string;
        tier: string;
        title?: string;
        project?: string;
        sig: string;
        overwrite?: boolean;
        library?: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const detail = (await op(opts, "clip.get", { path: clipPath })) as ClipDetail;
      if (detail.kind !== "midi" || !detail.notes || detail.notes.length === 0) {
        throw new Error(`${clipPath} is not a MIDI clip with notes`);
      }
      const summary = (await op(opts, "set.summary")) as SetSummary;
      const beatsPerBar = Number(cmdOpts.sig);
      const slug = cmdOpts.as ?? slugify(detail.name || "clip");
      const entry: ClipEntry = {
        slug,
        kind: "midi",
        category: cmdOpts.category,
        tags: splitTags(cmdOpts.tags),
        bpm: summary.tempo,
        scale: summary.scale.active
          ? `${PITCH_CLASSES[summary.scale.rootNote % 12]} ${summary.scale.name}`
          : null,
        lengthBeats: detail.duration,
        ...(beatsPerBar !== 4 ? { beatsPerBar } : {}),
        source: {
          project: cmdOpts.project ?? null,
          path: clipPath,
          saved: new Date().toISOString().slice(0, 10),
        },
        tier: cmdOpts.tier as ClipEntry["tier"],
        title: cmdOpts.title ?? (detail.name || slug),
        notation: serializeNotation(detail.notes, { beatsPerBar }),
      };
      const store = libraryStore(cmdOpts);
      const file = await store.saveClip(entry, { overwrite: cmdOpts.overwrite });
      await store.buildIndex();
      output(opts, { file, slug }, () =>
        `saved ${clipPath} -> ${file}\nplace it later with: awh lib place ${slug} <target>`,
      );
    },
  );

const lib = program
  .command("lib")
  .description("Browse the clip library and mirror it into Live's browser");

lib
  .command("list")
  .description("List library clips")
  .option("--category <category>", "filter by category")
  .option("--tag <tag>", "filter by tag")
  .option("--library <dir>", "library root")
  .action(async (cmdOpts: { category?: string; tag?: string; library?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const entries = await libraryStore(cmdOpts).listClips({
      ...(cmdOpts.category ? { category: cmdOpts.category } : {}),
      ...(cmdOpts.tag ? { tag: cmdOpts.tag } : {}),
    });
    output(opts, entries, () =>
      entries.length === 0
        ? "no matching library clips"
        : entries
            .map(
              (e) =>
                `${e.slug.padEnd(28)} ${e.category.padEnd(10)} ${String(e.lengthBeats).padStart(3)} beats  ` +
                `${(e.bpm ? `${e.bpm} bpm` : "").padEnd(8)} [${e.tier}] ${e.tags.join(",")}`,
            )
            .join("\n"),
    );
  });

lib
  .command("show <slug>")
  .description("Print a library entry (full markdown)")
  .option("--library <dir>", "library root")
  .action(async (slug: string, cmdOpts: { library?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const store = libraryStore(cmdOpts);
    const entry = await store.loadClip(slug);
    const file = join(store.root, entry.relPath);
    output(opts, entry, () => readFileSync(file, "utf8").trimEnd());
  });

lib
  .command("place <slug> <target>")
  .description(
    "Write a library clip into the Set. Target: slot path, arr clip path, or " +
      "track path with --at-bar. An EXISTING clip at the target is filled " +
      "(notes tiled/truncated to its length) rather than skipped or duplicated.",
  )
  .option("--at-bar <bar>", "arrangement position (1-based bar) for track targets")
  .option("--name <name>", "clip name (default: the slug)")
  .option("--library <dir>", "library root")
  .action(
    async (
      slug: string,
      target: string,
      cmdOpts: { atBar?: string; name?: string; library?: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const entry = await libraryStore(cmdOpts).loadClip(slug);
      if (!entry.notation) throw new Error(`${slug} has no notation block to place`);
      const beatsPerBar = entry.beatsPerBar ?? 4;
      const { notes: sourceNotes } = parseNotation(entry.notation, { beatsPerBar });
      const isSlotPath = /\/slot:\d+$/.test(target);
      const isArrPath = /\/arr:\d+$/.test(target);

      let existing: { path: string; lengthBeats: number } | undefined;
      if (isSlotPath || isArrPath) {
        try {
          const detail = (await op(opts, "clip.get", { path: target })) as ClipDetail;
          existing = { path: target, lengthBeats: detail.duration };
        } catch {
          // no clip there yet — fall through to create (slot paths only; an
          // arr path with nothing at it isn't a valid create target).
          if (isArrPath) {
            throw new Error(
              `no clip at ${target} — arr paths must point at an existing clip to fill`,
            );
          }
        }
      } else if (cmdOpts.atBar !== undefined) {
        const summary = (await op(opts, "set.summary")) as SetSummary;
        const track = [...summary.tracks, ...summary.returnTracks].find(
          (t) => t.path === target,
        );
        if (!track) throw new Error(`track not found: ${target}`);
        const startBeat = (Number(cmdOpts.atBar) - 1) * beatsPerBar;
        const endBeat = startBeat + entry.lengthBeats;
        const overlap = track.arrangementClips.find(
          (c) => startBeat < (c.endTime ?? 0) && endBeat > (c.startTime ?? 0),
        );
        if (overlap) existing = { path: overlap.path, lengthBeats: overlap.duration };
      } else {
        throw new Error(
          "Track targets need --at-bar <bar> (or pass a slot/arr clip path).",
        );
      }

      let result: { path: string };
      let placedNotes = sourceNotes;
      if (existing) {
        placedNotes = tileNotes(sourceNotes, entry.lengthBeats, existing.lengthBeats);
        await op(opts, "clip.notes", { path: existing.path, notes: placedNotes });
        await op(opts, "clip.update", {
          path: existing.path,
          name: cmdOpts.name ?? entry.slug,
        });
        result = { path: existing.path };
      } else {
        result = (await op(opts, "clip.create-midi", {
          target: isSlotPath
            ? { type: "session", slotPath: target }
            : {
                type: "arrangement",
                trackPath: target,
                startBeat: (Number(cmdOpts.atBar) - 1) * beatsPerBar,
              },
          lengthBeats: entry.lengthBeats,
          notes: sourceNotes,
          name: cmdOpts.name ?? entry.slug,
        })) as { path: string };
      }
      output(opts, result, () =>
        `placed ${slug} [${entry.tier}] -> ${result.path} ` +
          `(${placedNotes.length} notes, ${existing ? existing.lengthBeats : entry.lengthBeats} beats` +
          `${existing ? ", filled existing clip" : ""})`,
      );
    },
  );

lib
  .command("index")
  .description("Regenerate library INDEX.md files")
  .option("--library <dir>", "library root")
  .action(async (cmdOpts: { library?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const store = libraryStore(cmdOpts);
    const content = await store.buildIndex();
    output(opts, { root: store.root }, () => content.trimEnd());
  });

// --- B3d: Live browser mirror ------------------------------------------

const TEMPLATE_REL = join("templates", "midi-clip.xml");

interface MirrorConfig {
  uniqueId: string;
  name: string;
  vendor: string;
  revision: number;
}

async function loadMirrorConfig(store: LibraryStore): Promise<MirrorConfig> {
  const file = join(store.root, "mirror.json");
  try {
    return JSON.parse(await readFile(file, "utf8")) as MirrorConfig;
  } catch {
    return { uniqueId: "org.awh.user-library", name: "AWH Library", vendor: "awh", revision: 0 };
  }
}

async function saveMirrorConfig(store: LibraryStore, config: MirrorConfig): Promise<void> {
  await writeFile(join(store.root, "mirror.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

lib
  .command("capture-template <alcFile>")
  .description(
    "Store a Live-saved .alc as the golden template for export-alc. Capture it by " +
      "dragging ONE MIDI clip (with notes, from a device-free track) into the User Library",
  )
  .option("--library <dir>", "library root")
  .action(async (alcFile: string, cmdOpts: { library?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const store = libraryStore(cmdOpts);
    const xml = ungzipAlc(await readFile(alcFile));
    const info = inspectAlcTemplate(xml);
    const dest = join(store.root, TEMPLATE_REL);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, xml, "utf8");
    output(opts, { dest, ...info }, () =>
      [
        `template captured -> ${dest}`,
        `  from: ${info.creator}`,
        `  clip "${info.clipName}", ${info.noteCount} notes`,
        `  note schema: ${info.noteAttrs.join(", ")}`,
      ].join("\n"),
    );
  });

lib
  .command("export-alc")
  .description(
    "Mirror the library into a Live 12 browser Pack of .alc clips (drag the pack " +
      "folder into Live's Places once; later exports re-index automatically)",
  )
  .option("--dest <dir>", "pack directory (default: <repo>/live-mirror/AWH Library)")
  .option("--category <category>", "export only one category")
  .option("--library <dir>", "library root")
  .action(async (cmdOpts: { dest?: string; category?: string; library?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const store = libraryStore(cmdOpts);
    const templateFile = join(store.root, TEMPLATE_REL);
    let template: string;
    try {
      template = await readFile(templateFile, "utf8");
    } catch {
      throw new Error(
        `No golden template at ${templateFile}.\n` +
          "In Live 12: put ONE MIDI clip (with notes) on a track with no devices, drag it " +
          "into the User Library, then run: awh lib capture-template <path-to-that.alc>",
      );
    }
    const entries = (await store.listClips(
      cmdOpts.category ? { category: cmdOpts.category } : {},
    )).filter((e) => e.kind === "midi" && e.notation);
    // Proceed even with 0 entries: writePack wipes stale content from a
    // pack it owns, so this is what keeps the mirror in sync if the
    // library (or the --category slice of it) goes back to empty —
    // erroring out here would silently leave old clips in Live's browser.

    const config = await loadMirrorConfig(store);
    config.revision += 1;

    const items: PackItem[] = entries.map((e) => {
      const beatsPerBar = e.beatsPerBar ?? 4;
      const { notes } = parseNotation(e.notation!, { beatsPerBar });
      const xml = renderAlcClip(template, {
        name: e.title,
        notes,
        lengthBeats: e.lengthBeats,
        ...(Number.isInteger(beatsPerBar)
          ? { sigNumerator: beatsPerBar, sigDenominator: 4 }
          : {}),
      });
      return {
        relPath: `${e.category}/${e.slug}.alc`,
        content: gzipAlc(xml),
        keywords: [["AWH", e.category], ...e.tags.map((t) => ["AWH Tags", t])],
      };
    });

    const dest = cmdOpts.dest ?? join(store.root, "..", "live-mirror", config.name);
    await writePack(dest, {
      uniqueId: config.uniqueId,
      name: config.name,
      vendor: config.vendor,
      revision: config.revision,
    }, items);
    await saveMirrorConfig(store, config);
    output(opts, { dest, revision: config.revision, clips: items.map((i) => i.relPath) }, () =>
      [
        `exported ${items.length} clips -> ${dest} (pack revision ${config.revision})`,
        ...items.map((i) => `  ${i.relPath}`),
        `first time only: drag "${dest}" into Live's browser sidebar (Places) — `,
        `after that, re-exports show up on their own via the revision bump`,
      ].join("\n"),
    );
  });

lib
  .command("import-alc <alcFile>")
  .description("Import a Live Clip (.alc) into the library (reverse flow)")
  .requiredOption("--category <category>", "library category")
  .option("--as <slug>", "slug (default: derived from the clip name)")
  .option("--tags <tags>", "comma-separated tags")
  .option("--tier <tier>", "verified | sourced | draft", "draft")
  .option("--bpm <bpm>", "tempo context, if known")
  .option("--overwrite", "replace an existing entry with the same slug")
  .option("--library <dir>", "library root")
  .action(
    async (
      alcFile: string,
      cmdOpts: {
        category: string;
        as?: string;
        tags?: string;
        tier: string;
        bpm?: string;
        overwrite?: boolean;
        library?: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const parsed = parseAlcClip(ungzipAlc(await readFile(alcFile)));
      if (parsed.notes.length === 0) throw new Error(`${alcFile} contains no notes`);
      const beatsPerBar =
        parsed.sigNumerator && parsed.sigDenominator
          ? (parsed.sigNumerator * 4) / parsed.sigDenominator
          : 4;
      const slug = cmdOpts.as ?? slugify(parsed.name || "imported-clip");
      const entry: ClipEntry = {
        slug,
        kind: "midi",
        category: cmdOpts.category,
        tags: splitTags(cmdOpts.tags),
        bpm: cmdOpts.bpm ? Number(cmdOpts.bpm) : null,
        scale: null,
        lengthBeats: parsed.lengthBeats,
        ...(beatsPerBar !== 4 ? { beatsPerBar } : {}),
        source: {
          project: null,
          path: alcFile,
          saved: new Date().toISOString().slice(0, 10),
        },
        tier: cmdOpts.tier as ClipEntry["tier"],
        title: parsed.name || slug,
        notation: serializeNotation(parsed.notes, { beatsPerBar }),
      };
      const store = libraryStore(cmdOpts);
      const file = await store.saveClip(entry, { overwrite: cmdOpts.overwrite });
      await store.buildIndex();
      output(opts, { file, slug }, () =>
        `imported ${alcFile} -> ${file} (${parsed.notes.length} notes, ${parsed.lengthBeats} beats)`,
      );
    },
  );

// ---------------------------------------------------------------------------
// Knowledge base (B4): tiered, executable-first entries; open-ended topics;
// measurement records surfaced alongside. See knowledge/README.md.
// ---------------------------------------------------------------------------

function knowledgeStore(): KnowledgeStore {
  const root = repoRoot();
  return new KnowledgeStore(
    join(root, "knowledge"),
    join(findLibraryRoot(), "measurements"),
    join(findLibraryRoot(), "references"),
  );
}

const kb = program
  .command("kb")
  .description("Browse the knowledge base (knowledge/ + measurement records)");

kb
  .command("list")
  .description("List knowledge entries")
  .option("--topic <topic>", "topic prefix filter (topics are open-ended directories)")
  .option("--tag <tag>", "tag filter")
  .option("--tier <tier>", "verified | sourced | draft")
  .action(async (cmdOpts: { topic?: string; tag?: string; tier?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const entries = await knowledgeStore().listEntries({
      ...(cmdOpts.topic ? { topic: cmdOpts.topic } : {}),
      ...(cmdOpts.tag ? { tag: cmdOpts.tag } : {}),
      ...(cmdOpts.tier ? { tier: cmdOpts.tier } : {}),
    });
    output(opts, entries, () =>
      entries.length === 0
        ? "no matching knowledge entries"
        : entries
            .map(
              (e) =>
                `${e.slug.padEnd(30)} ${e.topic.padEnd(16)} [${e.tier}]` +
                `${e.executable ? "" : " PROSE-ONLY"} ${e.tags.join(",")}`,
            )
            .join("\n"),
    );
  });

kb
  .command("topics")
  .description("List knowledge topics (discovered from the tree)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const topics = await knowledgeStore().listTopics();
    output(opts, topics, () => (topics.length ? topics.join("\n") : "no topics yet"));
  });

kb
  .command("show <slug>")
  .description("Print a knowledge entry (full markdown)")
  .action(async (slug: string) => {
    const opts = program.opts<GlobalOpts>();
    const store = knowledgeStore();
    const entry = await store.loadEntry(slug);
    output(opts, entry, () => readFileSync(join(store.root, entry.relPath), "utf8").trimEnd());
  });

kb
  .command("index")
  .description("Regenerate knowledge/INDEX.md (entries by topic + measurement records)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const content = await knowledgeStore().buildIndex();
    output(opts, { root: knowledgeStore().root }, () => content.trimEnd());
  });

kb
  .command("new <topic> <slug>")
  .description("Scaffold a well-formed knowledge entry (tier: draft) to fill in")
  .option("--title <title>", "entry title (default: from the slug)")
  .option("--tags <tags>", "comma-separated tags")
  .action(async (topic: string, slug: string, cmdOpts: { title?: string; tags?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const title =
      cmdOpts.title ?? slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
    const file = await knowledgeStore().saveEntry({
      slug,
      topic,
      tier: "draft",
      tags: splitTags(cmdOpts.tags),
      sources: [],
      related: [],
      title,
      body: [
        "## Executable",
        "<!-- pipeline spec, awh-notation block, awh-style-spec block, or recipe.",
        "     Prose-only is a last resort and gets flagged in the index. -->",
        "",
        "## The rule",
        "<!-- the knowledge, with numbers -->",
      ].join("\n"),
    });
    await knowledgeStore().buildIndex();
    output(opts, { file }, () => `scaffolded ${file} — fill in Executable + rule, then kb index`);
  });

program
  .command("distill")
  .description(
    "Dump the open project for knowledge curation: structure, devices, and " +
      "every MIDI clip's notation — feed for creating library/knowledge entries",
  )
  .option("-o, --out <file>", "write to a file instead of stdout")
  .option("--sig <beatsPerBar>", "beats per bar for notation", "4")
  .action(async (cmdOpts: { out?: string; sig: string }) => {
    const opts = program.opts<GlobalOpts>();
    const summary = (await op(opts, "set.summary")) as SetSummary;
    const beatsPerBar = Number(cmdOpts.sig);
    const lines = [
      `# Project distill — ${new Date().toISOString().slice(0, 10)}`,
      "",
      `tempo ${summary.tempo} BPM · ${summary.trackCount} tracks · ${summary.sceneCount} scenes` +
        (summary.scale.active
          ? ` · scale ${PITCH_CLASSES[summary.scale.rootNote % 12]} ${summary.scale.name}`
          : ""),
      "",
    ];
    for (const track of summary.tracks) {
      lines.push(`## ${track.path} [${track.kind}] ${track.name}`);
      if (track.devices.length) {
        lines.push(`devices: ${track.devices.map((d) => d.name).join(" -> ")}`);
      }
      const clips = [...track.sessionClips, ...track.arrangementClips];
      for (const clip of clips) {
        if (clip.kind !== "midi") {
          lines.push("", `### ${clip.path} ${clip.name} (audio)`);
          continue;
        }
        const detail = (await op(opts, "clip.get", { path: clip.path })) as ClipDetail;
        lines.push(
          "",
          `### ${clip.path} ${clip.name || "(unnamed)"} — ${detail.duration} beats`,
          "```awh-notation",
          detail.notes?.length
            ? serializeNotation(detail.notes, { beatsPerBar })
            : "# (empty clip)",
          "```",
        );
      }
      lines.push("");
    }
    const text = lines.join("\n");
    if (cmdOpts.out) {
      await writeFile(cmdOpts.out, text, "utf8");
      output(opts, { out: cmdOpts.out }, () => `distilled -> ${cmdOpts.out}`);
    } else {
      process.stdout.write(`${text}\n`);
    }
  });

// ---------------------------------------------------------------------------
// Mix analysis (M6): measurement engine (Python) + M4L capture tap driver.
// ---------------------------------------------------------------------------

function repoRoot(): string {
  // library root is <repo>/library (findLibraryRoot walks up) — its parent.
  return dirname(findLibraryRoot());
}

function analysisPython(): { python: string; cwd: string } {
  const root = repoRoot();
  const venv = join(root, ".venv", "bin", "python");
  const python = process.env.AWH_PYTHON ?? (existsSync(venv) ? venv : "python3");
  return { python, cwd: join(root, "analysis") };
}

/** Run `python -m awh_analysis <args>` streaming stdio through. */
async function runAnalysis(args: string[]): Promise<void> {
  const { python, cwd } = analysisPython();
  if (!existsSync(cwd)) {
    throw new Error(`analysis engine not found at ${cwd} — is the repo checkout complete?`);
  }
  const child = spawn(python, ["-m", "awh_analysis", ...args], {
    cwd,
    stdio: "inherit",
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", (err) =>
      reject(
        new Error(
          `could not run ${python} (${err.message}) — create the venv per docs/dev-loop.md ` +
            "or set AWH_PYTHON",
        ),
      ),
    );
    child.on("close", (c) => resolve(c ?? 1));
  });
  if (code !== 0) process.exitCode = code;
}

/** Resolve --target: an existing file path, or a name in library/targets/. */
function resolveTarget(target: string): string {
  if (existsSync(target)) return target;
  const named = join(findLibraryRoot(), "targets", `${target}.json`);
  if (existsSync(named)) return named;
  throw new Error(`target "${target}" is neither a file nor library/targets/${target}.json`);
}

const mix = program
  .command("mix")
  .description("Measurement-based mix feedback (LUFS/PSR/spectrum/phase/pump)");

mix
  .command("report <file>")
  .description("Measure a rendered/captured audio file and report prioritized findings")
  .option("--bpm <bpm>", "Set tempo — enables sidechain-pump verification")
  .option("--target <nameOrPath>", "genre target (library/targets/<name>.json)")
  .option("--delivery <preset>", "delivery check: club | streaming | apple")
  .option("--from <seconds>", "analyze from this time")
  .option("--to <seconds>", "analyze up to this time")
  .option(
    "--save [name]",
    "also save a measurement record to library/measurements/ (default name: from the file)",
  )
  .action(
    async (
      file: string,
      cmdOpts: {
        bpm?: string;
        target?: string;
        delivery?: string;
        from?: string;
        to?: string;
        save?: string | boolean;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const args = ["report", file];
      if (cmdOpts.bpm) args.push("--bpm", cmdOpts.bpm);
      if (cmdOpts.target) args.push("--target", resolveTarget(cmdOpts.target));
      if (cmdOpts.delivery) args.push("--delivery", cmdOpts.delivery);
      if (cmdOpts.from) args.push("--from", cmdOpts.from);
      if (cmdOpts.to) args.push("--to", cmdOpts.to);
      if (cmdOpts.save !== undefined) {
        const name =
          typeof cmdOpts.save === "string"
            ? cmdOpts.save
            : slugify(basename(file).replace(/\.[^.]+$/, "") || "record");
        const recordPath = join(findLibraryRoot(), "measurements", `${name}.json`);
        await mkdir(dirname(recordPath), { recursive: true });
        args.push("--save-record", recordPath);
        process.stderr.write(`record -> ${recordPath}\n`);
      }
      if (opts.json) args.push("--json");
      await runAnalysis(args);
    },
  );

mix
  .command("ab <fileA> <fileB>")
  .description("Loudness-matched A/B comparison of two renders (counters louder=better)")
  .option("--bpm <bpm>", "Set tempo — includes pump comparison")
  .action(async (fileA: string, fileB: string, cmdOpts: { bpm?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const args = ["ab", fileA, fileB];
    if (cmdOpts.bpm) args.push("--bpm", cmdOpts.bpm);
    if (opts.json) args.push("--json");
    await runAnalysis(args);
  });

mix
  .command("target <files...>")
  .description(
    "Measure YOUR reference tracks into a genre target profile (also records " +
      "each reference into library/measurements/ for future retrieval)",
  )
  .requiredOption("--save <name>", "target name (stored in library/targets/<name>.json)")
  .option("--no-records", "skip writing per-reference measurement records")
  .action(async (files: string[], cmdOpts: { save: string; records: boolean }) => {
    const opts = program.opts<GlobalOpts>();
    const dest = join(findLibraryRoot(), "targets", `${cmdOpts.save}.json`);
    await mkdir(dirname(dest), { recursive: true });
    const args = ["target", ...files, "--save", dest];
    if (cmdOpts.records) {
      const recordsDir = join(findLibraryRoot(), "measurements");
      await mkdir(recordsDir, { recursive: true });
      args.push("--records-dir", recordsDir);
    }
    if (opts.json) args.push("--json");
    await runAnalysis(args);
  });

mix
  .command("records [name]")
  .description(
    "List saved measurement records (library/measurements/), or show one by name",
  )
  .action(async (name: string | undefined) => {
    const opts = program.opts<GlobalOpts>();
    const dir = join(findLibraryRoot(), "measurements");
    if (name !== undefined) {
      const file = join(dir, `${name}.json`);
      if (!existsSync(file)) throw new Error(`no measurement record ${file}`);
      const record = JSON.parse(readFileSync(file, "utf8")) as {
        saved: string;
        file: string;
        measurements: Record<string, never>;
        findings: { severity: string; explanation: string; suggestion: string }[];
      };
      output(opts, record, () => {
        const m = record.measurements as unknown as {
          loudness: { lufs_integrated: number; true_peak_db: number; psr: { min_psr_loud: number } };
          spectrum: { tilt_db_per_oct: number };
          bpm?: number;
        };
        return [
          `${name} — saved ${record.saved}`,
          `  source  ${record.file}`,
          `  LUFS-I ${m.loudness.lufs_integrated.toFixed(2)} · TP ${m.loudness.true_peak_db.toFixed(2)} dBTP · ` +
            `PSR ${m.loudness.psr.min_psr_loud.toFixed(1)} · tilt ${m.spectrum.tilt_db_per_oct.toFixed(2)} dB/oct` +
            (m.bpm ? ` · ${m.bpm} BPM` : ""),
          ``,
          ...record.findings.map(
            (f) => `  [${f.severity.toUpperCase().padEnd(5)}] ${f.explanation}`,
          ),
          ``,
          `full JSON: ${file} (or --json)`,
        ].join("\n");
      });
      return;
    }
    if (!existsSync(dir)) {
      output(opts, [], () => "no measurement records yet — awh mix report <file> --save");
      return;
    }
    const rows = (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
          saved: string;
          file: string;
          measurements: {
            loudness: { lufs_integrated: number };
            spectrum: { tilt_db_per_oct: number };
          };
        };
        return {
          name: f.replace(/\.json$/, ""),
          saved: r.saved,
          lufs: r.measurements.loudness.lufs_integrated,
          tilt: r.measurements.spectrum.tilt_db_per_oct,
          file: basename(r.file),
        };
      });
    output(opts, rows, () =>
      rows.length === 0
        ? "no measurement records yet — awh mix report <file> --save"
        : rows
            .map(
              (r) =>
                `${r.name.padEnd(32)} ${r.saved}  ${r.lufs.toFixed(1).padStart(6)} LUFS  ` +
                `${r.tilt.toFixed(1).padStart(5)} dB/oct  ${r.file}`,
            )
            .join("\n"),
    );
  });

/**
 * Typed wrapper for device.param — op() args are `unknown`, so a wrong field
 * name compiles fine and only fails at runtime inside Live (the {name} vs
 * {param} bug found in live verification). Repeat-use ops get typed wrappers;
 * see docs/lessons-learned.md.
 */
async function setDeviceParam(
  opts: GlobalOpts,
  path: string,
  param: string,
  value: number,
): Promise<void> {
  await op(opts, "device.param", { path, param, value });
}

/** Resolve trigger positions (seconds) from the Trigger MIDI clip or manual beats. */
async function resolveTriggerSeconds(
  opts: GlobalOpts,
  cmdOpts: { triggerClip?: string; triggers?: string },
): Promise<{ seconds: number[]; cycle?: number; tempo: number }> {
  if (!cmdOpts.triggerClip && !cmdOpts.triggers) {
    throw new Error("pass --trigger-clip <path> (the Trigger MIDI clip) or --triggers <beats>");
  }
  const summary = (await op(opts, "set.summary")) as SetSummary;
  const secPerBeat = 60 / summary.tempo;
  if (cmdOpts.triggerClip) {
    const detail = (await op(opts, "clip.get", { path: cmdOpts.triggerClip })) as ClipDetail;
    if (detail.kind !== "midi" || !detail.notes?.length) {
      throw new Error(`${cmdOpts.triggerClip} is not a MIDI clip with notes`);
    }
    const starts = [...new Set(detail.notes.map((n) => n.start))].sort((a, b) => a - b);
    return {
      seconds: starts.map((b) => b * secPerBeat),
      cycle: detail.duration * secPerBeat,
      tempo: summary.tempo,
    };
  }
  return {
    seconds: cmdOpts.triggers!.split(",").map((b) => Number(b.trim()) * secPerBeat),
    tempo: summary.tempo,
  };
}

function triggerArgs(t: { seconds: number[]; cycle?: number }): string[] {
  const args = ["--triggers", t.seconds.map((s) => s.toFixed(6)).join(",")];
  if (t.cycle !== undefined) args.push("--cycle", t.cycle.toFixed(6));
  return args;
}

/** Drive the M4L tap through one loop-record-play-stop cycle. */
async function captureSpan(
  opts: GlobalOpts,
  spec: { fromBar: number; bars: number; beatsPerBar: number; tapPort: number; out: string; tailS: number },
): Promise<number> {
  const summary = (await op(opts, "set.summary")) as SetSummary;
  const startBeat = (spec.fromBar - 1) * spec.beatsPerBar;
  const lengthBeats = spec.bars * spec.beatsPerBar;
  const seconds = (lengthBeats / summary.tempo) * 60 + spec.tailS;
  await sendToTap("/awh/loop", [startBeat, lengthBeats], spec.tapPort);
  await sendToTap("/awh/record", [spec.out], spec.tapPort);
  await sendToTap("/awh/play", [1], spec.tapPort);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await sendToTap("/awh/play", [0], spec.tapPort);
  await sendToTap("/awh/stop", [], spec.tapPort);
  // sfrecord~ has no completion ack over OSC — give it a moment to flush
  // and close the WAV header before anything reads the file. Without this,
  // an immediate read can see a file that `existsSync` but whose header
  // still reports 0 frames (found live: intermittent "selection is 0.000s"
  // analysis failures on files that were valid moments later).
  await new Promise((r) => setTimeout(r, 400));
  if (!existsSync(spec.out)) {
    throw new Error(
      `${spec.out} was not created — is the AWH Capture Tap device loaded (m4l/README.md) ` +
        "and listening on the right port?",
    );
  }
  return seconds;
}

/** Run the analysis CLI capturing stdout as JSON (for internal loops). */
async function runAnalysisJson(args: string[]): Promise<Record<string, number>> {
  const { python, cwd } = analysisPython();
  const child = spawn(python, ["-m", "awh_analysis", ...args, "--json"], { cwd });
  let out = "";
  let err = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr.on("data", (d: Buffer) => (err += d.toString()));
  const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)));
  if (code !== 0) throw new Error(`analysis failed: ${err.trim() || out.trim()}`);
  return JSON.parse(out) as Record<string, number>;
}

const duckCmd = mix
  .command("duck")
  .description(
    "Sidechain ducking toolkit: fit the ideal envelope to your drums, set up an " +
      "automatic stock-Compressor duck, measure/calibrate the result. ShaperBox " +
      "hand-drawing is one strategy; the compressor path is the automatic one.",
  );

duckCmd
  .command("fit <drumsFile>")
  .description(
    "Fit the duck envelope to YOUR drums: trigger-aligned low-band decay -> " +
      "depth/hold/release + exact Volume Shaper points to draw",
  )
  .option(
    "--trigger-clip <clipPath>",
    "the Trigger MIDI clip (note starts become trigger times; capture must start " +
      "on the clip's loop boundary)",
  )
  .option("--triggers <beats>", "manual comma-separated trigger positions in BEATS")
  .option("--bass <file>", "bass capture at session levels — enables masking-based depth")
  .option("--depth <db>", "force duck depth in dB")
  .action(
    async (
      drumsFile: string,
      cmdOpts: { triggerClip?: string; triggers?: string; bass?: string; depth?: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const t = await resolveTriggerSeconds(opts, cmdOpts);
      const args = ["duck", drumsFile, ...triggerArgs(t)];
      if (cmdOpts.bass) args.push("--bass", cmdOpts.bass);
      if (cmdOpts.depth) args.push("--depth", cmdOpts.depth);
      if (opts.json) args.push("--json");
      await runAnalysis(args);
    },
  );

duckCmd
  .command("setup <trackPath>")
  .description(
    "AUTOMATIC strategy: insert a stock Compressor on the track (usually the " +
      "Sidechain bus) preset for ducking — fastest attack, max ratio. Two manual " +
      "touches remain (the SDK has no routing/automation API): enable Sidechain " +
      "with Audio From = the trigger/kick source, and dial Release to the fitted ms",
  )
  .option("--release-ms <ms>", "release target from `duck fit` (printed for the manual dial)")
  .action(async (trackPath: string, cmdOpts: { releaseMs?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const inserted = (await op(opts, "device.insert", {
      ownerPath: trackPath,
      name: "Compressor",
    })) as { path: string };
    const detail = (await op(opts, "device.get", { path: inserted.path })) as {
      params: { name: string; value: number; min: number; max: number }[];
    };
    const byName = new Map(detail.params.map((p) => [p.name, p]));
    const setRaw = async (name: string, value: number): Promise<string> => {
      const p = byName.get(name);
      if (!p) return `  !  param "${name}" not found — set it by hand`;
      await setDeviceParam(opts, inserted.path, name, value);
      return `  ok ${name} -> ${value} (raw range ${p.min}..${p.max})`;
    };
    // "Sidechain On" is a normal automatable param (live-verified) — only
    // the Audio From ROUTING is genuinely outside the SDK. Live's exact
    // param name varies, so match candidates.
    const scOn = ["S/C On", "Sidechain On", "SideChain On", "SC On"]
      .map((n) => byName.get(n))
      .find((q) => q !== undefined);
    const lines = [
      `Compressor inserted at ${inserted.path}`,
      await setRaw("Attack", byName.get("Attack")?.min ?? 0),
      await setRaw("Ratio", byName.get("Ratio")?.max ?? 0),
      scOn
        ? await setRaw(scOn.name, scOn.max)
        : '  !  no sidechain-enable param found (looked for S/C On variants) — enable it by hand',
      "",
      "Manual touches (the SDK cannot set routing or ms-displays):",
      "  1. Audio From = your trigger source (Kick / Trigger-audio track)" +
        (scOn ? "" : " + enable Sidechain"),
      `  2. Release -> ${cmdOpts.releaseMs ? `${cmdOpts.releaseMs} ms` : "the release_ms from `awh mix duck fit`"}`,
      "",
      "Then calibrate the depth automatically:",
      `  awh mix duck calibrate ${inserted.path} --target-depth <dB from fit> \\`,
      "    --trigger-clip <Trigger clip> --from-bar <bar> --bars 4",
    ];
    output(opts, { devicePath: inserted.path }, () => lines.join("\n"));
  });

duckCmd
  .command("measure <bassCapture>")
  .description("Measure the ACHIEVED duck depth on a bass/sidechain-bus capture")
  .option("--trigger-clip <clipPath>", "the Trigger MIDI clip")
  .option("--triggers <beats>", "manual trigger positions in BEATS")
  .action(
    async (bassCapture: string, cmdOpts: { triggerClip?: string; triggers?: string }) => {
      const opts = program.opts<GlobalOpts>();
      const t = await resolveTriggerSeconds(opts, cmdOpts);
      const args = ["duckdepth", bassCapture, ...triggerArgs(t)];
      if (opts.json) args.push("--json");
      await runAnalysis(args);
    },
  );

duckCmd
  .command("calibrate <devicePath>")
  .description(
    "Closed-loop compressor calibration: capture the ducked bus via the tap, " +
      "measure the achieved depth, adjust Threshold, repeat until it matches " +
      "--target-depth. Needs Live + the capture tap ON THE DUCKED BUS.",
  )
  .requiredOption("--target-depth <db>", "duck depth to hit (from `duck fit`)")
  .requiredOption("--from-bar <bar>", "capture span start (Trigger pattern boundary)")
  .requiredOption("--bars <bars>", "capture span length")
  .option("--trigger-clip <clipPath>", "the Trigger MIDI clip")
  .option("--triggers <beats>", "manual trigger positions in BEATS")
  .option("--param <name>", "device parameter to search", "Threshold")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .option("--tap-port <port>", "capture tap OSC port", String(TAP_PORT))
  .option("--max-iters <n>", "bisection iterations after the bracket probes", "4")
  .option("--tolerance <db>", "acceptable |achieved - target|", "1.0")
  .action(
    async (
      devicePath: string,
      cmdOpts: {
        targetDepth: string;
        fromBar: string;
        bars: string;
        triggerClip?: string;
        triggers?: string;
        param: string;
        sig: string;
        tapPort: string;
        maxIters: string;
        tolerance: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const target = Number(cmdOpts.targetDepth);
      const t = await resolveTriggerSeconds(opts, cmdOpts);
      const detail = (await op(opts, "device.get", { path: devicePath })) as {
        params: { name: string; value: number; min: number; max: number }[];
      };
      const param = detail.params.find((p) => p.name === cmdOpts.param);
      if (!param) {
        throw new Error(
          `no "${cmdOpts.param}" param on ${devicePath} — params: ${detail.params.map((p) => p.name).join(", ")}`,
        );
      }
      const onParam = detail.params.find((p) => p.name === "Device On");
      const spec = {
        fromBar: Number(cmdOpts.fromBar),
        bars: Number(cmdOpts.bars),
        beatsPerBar: Number(cmdOpts.sig),
        tapPort: Number(cmdOpts.tapPort),
        tailS: 0.3,
      };
      const scratch = join(repoRoot(), ".dev", "duck-calibrate");
      await mkdir(scratch, { recursive: true });

      const measureAt = async (label: string, raw?: number): Promise<number> => {
        if (raw !== undefined) {
          await setDeviceParam(opts, devicePath, cmdOpts.param, raw);
        }
        const out = join(scratch, `${label}.wav`);
        await captureSpan(opts, { ...spec, out });
        const r = await runAnalysisJson(["duckdepth", out, ...triggerArgs(t)]);
        return r.depth_db!;
      };

      // baseline: duck bypassed -> the material's natural modulation
      if (onParam) await setDeviceParam(opts, devicePath, "Device On", 0);
      const baseline = await measureAt("baseline");
      if (onParam) await setDeviceParam(opts, devicePath, "Device On", 1);
      process.stderr.write(`baseline (bypassed): ${baseline.toFixed(2)} dB natural modulation\n`);

      // bracket probes at 25% / 75% of the raw range to learn direction
      const lo25 = param.min + 0.25 * (param.max - param.min);
      const hi75 = param.min + 0.75 * (param.max - param.min);
      const d25 = Math.max(0, (await measureAt("probe25", lo25)) - baseline);
      const d75 = Math.max(0, (await measureAt("probe75", hi75)) - baseline);
      process.stderr.write(`probes: raw ${lo25.toFixed(3)} -> ${d25.toFixed(2)} dB, raw ${hi75.toFixed(3)} -> ${d75.toFixed(2)} dB\n`);
      // deeperRaw = the end of the range that gives MORE ducking
      let deepRaw = d25 > d75 ? param.min : param.max;
      let shallowRaw = d25 > d75 ? param.max : param.min;
      let best = { raw: d25 > d75 ? lo25 : hi75, depth: Math.max(d25, d75) };

      const tolerance = Number(cmdOpts.tolerance);
      for (let i = 0; i < Number(cmdOpts.maxIters); i++) {
        if (Math.abs(best.depth - target) <= tolerance) break;
        const mid = (deepRaw + shallowRaw) / 2;
        const depth = Math.max(0, (await measureAt(`iter${i}`, mid)) - baseline);
        process.stderr.write(`iter ${i + 1}: raw ${mid.toFixed(3)} -> ${depth.toFixed(2)} dB (target ${target})\n`);
        if (Math.abs(depth - target) < Math.abs(best.depth - target)) best = { raw: mid, depth };
        // bracket: [shallowRaw, deepRaw]; too little duck -> move the shallow
        // end to mid, too much -> move the deep end to mid
        if (depth < target) shallowRaw = mid;
        else deepRaw = mid;
      }

      await setDeviceParam(opts, devicePath, cmdOpts.param, best.raw);
      output(opts, { param: cmdOpts.param, raw: best.raw, achievedDepth: best.depth, baseline }, () =>
        [
          `calibrated: ${cmdOpts.param} = ${best.raw.toFixed(3)} (raw) -> ` +
            `${best.depth.toFixed(2)} dB duck (target ${target} ±${tolerance})`,
          Math.abs(best.depth - target) <= tolerance
            ? "within tolerance — audition it"
            : "NOT within tolerance — the compressor may not reach this depth on this material; " +
              "consider the ShaperBox strategy or a louder trigger source",
        ].join("\n"),
      );
    },
  );

mix
  .command("capture")
  .description(
    "Record post-FX audio via the M4L capture tap (m4l/): loops the arrangement " +
      "over a bar span, records to a file, and stops",
  )
  .requiredOption("-o, --out <file>", "output file (absolute path recommended)")
  .requiredOption("--from-bar <bar>", "1-based arrangement bar to loop from")
  .requiredOption("--bars <bars>", "loop length in bars")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .option("--tap-port <port>", "capture tap OSC port", String(TAP_PORT))
  .option("--tail <seconds>", "extra record time after the loop", "0.5")
  .action(
    async (cmdOpts: {
      out: string;
      fromBar: string;
      bars: string;
      sig: string;
      tapPort: string;
      tail: string;
    }) => {
      const opts = program.opts<GlobalOpts>();
      const outPath = resolve(cmdOpts.out);
      process.stderr.write(
        `recording ${cmdOpts.bars} bars at the tap (${outPath})…\n`,
      );
      const seconds = await captureSpan(opts, {
        fromBar: Number(cmdOpts.fromBar),
        bars: Number(cmdOpts.bars),
        beatsPerBar: Number(cmdOpts.sig),
        tapPort: Number(cmdOpts.tapPort),
        out: outPath,
        tailS: Number(cmdOpts.tail),
      });
      const summary = (await op(opts, "set.summary")) as SetSummary;
      output(opts, { file: outPath, seconds }, () =>
        `captured -> ${outPath}\nanalyze with: awh mix report ${outPath} --bpm ${summary.tempo}`,
      );
    },
  );

// ---------------------------------------------------------------------------
// Scaffolding + harmony (M7): new projects from the owner's template,
// declarative populate, chord progressions in-scale.
// ---------------------------------------------------------------------------

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) await copyDirRecursive(from, to);
    else await copyFile(from, to);
  }
}

/** Resolve the Set scale (or --key) into a ScaleContext for harmony work. */
function resolveKey(
  summary: SetSummary,
  key: string | undefined,
): { rootNote: number; intervals: number[]; label: string } {
  if (key) {
    const parsed = parseScale(key);
    return { ...parsed, label: key };
  }
  if (!summary.scale.active) {
    throw new Error(
      'the Set has no active scale — pass --key "A minor" (or enable the Set scale)',
    );
  }
  return {
    rootNote: summary.scale.rootNote,
    intervals: summary.scale.intervals,
    label: `${PITCH_CLASSES[summary.scale.rootNote % 12]} ${summary.scale.name}`,
  };
}

const newCmd = program
  .command("new")
  .description("Start a track the way you actually start: from YOUR template");

newCmd
  .command("project <name>")
  .description(
    "Copy your template project to a new '<name> Project' folder (disk only — " +
      "open it in Live, then `awh new populate`)",
  )
  .option(
    "--template <dir>",
    "template project directory (default: library/templates/project)",
  )
  .option("--dest <dir>", "parent directory for the new project (default: cwd)")
  .action(async (name: string, cmdOpts: { template?: string; dest?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const template =
      cmdOpts.template ?? join(findLibraryRoot(), "templates", "project");
    if (!existsSync(template)) {
      throw new Error(
        `no template at ${template} — copy your starting-point Live project folder ` +
          "there once (the whole '<x> Project' folder), or pass --template",
      );
    }
    const dest = resolve(cmdOpts.dest ?? ".", `${name} Project`);
    if (existsSync(dest)) throw new Error(`${dest} already exists — refusing to overwrite`);
    await copyDirRecursive(template, dest);
    // rename the template's .als to the new project name
    const als = (await readdir(dest)).filter((f) => f.endsWith(".als"));
    let setPath = "";
    if (als.length > 0) {
      setPath = join(dest, `${name}.als`);
      await rename(join(dest, als[0]!), setPath);
      for (const extra of als.slice(1)) await rm(join(dest, extra));
    }
    output(opts, { project: dest, set: setPath }, () =>
      [
        `project created -> ${dest}`,
        setPath ? `open ${setPath} in Live, then:` : "open the project in Live, then:",
        "  awh new populate            # tempo/tracks/starters from your scaffold",
      ].join("\n"),
    );
  });

interface ScaffoldSpec {
  tempo?: number;
  tracks?: { name: string; kind?: "midi" | "audio" }[];
  starters?: { slug: string; track: string; atBar?: number }[];
  chords?: {
    track: string;
    progression: string;
    key?: string;
    bars?: number;
    atBar?: number;
    voicing?: "close" | "spread";
    rhythm?: "whole" | "half" | "quarters" | "offbeat-stabs";
  };
}

newCmd
  .command("populate [scaffoldFile]")
  .description(
    "Apply your scaffold (library/templates/scaffold.yaml) to the OPEN Set: " +
      "tempo, named tracks, starter clips from the library, a chord bed",
  )
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .action(async (scaffoldFile: string | undefined, cmdOpts: { sig: string }) => {
    const opts = program.opts<GlobalOpts>();
    const file = scaffoldFile ?? join(findLibraryRoot(), "templates", "scaffold.yaml");
    if (!existsSync(file)) {
      throw new Error(
        `no scaffold at ${file} — create one (tempo/tracks/starters/chords; see the ` +
          "skill's scaffolding flow) or pass a path",
      );
    }
    const scaffold = parseYaml(await readFile(file, "utf8")) as ScaffoldSpec;
    const beatsPerBar = Number(cmdOpts.sig);
    const done: string[] = [];

    if (scaffold.tempo !== undefined) {
      await op(opts, "set.tempo", { bpm: scaffold.tempo });
      done.push(`tempo -> ${scaffold.tempo} BPM`);
    }

    let summary = (await op(opts, "set.summary")) as SetSummary;
    const trackByName = (trackName: string) =>
      summary.tracks.find((t) => t.name.toLowerCase() === trackName.toLowerCase());

    for (const spec of scaffold.tracks ?? []) {
      if (trackByName(spec.name)) continue;
      const created = (await op(opts, "track.create", {
        kind: spec.kind ?? "midi",
        name: spec.name,
      })) as { path: string };
      done.push(`track ${spec.name} -> ${created.path}`);
    }
    summary = (await op(opts, "set.summary")) as SetSummary;

    const store = libraryStore({});
    for (const starter of scaffold.starters ?? []) {
      const track = trackByName(starter.track);
      if (!track) throw new Error(`starter "${starter.slug}": no track named "${starter.track}"`);
      const entry = await store.loadClip(starter.slug);
      if (!entry.notation) throw new Error(`starter ${starter.slug} has no notation`);
      const { notes } = parseNotation(entry.notation, {
        beatsPerBar: entry.beatsPerBar ?? 4,
      });
      const target =
        starter.atBar !== undefined
          ? {
              type: "arrangement",
              trackPath: track.path,
              startBeat: (starter.atBar - 1) * beatsPerBar,
            }
          : (() => {
              const occupied = new Set(
                track.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])),
              );
              const free = Array.from({ length: track.slotCount }, (_, i) => i).find(
                (i) => !occupied.has(i),
              );
              if (free === undefined)
                throw new Error(`no empty slot on ${track.name} for ${starter.slug}`);
              return { type: "session", slotPath: `${track.path}/slot:${free}` };
            })();
      await op(opts, "clip.create-midi", {
        target,
        lengthBeats: entry.lengthBeats,
        notes,
        name: starter.slug,
      });
      done.push(`starter ${entry.slug} [${entry.tier}] -> ${track.name}`);
    }

    if (scaffold.chords) {
      const c = scaffold.chords;
      const track = trackByName(c.track);
      if (!track) throw new Error(`chords: no track named "${c.track}"`);
      const keyCtx = resolveKey(summary, c.key);
      const chords = parseProgression(c.progression, keyCtx);
      const voiced = voiceProgression(chords, { style: c.voicing ?? "close" });
      const bars = c.bars ?? chords.length;
      const notes = renderChords(voiced, {
        bars,
        beatsPerBar,
        rhythm: c.rhythm ?? "whole",
      });
      await op(opts, "clip.create-midi", {
        target:
          c.atBar !== undefined
            ? { type: "arrangement", trackPath: track.path, startBeat: (c.atBar - 1) * beatsPerBar }
            : { type: "session", slotPath: `${track.path}/slot:0` },
        lengthBeats: bars * beatsPerBar,
        notes,
        name: c.progression,
      });
      done.push(`chords ${c.progression} (${keyCtx.label}) -> ${c.track}`);
    }

    output(opts, { applied: done }, () =>
      done.length ? done.map((d) => `  ok ${d}`).join("\n") : "scaffold had nothing to apply",
    );
  });

program
  .command("chords <target>")
  .description(
    "CO-WRITE a chord progression clip, in the Set's scale (or --key). " +
      "Target: slot path, or track path with --at-bar",
  )
  .requiredOption(
    "--progression <spec>",
    'roman numerals in-scale, e.g. "i-VI-III-VII" or "I IV V vi" (7/sus2/sus4/dim/aug, b/# borrow)',
  )
  .option("--key <key>", 'e.g. "A minor" (default: the Set scale)')
  .option("--bars <bars>", "total bars (default: one per chord)")
  .option("--voicing <style>", "close | spread", "close")
  .option("--rhythm <style>", "whole | half | quarters | offbeat-stabs", "whole")
  .option("--center <midi>", "voicing register center", "60")
  .option("--bass", "add a root bass note an octave below")
  .option("--at-bar <bar>", "arrangement position for track targets")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .option("--name <name>", "clip name (default: the progression)")
  .action(
    async (
      target: string,
      cmdOpts: {
        progression: string;
        key?: string;
        bars?: string;
        voicing: "close" | "spread";
        rhythm: "whole" | "half" | "quarters" | "offbeat-stabs";
        center: string;
        bass?: boolean;
        atBar?: string;
        sig: string;
        name?: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const summary = (await op(opts, "set.summary")) as SetSummary;
      const keyCtx = resolveKey(summary, cmdOpts.key);
      const chords = parseProgression(cmdOpts.progression, keyCtx);
      const voiced = voiceProgression(chords, {
        style: cmdOpts.voicing,
        center: Number(cmdOpts.center),
      });
      const beatsPerBar = Number(cmdOpts.sig);
      const bars = cmdOpts.bars ? Number(cmdOpts.bars) : chords.length;
      const notes = renderChords(voiced, {
        bars,
        beatsPerBar,
        rhythm: cmdOpts.rhythm,
        bassOctaves: cmdOpts.bass ? 1 : 0,
      });
      const isSlot = /\/slot:\d+$/.test(target);
      if (!isSlot && cmdOpts.atBar === undefined) {
        throw new Error("track targets need --at-bar (or pass a slot path)");
      }
      const created = (await op(opts, "clip.create-midi", {
        target: isSlot
          ? { type: "session", slotPath: target }
          : {
              type: "arrangement",
              trackPath: target,
              startBeat: (Number(cmdOpts.atBar) - 1) * beatsPerBar,
            },
        lengthBeats: bars * beatsPerBar,
        notes,
        name: cmdOpts.name ?? cmdOpts.progression,
      })) as { path: string };
      output(opts, { path: created.path, chords: voiced.map((v) => v.symbol) }, () =>
        [
          `${cmdOpts.progression} (${keyCtx.label}, ${cmdOpts.voicing}, ${cmdOpts.rhythm}) -> ${created.path}`,
          ...voiced.map(
            (v) => `  ${v.symbol.padEnd(8)} ${v.pitches.map((p) => midiToPitch(p)).join(" ")}`,
          ),
        ].join("\n"),
      );
    },
  );

// ---------------------------------------------------------------------------
// Reference deconstruction (M8): tempo/grid/energy/sections from a reference
// audio file, draft section map as marker clips, corrections read back.
// ---------------------------------------------------------------------------

interface RefSection {
  name: string;
  start_bar: number;
  end_bar: number;
  confidence: number;
  evidence?: string;
}

const ref = program
  .command("ref")
  .description("Deconstruct reference tracks: tempo, energy arc, section map");

ref
  .command("analyze <audio>")
  .description("Analyze a reference: BPM/grid, bar energy arc, rule-based sections")
  .option("--phrase <bars>", "phrase length sections snap to (4 or 8)", "4")
  .option(
    "--hint-bpm <bpm>",
    "tempo disambiguation hint (e.g. the Set's tempo) — swaps in the runner-up " +
      "when it matches within 2%; never invents a tempo",
  )
  .option("--save [name]", "save to library/references/<name>.json (knowledge citizen)")
  .action(
    async (audio: string, cmdOpts: { phrase: string; hintBpm?: string; save?: string | boolean }) => {
      const opts = program.opts<GlobalOpts>();
      const args = ["ref", audio, "--phrase", cmdOpts.phrase];
      if (cmdOpts.hintBpm) args.push("--hint-bpm", cmdOpts.hintBpm);
      if (cmdOpts.save !== undefined) {
        const name =
          typeof cmdOpts.save === "string"
            ? cmdOpts.save
            : slugify(basename(audio).replace(/\.[^.]+$/, "") || "reference");
        const dest = join(findLibraryRoot(), "references", `${name}.json`);
        await mkdir(dirname(dest), { recursive: true });
        args.push("--save-record", dest);
        process.stderr.write(`reference record -> ${dest}\n`);
      }
      if (opts.json) args.push("--json");
      await runAnalysis(args);
    },
  );

const refSections = ref
  .command("sections")
  .description("Draft section map <-> named marker clips on a Sections track");

refSections
  .command("apply <analysisOrAudio>")
  .description(
    "Write the analyzed section map into Live as empty named clips on a " +
      "'Sections' MIDI track (created if missing) — the owner corrects by " +
      "dragging/renaming, then `ref sections read` picks the corrections up",
  )
  .option("--track <trackPath>", "existing track to use instead of 'Sections'")
  .option("--phrase <bars>", "phrase length (when analyzing audio directly)", "4")
  .option("--sig <beatsPerBar>", "beats per bar on the timeline", "4")
  .option("--clear", "clear existing clips on the target track first")
  .action(
    async (
      analysisOrAudio: string,
      cmdOpts: { track?: string; phrase: string; sig: string; clear?: boolean },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const beatsPerBar = Number(cmdOpts.sig);

      let sections: RefSection[];
      let sourceBpm: number | undefined;
      if (analysisOrAudio.endsWith(".json")) {
        const parsed = JSON.parse(await readFile(analysisOrAudio, "utf8")) as {
          sections?: RefSection[];
          bpm?: number;
          reference?: { sections: RefSection[]; bpm: number };
        };
        const analysis = parsed.reference ?? parsed;
        if (!analysis.sections) throw new Error(`${analysisOrAudio} has no sections`);
        sections = analysis.sections;
        sourceBpm = analysis.bpm;
      } else {
        const result = (await runAnalysisJson([
          "ref",
          analysisOrAudio,
          "--phrase",
          cmdOpts.phrase,
        ])) as unknown as { sections: RefSection[]; bpm: number };
        sections = result.sections;
        sourceBpm = result.bpm;
      }
      if (sections.length === 0) throw new Error("no sections detected — nothing to apply");

      const summary = (await op(opts, "set.summary")) as SetSummary;
      let trackPath = cmdOpts.track;
      if (!trackPath) {
        const existing = summary.tracks.find(
          (t) => t.kind === "midi" && t.name.toLowerCase() === "sections",
        );
        if (existing) {
          trackPath = existing.path;
        } else {
          const created = (await op(opts, "track.create", {
            kind: "midi",
            name: "Sections",
          })) as { path: string };
          trackPath = created.path;
        }
      }
      const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === trackPath);
      if (track && track.arrangementClips.length > 0) {
        if (!cmdOpts.clear) {
          throw new Error(
            `${trackPath} already has ${track.arrangementClips.length} arrangement clips — ` +
              "pass --clear to replace the map, or --track for a different track",
          );
        }
        const endBeat = Math.max(...track.arrangementClips.map((c) => c.endTime ?? 0));
        await op(opts, "track.clear-range", { path: trackPath, startBeat: 0, endBeat });
      }

      for (const s of sections) {
        const startBeat = (s.start_bar - 1) * beatsPerBar;
        const lengthBeats = (s.end_bar - s.start_bar + 1) * beatsPerBar;
        await op(opts, "clip.create-midi", {
          target: { type: "arrangement", trackPath, startBeat },
          lengthBeats,
          notes: [],
          name: `${s.name} ${s.end_bar - s.start_bar + 1}b [c=${s.confidence.toFixed(2)}]`,
        });
      }
      output(opts, { trackPath, sections: sections.length, bpm: sourceBpm }, () =>
        [
          `${sections.length} section markers -> ${trackPath}` +
            (sourceBpm ? ` (reference ${sourceBpm.toFixed(1)} BPM)` : ""),
          ...sections.map(
            (s) =>
              `  bar ${String(s.start_bar).padStart(3)}-${String(s.end_bar).padEnd(3)} ` +
              `${s.name} [confidence ${s.confidence.toFixed(2)}]`,
          ),
          "correct by dragging/renaming the clips, then: awh ref sections read " + trackPath,
        ].join("\n"),
      );
    },
  );

refSections
  .command("read <trackPath>")
  .description("Read the (corrected) section clips back into an analysis JSON")
  .option("--sig <beatsPerBar>", "beats per bar on the timeline", "4")
  .option("-o, --out <file>", "write the updated section map JSON here")
  .option(
    "--save <name>",
    "merge the correction into an existing library/references/<name>.json " +
      "(the saved reference's sections field; bpm/arc/etc. untouched)",
  )
  .action(async (trackPath: string, cmdOpts: { sig: string; out?: string; save?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const beatsPerBar = Number(cmdOpts.sig);
    const summary = (await op(opts, "set.summary")) as SetSummary;
    const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === trackPath);
    if (!track) throw new Error(`track not found: ${trackPath}`);
    const sections = track.arrangementClips
      .slice()
      .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
      .map((c) => {
        // lenient parse of "<name> <len>b [c=0.82]" — corrections may drop parts
        const m = c.name.match(/^(.*?)(?:\s+\d+b)?(?:\s+\[c=([\d.]+)\])?\s*$/);
        return {
          name: (m?.[1] ?? c.name).trim() || "section",
          start_bar: Math.round((c.startTime ?? 0) / beatsPerBar) + 1,
          end_bar: Math.round((c.endTime ?? 0) / beatsPerBar),
          confidence: m?.[2] ? Number(m[2]) : 1.0, // owner-corrected = certain
          evidence: "owner correction",
        };
      });
    if (sections.length === 0) throw new Error(`no section clips on ${trackPath}`);
    const result = { trackPath, beatsPerBar, sections };
    if (cmdOpts.out) {
      await writeFile(cmdOpts.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    let savedTo: string | undefined;
    if (cmdOpts.save) {
      const dest = join(findLibraryRoot(), "references", `${cmdOpts.save}.json`);
      if (!existsSync(dest)) {
        throw new Error(`${dest} does not exist — run \`awh ref analyze --save ${cmdOpts.save}\` first`);
      }
      const record = JSON.parse(await readFile(dest, "utf8")) as {
        reference: { sections: unknown };
      };
      record.reference.sections = sections;
      await writeFile(dest, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      savedTo = dest;
    }
    output(opts, { ...result, ...(savedTo ? { savedTo } : {}) }, () =>
      [
        `${sections.length} sections read from ${trackPath}${cmdOpts.out ? ` -> ${cmdOpts.out}` : ""}`,
        ...sections.map(
          (s) => `  bar ${String(s.start_bar).padStart(3)}-${String(s.end_bar).padEnd(3)} ${s.name}`,
        ),
        ...(savedTo ? [`merged into ${savedTo} — run \`awh kb index\` to refresh the index`] : []),
      ].join("\n"),
    );
  });

program
  .command("render <trackPath>")
  .description("Render an AUDIO track's pre-FX signal to a WAV (beats range)")
  .requiredOption("--from <beat>", "start beat")
  .requiredOption("--to <beat>", "end beat")
  .action(async (trackPath: string, cmdOpts: { from: string; to: string }) => {
    const opts = program.opts<GlobalOpts>();
    const body = (await callGateway(opts, "/api/ops/track.render-prefx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: trackPath,
        startBeat: Number(cmdOpts.from),
        endBeat: Number(cmdOpts.to),
      }),
    })) as { result: { audioPath: string } };
    output(opts, body.result, () => body.result.audioPath);
  });

program
  .command("serve-fake")
  .description(
    "Run a local gateway backed by a fake Live Set (development without Ableton)",
  )
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const server = createGatewayServer(new FakeLiveBridge(), {
      port: Number(opts.port),
    });
    const port = await server.start();
    process.stdout.write(
      `fake gateway listening on http://127.0.0.1:${port} (ctrl-c to stop)\n`,
    );
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        void server.stop().then(resolve);
      });
    });
  });

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
