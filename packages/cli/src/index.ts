#!/usr/bin/env node
/**
 * awh — Ableton Workflow Helper CLI.
 *
 * Every command is a deterministic operation against the gateway (the
 * extension running inside Live, or `awh serve-fake` for offline dev).
 * The same commands are what a Claude Code skill drives — no AI-only paths.
 */
import { readFile, writeFile } from "node:fs/promises";
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
  applyPipeline,
  createGatewayServer,
  listTransforms,
  makeRng,
  parseNotation,
  parsePipeline,
  parseScale,
  serializeNotation,
  variantSeed,
  type ClipDetail,
  type NoteSpec,
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
