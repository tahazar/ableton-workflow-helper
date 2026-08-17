#!/usr/bin/env node
/**
 * awh — Ableton Workflow Helper CLI.
 *
 * Every command is a deterministic operation against the gateway (the
 * extension running inside Live, or `awh serve-fake` for offline dev).
 * The same commands are what a Claude Code skill drives — no AI-only paths.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  listForms,
  planFromForm,
  renderSections,
  validateSectionsPlan,
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
  ungzipAlc,
  variantSeed,
  writePack,
  GM_DRUM_KIT,
  drumFill,
  generateDrumPattern,
  humanizeDrums,
  listDrumStyles,
  mapPadRoles,
  varyDrums,
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
  .description("Emit an editable YAML sections plan from a genre form preset")
  .requiredOption("--form <form>", `genre form: ${listForms().join(" | ")}`)
  .requiredOption(
    "--role <role=clipPath...>",
    "role bindings, repeatable: --role drums=track:1/slot:0 --role bass=track:2/slot:0",
    (value: string, acc: string[]) => [...acc, value],
    [] as string[],
  )
  .option("-o, --out <file>", "write the plan to a file (default: stdout)")
  .action(async (cmdOpts: { form: string; role: string[]; out?: string }) => {
    const roles: Record<string, { trackPath: string; source: string }> = {};
    for (const binding of cmdOpts.role) {
      const [role, source] = binding.split("=", 2);
      if (!role || !source) throw new Error(`bad --role "${binding}" (expected role=clipPath)`);
      const trackPath = source.replace(/\/(slot|arr):\d+$/, "");
      if (trackPath === source) throw new Error(`--role ${role}: "${source}" is not a clip path`);
      roles[role] = { trackPath, source };
    }
    const plan = planFromForm(cmdOpts.form, roles);
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
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const summary = (await op(opts, "set.summary")) as SetSummary;
      const { kit, usedRack } = trackDrumKit(summary, trackPath);
      const ctx = drumContext(cmdOpts);
      const notes = generateDrumPattern(cmdOpts.style, kit, ctx);
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
      output(opts, { path: result.path, notes: notes.length, usedRack }, () =>
        [
          `${cmdOpts.style} pattern -> ${where} (${notes.length} hits, ${ctx.bars} bars, seed ${cmdOpts.seed})`,
          usedRack
            ? `pad roles mapped from the track's drum rack`
            : `NOTE: no drum rack on ${trackPath} — used General MIDI note numbers`,
        ].join("\n"),
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
    "Write a library clip into the Set. Target: slot path, or track path with --at-bar",
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
      const { notes } = parseNotation(entry.notation, { beatsPerBar });
      const isSlot = /\/slot:\d+$/.test(target);
      if (!isSlot && cmdOpts.atBar === undefined) {
        throw new Error("Track targets need --at-bar <bar> (or pass a slot path).");
      }
      const result = (await op(opts, "clip.create-midi", {
        target: isSlot
          ? { type: "session", slotPath: target }
          : {
              type: "arrangement",
              trackPath: target,
              startBeat: (Number(cmdOpts.atBar) - 1) * beatsPerBar,
            },
        lengthBeats: entry.lengthBeats,
        notes,
        name: cmdOpts.name ?? entry.slug,
      })) as { path: string };
      output(opts, result, () =>
        `placed ${slug} [${entry.tier}] -> ${result.path} (${notes.length} notes, ${entry.lengthBeats} beats)`,
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
    if (entries.length === 0) throw new Error("No MIDI library clips to export");

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
