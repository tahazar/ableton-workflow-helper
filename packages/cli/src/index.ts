#!/usr/bin/env node
/**
 * awh — Ableton Workflow Helper CLI.
 *
 * Every command is a deterministic operation against the gateway (the
 * extension running inside Live, or `awh serve-fake` for offline dev).
 * The same commands are what a Claude Code skill drives — no AI-only paths.
 */
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { TAP_PORT, sendToTap } from "./osc.js";
import { analysisPython } from "./analysis-python.js";
import {
  DEFAULT_BPM_TOL,
  DEFAULT_CENTS_TOL,
  DEFAULT_CLAP_MODEL,
  expectedClapModelLabel,
  indexHasClapEmbeddings,
  loadSamplesIndex,
  makePythonClapEmbedder,
  makePythonClapTextEmbedder,
  makePythonPitchTagger,
  makePythonScanner,
  noteNameToHz,
  pitchDisplayNote,
  rankSimilar,
  rankSimilarSemantic,
  resolveReferenceClapVector,
  resolveReferenceVector,
  resolveSamplesIndexPath,
  runEmbed,
  runIndex,
  runPitchTag,
  searchIndex,
  searchSemantic,
  suggestRelaxations,
  summarizeIndex,
  type ClapModel,
  type SearchOptions,
} from "./samples.js";
import { DUCK_PORT, DUCK_REPLY_PORT, pushDuck, shapeFromFitJson, type DuckShape, type DuckTriggerSet } from "./duck.js";
import { runLayers, type LayerCaptureFn } from "./layers.js";
import {
  enrichActionsWithDevices,
  readMasterChainDevices,
  resolveMeasurementRecordPath,
  type MasterDevice,
} from "./advise.js";
import {
  RECIPE_SLUG_PREFIX,
  applyRecipePlan,
  loadRecipeFromEntry,
  planRecipeApply,
  setDeviceParam as opSetDeviceParam,
  summarizeRecipeEntries,
  type OpCaller,
  type RecipePlan,
} from "./op.js";
import {
  REMOTE_PORT,
  REMOTE_REPLY_PORT,
  auditionEnd,
  auditionSlug,
  parseLaunchTarget,
  remoteFire,
  remoteJump,
  remotePlay,
  remoteScene,
  remoteStop,
  remoteStopClips,
  type AuditionState,
} from "./remote.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildEndlessPlayer, SINGLE_FILE_WARN_BYTES } from "./endless/build.js";
import { buildEndlessPlanYaml, parseSectionsArg, sectionsFromReference, type RefSectionLike } from "./endless/plan.js";
import { buildEndlessDemo } from "./endless/demo.js";
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
  clampNotesToLength,
  clipLengthBeats,
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
  parseQuantizeGrid,
  quantizeNotes,
  renderChords,
  secondsToBeats,
  voiceProgression,
  varyDrums,
  BASS_MUSIC_CR_SPEC,
  RESPONSE_RECIPE_NAMES,
  generatePhrase,
  generateResponses,
  listPhraseStyles,
  listPhraseVariants,
  parsePhraseSpec,
  parseOperatorRecipe,
  parsePath,
  formatPath,
  sortNotes,
  ARP_BEATS_PER_BAR,
  BASIC_UP_SPEC,
  MELODIC_TECHNO_16THS_SPEC,
  arpRateBeats,
  checkArpGate,
  chordsFromNotes,
  generateArp,
  listArpStyles,
  listArpVariants,
  parseArpSpec,
  type PhraseSpec,
  type ResponseRecipeName,
  type DrumStyleSpec,
  type ArpChordSpan,
  type ArpSpec,
  type ClipDetail,
  type ClipEntry,
  type DeviceDetail,
  type DrumContext,
  type DrumKit,
  type NoteSpec,
  type OperatorRecipe,
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

interface A2mTranscription {
  notes: { start_s: number; dur_s: number; pitch: number; velocity: number }[];
  params: {
    onset_thresh: number;
    frame_thresh: number;
    min_note_len_ms: number;
    min_freq: number | null;
    max_freq: number | null;
    melodia_trim: boolean;
  };
  model: string;
  n_notes: number;
}

clip
  .command("from-audio <audioFile> <target>")
  .description(
    "Transcribe melodic audio to a MIDI clip via Basic Pitch (polyphonic pitch " +
      "estimate to audition and correct — NOT ground truth; for drums use " +
      "`awh drums detect-onsets` instead). Target: a track path (auto-picks an " +
      "empty session slot) or an explicit slot (track:0/slot:2) — an existing " +
      "clip there is overwritten with the transcription (same occupied-target " +
      "convention as `awh lib place`).",
  )
  .option("--bpm <bpm>", "tempo for seconds -> beats conversion (default: the Set's tempo)")
  .option(
    "--quantize <grid>",
    "snap note starts to a grid (1/4|1/8|1/16|1/32|off) — lengths >= one grid unit snap too",
    "off",
  )
  .option("--onset-thresh <n>", "onset sensitivity (Basic Pitch default 0.5)")
  .option("--frame-thresh <n>", "frame/pitch confidence threshold (Basic Pitch default 0.3)")
  .option("--min-len <ms>", "minimum note length in ms (Basic Pitch default 127.7)")
  .option("--min-freq <hz>", "ignore pitches below this frequency")
  .option("--max-freq <hz>", "ignore pitches above this frequency")
  .option("--name <name>", "clip name (default: the audio file's basename)")
  .option("--dry-run", "print the note summary without touching Live")
  .action(
    async (
      audioFile: string,
      target: string,
      cmdOpts: {
        bpm?: string;
        quantize: string;
        onsetThresh?: string;
        frameThresh?: string;
        minLen?: string;
        minFreq?: string;
        maxFreq?: string;
        name?: string;
        dryRun?: boolean;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const beatsPerBar = 4;
      // Validate --quantize before spending time running the model.
      const gridBeats = parseQuantizeGrid(cmdOpts.quantize);

      const analysisArgs = ["a2m", audioFile];
      if (cmdOpts.onsetThresh) analysisArgs.push("--onset-thresh", cmdOpts.onsetThresh);
      if (cmdOpts.frameThresh) analysisArgs.push("--frame-thresh", cmdOpts.frameThresh);
      if (cmdOpts.minLen) analysisArgs.push("--min-len", cmdOpts.minLen);
      if (cmdOpts.minFreq) analysisArgs.push("--min-freq", cmdOpts.minFreq);
      if (cmdOpts.maxFreq) analysisArgs.push("--max-freq", cmdOpts.maxFreq);
      const transcription = (await runAnalysisJson(
        analysisArgs,
      )) as unknown as A2mTranscription;
      const p = transcription.params;
      const paramsLine =
        `onset=${p.onset_thresh} frame=${p.frame_thresh} minLen=${p.min_note_len_ms}ms` +
        (p.min_freq !== null ? ` minFreq=${p.min_freq}Hz` : "") +
        (p.max_freq !== null ? ` maxFreq=${p.max_freq}Hz` : "");

      // Zero notes is a STATE, not an error (docs/lessons-learned.md #5):
      // no clip is created, exit 0.
      if (transcription.n_notes === 0) {
        output(opts, transcription, () =>
          `no notes detected (silence or below thresholds) in ${audioFile} — ${paramsLine} (${transcription.model})`,
        );
        return;
      }

      const summary = (await op(opts, "set.summary")) as SetSummary;
      const bpm = cmdOpts.bpm ? Number(cmdOpts.bpm) : summary.tempo;

      let notes: NoteSpec[] = transcription.notes.map((n) => ({
        start: secondsToBeats(n.start_s, bpm),
        duration: secondsToBeats(n.dur_s, bpm),
        pitch: n.pitch,
        velocity: n.velocity,
      }));
      if (gridBeats !== null) notes = quantizeNotes(notes, gridBeats);

      const lastEnd = notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
      const lengthBeats = clipLengthBeats(lastEnd, beatsPerBar);
      const pitches = notes.map((n) => n.pitch);
      const loPitch = Math.min(...pitches);
      const hiPitch = Math.max(...pitches);
      const summaryLine =
        `${notes.length} notes, ${midiToPitch(loPitch)}(${loPitch})-${midiToPitch(hiPitch)}(${hiPitch}), ` +
        `${lengthBeats / beatsPerBar} bars @ ${bpm} BPM — ${paramsLine} (${transcription.model})`;
      const estimateNote = "estimate only — audition and correct in Live.";

      // Resolve the target (reads only — clip.get/set.summary) even in
      // --dry-run, same as `sections apply`: a dry run should still catch
      // "no such track"/"no empty slot" instead of only surfacing that on
      // the real run. Only the WRITE ops below are skipped for --dry-run.
      const name = cmdOpts.name ?? basename(audioFile).replace(/\.[^./]+$/, "");
      const isSlot = /\/slot:\d+$/.test(target);

      let targetSpec: unknown;
      let where: string;
      let existing: { path: string; lengthBeats: number } | undefined;
      if (isSlot) {
        try {
          const detail = (await op(opts, "clip.get", { path: target })) as ClipDetail;
          existing = { path: target, lengthBeats: detail.duration };
        } catch {
          // nothing there yet -> create fresh below
        }
        targetSpec = { type: "session", slotPath: target };
        where = target;
      } else {
        const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === target);
        if (!track) {
          throw new Error(
            `track not found: ${target} (pass a session slot like track:0/slot:2 to target an occupied clip)`,
          );
        }
        const occupied = new Set(
          track.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])),
        );
        const free = Array.from({ length: track.slotCount }, (_, i) => i).find(
          (i) => !occupied.has(i),
        );
        if (free === undefined) {
          throw new Error(
            `no empty session slot on ${target} — pass an explicit track:N/slot:M target`,
          );
        }
        where = `${target}/slot:${free}`;
        targetSpec = { type: "session", slotPath: where };
      }

      if (cmdOpts.dryRun) {
        output(
          opts,
          { notes, lengthBeats, bpm, params: p, model: transcription.model, target: where },
          () =>
            [
              `dry run: ${summaryLine} -> ${where}${existing ? " (fills an existing clip)" : ""}`,
              estimateNote,
            ].join("\n"),
        );
        return;
      }

      let placedNotes = notes;
      let result: { path: string };
      if (existing) {
        // Occupied target: overwrite in place (same convention as `awh lib
        // place`). The gateway has no clip-resize op, so a transcription
        // longer than the existing clip is clamped to fit rather than
        // silently sending notes Live would never play.
        placedNotes = clampNotesToLength(notes, existing.lengthBeats);
        await op(opts, "clip.notes", { path: existing.path, notes: placedNotes });
        await op(opts, "clip.update", { path: existing.path, name });
        result = { path: existing.path };
      } else {
        result = (await op(opts, "clip.create-midi", {
          target: targetSpec,
          lengthBeats,
          notes: placedNotes,
          name,
        })) as { path: string };
      }

      const clampedNote =
        existing && placedNotes.length < notes.length
          ? ` — existing clip is ${existing.lengthBeats} beats, ${notes.length - placedNotes.length} ` +
            "note(s) past its end were dropped (it can't be resized via the gateway)"
          : "";

      output(
        opts,
        { path: result.path, notes: placedNotes, lengthBeats, params: p, model: transcription.model },
        () =>
          [
            `transcribed -> ${result.path}: ${summaryLine}${existing ? ", filled existing clip" : ""}${clampedNote}`,
            estimateNote,
          ].join("\n"),
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
  .option("--all", "allow an empty --prefix (matches EVERY clip on the track)")
  .action(async (trackPath: string, cmdOpts: { prefix: string; all?: boolean }) => {
    const opts = program.opts<GlobalOpts>();
    // An empty prefix matches every clip name — a validation pass lost a
    // placeholder clip to it. Deleting everything must be said out loud.
    if (cmdOpts.prefix === "" && !cmdOpts.all) {
      throw new Error(
        `--prefix "" matches EVERY clip on ${trackPath} — pass --all if you really mean that`,
      );
    }
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

// ---------------------------------------------------------------------------
// AWH Remote (M12, m4l/): transport + clip launch over OSC — the SDK has no
// play/stop/position or session-clip-launch API (docs/sdk-feedback.md), so
// this device (which supersedes the AWH Capture Tap: same 9720/9721 ports,
// superset protocol) is the only way `awh` can press play. Wire logic lives
// in remote.ts (testable without spawning the CLI, see remote.test.ts).
// ---------------------------------------------------------------------------

interface RemotePortOpts {
  remotePort: string;
  remoteReplyPort: string;
}

function remoteOscOpts(cmdOpts: RemotePortOpts): { port: number; replyPort: number } {
  return { port: Number(cmdOpts.remotePort), replyPort: Number(cmdOpts.remoteReplyPort) };
}

function addRemotePortOptions<T extends Command>(cmd: T): T {
  return cmd
    .option("--remote-port <port>", "AWH Remote OSC port", String(REMOTE_PORT))
    .option("--remote-reply-port <port>", "AWH Remote OSC reply port", String(REMOTE_REPLY_PORT)) as T;
}

addRemotePortOptions(
  program
    .command("play")
    .description(
      "Start the transport via the AWH Remote M4L device (m4l/README.md). " +
        "--from-bar jumps the arrangement playhead first.",
    )
    .option("--from-bar <bar>", "1-based arrangement bar to jump to before playing")
    .option("--sig <beatsPerBar>", "beats per bar", "4"),
).action(
  async (cmdOpts: RemotePortOpts & { fromBar?: string; sig: string }) => {
    const opts = program.opts<GlobalOpts>();
    const fromBeats =
      cmdOpts.fromBar !== undefined ? (Number(cmdOpts.fromBar) - 1) * Number(cmdOpts.sig) : undefined;
    const result = await remotePlay({ ...remoteOscOpts(cmdOpts), fromBeats });
    output(opts, result, () =>
      cmdOpts.fromBar !== undefined
        ? `playing from bar ${cmdOpts.fromBar} (beat ${fromBeats})`
        : "playing",
    );
  },
);

addRemotePortOptions(
  program.command("stop").description("Stop the transport via the AWH Remote M4L device"),
).action(async (cmdOpts: RemotePortOpts) => {
  const opts = program.opts<GlobalOpts>();
  await remoteStop(remoteOscOpts(cmdOpts));
  output(opts, { stopped: true }, () => "stopped");
});

addRemotePortOptions(
  program
    .command("jump <bar>")
    .description("Set the arrangement playhead (current_song_time) via the AWH Remote M4L device")
    .option("--sig <beatsPerBar>", "beats per bar", "4"),
).action(async (bar: string, cmdOpts: RemotePortOpts & { sig: string }) => {
  const opts = program.opts<GlobalOpts>();
  const beats = (Number(bar) - 1) * Number(cmdOpts.sig);
  const result = await remoteJump({ beats, ...remoteOscOpts(cmdOpts) });
  output(opts, { beats, reply: result }, () => `jumped to bar ${bar} (beat ${beats})`);
});

addRemotePortOptions(
  program
    .command("launch <target>")
    .description(
      "Fire a session clip slot (track:N/slot:M) or a scene (scene:N) via the AWH Remote " +
        "M4L device — respects Live's launch quantization",
    ),
).action(async (target: string, cmdOpts: RemotePortOpts) => {
  const opts = program.opts<GlobalOpts>();
  const parsed = parseLaunchTarget(target);
  const result =
    parsed.kind === "fire"
      ? await remoteFire({ trackIdx: parsed.trackIdx, slotIdx: parsed.slotIdx, ...remoteOscOpts(cmdOpts) })
      : await remoteScene({ sceneIdx: parsed.sceneIdx, ...remoteOscOpts(cmdOpts) });
  output(opts, { target, reply: result }, () => `launched ${target} -> ${result.join(" ")}`);
});

addRemotePortOptions(
  program
    .command("stop-clips [track]")
    .description(
      "Stop all clips on a track (track:N), or the whole Set when omitted, via the AWH Remote " +
        "M4L device (call stop_all_clips)",
    ),
).action(async (track: string | undefined, cmdOpts: RemotePortOpts) => {
  const opts = program.opts<GlobalOpts>();
  if (track !== undefined && !/^track:\d+$/.test(track)) {
    throw new Error(`awh stop-clips needs a plain track path like track:2 (got "${track}")`);
  }
  const trackIdx = track !== undefined ? Number(track.match(/^track:(\d+)$/)![1]) : -1;
  const result = await remoteStopClips({ trackIdx, ...remoteOscOpts(cmdOpts) });
  output(opts, { track: track ?? "all", reply: result }, () =>
    track !== undefined ? `stopped clips on ${track}` : "stopped all clips",
  );
});

// ---------------------------------------------------------------------------
// `awh lib audition` state: which auditioned clip (if any) is still pending
// a sweep — persisted between CLI invocations (this is the ONLY CLI command
// with cross-invocation state; docs/design/live-remote.md). AWH_AUDITION_STATE
// overrides the file location (used by tests to avoid touching the real
// repo's .dev/); default lives under .dev/ (gitignored), same scratch
// convention as `op verify`'s capture files.
// ---------------------------------------------------------------------------

function auditionStateFile(): string {
  return process.env.AWH_AUDITION_STATE
    ? resolve(process.env.AWH_AUDITION_STATE)
    : join(repoRoot(), ".dev", "audition-state.json");
}

async function readAuditionState(): Promise<AuditionState | undefined> {
  const file = auditionStateFile();
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(await readFile(file, "utf8")) as AuditionState;
  } catch {
    return undefined;
  }
}

async function writeAuditionState(state: AuditionState | undefined): Promise<void> {
  const file = auditionStateFile();
  if (state === undefined) {
    if (existsSync(file)) await rm(file);
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf8");
}

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
      let styleSpec: DrumStyleSpec | undefined;
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
// Drum-loop rhythm-statistics mining (owner request): band-split onset
// mining across a folder of drum loops, reported for comparison against the
// built-in style specs — never auto-applied to them (grammars.ts/styleSpec.ts
// stay hand-authored and locked).
// ---------------------------------------------------------------------------

interface DrumStatsBand {
  position_prob: number[];
  density: number;
  onsets_total: number;
}

interface DrumStatsResult {
  dataset: string;
  n_loops: number;
  bpm_range: [number, number];
  bpm_mean: number;
  grid: number;
  per_band: { low: DrumStatsBand; mid: DrumStatsBand; high: DrumStatsBand };
  swing_estimate: {
    band: string;
    on8_mean_offset_steps: number | null;
    off16_mean_offset_steps: number | null;
    delay_frac_of_16th_step: number | null;
    delay_equivalent_beats: number | null;
    n_on8_onsets: number;
    n_off16_onsets: number;
  };
  downbeat_check: { loops_checked: number; loops_near_zero: number; near_zero_threshold_s: number | null };
  mp3_decode_mode: string | null;
  assumptions: string[];
  files: string[];
  skipped: { file: string; reason: string }[];
  generated_by: string;
}

function renderDrumStatsTable(result: DrumStatsResult): string {
  const bands: Array<"low" | "mid" | "high"> = ["low", "mid", "high"];
  const grid = result.grid;
  const header = "position   " + Array.from({ length: grid }, (_, i) => String(i).padStart(5)).join("");
  const lines = [
    `${result.dataset} — ${result.n_loops} loop(s), BPM ${result.bpm_range[0].toFixed(0)}-` +
      `${result.bpm_range[1].toFixed(0)} (mean ${result.bpm_mean.toFixed(1)}), ` +
      `mp3 decode: ${result.mp3_decode_mode ?? "n/a"}`,
    "",
    "Position-hit probability (% of bars with an onset at that grid step):",
    header,
  ];
  for (const b of bands) {
    const pb = result.per_band[b];
    const row = pb.position_prob.map((p) => String(Math.round(p * 100)).padStart(5)).join("");
    lines.push(`${b.padEnd(10)} ${row}`);
  }
  lines.push("");
  for (const b of bands) {
    const pb = result.per_band[b];
    lines.push(`${b.padEnd(4)} density  ${pb.density.toFixed(2)} onsets/bar (${pb.onsets_total} onsets total)`);
  }
  lines.push("");
  const sw = result.swing_estimate;
  lines.push(
    sw.delay_frac_of_16th_step !== null
      ? `swing (high band, off-16th vs on-8th timing): ${(sw.delay_frac_of_16th_step * 100).toFixed(1)}% ` +
          `of a 16th step late (${sw.delay_equivalent_beats!.toFixed(3)} beats equiv.; n=${sw.n_on8_onsets} on-8th / ` +
          `${sw.n_off16_onsets} off-16th onsets)`
      : "swing: not enough high-band onsets to estimate",
  );
  lines.push("");
  lines.push("Assumptions (read before trusting these numbers):");
  for (const a of result.assumptions) lines.push(`  - ${a}`);
  if (result.skipped.length > 0) {
    lines.push("");
    lines.push("Skipped files:");
    for (const s of result.skipped) lines.push(`  - ${s.file}: ${s.reason}`);
  }
  return lines.join("\n");
}

drums
  .command("mine <dirs...>")
  .description(
    "Mine rhythm statistics (band-split 16th-grid hit-position probabilities) from " +
      "a folder of drum-loop audio files — REPORTS numbers to compare against the " +
      "built-in style specs, never auto-tunes them",
  )
  .option("--no-bpm-from-name", "disable parsing BPM from loop filenames (e.g. '138bpm_...') — requires --bpm")
  .option("--bpm <bpm>", "fixed BPM fallback (or forced for every loop with --no-bpm-from-name)")
  .option("--grid <n>", "grid steps per bar", "16")
  .option("--dataset <name>", "dataset name for the output (default: single input directory's basename)")
  .option(
    "--attribution <text>",
    "license/attribution note embedded verbatim in the saved record (e.g. the exact CC BY 4.0 credit line)",
  )
  .option(
    "--save [name]",
    "also save a measurement record to library/measurements/ (default name: the dataset name)",
  )
  .action(
    async (
      dirs: string[],
      cmdOpts: {
        bpmFromName: boolean;
        bpm?: string;
        grid: string;
        dataset?: string;
        attribution?: string;
        save?: string | boolean;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const datasetName =
        cmdOpts.dataset ?? (dirs.length === 1 ? basename(resolve(dirs[0]!)) : undefined);

      const args = ["drumstats", ...dirs];
      if (!cmdOpts.bpmFromName) args.push("--no-bpm-from-name");
      if (cmdOpts.bpm) args.push("--bpm", cmdOpts.bpm);
      args.push("--grid", cmdOpts.grid);
      if (datasetName) args.push("--dataset", datasetName);

      let recordPath: string | undefined;
      if (cmdOpts.save !== undefined) {
        const name =
          typeof cmdOpts.save === "string" ? cmdOpts.save : slugify(datasetName ?? "drumstats-record");
        recordPath = join(findLibraryRoot(), "measurements", `${name}.json`);
        await mkdir(dirname(recordPath), { recursive: true });
        args.push("--save-record", recordPath);
        if (cmdOpts.attribution) {
          args.push("--attribution", JSON.stringify({ note: cmdOpts.attribution }));
        }
        process.stderr.write(`record -> ${recordPath}\n`);
      }

      const result = (await runAnalysisJson(args)) as unknown as DrumStatsResult;

      // Zero audio files found is a STATE, not an error (docs/lessons-learned.md #5).
      if (result.n_loops === 0) {
        output(opts, result, () =>
          `no audio files found in: ${dirs.join(", ")} (looked for .mp3/.wav/.aif/.aiff/.flac/.ogg)`,
        );
        return;
      }

      output(opts, result, () => renderDrumStatsTable(result));
    },
  );

// ---------------------------------------------------------------------------
// Phrase engine (M9): call-and-response drop writing.
// ---------------------------------------------------------------------------

const PHRASE_BEATS_PER_BAR = 4;

/** Resolve --style: built-in first, else a `phrase-style-<name>` knowledge
 *  entry's ```awh-phrase-spec``` block — same convention as `drums gen`. */
async function resolvePhraseSpec(style: string): Promise<{ spec: PhraseSpec; styleTier?: string }> {
  if (listPhraseStyles().includes(style)) {
    return { spec: BASS_MUSIC_CR_SPEC };
  }
  let entry;
  try {
    entry = await knowledgeStore().loadEntry(`phrase-style-${style}`);
  } catch {
    throw new Error(
      `unknown phrase style "${style}" — built-ins: ${listPhraseStyles().join(", ")}; ` +
        `data styles need a knowledge entry with slug phrase-style-${style} (see knowledge/README.md)`,
    );
  }
  const specText = extractFencedBlock(entry.body, "awh-phrase-spec");
  if (!specText) {
    throw new Error(`knowledge entry ${entry.relPath} has no \`\`\`awh-phrase-spec block`);
  }
  return { spec: parsePhraseSpec(specText), styleTier: entry.tier };
}

/** Resolve a `drop phrase` target: explicit slot/arr path, track + --at-bar,
 *  or a bare track path (auto-picks an empty session slot) — same
 *  conventions as `drums gen`/`lib place`/`clip from-audio`. An existing
 *  clip at the target is filled in place (same occupied-target convention). */
async function resolvePhraseTarget(
  opts: GlobalOpts,
  summary: SetSummary,
  target: string,
  atBar: string | undefined,
  lengthBeats: number,
): Promise<{ targetSpec: unknown; where: string; existing?: { path: string; lengthBeats: number } }> {
  const isSlotPath = /\/slot:\d+$/.test(target);
  const isArrPath = /\/arr:\d+$/.test(target);
  if (isSlotPath || isArrPath) {
    let existing: { path: string; lengthBeats: number } | undefined;
    try {
      const detail = (await op(opts, "clip.get", { path: target })) as ClipDetail;
      existing = { path: target, lengthBeats: detail.duration };
    } catch {
      if (isArrPath) {
        throw new Error(`no clip at ${target} — arr paths must point at an existing clip to fill`);
      }
    }
    return { targetSpec: { type: "session", slotPath: target }, where: target, existing };
  }
  const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === target);
  if (!track) throw new Error(`track not found: ${target}`);
  if (atBar !== undefined) {
    const startBeat = (Number(atBar) - 1) * PHRASE_BEATS_PER_BAR;
    const endBeat = startBeat + lengthBeats;
    const overlap = track.arrangementClips.find(
      (c) => startBeat < (c.endTime ?? 0) && endBeat > (c.startTime ?? 0),
    );
    const existing = overlap ? { path: overlap.path, lengthBeats: overlap.duration } : undefined;
    return { targetSpec: { type: "arrangement", trackPath: target, startBeat }, where: `${target} @ bar ${atBar}`, existing };
  }
  const occupied = new Set(track.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])));
  const free = Array.from({ length: track.slotCount }, (_, i) => i).find((i) => !occupied.has(i));
  if (free === undefined) {
    throw new Error(`no empty session slot on ${target} — pass --at-bar or an explicit slot/arr path`);
  }
  const slotPath = `${target}/slot:${free}`;
  return { targetSpec: { type: "session", slotPath }, where: slotPath };
}

/** Write (or fill) a phrase voice's clip. Occupied targets are filled in
 *  place (notes clamped to the existing clip's length), same convention as
 *  `awh lib place` / `awh clip from-audio`. */
async function writePhraseClip(
  opts: GlobalOpts,
  resolved: { targetSpec: unknown; where: string; existing?: { path: string; lengthBeats: number } },
  lengthBeats: number,
  notes: NoteSpec[],
  name: string,
): Promise<{ path: string; notes: NoteSpec[]; clamped: number }> {
  if (resolved.existing) {
    const placed = clampNotesToLength(notes, resolved.existing.lengthBeats);
    await op(opts, "clip.notes", { path: resolved.existing.path, notes: placed });
    await op(opts, "clip.update", { path: resolved.existing.path, name });
    return { path: resolved.existing.path, notes: placed, clamped: notes.length - placed.length };
  }
  const result = (await op(opts, "clip.create-midi", {
    target: resolved.targetSpec,
    lengthBeats,
    notes,
    name,
  })) as { path: string };
  return { path: result.path, notes, clamped: 0 };
}

const drop = program
  .command("drop")
  .description(
    "Call-and-response phrase engine (M9): answer an existing call clip, or " +
      "cold-start a call/response skeleton from a spec",
  );

drop
  .command("respond <callClip> <target>")
  .description(
    "THE core call-and-response feature: reads an existing call clip and " +
      "emits N candidate RESPONSE clips (default: one per recipe) into " +
      "consecutive empty session slots on <target> (a track path), each " +
      `named "resp <recipe> s<seed>".`,
  )
  .option("--recipe <recipe>", `pin one recipe (${RESPONSE_RECIPE_NAMES.join(", ")}) instead of one-per-recipe`)
  .option("-n, --count <n>", "number of candidates (default: one per eligible recipe)")
  .option("--seed <seed>", "base random seed (same seed = same candidates)", "1")
  .option("--key <key>", 'e.g. "A minor" (default: the Set scale)')
  .option(
    "--style <style>",
    `phrase spec: built-in (${listPhraseStyles().join(", ")}) or a knowledge phrase-style-<name>`,
    "bass-music-cr",
  )
  .option("--dry-run", "print the candidates without touching Live")
  .action(
    async (
      callClip: string,
      target: string,
      cmdOpts: {
        recipe?: string;
        count?: string;
        seed: string;
        key?: string;
        style: string;
        dryRun?: boolean;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const detail = (await op(opts, "clip.get", { path: callClip })) as ClipDetail;
      if (detail.kind !== "midi" || !detail.notes) {
        throw new Error(`${callClip} is not a MIDI clip`);
      }

      // Zero notes is a STATE, not an error (docs/lessons-learned.md #5):
      // nothing to respond to, nothing written, exit 0.
      if (detail.notes.length === 0) {
        output(opts, { callClip, created: [] }, () =>
          `${callClip} has no notes — nothing to respond to (write or transcribe a call first)`,
        );
        return;
      }

      const { spec, styleTier } = await resolvePhraseSpec(cmdOpts.style);
      const summary = (await op(opts, "set.summary")) as SetSummary;
      const keyCtx = resolveKey(summary, cmdOpts.key);

      let recipes: ResponseRecipeName[];
      if (cmdOpts.recipe) {
        if (!RESPONSE_RECIPE_NAMES.includes(cmdOpts.recipe as ResponseRecipeName)) {
          throw new Error(`unknown recipe "${cmdOpts.recipe}" (one of: ${RESPONSE_RECIPE_NAMES.join(", ")})`);
        }
        recipes = [cmdOpts.recipe as ResponseRecipeName];
      } else {
        recipes = spec.responseRecipes;
      }
      const count = cmdOpts.count !== undefined ? Number(cmdOpts.count) : recipes.length;
      const candidates = generateResponses(detail.notes, keyCtx, spec, {
        recipes,
        count,
        seed: Number(cmdOpts.seed),
      });
      const warnings = [...new Set(candidates.flatMap((c) => c.warnings))];
      const specLine = `spec ${cmdOpts.style}${styleTier ? ` [${styleTier}]` : ""}, key ${keyCtx.label}`;

      const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === target);
      if (!track) throw new Error(`track not found: ${target}`);
      const occupied = new Set(track.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])));
      const free = Array.from({ length: track.slotCount }, (_, i) => i).filter((i) => !occupied.has(i));
      if (free.length < candidates.length) {
        throw new Error(
          `need ${candidates.length} empty session slots on ${target}, found ${free.length} — ` +
            "add scenes or sweep old auditions",
        );
      }

      if (cmdOpts.dryRun) {
        output(opts, { candidates, warnings }, () =>
          [
            `dry run: ${candidates.length} response candidate(s) for ${callClip} -> ${target} (${specLine}):`,
            ...candidates.map((c) => `  resp ${c.recipe} s${c.seed} — ${c.notes.length} notes, ${c.lengthBeats} beats`),
            ...warnings.map((w) => `  WARNING: ${w}`),
            "candidates are starting points to audition, not a finished part.",
          ].join("\n"),
        );
        return;
      }

      const created: { path: string; name: string }[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]!;
        const slotPath = `${target}/slot:${free[i]}`;
        const name = `resp ${c.recipe} s${c.seed}`;
        await op(opts, "clip.create-midi", {
          target: { type: "session", slotPath },
          lengthBeats: c.lengthBeats,
          notes: c.notes,
          name,
        });
        created.push({ path: slotPath, name });
      }

      output(opts, { created, warnings }, () =>
        [
          `${created.length} response candidate(s) for ${callClip} -> ${target} (${specLine}):`,
          ...created.map((c) => `  ${c.path.padEnd(22)} ${c.name}`),
          ...warnings.map((w) => `  WARNING: ${w}`),
          "candidates are starting points — audition, then keep/tweak your favorite.",
        ].join("\n"),
      );
    },
  );

drop
  .command("phrase <target> [responseTarget]")
  .description(
    "Cold-start an 8/16-bar call-and-response skeleton from a spec. One " +
      "target = single clip, register-split; two targets = paired call/" +
      "response clips of equal length (each voice silent during the " +
      "other's bars).",
  )
  .option("--bars <bars>", "8 or 16", "8")
  .option(
    "--style <style>",
    `phrase spec: built-in (${listPhraseStyles().join(", ")}) or a knowledge phrase-style-<name>`,
    "bass-music-cr",
  )
  .option("--seed <seed>", "random seed (same seed = same phrase)", "1")
  .option("--variant <variant>", "force a named call-cell variant (see the style's callCells) or its index")
  .option("--key <key>", 'e.g. "A minor" (default: the Set scale)')
  .option("--at-bar <bar>", "arrangement position (1-based bar) for track targets")
  .option("--dry-run", "print the notation preview without touching Live")
  .action(
    async (
      target: string,
      responseTarget: string | undefined,
      cmdOpts: {
        bars: string;
        style: string;
        seed: string;
        variant?: string;
        key?: string;
        atBar?: string;
        dryRun?: boolean;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const bars = Number(cmdOpts.bars);
      if (bars !== 8 && bars !== 16) {
        throw new Error(`--bars must be 8 or 16 (got "${cmdOpts.bars}")`);
      }

      const { spec, styleTier } = await resolvePhraseSpec(cmdOpts.style);
      const summary = (await op(opts, "set.summary")) as SetSummary;
      const keyCtx = resolveKey(summary, cmdOpts.key);

      let variant: number | undefined;
      if (cmdOpts.variant !== undefined) {
        const names = listPhraseVariants(spec);
        variant = /^\d+$/.test(cmdOpts.variant) ? Number(cmdOpts.variant) : names.indexOf(cmdOpts.variant);
        if (variant < 0) {
          throw new Error(`unknown variant "${cmdOpts.variant}" (available: ${names.join(", ")})`);
        }
      }

      const phrase = generatePhrase(spec, keyCtx, {
        bars: bars as 8 | 16,
        seed: Number(cmdOpts.seed),
        ...(variant !== undefined ? { variant } : {}),
      });
      const specLine =
        `spec ${cmdOpts.style}${styleTier ? ` [${styleTier}]` : ""} — cell ${phrase.meta.callCell}, ` +
        `recipe ${phrase.meta.recipe}, seed ${cmdOpts.seed}, key ${keyCtx.label}`;

      if (responseTarget) {
        const callResolved = await resolvePhraseTarget(opts, summary, target, cmdOpts.atBar, phrase.lengthBeats);
        const respResolved = await resolvePhraseTarget(
          opts,
          summary,
          responseTarget,
          cmdOpts.atBar,
          phrase.lengthBeats,
        );

        if (cmdOpts.dryRun) {
          output(
            opts,
            { call: phrase.callNotes, response: phrase.responseNotes, lengthBeats: phrase.lengthBeats, warnings: phrase.warnings },
            () =>
              [
                `dry run: ${bars}-bar phrase (${specLine}):`,
                `  call -> ${callResolved.where} (${phrase.callNotes.length} notes, ${phrase.lengthBeats} beats)`,
                `  response -> ${respResolved.where} (${phrase.responseNotes.length} notes, ${phrase.lengthBeats} beats)`,
                ...phrase.warnings.map((w) => `  WARNING: ${w}`),
                "this is a skeleton — audition both voices together, then shape it into a real drop.",
              ].join("\n"),
          );
          return;
        }

        const callResult = await writePhraseClip(opts, callResolved, phrase.lengthBeats, phrase.callNotes, `call ${spec.name}`);
        const respResult = await writePhraseClip(
          opts,
          respResolved,
          phrase.lengthBeats,
          phrase.responseNotes,
          `response ${spec.name}`,
        );

        output(opts, { call: callResult, response: respResult, warnings: phrase.warnings }, () =>
          [
            `${bars}-bar phrase (${specLine}):`,
            `  call -> ${callResult.path} (${callResult.notes.length} notes)`,
            `  response -> ${respResult.path} (${respResult.notes.length} notes)`,
            ...phrase.warnings.map((w) => `  WARNING: ${w}`),
            "this is a skeleton, not a finished drop — audition both voices together and shape it from there.",
          ].join("\n"),
        );
      } else {
        const resolved = await resolvePhraseTarget(opts, summary, target, cmdOpts.atBar, phrase.lengthBeats);
        const merged = sortNotes([...phrase.callNotes, ...phrase.responseNotes]);

        if (cmdOpts.dryRun) {
          output(opts, { notes: merged, lengthBeats: phrase.lengthBeats, warnings: phrase.warnings }, () =>
            [
              `dry run: ${bars}-bar phrase (${specLine}) -> ${resolved.where} ` +
                `(${merged.length} notes, register-split call/response in one clip)`,
              ...phrase.warnings.map((w) => `  WARNING: ${w}`),
              "this is a skeleton — audition, then shape it into a real drop.",
            ].join("\n"),
          );
          return;
        }

        const result = await writePhraseClip(opts, resolved, phrase.lengthBeats, merged, spec.name);
        output(opts, { path: result.path, notes: result.notes, warnings: phrase.warnings }, () =>
          [
            `${bars}-bar phrase (${specLine}) -> ${result.path} (${result.notes.length} notes, register-split)`,
            ...phrase.warnings.map((w) => `  WARNING: ${w}`),
            "this is a skeleton, not a finished drop — audition and shape it from there.",
          ].join("\n"),
        );
      }
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
  .command("audition [slug] [track]")
  .description(
    "Place a library clip into an empty slot on <track> and fire it via the AWH Remote M4L " +
      "device (m4l/README.md) so it's immediately audible. Auditioning a new slug (or --end) " +
      "sweeps the PREVIOUS audition by its exact clip name (never a prefix sweep) — pass --keep " +
      "to leave a clip in place permanently instead.",
  )
  .option("--keep", "keep this clip in place permanently (skip the sweep-on-next/--end cleanup)")
  .option("--end", "sweep the pending (non---keep) audition and exit — no <slug>/<track> needed")
  .option("--library <dir>", "library root")
  .option("--remote-port <port>", "AWH Remote OSC port", String(REMOTE_PORT))
  .option("--remote-reply-port <port>", "AWH Remote OSC reply port", String(REMOTE_REPLY_PORT))
  .action(
    async (
      slug: string | undefined,
      track: string | undefined,
      cmdOpts: { keep?: boolean; end?: boolean; library?: string; remotePort: string; remoteReplyPort: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const caller: OpCaller = (name, args) => op(opts, name, args);
      const pending = await readAuditionState();

      if (cmdOpts.end) {
        const swept = await auditionEnd({ caller, pending });
        await writeAuditionState(undefined);
        output(opts, { swept: swept ?? [] }, () =>
          swept === undefined || swept.length === 0
            ? "nothing to end — no pending (non---keep) audition"
            : `swept ${swept.length} clip(s): ${swept.join(", ")}`,
        );
        return;
      }

      if (!slug || !track) {
        throw new Error("pass <slug> <track> to audition, or --end to sweep the previous one");
      }
      const entry = await libraryStore(cmdOpts).loadClip(slug);
      if (!entry.notation) throw new Error(`${slug} has no notation block to audition`);

      const result = await auditionSlug({
        caller,
        source: {
          slug,
          notation: entry.notation,
          lengthBeats: entry.lengthBeats,
          beatsPerBar: entry.beatsPerBar ?? 4,
        },
        trackPath: track,
        keep: cmdOpts.keep,
        pending,
        osc: remoteOscOpts(cmdOpts),
      });
      await writeAuditionState(result.nextPending);

      output(opts, result, () =>
        [
          result.swept && result.swept.length
            ? `swept previous audition: ${result.swept.join(", ")}`
            : undefined,
          `playing ${slug} [${entry.tier}] -> ${result.path} (fired track ${result.trackIdx} slot ${result.slotIdx})`,
          cmdOpts.keep
            ? "kept — won't be auto-swept (use `awh sweep` by hand when done)."
            : "not kept — auditioning the next slug (or `awh lib audition --end`) will sweep this one.",
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
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

lib
  .command("import")
  .description(
    "Drain right-click captures ('AWH: Save clip to library' in Live) into " +
      "library/clips/inbox/ as draft entries for naming/tagging later",
  )
  .option("--library <dir>", "library root")
  .action(async (cmdOpts: { library?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const entries = (await op(opts, "library.outbox")) as {
      name: string;
      notes: NoteSpec[];
      lengthBeats: number;
      tempo: number;
      scale: { rootNote: number; name: string; active: boolean } | null;
      capturedAt: string;
    }[];
    if (entries.length === 0) {
      output(opts, [], () => "outbox empty — nothing captured since the last import");
      return;
    }
    const store = libraryStore(cmdOpts);
    const existing = new Set((await store.listClips()).map((e) => e.slug));
    const imported: string[] = [];
    for (const captured of entries) {
      let base: string;
      try {
        base = slugify(captured.name || "captured-clip");
      } catch {
        base = "captured-clip";
      }
      let slug = base;
      for (let n = 2; existing.has(slug); n++) slug = `${base}-${n}`;
      existing.add(slug);
      const file = await store.saveClip({
        slug,
        kind: "midi",
        category: "inbox",
        tags: [],
        bpm: captured.tempo,
        scale: captured.scale?.active
          ? `${PITCH_CLASSES[captured.scale.rootNote % 12]} ${captured.scale.name}`
          : null,
        lengthBeats: captured.lengthBeats,
        source: {
          project: null,
          path: "right-click capture",
          saved: captured.capturedAt.slice(0, 10),
        },
        tier: "draft",
        title: captured.name || slug,
        notation: serializeNotation(captured.notes, { beatsPerBar: 4 }),
      });
      imported.push(file);
    }
    await store.buildIndex();
    output(opts, { imported }, () =>
      [
        `${imported.length} capture(s) imported:`,
        ...imported.map((f) => `  ${f}`),
        "curate: rename/re-categorize (edit category + move the file), tag, then lib index",
      ].join("\n"),
    );
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

    // Record "kinds" sharing library/measurements/: single-file mix reports
    // (report.save_record, `kind` field absent), multi-file drumstats
    // records (`kind: "drumstats"`), M13's `mix layers --save`
    // (`kind: "layers"`) and `mix advise --save` (`kind: "advice"`) —
    // ALL must render (not crash) in `mix records`/`mix records <name>`.
    interface DrumStatsRecordFile {
      kind: "drumstats";
      saved: string;
      n_sources: number;
      stats: DrumStatsResult;
      attribution?: { note?: string; [k: string]: unknown };
    }
    interface MixReportRecordFile {
      kind?: undefined;
      saved: string;
      file: string;
      measurements: {
        loudness: { lufs_integrated: number; true_peak_db: number; psr: { min_psr_loud: number } };
        spectrum: { tilt_db_per_oct: number };
        bpm?: number;
      };
      findings: { severity: string; explanation: string; suggestion: string }[];
    }
    interface LayersRecordFile {
      kind: "layers";
      saved: string;
      tracks: { trackPath: string; trackName: string; file: string }[];
      bands: { calibration?: string };
    }
    interface AdviceRecordFile {
      kind: "advice";
      saved: string;
      source: string;
      preset: string;
      has_target: boolean;
      has_layers: boolean;
      items: AdviceItem[];
      healthy: AdviceHealthy | null;
    }
    type RecordFile = DrumStatsRecordFile | MixReportRecordFile | LayersRecordFile | AdviceRecordFile;

    if (name !== undefined) {
      const file = join(dir, `${name}.json`);
      if (!existsSync(file)) throw new Error(`no measurement record ${file}`);
      const record = JSON.parse(readFileSync(file, "utf8")) as RecordFile;
      if (record.kind === "drumstats") {
        const s = record.stats;
        output(opts, record, () =>
          [
            `${name} — saved ${record.saved} (drumstats: ${s.dataset})`,
            `  n_loops ${s.n_loops}  sources ${record.n_sources}  ` +
              `bpm ${s.bpm_range[0].toFixed(0)}-${s.bpm_range[1].toFixed(0)}`,
            `  density  low ${s.per_band.low.density.toFixed(2)}/bar · ` +
              `mid ${s.per_band.mid.density.toFixed(2)}/bar · high ${s.per_band.high.density.toFixed(2)}/bar`,
            ...(record.attribution?.note ? [`  attribution: ${record.attribution.note}`] : []),
            ``,
            `full JSON: ${file} (or --json); re-run: awh drums mine <dir> --dataset ${s.dataset}`,
          ].join("\n"),
        );
        return;
      }
      if (record.kind === "layers") {
        output(opts, record, () =>
          [
            `${name} — saved ${record.saved} (layers: ${record.tracks.length} track(s))`,
            ...record.tracks.map((t) => `  ${t.trackPath.padEnd(10)} "${t.trackName}"`),
            ``,
            `full JSON: ${file} (or --json); unlocks: awh mix advise ... --layers ${name}`,
          ].join("\n"),
        );
        return;
      }
      if (record.kind === "advice") {
        const actionable = record.items.filter((it) => it.kind === "finding");
        output(opts, record, () =>
          [
            `${name} — saved ${record.saved} (advice: ${record.source}, preset ${record.preset})`,
            record.healthy
              ? `  HEALTHY — ${record.healthy.message}`
              : `  ${actionable.length} actionable item(s), top: #${actionable[0]?.rank} ${actionable[0]?.id}`,
            ``,
            `full JSON: ${file} (or --json); re-run: awh mix advise ... --compare ${name}`,
          ].join("\n"),
        );
        return;
      }
      const m = record.measurements;
      output(opts, record, () =>
        [
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
        ].join("\n"),
      );
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
        const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as RecordFile;
        const name = f.replace(/\.json$/, "");
        if (r.kind === "drumstats") {
          return {
            name,
            saved: r.saved,
            summary: `drumstats: ${r.stats.n_loops} loop(s), ${r.stats.dataset}`,
          };
        }
        if (r.kind === "layers") {
          return {
            name,
            saved: r.saved,
            summary: `layers: ${r.tracks.length} track(s) (${r.tracks.map((t) => t.trackName).join(", ")})`,
          };
        }
        if (r.kind === "advice") {
          const actionable = r.items.filter((it) => it.kind === "finding");
          return {
            name,
            saved: r.saved,
            summary: r.healthy
              ? `advice: healthy (${r.source})`
              : `advice: ${actionable.length} actionable item(s) (${r.source})`,
          };
        }
        return {
          name,
          saved: r.saved,
          summary:
            `${r.measurements.loudness.lufs_integrated.toFixed(1).padStart(6)} LUFS  ` +
            `${r.measurements.spectrum.tilt_db_per_oct.toFixed(1).padStart(5)} dB/oct  ${basename(r.file)}`,
        };
      });
    output(opts, rows, () =>
      rows.length === 0
        ? "no measurement records yet — awh mix report <file> --save"
        : rows.map((r) => `${r.name.padEnd(32)} ${r.saved}  ${r.summary}`).join("\n"),
    );
  });

// ---------------------------------------------------------------------------
// M11: sample library — local index, search, similarity
// (docs/design/sample-library.md; logic lives in samples.ts)
// ---------------------------------------------------------------------------

const samplesCmd = program
  .command("samples")
  .description(
    "Local sample-library index: text/trait search over your own sample folders, " +
      "ranked by cosine similarity to a reference sound — never invents a path " +
      "(docs/design/sample-library.md)",
  );

function requireAnalysisEngine(): { python: string; cwd: string } {
  const { python, cwd } = analysisPython();
  if (!existsSync(cwd)) {
    throw new Error(`analysis engine not found at ${cwd} — is the repo checkout complete?`);
  }
  return { python, cwd };
}

samplesCmd
  .command("index <dirs...>")
  .description(
    "Walk folders (wav/aiff/flac/mp3) and (re)build the local index — incremental by " +
      "path+size+mtime; deleted files under the given folders are pruned",
  )
  .option("--rescan", "force re-scan every file, ignoring the incremental cache", false)
  .action(async (dirs: string[], cmdOpts: { rescan: boolean }) => {
    const opts = program.opts<GlobalOpts>();
    const { python, cwd } = requireAnalysisEngine();
    const indexPath = resolveSamplesIndexPath();

    let lastPrinted = 0;
    const result = await runIndex(dirs, {
      rescan: cmdOpts.rescan,
      indexPath,
      scanner: makePythonScanner(python, cwd),
      onProgress: (done, total) => {
        if (done - lastPrinted >= 1000 || done === total) {
          process.stderr.write(`scanned ${done}/${total}\n`);
          lastPrinted = done;
        }
      },
    });

    const summary = {
      scanned: result.scanned,
      unreadable: result.unreadable,
      unchanged: result.unchanged,
      pruned: result.pruned,
      totalFiles: result.totalFiles,
      indexPath,
    };
    output(opts, summary, () =>
      `indexed ${result.scanned} file(s) (${result.unreadable} unreadable), ` +
        `${result.unchanged} unchanged, ${result.pruned} pruned -> ${indexPath}`,
    );
  });

samplesCmd
  .command("embed")
  .description(
    "Compute missing/stale CLAP embeddings for the whole index (M11b, docs/design/" +
      "sample-semantic.md) — enables `search --semantic`/`similar --semantic`; " +
      "incremental (already-embedded files are skipped), and a model switch re-embeds",
  )
  .option("--model <model>", "music (default, music-tuned) | general (AudioSet)", DEFAULT_CLAP_MODEL)
  .action(async (cmdOpts: { model: string }) => {
    const opts = program.opts<GlobalOpts>();
    if (cmdOpts.model !== "music" && cmdOpts.model !== "general") {
      throw new Error(`--model must be "music" or "general" (got "${cmdOpts.model}")`);
    }
    const model = cmdOpts.model as ClapModel;
    const indexPath = resolveSamplesIndexPath();
    const index = await loadSamplesIndex(indexPath);
    if (Object.keys(index.files).length === 0) {
      output(opts, { embedded: 0 }, () =>
        `no samples indexed yet — run \`awh samples index <dir...>\` first (index: ${indexPath})`,
      );
      return;
    }

    const { python, cwd } = requireAnalysisEngine();
    let lastPrinted = 0;
    const result = await runEmbed({
      indexPath,
      model,
      embedder: makePythonClapEmbedder(python, cwd),
      onProgress: (done, total) => {
        if (done - lastPrinted >= 200 || done === total) {
          process.stderr.write(`embedded ${done}/${total}\n`);
          lastPrinted = done;
        }
      },
    });

    output(opts, result, () => {
      if (result.totalCandidates === 0) {
        return "no readable samples to embed yet — run `awh samples index <dir...>` first";
      }
      if (result.embedded === 0) {
        return (
          `all ${result.totalCandidates} readable sample(s) already embedded ` +
          `(${result.modelLabel}) — nothing to do`
        );
      }
      return (
        `embedded ${result.embedded} of ${result.totalCandidates} readable sample(s) with ` +
        `${result.modelLabel} (${result.neverEmbedded} new, ${result.stale} stale re-embedded, ` +
        `${result.unreadable} failed to embed), ${result.upToDate} already up to date -> ${indexPath}`
      );
    });
  });

samplesCmd
  .command("pitch-tag")
  .description(
    "Pitch-tag eligible kick/sub/808 one-shots (M11c) with a periodicity-tracked f0/note " +
      "(mix pitch, never a naive FFT-peak pick) — enables `search --near-note`; incremental " +
      "(already-tagged files are skipped), only one-shots whose energy is low-band-dominated " +
      "are eligible (hats/vocals/melodic loops are never candidates)",
  )
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const indexPath = resolveSamplesIndexPath();
    const index = await loadSamplesIndex(indexPath);
    if (Object.keys(index.files).length === 0) {
      output(opts, { tagged: 0 }, () =>
        `no samples indexed yet — run \`awh samples index <dir...>\` first (index: ${indexPath})`,
      );
      return;
    }

    const { python, cwd } = requireAnalysisEngine();
    let lastPrinted = 0;
    const result = await runPitchTag({
      indexPath,
      tagger: makePythonPitchTagger(python, cwd),
      onProgress: (done, total) => {
        if (done - lastPrinted >= 200 || done === total) {
          process.stderr.write(`pitch-tagged ${done}/${total}\n`);
          lastPrinted = done;
        }
      },
    });

    output(opts, result, () => {
      if (result.totalCandidates === 0) {
        return (
          "no eligible kick/sub/808 one-shots to tag yet (candidates are one-shots whose " +
          "energy is low-band-dominated) — run `awh samples index <dir...>` first"
        );
      }
      if (result.tagged === 0) {
        return `all ${result.totalCandidates} eligible one-shot(s) already pitch-tagged — nothing to do`;
      }
      return (
        `pitch-tagged ${result.tagged} of ${result.totalCandidates} eligible one-shot(s) ` +
        `(${result.neverTagged} new, ${result.stale} stale re-tagged, ${result.unreadable} failed), ` +
        `${result.upToDate} already up to date, ${result.notCandidate} not eligible -> ${indexPath}`
      );
    });
  });

samplesCmd
  .command("search [query...]")
  .description(
    "Search the index by path tokens (ALL terms must match by default) plus trait filters",
  )
  .option("--any", "match ANY query term instead of ALL", false)
  .option("--type <type>", "filter: loop | oneshot")
  .option("--min-dur <seconds>", "minimum duration in seconds")
  .option("--max-dur <seconds>", "maximum duration in seconds")
  .option("--bpm <bpm>", "filter to samples near this BPM")
  .option("--bpm-tol <bpm>", "BPM tolerance", String(DEFAULT_BPM_TOL))
  .option("--band <band>", "filter: low | mid | high (dominant band)")
  .option(
    "--near-note <note>",
    "filter: pitch-tagged kick/sub one-shots near this note (M11c, Ableton convention " +
      'e.g. "F1") — needs `awh samples pitch-tag` first; composes with every other filter',
  )
  .option("--cents <n>", "cents tolerance for --near-note", String(DEFAULT_CENTS_TOL))
  .option(
    "--semantic <phrase>",
    "rank by CLAP semantic similarity to this phrase instead of path tokens " +
      "(M11b) — composes with the trait filters above, not with plain query terms",
  )
  .action(
    async (
      query: string[] | undefined,
      cmdOpts: {
        any: boolean;
        type?: string;
        minDur?: string;
        maxDur?: string;
        bpm?: string;
        bpmTol: string;
        band?: string;
        nearNote?: string;
        cents: string;
        semantic?: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const terms = query ?? [];
      const indexPath = resolveSamplesIndexPath();
      const index = await loadSamplesIndex(indexPath);
      if (Object.keys(index.files).length === 0) {
        output(opts, { hits: [] }, () =>
          `no samples indexed yet — run \`awh samples index <dir...>\` first (index: ${indexPath})`,
        );
        return;
      }
      if (cmdOpts.type !== undefined && cmdOpts.type !== "loop" && cmdOpts.type !== "oneshot") {
        throw new Error(`--type must be "loop" or "oneshot" (got "${cmdOpts.type}")`);
      }
      if (cmdOpts.band !== undefined && !["low", "mid", "high"].includes(cmdOpts.band)) {
        throw new Error(`--band must be "low", "mid", or "high" (got "${cmdOpts.band}")`);
      }
      const searchOpts: SearchOptions = {
        any: cmdOpts.any,
        type: cmdOpts.type as "loop" | "oneshot" | undefined,
        minDurS: cmdOpts.minDur !== undefined ? Number(cmdOpts.minDur) : undefined,
        maxDurS: cmdOpts.maxDur !== undefined ? Number(cmdOpts.maxDur) : undefined,
        bpm: cmdOpts.bpm !== undefined ? Number(cmdOpts.bpm) : undefined,
        bpmTol: Number(cmdOpts.bpmTol),
        band: cmdOpts.band as "low" | "mid" | "high" | undefined,
        nearNoteHz: cmdOpts.nearNote !== undefined ? noteNameToHz(cmdOpts.nearNote) : undefined,
        centsTol: Number(cmdOpts.cents),
      };

      if (cmdOpts.semantic !== undefined) {
        if (terms.length > 0) {
          throw new Error(
            "--semantic is a standalone query mode — drop the extra search terms " +
              `("${terms.join(" ")}"), or run a plain token search instead`,
          );
        }
        const model = DEFAULT_CLAP_MODEL;
        if (!indexHasClapEmbeddings(index, model)) {
          throw new Error(
            "no samples have CLAP embeddings yet — run `awh samples embed` first, " +
              `then retry --semantic (index: ${indexPath})`,
          );
        }
        const { python, cwd } = requireAnalysisEngine();
        const queryVector = await makePythonClapTextEmbedder(python, cwd)(cmdOpts.semantic, model);
        const result = searchSemantic(index, queryVector.v, model, searchOpts);

        output(opts, result, () => {
          const lines: string[] = [];
          if (result.hits.length === 0) {
            lines.push(`0 semantic hits for "${cmdOpts.semantic}" (matching the trait filters)`);
          } else {
            lines.push(
              ...result.hits.map((h) => {
                const s = h.entry.scan;
                return (
                  `${h.score.toFixed(3)}  ${h.path.padEnd(52)} ${(s.duration_s ?? 0).toFixed(2).padStart(6)}s  ` +
                  `${(s.type_guess ?? "?").padEnd(7)}` +
                  (s.bpm ? `  ${s.bpm.toFixed(1)}bpm` : "          ") +
                  `  ${s.dominant_band ?? "?"}` +
                  (h.entry.pitch?.state === "voiced" ? `  ${pitchDisplayNote(h.entry.pitch)}` : "")
                );
              }),
            );
          }
          if (result.notEmbeddedInIndex > 0) {
            lines.push(
              `${result.notEmbeddedInIndex} of ${result.totalReadableInIndex} files not embedded — ` +
                "run `awh samples embed`",
            );
          }
          return lines.join("\n");
        });
        return;
      }

      const hits = searchIndex(index, terms, searchOpts);

      if (hits.length === 0) {
        const relaxations = suggestRelaxations(index, terms, searchOpts);
        output(opts, { hits: [], relaxations }, () =>
          [
            `0 hits for "${terms.join(" ")}"`,
            ...relaxations.map(
              (r) => `  ${r.count} for "${r.terms.join(" ")}" (${r.note})`,
            ),
          ].join("\n"),
        );
        return;
      }

      output(opts, hits, () =>
        hits
          .map((h) => {
            const s = h.entry.scan;
            return (
              `${h.path.padEnd(60)} ${(s.duration_s ?? 0).toFixed(2).padStart(6)}s  ` +
              `${(s.type_guess ?? "?").padEnd(7)}` +
              (s.bpm ? `  ${s.bpm.toFixed(1)}bpm` : "          ") +
              `  ${s.dominant_band ?? "?"}` +
              (h.entry.pitch?.state === "voiced" ? `  ${pitchDisplayNote(h.entry.pitch)}` : "")
            );
          })
          .join("\n"),
      );
    },
  );

samplesCmd
  .command("similar <file>")
  .description(
    "Rank indexed samples by similarity to a reference file — the reference need not " +
      "be indexed. Semantic (CLAP) is the default once the index has embeddings; " +
      "--traits forces the v1 MFCC/spectral/band-split feature vector",
  )
  .option("--count <n>", "how many results to show", "10")
  .option("--semantic", "force CLAP semantic ranking (M11b)")
  .option("--traits", "force the v1 MFCC/spectral/band-split vector, even if embeddings exist")
  .action(async (file: string, cmdOpts: { count: string; semantic?: boolean; traits?: boolean }) => {
    const opts = program.opts<GlobalOpts>();
    if (cmdOpts.semantic && cmdOpts.traits) {
      throw new Error("pass either --semantic or --traits, not both");
    }
    const indexPath = resolveSamplesIndexPath();
    const index = await loadSamplesIndex(indexPath);
    const readable = Object.values(index.files).filter((e) => !e.scan.unreadable);
    if (readable.length === 0) {
      output(opts, { hits: [] }, () =>
        `no samples indexed yet — run \`awh samples index <dir...>\` first (index: ${indexPath})`,
      );
      return;
    }

    const model = DEFAULT_CLAP_MODEL;
    const hasEmbeddings = indexHasClapEmbeddings(index, model);
    const useSemantic = cmdOpts.semantic || (!cmdOpts.traits && hasEmbeddings);
    const count = Math.max(1, Number(cmdOpts.count));
    const { python, cwd } = requireAnalysisEngine();

    if (useSemantic) {
      if (!hasEmbeddings) {
        throw new Error(
          "no samples have CLAP embeddings yet — run `awh samples embed` first, " +
            `then retry --semantic (index: ${indexPath})`,
        );
      }
      const expectedLabel = expectedClapModelLabel(model);
      const { vector: refVector, fromIndex } = await resolveReferenceClapVector(
        index,
        file,
        makePythonClapEmbedder(python, cwd),
        model,
      );
      const candidates = readable
        .filter((e) => e.clap && e.clap.model === expectedLabel)
        .map((e) => ({ path: e.path, vector: e.clap!, entry: e }));
      const ranked = rankSimilarSemantic(refVector.v, candidates, file).slice(0, count);

      output(opts, { mode: "semantic", fromIndex, hits: ranked }, () =>
        [
          `(semantic — CLAP embedding space, closest in the library, not "a match"; ` +
            (fromIndex ? "reference read from the index)" : "reference embedded on the fly — not indexed)"),
          ...ranked.map((h) => {
            const s = h.entry.scan;
            return (
              `${h.score.toFixed(3)}  ${h.path.padEnd(50)} ${(s.type_guess ?? "?").padEnd(7)} ` +
              `${(s.duration_s ?? 0).toFixed(2).padStart(6)}s` +
              (s.bpm ? `  ${s.bpm.toFixed(1)}bpm` : "") +
              `  ${s.dominant_band ?? "?"}`
            );
          }),
        ].join("\n"),
      );
      return;
    }

    const traitReadable = readable.filter((e) => e.scan.similarity_vector);
    if (traitReadable.length === 0) {
      output(opts, { hits: [] }, () =>
        `no samples with trait vectors indexed yet — run \`awh samples index <dir...>\` first (index: ${indexPath})`,
      );
      return;
    }
    const { vector: refVector, fromIndex } = await resolveReferenceVector(
      index,
      file,
      makePythonScanner(python, cwd),
    );

    const candidates = traitReadable.map((e) => ({
      path: e.path,
      vector: e.scan.similarity_vector!,
      entry: e,
    }));
    const ranked = rankSimilar(refVector, candidates, file).slice(0, count);

    output(opts, { mode: "traits", fromIndex, hits: ranked }, () =>
      [
        fromIndex ? `(traits — reference read from the index)` : `(traits — reference scanned on the fly, not indexed)`,
        ...ranked.map((h) => {
          const s = h.entry.scan;
          return (
            `${h.similarity.toFixed(3)}  ${h.path.padEnd(50)} ${(s.type_guess ?? "?").padEnd(7)} ` +
            `${(s.duration_s ?? 0).toFixed(2).padStart(6)}s` +
            (s.bpm ? `  ${s.bpm.toFixed(1)}bpm` : "") +
            `  ${s.dominant_band ?? "?"}`
          );
        }),
      ].join("\n"),
    );
  });

samplesCmd
  .command("stats")
  .description("Summary of the local sample index (size, roots, type/duration/band histograms)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const indexPath = resolveSamplesIndexPath();
    const index = await loadSamplesIndex(indexPath);
    const stats = summarizeIndex(index);
    output(opts, { ...stats, indexPath }, () =>
      [
        `${stats.totalFiles} file(s) indexed -> ${indexPath}`,
        `  roots: ${stats.roots.length ? stats.roots.join(", ") : "(none)"}`,
        `  type:  ${stats.byType.loop} loop, ${stats.byType.oneshot} oneshot, ` +
          `${stats.byType.unreadable} unreadable`,
        `  band:  low ${stats.byBand.low}  mid ${stats.byBand.mid}  high ${stats.byBand.high}`,
        stats.durationStats
          ? `  duration: ${stats.durationStats.minS.toFixed(2)}s - ` +
            `${stats.durationStats.maxS.toFixed(2)}s (mean ${stats.durationStats.meanS.toFixed(2)}s)`
          : `  duration: (no readable files yet)`,
        stats.pitchTag.candidates > 0
          ? `  pitch:  ${stats.pitchTag.tagged}/${stats.pitchTag.candidates} eligible kick/sub ` +
            `one-shot(s) tagged (${stats.pitchTag.voiced} voiced, ${stats.pitchTag.unvoiced} ` +
            `unvoiced, ${stats.pitchTag.tooShort} too short) — run \`awh samples pitch-tag\` ` +
            (stats.pitchTag.tagged < stats.pitchTag.candidates ? "to finish" : "again to refresh")
          : `  pitch:  (no eligible kick/sub one-shots indexed yet)`,
      ].join("\n"),
    );
  });

/**
 * Typed wrapper for device.param — op() args are `unknown`, so a wrong field
 * name compiles fine and only fails at runtime inside Live (the {name} vs
 * {param} bug found in live verification). Repeat-use ops get typed wrappers;
 * see docs/lessons-learned.md. Delegates to op.ts's caller-based version
 * (packages/cli/src/op.ts) — the SAME wrapper the `awh op` (B2) engine uses,
 * just bound to this file's opts-based `op()` gateway caller.
 */
async function setDeviceParam(
  opts: GlobalOpts,
  path: string,
  param: string,
  value: number,
): Promise<void> {
  await opSetDeviceParam((name, args) => op(opts, name, args), path, param, value);
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

/**
 * Resolve trigger positions in raw BEATS (not seconds) plus the pattern's
 * loop length in beats — what the M4L Ducker needs (it runs its own
 * transport-beat math, see m4l/README.md). Distinct from
 * resolveTriggerSeconds, which the analysis-engine flows use instead.
 */
async function resolveDuckTriggerBeats(
  opts: GlobalOpts,
  cmdOpts: { triggerClip?: string; pattern?: string; length?: string },
): Promise<DuckTriggerSet> {
  if (!cmdOpts.triggerClip && !cmdOpts.pattern) {
    throw new Error("pass --trigger-clip <path> (the Trigger MIDI clip) or --pattern <beats> --length <beats>");
  }
  if (cmdOpts.triggerClip) {
    const detail = (await op(opts, "clip.get", { path: cmdOpts.triggerClip })) as ClipDetail;
    if (detail.kind !== "midi") {
      throw new Error(`${cmdOpts.triggerClip} is not a MIDI clip`);
    }
    const beats = [...new Set((detail.notes ?? []).map((n) => n.start))].sort((a, b) => a - b);
    return { patternLengthBeats: detail.duration, beats };
  }
  if (!cmdOpts.length) {
    throw new Error("--pattern requires --length <beats> (the pattern's loop length)");
  }
  const beats = cmdOpts.pattern!.trim().length
    ? [...new Set(cmdOpts.pattern!.split(",").map((b) => Number(b.trim())))].sort((a, b) => a - b)
    : [];
  return { patternLengthBeats: Number(cmdOpts.length), beats };
}

/** Shape source for `duck push`: --fit <path> (duck-fit --json output) or explicit flags. */
function resolveDuckShape(cmdOpts: {
  fit?: string;
  depth?: string;
  release?: string;
  attack?: string;
  hold?: string;
}): DuckShape {
  if (cmdOpts.fit) {
    const fit = JSON.parse(readFileSync(cmdOpts.fit, "utf8")) as unknown;
    return shapeFromFitJson(fit);
  }
  if (cmdOpts.depth === undefined || cmdOpts.release === undefined) {
    throw new Error("pass --fit <duck-fit.json> or --depth <dB> --release <ms>");
  }
  return {
    depthDb: Number(cmdOpts.depth),
    releaseMs: Number(cmdOpts.release),
    attackMs: cmdOpts.attack !== undefined ? Number(cmdOpts.attack) : 2,
    holdMs: cmdOpts.hold !== undefined ? Number(cmdOpts.hold) : 0,
  };
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
      "automatic stock-Compressor duck, push it straight to the AWH M4L Ducker " +
      "(full-auto), or measure/calibrate the result. ShaperBox hand-drawing is one " +
      "strategy among several — see `awh mix duck push` for the no-routing-clicks one.",
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

duckCmd
  .command("push")
  .description(
    "FULL-AUTO strategy: push the fitted duck envelope to the AWH Ducker M4L device " +
      "(m4l/) over OSC — transport-synced, no compressor/ShaperBox routing needed. " +
      "The device must already be placed once by hand on the Sidechain bus (m4l/README.md).",
  )
  .option("--fit <path>", "duck-fit JSON file (`awh mix duck fit ... --json > fit.json`)")
  .option("--depth <db>", "explicit duck depth in dB (alternative to --fit)")
  .option("--release <ms>", "explicit release time in ms (required with --depth)")
  .option("--attack <ms>", "explicit attack time in ms", "2")
  .option("--hold <ms>", "explicit hold time in ms", "0")
  .option("--trigger-clip <clipPath>", "the Trigger MIDI clip (note starts + loop length, in BEATS)")
  .option("--pattern <beats>", "manual comma-separated trigger positions in BEATS")
  .option("--length <beats>", "pattern loop length in BEATS (required with --pattern)")
  .option("--off", "bypass the Ducker (ping + /awh/duck/on 0) — ignores shape/trigger options")
  .option("--duck-port <port>", "Ducker OSC port", String(DUCK_PORT))
  .option("--duck-reply-port <port>", "Ducker OSC reply port", String(DUCK_REPLY_PORT))
  .action(
    async (cmdOpts: {
      fit?: string;
      depth?: string;
      release?: string;
      attack?: string;
      hold?: string;
      triggerClip?: string;
      pattern?: string;
      length?: string;
      off?: boolean;
      duckPort: string;
      duckReplyPort: string;
    }) => {
      const opts = program.opts<GlobalOpts>();
      const port = Number(cmdOpts.duckPort);
      const replyPort = Number(cmdOpts.duckReplyPort);

      if (cmdOpts.off) {
        const result = await pushDuck({ port, replyPort, off: true });
        output(opts, result, () => `Ducker bypassed (${result.version ? `v${result.version}, ` : ""}port ${port})`);
        return;
      }

      if (!cmdOpts.fit && cmdOpts.depth === undefined) {
        throw new Error("pass --fit <duck-fit.json> or --depth <dB> --release <ms>");
      }
      if (!cmdOpts.triggerClip && !cmdOpts.pattern) {
        throw new Error("pass --trigger-clip <clip path> or --pattern <beats> --length <beats>");
      }

      const shape = resolveDuckShape(cmdOpts);
      const triggers = await resolveDuckTriggerBeats(opts, cmdOpts);

      // Zero triggers is a STATE, not an error (docs/lessons-learned.md rule
      // 5): a duck with nothing to trigger on is a documented no-op — say
      // so, send nothing (not even a ping), exit 0.
      if (triggers.beats.length === 0) {
        output(opts, { sent: false, reason: "no triggers" }, () =>
          "no trigger positions found (empty Trigger clip / empty --pattern) — " +
            "nothing to duck; sent nothing to the Ducker",
        );
        return;
      }

      const result = await pushDuck({ port, replyPort, shape, triggers });
      output(opts, result, () =>
        [
          `Ducker updated (v${result.version}, port ${port}):`,
          `  triggers   ${result.triggerCount} at pattern length ${result.patternLengthBeats} beats`,
          `  shape      depth ${shape.depthDb.toFixed(1)} dB, attack ${shape.attackMs.toFixed(0)} ms, ` +
            `hold ${shape.holdMs.toFixed(0)} ms, release ${shape.releaseMs.toFixed(0)} ms`,
          `  state      on`,
          "",
          "Verify: `awh mix duck measure <SidechainBusCapture> --trigger-clip ...` " +
            "on a capture of the Sidechain bus post-Ducker.",
        ].join("\n"),
      );
    },
  );

mix
  .command("pump-check <busCapture>")
  .description(
    "Trigger-locked sidechain verification (pump v2): fits the fixed dip " +
      "model per trigger and gives a ducking/no-duck/inconclusive verdict. " +
      "Capture the ISOLATED ducked bus (Sidechain track), not the full mix",
  )
  .option("--trigger-clip <clipPath>", "the Trigger MIDI clip")
  .option("--triggers <beats>", "manual trigger positions in BEATS")
  .action(
    async (busCapture: string, cmdOpts: { triggerClip?: string; triggers?: string }) => {
      const opts = program.opts<GlobalOpts>();
      const t = await resolveTriggerSeconds(opts, cmdOpts);
      const args = ["pumpcheck", busCapture, ...triggerArgs(t)];
      if (opts.json) args.push("--json");
      await runAnalysis(args);
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
// M6b masking toolkit (docs/design/analysis-engine.md's 2026-08-23 gap
// report): periodicity-tracked pitch, calibrated narrowband energy, and
// the solo->capture->unsolo choreography — packages/cli/src/layers.ts.
// ---------------------------------------------------------------------------

mix
  .command("pitch <file>")
  .description(
    "Periodicity-tracked f0 (pyin) with an honest harmonic-dominance flag — " +
      "never a naive FFT-peak pick (the exact live-caught failure this replaces)",
  )
  .option(
    "--per-note",
    "segment via onset detection and report f0/dominance PER NOTE, not one average",
  )
  .option("--from <seconds>", "analyze from this time")
  .option("--to <seconds>", "analyze up to this time")
  .action(
    async (
      file: string,
      cmdOpts: { perNote?: boolean; from?: string; to?: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const args = ["pitch", file];
      if (cmdOpts.perNote) args.push("--per-note");
      if (cmdOpts.from) args.push("--from", cmdOpts.from);
      if (cmdOpts.to) args.push("--to", cmdOpts.to);
      if (opts.json) args.push("--json");
      await runAnalysis(args);
    },
  );

mix
  .command("bands <files...>")
  .description(
    "Calibrated per-band dBFS via a Welch periodogram (masking-diagnosis narrowband " +
      "compare, not a one-FFT time-smeared number); multiple files -> an aligned " +
      "table with per-band deltas vs. the first",
  )
  .option(
    "--bands <ranges>",
    'comma-separated "lo-hi" Hz ranges (default: "20-100,100-140,140-200,200-500,500-2000" ' +
      "= sub/low/scoop zone/low-mid/mid)",
  )
  .option("--from <seconds>", "analyze from this time")
  .option("--to <seconds>", "analyze up to this time")
  .action(
    async (
      files: string[],
      cmdOpts: { bands?: string; from?: string; to?: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const args = ["bands", ...files];
      if (cmdOpts.bands) args.push("--bands", cmdOpts.bands);
      if (cmdOpts.from) args.push("--from", cmdOpts.from);
      if (cmdOpts.to) args.push("--to", cmdOpts.to);
      if (opts.json) args.push("--json");
      await runAnalysis(args);
    },
  );

mix
  .command("layers [tracks...]")
  .description(
    "Solo -> capture -> unsolo EACH track in sequence (restoring the exact prior " +
      "solo state after every step, even on failure), then compare narrowband " +
      "energy across the captures (`mix bands`). Needs the AWH Capture Tap (m4l/).",
  )
  .option("--bars <bars>", "capture span length in bars", "8")
  .option("--from-bar <bar>", "1-based arrangement bar to loop from", "1")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .option("--tap-port <port>", "capture tap OSC port", String(TAP_PORT))
  .option("--tail <seconds>", "extra record time after the loop", "0.5")
  .option(
    "--bands <ranges>",
    'comma-separated "lo-hi" Hz ranges for the comparison (default: `mix bands`\' own default)',
  )
  .option("--keep", "keep the per-track capture files (temp dir path is always printed)")
  .option(
    "--save [name]",
    "also save a layers/bands record to library/measurements/ (default name: from the " +
      "track list) — unlocks `awh mix advise --layers <name>`'s masking stage",
  )
  .action(
    async (
      tracks: string[],
      cmdOpts: {
        bars: string;
        fromBar: string;
        sig: string;
        tapPort: string;
        tail: string;
        bands?: string;
        keep?: boolean;
        save?: string | boolean;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();

      // Zero tracks is a STATE, not an error (docs/lessons-learned.md rule
      // 5) — nothing to solo/capture/compare, say so plainly, exit 0.
      if (tracks.length === 0) {
        output(opts, { ran: false, reason: "no tracks" }, () =>
          "no tracks given — nothing to solo/capture/compare " +
            "(awh mix layers track:0 track:1 ...)",
        );
        return;
      }

      const outDir = await mkdtemp(join(tmpdir(), "awh-mix-layers-"));
      const capture: LayerCaptureFn = async (_trackPath, outPath) =>
        captureSpan(opts, {
          fromBar: Number(cmdOpts.fromBar),
          bars: Number(cmdOpts.bars),
          beatsPerBar: Number(cmdOpts.sig),
          tapPort: Number(cmdOpts.tapPort),
          out: outPath,
          tailS: Number(cmdOpts.tail),
        });

      const caller: OpCaller = (name, args) => op(opts, name, args);

      let results;
      try {
        results = await runLayers(caller, tracks, outDir, capture, {
          onRetry: (trackPath, err) =>
            process.stderr.write(
              `mix layers: capture of ${trackPath} aborted (${(err as Error).message}) — ` +
                `retrying once; rapid back-to-back captures are a known intermittent flake, ` +
                `solo state is intact\n`,
            ),
        });
      } catch (err) {
        process.stderr.write(
          `mix layers: aborted (solo state has been restored) — ${(err as Error).message}\n` +
            `captures so far (if any) are in ${outDir}\n`,
        );
        throw err;
      }

      const bandsArgs = ["bands", ...results.map((r) => r.outPath)];
      if (cmdOpts.bands) bandsArgs.push("--bands", cmdOpts.bands);

      process.stderr.write(
        `captured ${results.length} layer(s) -> ${outDir}${cmdOpts.keep ? "" : " (will be deleted after comparing; pass --keep to retain)"}\n` +
          results
            .map(
              (r) =>
                `  ${r.trackPath.padEnd(10)} "${r.trackName}" -> ${r.outPath}${r.retried ? " (succeeded on retry)" : ""}`,
            )
            .join("\n") +
          "\n",
      );

      let compareResult: Record<string, unknown> | undefined;
      let savedRecordPath: string | undefined;
      if (cmdOpts.save !== undefined) {
        compareResult = (await runAnalysisJson([...bandsArgs, "--json"])) as unknown as Record<
          string,
          unknown
        >;
        const name =
          typeof cmdOpts.save === "string"
            ? cmdOpts.save
            : slugify(tracks.join("-")) || "layers";
        savedRecordPath = join(findLibraryRoot(), "measurements", `${name}.json`);
        // `file` here matches EXACTLY what was passed to `bands` (results[].outPath)
        // so `awh mix advise`'s masking rule can map compareResult's per-file band
        // levels back to track names.
        const record = {
          kind: "layers",
          schema: 1,
          saved: new Date().toISOString().slice(0, 10),
          tracks: results.map((r) => ({
            trackPath: r.trackPath,
            trackName: r.trackName,
            file: r.outPath,
          })),
          bands: compareResult,
        };
        await mkdir(dirname(savedRecordPath), { recursive: true });
        await writeFile(savedRecordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
        process.stderr.write(`record -> ${savedRecordPath}\n`);
      }

      if (opts.json) {
        if (!compareResult) {
          compareResult = (await runAnalysisJson([...bandsArgs, "--json"])) as unknown as Record<
            string,
            unknown
          >;
        }
        if (!cmdOpts.keep) await rm(outDir, { recursive: true, force: true });
        process.stdout.write(
          `${JSON.stringify(
            {
              results,
              outDir: cmdOpts.keep ? outDir : null,
              compare: compareResult,
              ...(savedRecordPath ? { savedRecord: savedRecordPath } : {}),
            },
            null,
            2,
          )}\n`,
        );
      } else {
        // Same bands table `awh mix bands` itself prints — no separate
        // rendering to keep in sync.
        await runAnalysis(bandsArgs);
        if (!cmdOpts.keep) await rm(outDir, { recursive: true, force: true });
      }
    },
  );

// ---------------------------------------------------------------------------
// M13: the mix advisor — a deterministic rule engine over the SAME
// measurement pipeline `mix report` uses (docs/design/mix-advisor.md). The
// rule table lives in analysis/awh_analysis/advise.py; this command only
// resolves CLI inputs to file paths, optionally enriches action text with
// real master-chain device names (--set, additive/offline-safe — see
// advise.ts), and renders the ranked plan.
// ---------------------------------------------------------------------------

interface AdviceItem {
  id: string;
  kind: "finding" | "placeholder" | "info";
  stage: string;
  rank: number;
  evidence: Record<string, unknown>;
  issue: string;
  action: string;
  verify: string;
  confidence: string;
  basis: string;
  magnitude: number;
  blockedBy: number[];
}
interface AdviceHealthy {
  message: string;
  marginal_metrics: { id: string; margin: number; unit: string; evidence: Record<string, unknown> }[];
}
interface AdviceCompareEntry {
  id: string;
  status: "resolved" | "improved" | "unchanged" | "new";
  old_magnitude?: number;
  new_magnitude?: number;
  old_evidence: unknown;
  new_evidence: unknown;
}
interface AdviseResult {
  preset: string;
  has_target: boolean;
  has_layers: boolean;
  items: AdviceItem[];
  healthy: AdviceHealthy | null;
  compare?: AdviceCompareEntry[];
}

function renderAdvisePretty(result: AdviseResult): string {
  const lines: string[] = [
    `preset: ${result.preset}   target: ${result.has_target ? "yes" : "no"}   ` +
      `layers: ${result.has_layers ? "yes" : "no"}`,
    "",
  ];
  if (result.healthy) {
    lines.push(`HEALTHY — ${result.healthy.message}`);
    for (const m of result.healthy.marginal_metrics) {
      lines.push(`  closest to tripping: ${m.id}  margin ${m.margin.toFixed(2)} ${m.unit}`);
    }
    lines.push("");
  }
  for (const it of result.items) {
    lines.push(
      it.kind === "finding"
        ? `#${it.rank} [${it.stage}] ${it.id}`
        : `#${it.rank} [${it.stage}] ${it.id} (${it.kind})`,
    );
    lines.push(`  ${it.issue}`);
    lines.push(`  -> ${it.action}`);
    if (it.verify !== "n/a") lines.push(`  verify:  ${it.verify}`);
    if (it.blockedBy.length > 0) lines.push(`  blockedBy: #${it.blockedBy.join(", #")}`);
    if (it.kind === "finding") lines.push(`  confidence: ${it.confidence}   basis: ${it.basis}`);
    lines.push("");
  }
  if (result.compare) {
    lines.push("compare vs. saved advice record:");
    for (const c of result.compare) {
      const extra =
        c.old_magnitude !== undefined && c.new_magnitude !== undefined
          ? `  (${c.old_magnitude.toFixed(2)} -> ${c.new_magnitude.toFixed(2)})`
          : "";
      lines.push(`  [${c.status.padEnd(9)}] ${c.id}${extra}`);
    }
  }
  return lines.join("\n");
}

mix
  .command("advise [captureFile]")
  .description(
    "Deterministic rule-based mix advice: a ranked, cited, verifiable plan across the " +
      "dependency ladder (integrity -> phase -> masking -> tonal -> dynamics -> loudness). " +
      "Zero actionable items is the healthy state, not an error.",
  )
  .option(
    "--record <nameOrPath>",
    "use a saved mix-report measurement record instead of measuring a capture file " +
      "(mutually exclusive with <captureFile>)",
  )
  .option("--target <nameOrPath>", "genre target — unlocks the tonal-balance stage")
  .option(
    "--layers <nameOrPath>",
    "a record saved by `mix layers --save` — unlocks the inter-element masking stage",
  )
  .option("--preset <preset>", "delivery preset: club | streaming | apple", "club")
  .option(
    "--set",
    "name real devices on the master chain in actions (reads via device.get when the " +
      "gateway is up; purely additive — works offline without it)",
  )
  .option("--save [name]", "also save an advice record to library/measurements/")
  .option("--compare <nameOrPath>", "diff this run against a previously-saved advice record")
  .action(
    async (
      captureFile: string | undefined,
      cmdOpts: {
        record?: string;
        target?: string;
        layers?: string;
        preset: string;
        set?: boolean;
        save?: string | boolean;
        compare?: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();

      if (Boolean(captureFile) === Boolean(cmdOpts.record)) {
        throw new Error(
          "awh mix advise requires exactly one of <captureFile> or --record <nameOrPath>",
        );
      }

      const libraryRoot = findLibraryRoot();
      const args = ["advise"];
      if (captureFile) args.push(captureFile);
      if (cmdOpts.record) {
        args.push("--record", resolveMeasurementRecordPath(cmdOpts.record, libraryRoot));
      }
      if (cmdOpts.target) args.push("--target", resolveTarget(cmdOpts.target));
      if (cmdOpts.layers) {
        args.push("--layers", resolveMeasurementRecordPath(cmdOpts.layers, libraryRoot));
      }
      args.push("--preset", cmdOpts.preset);
      if (cmdOpts.compare) {
        args.push("--compare", resolveMeasurementRecordPath(cmdOpts.compare, libraryRoot));
      }

      let savePath: string | undefined;
      if (cmdOpts.save !== undefined) {
        const base =
          typeof cmdOpts.save === "string"
            ? cmdOpts.save
            : slugify(
                cmdOpts.record ?? basename(captureFile ?? "advice").replace(/\.[^.]+$/, ""),
              ) || "advice";
        savePath = join(libraryRoot, "measurements", `${base}.json`);
        await mkdir(dirname(savePath), { recursive: true });
        args.push("--save-record", savePath);
      }

      const result = (await runAnalysisJson(args)) as unknown as AdviseResult;

      // --set is additive and offline-safe: any gateway failure (not up,
      // wrong port, etc.) just leaves masterDevices empty rather than
      // failing the whole plan. Enrichment is display-only — it never
      // touches the record --save already wrote (device indices on the
      // master chain aren't stable enough to bake into a saved plan).
      if (cmdOpts.set) {
        let masterDevices: MasterDevice[] = [];
        try {
          masterDevices = await readMasterChainDevices((name, a) => op(opts, name, a));
        } catch {
          // additive only — see comment above
        }
        result.items = enrichActionsWithDevices(result.items, masterDevices);
      }

      if (savePath) process.stderr.write(`record -> ${savePath}\n`);

      output(opts, result, () => renderAdvisePretty(result));
    },
  );

// ---------------------------------------------------------------------------
// Operator assistant (B2): recipe knowledge base + audio-sample sound
// matching. docs/design/operator-assistant.md. Engine lives in op.ts
// (validate-first apply flow) + analysis/awh_analysis/opmatch.py.
// ---------------------------------------------------------------------------

interface OpMatchF0 {
  hz: number | null;
  drift_semitones: number | null;
  voiced_fraction: number;
}
interface OpMatchAdsr {
  attack_s: number;
  decay_s: number;
  sustain_db: number;
  sustain_s: number;
  release_s: number;
  peak_db: number;
  floor_db: number;
  has_sustain: boolean;
  r_squared: number;
}
interface OpMatchCentroid {
  direction: "rising" | "falling" | "flat";
  start_hz: number | null;
  end_hz: number | null;
  slope_hz_per_s: number;
}
interface OpMatchAnalysis {
  file: string;
  duration_s: number;
  samplerate: number;
  f0: OpMatchF0;
  adsr: OpMatchAdsr;
  centroid: OpMatchCentroid;
  harmonic_vector: number[];
  harmonic_amplitudes: number[];
  harmonicity_ratio: number;
  partial_deviation_semitones: number | null;
  noise_floor_ratio: number;
}
interface OpMatchProposal {
  oscillator: { waveform: string; residual: number; note: string };
  envelope: { attack_s: number; decay_s: number; sustain_db: number; release_s: number; fit_r_squared: number };
  filter: { direction: string; note: string };
  drawThesePartials: number[];
  addressable: Record<string, number>;
  addressable_caveat: string;
}
interface OpMatchResult {
  analysis: OpMatchAnalysis;
  tier: 1 | 2 | 3;
  reasons: string[];
  proposal: OpMatchProposal | null;
  summary: string;
}
interface OpCompareResult {
  log_spectrogram_l2: number;
  harmonic_cosine: number | null;
  score: number;
}

/** Resolve an `op apply`/`op match --apply` recipe-name argument to its
 *  `operator-recipe-<name>` knowledge entry, same slug-prefix convention as
 *  resolvePhraseSpec's `phrase-style-<name>`. */
async function loadOperatorRecipeEntry(name: string) {
  const slug = name.startsWith(RECIPE_SLUG_PREFIX) ? name : `${RECIPE_SLUG_PREFIX}${name}`;
  try {
    return await knowledgeStore().loadEntry(slug);
  } catch {
    throw new Error(
      `unknown operator recipe "${name}" — run \`awh op recipes\` to list them (slug "${slug}" not found)`,
    );
  }
}

/** A device path's owning track path (its root segment). */
function deviceTrackPath(devicePath: string): string {
  const segments = parsePath(devicePath);
  const root = segments[0];
  if (!root) throw new Error(`bad device path: ${devicePath}`);
  return formatPath([root]);
}

function renderRecipeWriteLines(results: { param: string; target: number; actual: number; matched: boolean }[]): string[] {
  return results.map(
    (r) => `  ${r.param}: -> ${r.target}${r.matched ? "" : `  ** actual ${r.actual} (MISMATCH)`}`,
  );
}

function renderOpMatchText(result: OpMatchResult): string {
  const a = result.analysis;
  const lines = [
    `tier ${result.tier}: ${result.summary}`,
    "",
    `f0: ${a.f0.hz !== null ? `${a.f0.hz.toFixed(1)} Hz` : "n/a"}  ` +
      `harmonicity ${a.harmonicity_ratio.toFixed(2)}  ` +
      `partial deviation ${a.partial_deviation_semitones !== null ? `${a.partial_deviation_semitones.toFixed(2)} semitones` : "n/a"}  ` +
      `noise floor ratio ${a.noise_floor_ratio.toFixed(2)}`,
  ];
  if (result.tier === 3) {
    lines.push("", "reasons:", ...result.reasons.map((r) => `  - ${r}`));
    return lines.join("\n");
  }
  const p = result.proposal!;
  lines.push(
    "",
    `oscillator: ${p.oscillator.waveform} (residual ${p.oscillator.residual.toFixed(2)})`,
    `envelope target: attack ${(p.envelope.attack_s * 1000).toFixed(0)}ms  ` +
      `decay ${(p.envelope.decay_s * 1000).toFixed(0)}ms  sustain ${p.envelope.sustain_db.toFixed(1)}dB  ` +
      `release ${(p.envelope.release_s * 1000).toFixed(0)}ms  (fit r^2=${p.envelope.fit_r_squared.toFixed(2)})`,
    `filter: ${p.filter.direction}`,
    "",
    "drawThesePartials (16 normalized amplitudes — hand-draw in Operator's " +
      "harmonics editor if the stock-wave residual above is high):",
    "  " + p.drawThesePartials.map((v) => v.toFixed(2)).join(", "),
    "",
    `addressable (raw device.param values, HEURISTIC): ` +
      (Object.keys(p.addressable).length === 0
        ? "(none — advisory only)"
        : Object.entries(p.addressable).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(", ")),
    p.addressable_caveat,
  );
  return lines.join("\n");
}

const opGroup = program
  .command("op")
  .description("Operator assistant (B2): recipes + audio-sample sound matching");

opGroup
  .command("recipes")
  .description("List operator-recipe-* knowledge entries")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const entries = await knowledgeStore().listEntries();
    const recipes = summarizeRecipeEntries(entries);
    output(opts, recipes, () =>
      recipes.length === 0
        ? "no operator recipes yet — knowledge/sound-design/operator-recipe-*.md " +
          "(see docs/design/operator-assistant.md)"
        : recipes
            .map(
              (r) =>
                `${r.slug.padEnd(30)} [${r.tier}] ${String(r.paramCount).padStart(3)} params` +
                `${r.hasPlayNotes ? "  (playNotes)" : ""}  ${r.title}`,
            )
            .join("\n"),
    );
  });

opGroup
  .command("apply <recipe> <devicePath>")
  .description(
    "Apply a recipe's params to a live device: validates every param NAME " +
      "against device.get FIRST (fails loudly, writes nothing, on any unknown " +
      "name), then writes and reads back every param to report mismatches.",
  )
  .option("--dry-run", "print the planned moves without writing anything")
  .option("--audition", "write the recipe's playNotes to an empty session slot on the device's track")
  .option("--sig <beatsPerBar>", "beats per bar for --audition notation", "4")
  .action(
    async (
      recipeName: string,
      devicePath: string,
      cmdOpts: { dryRun?: boolean; audition?: boolean; sig: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const entry = await loadOperatorRecipeEntry(recipeName);
      const recipe = loadRecipeFromEntry(entry);
      const detail = (await op(opts, "device.get", { path: devicePath })) as DeviceDetail;
      const plan: RecipePlan = planRecipeApply(detail, recipe, devicePath);

      if (plan.unknownParams.length > 0) {
        throw new Error(
          `recipe "${recipe.name}" [${entry.tier}] references params not on ${devicePath} ` +
            `(${detail.name}): ${plan.unknownParams.join(", ")}\n` +
            `known params: ${plan.knownParamNames.join(", ")}`,
        );
      }

      if (cmdOpts.dryRun) {
        output(opts, { plan }, () =>
          [
            `${recipe.name} [${entry.tier}] -> ${devicePath} (${detail.name}) — DRY RUN, nothing written`,
            ...plan.moves.map((m) => `  ${m.param}: ${m.from} -> ${m.to}`),
          ].join("\n"),
        );
        return;
      }

      const caller: OpCaller = (name, args) => op(opts, name, args);
      const results = await applyRecipePlan(caller, plan);
      const mismatches = results.filter((r) => !r.matched);

      let auditionLine = "";
      if (cmdOpts.audition) {
        if (!recipe.playNotes) {
          auditionLine = "\n--audition: recipe has no playNotes to write";
        } else {
          const beatsPerBar = Number(cmdOpts.sig);
          const parsed = parseNotation(recipe.playNotes, { beatsPerBar });
          const trackPath = deviceTrackPath(devicePath);
          const summary = (await op(opts, "set.summary")) as SetSummary;
          const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === trackPath);
          if (!track) {
            auditionLine = `\n--audition: track not found: ${trackPath}`;
          } else {
            const occupied = new Set(
              track.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])),
            );
            const free = Array.from({ length: track.slotCount }, (_, i) => i).find((i) => !occupied.has(i));
            if (free === undefined) {
              auditionLine = `\n--audition: no empty session slot on ${trackPath} — pick one manually`;
            } else {
              const slotPath = `${trackPath}/slot:${free}`;
              await op(opts, "clip.create-midi", {
                target: { type: "session", slotPath },
                lengthBeats: parsed.suggestedLengthBeats,
                notes: parsed.notes,
                name: `${recipe.name} audition`,
              });
              auditionLine = `\naudition clip -> ${slotPath} (press play in Live to hear it)`;
            }
          }
        }
      }

      output(opts, { plan, results, mismatches }, () =>
        [
          `${recipe.name} [${entry.tier}] -> ${devicePath} (${detail.name})`,
          ...renderRecipeWriteLines(results),
          mismatches.length === 0
            ? "all params verified by read-back"
            : `${mismatches.length} param(s) did not verify — read-back value differs from what was written`,
        ].join("\n") + auditionLine,
      );
    },
  );

opGroup
  .command("match <sample>")
  .description(
    "Analyze an audio sample and propose an Operator patch, tiered by " +
      "reachability (tier 3 = outside Operator's reachable set — a normal " +
      "result, not an error).",
  )
  .option("--apply <devicePath>", "push the addressable subset of the proposal to a live device")
  .action(async (sample: string, cmdOpts: { apply?: string }) => {
    const opts = program.opts<GlobalOpts>();
    const result = (await runAnalysisJson(["opmatch", sample])) as unknown as OpMatchResult;

    if (!cmdOpts.apply) {
      output(opts, result, () => renderOpMatchText(result));
      return;
    }

    if (result.tier === 3) {
      output(opts, result, () => `${renderOpMatchText(result)}\n\n--apply: tier-3 refusal — nothing to apply.`);
      return;
    }

    const proposal = result.proposal!;
    if (Object.keys(proposal.addressable).length === 0) {
      output(opts, result, () =>
        `${renderOpMatchText(result)}\n\n--apply: nothing addressable in this proposal (advisory only) — nothing written.`,
      );
      return;
    }

    const devicePath = cmdOpts.apply;
    const detail = (await op(opts, "device.get", { path: devicePath })) as DeviceDetail;
    const syntheticRecipe: OperatorRecipe = {
      name: `${basename(sample)} match`,
      device: detail.name,
      params: proposal.addressable,
    };
    const plan: RecipePlan = planRecipeApply(detail, syntheticRecipe, devicePath);
    if (plan.unknownParams.length > 0) {
      throw new Error(
        `proposal references params not on ${devicePath} (${detail.name}): ${plan.unknownParams.join(", ")}\n` +
          `known params: ${plan.knownParamNames.join(", ")}`,
      );
    }
    const caller: OpCaller = (name, args) => op(opts, name, args);
    const results = await applyRecipePlan(caller, plan);
    const mismatches = results.filter((r) => !r.matched);

    output(opts, { ...result, applied: { devicePath, results, mismatches } }, () =>
      [
        renderOpMatchText(result),
        "",
        `applied addressable subset -> ${devicePath} (${detail.name}):`,
        ...renderRecipeWriteLines(results),
        "",
        "drawThesePartials (always yours to hand-draw, even applied):",
        "  " + proposal.drawThesePartials.map((v) => v.toFixed(2)).join(", "),
      ].join("\n"),
    );
  });

opGroup
  .command("verify <ref> <devicePath>")
  .description(
    "Closed-loop verification: writes an audition note (at the reference's " +
      "own detected pitch) onto the device's track, captures it via the M4L " +
      "tap, and reports a spectral-distance score against the reference. " +
      "Requires the AWH Capture Tap device (m4l/README.md) — NOT auto-iterated: " +
      "report, owner tweaks, re-verify.",
  )
  .option("--from-bar <bar>", "arrangement position to write/play the audition note", "1")
  .option("--bars <bars>", "capture span length in bars (default: enough to cover the reference)")
  .option("--sig <beatsPerBar>", "beats per bar", "4")
  .option("--tap-port <port>", "capture tap OSC port", String(TAP_PORT))
  .option("--out <file>", "capture destination (default: a scratch file under .dev/)")
  .action(
    async (
      ref: string,
      devicePath: string,
      cmdOpts: { fromBar: string; bars?: string; sig: string; tapPort: string; out?: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const detail = (await op(opts, "device.get", { path: devicePath })) as DeviceDetail;

      const refAnalysis = (await runAnalysisJson(["opmatch", ref])) as unknown as OpMatchResult;
      const hz = refAnalysis.analysis.f0.hz;
      if (hz === null) {
        throw new Error(
          `${ref} has no stable pitch to audition — op verify needs a tonal reference ` +
            `(run \`awh op match ${ref}\` for the full analysis)`,
        );
      }
      const midiPitch = Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(hz / 440))));

      const summary = (await op(opts, "set.summary")) as SetSummary;
      const beatsPerBar = Number(cmdOpts.sig);
      const trackPath = deviceTrackPath(devicePath);
      const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === trackPath);
      if (!track) throw new Error(`track not found: ${trackPath}`);

      const fromBar = Number(cmdOpts.fromBar);
      const startBeat = (fromBar - 1) * beatsPerBar;
      const noteLengthBeats = Math.max(
        beatsPerBar,
        clipLengthBeats(secondsToBeats(refAnalysis.analysis.duration_s, summary.tempo), beatsPerBar),
      );
      const bars = cmdOpts.bars ? Math.ceil(Number(cmdOpts.bars)) : noteLengthBeats / beatsPerBar;
      const endBeat = startBeat + bars * beatsPerBar;

      const overlap = track.arrangementClips.find(
        (c) => startBeat < (c.endTime ?? 0) && endBeat > (c.startTime ?? 0),
      );
      const notes: NoteSpec[] = [{ pitch: midiPitch, start: 0, duration: noteLengthBeats, velocity: 100 }];
      if (overlap) {
        if (overlap.kind !== "midi") {
          throw new Error(`${overlap.path} at bar ${fromBar} is an audio clip — pick a different --from-bar`);
        }
        const clamped = clampNotesToLength(notes, overlap.duration);
        await op(opts, "clip.notes", { path: overlap.path, notes: clamped });
        await op(opts, "clip.update", { path: overlap.path, name: "op verify audition" });
      } else {
        await op(opts, "clip.create-midi", {
          target: { type: "arrangement", trackPath, startBeat },
          lengthBeats: noteLengthBeats,
          notes,
          name: "op verify audition",
        });
      }

      const out =
        cmdOpts.out ??
        join(repoRoot(), ".dev", "op-verify", `${slugify(basename(ref).replace(/\.[^.]+$/, "") || "capture")}.wav`);
      await mkdir(dirname(out), { recursive: true });

      let captured: number;
      try {
        captured = await captureSpan(opts, {
          fromBar,
          bars,
          beatsPerBar,
          tapPort: Number(cmdOpts.tapPort),
          out,
          tailS: 0.3,
        });
      } catch (err) {
        throw new Error(
          `op verify requires the AWH Capture Tap M4L device (m4l/README.md) — ${(err as Error).message}`,
        );
      }

      const compareResult = (await runAnalysisJson(["opcompare", ref, out])) as unknown as OpCompareResult;
      output(
        opts,
        { devicePath, deviceName: detail.name, capture: out, seconds: captured, compare: compareResult },
        () =>
          [
            `${detail.name} @ ${devicePath} vs ${ref}`,
            `audition note: pitch ${midiPitch} (from ${ref}'s detected f0 ${hz.toFixed(1)} Hz)`,
            `captured -> ${out} (${captured.toFixed(1)}s)`,
            `log-spectrogram L2: ${compareResult.log_spectrogram_l2.toFixed(3)}`,
            `harmonic cosine: ${compareResult.harmonic_cosine !== null ? compareResult.harmonic_cosine.toFixed(3) : "n/a"}`,
            `score: ${compareResult.score.toFixed(3)} (1.0 = identical — ears decide the rest)`,
          ].join("\n"),
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
// Arp & rhythm engine (M14): our own MIDI arp generation, so vary/library/
// phrases/seeds/notation can all touch the output — the stock Arpeggiator
// stays the JAMMING tool, `awh arp` is the COMMITTING tool. See
// docs/design/arp-engine.md.
// ---------------------------------------------------------------------------

const ARP_BUILTIN_SPECS: Record<string, ArpSpec> = {
  "basic-up": BASIC_UP_SPEC,
  "melodic-techno-16ths": MELODIC_TECHNO_16THS_SPEC,
};

/** Resolve --style: built-in first, else an `arp-style-<name>` knowledge
 *  entry's ```awh-arp-spec``` block — same convention as `drums gen` /
 *  `drop phrase`. */
async function resolveArpSpec(style: string): Promise<{ spec: ArpSpec; styleTier?: string }> {
  const builtin = ARP_BUILTIN_SPECS[style];
  if (builtin) return { spec: builtin };
  let entry;
  try {
    entry = await knowledgeStore().loadEntry(`arp-style-${style}`);
  } catch {
    throw new Error(
      `unknown arp style "${style}" — built-ins: ${listArpStyles().join(", ")}; ` +
        `data styles need a knowledge entry with slug arp-style-${style} (see knowledge/README.md)`,
    );
  }
  const specText = extractFencedBlock(entry.body, "awh-arp-spec");
  if (!specText) {
    throw new Error(`knowledge entry ${entry.relPath} has no \`\`\`awh-arp-spec block`);
  }
  return { spec: parseArpSpec(specText), styleTier: entry.tier };
}

program
  .command("arp <clipOrTarget> [maybeTarget]")
  .description(
    "Arpeggiate a chord clip, or a --prog progression, into a target clip. " +
      "Chord clip source: <clipOrTarget> <maybeTarget>. --prog source: " +
      '<clipOrTarget> alone IS the target, e.g. `awh arp --prog "i-VI-III-VII" track:1/slot:0`.',
  )
  .option("--style <style>", `built-in (${listArpStyles().join(", ")}) or a knowledge arp-style-<name>`, "basic-up")
  .option("--seed <seed>", "random seed (same seed = same pattern)", "1")
  .option("--variant <variant>", "force the euclid mask's rotation (listable: rotate-0, rotate-1, ...) or its index")
  .option("--rate <rate>", "override the spec's step rate, e.g. 1/16, 1/8t, 1/4d")
  .option("--gate <gate>", "override the spec's gate (0.05-1.0)")
  .option("--bars <bars>", "total bars to generate (default: the chord source's own length)")
  .option("--prog <progression>", 'roman-numeral progression, e.g. "i-VI-III-VII" (alternative chord source to a clip)')
  .option("--key <key>", 'e.g. "A minor" (default: the Set scale) — only used with --prog')
  .option("--voicing <style>", "close | spread — only used with --prog", "close")
  .option("--center <midi>", "voicing register center — only used with --prog", "60")
  .option("--name <name>", "clip name (default: <style>-arp)")
  .option("--at-bar <bar>", "arrangement position for track targets")
  .option("--dry-run", "print the notation preview without touching Live")
  .action(
    async (
      clipOrTarget: string,
      maybeTarget: string | undefined,
      cmdOpts: {
        style: string;
        seed: string;
        variant?: string;
        rate?: string;
        gate?: string;
        bars?: string;
        prog?: string;
        key?: string;
        voicing: "close" | "spread";
        center: string;
        name?: string;
        atBar?: string;
        dryRun?: boolean;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();

      let target: string;
      let chordClipPath: string | undefined;
      if (cmdOpts.prog !== undefined) {
        if (maybeTarget !== undefined) {
          throw new Error(
            "--prog takes a single <target> argument — pass either a chord clip + target, or --prog + target alone",
          );
        }
        target = clipOrTarget;
      } else {
        if (maybeTarget === undefined) {
          throw new Error("a target is required: `awh arp <chordClip> <target>` (or use --prog for a target-only call)");
        }
        chordClipPath = clipOrTarget;
        target = maybeTarget;
      }

      const { spec: resolvedSpec, styleTier } = await resolveArpSpec(cmdOpts.style);
      if (cmdOpts.rate !== undefined) arpRateBeats(cmdOpts.rate); // validate, throws on a bad format
      const spec: ArpSpec = {
        ...resolvedSpec,
        ...(cmdOpts.rate !== undefined ? { rate: cmdOpts.rate } : {}),
        ...(cmdOpts.gate !== undefined ? { gate: checkArpGate(Number(cmdOpts.gate)) } : {}),
      };

      let variant: number | undefined;
      if (cmdOpts.variant !== undefined) {
        const names = listArpVariants(spec);
        variant = /^\d+$/.test(cmdOpts.variant) ? Number(cmdOpts.variant) : names.indexOf(cmdOpts.variant);
        if (variant < 0 || variant >= names.length) {
          throw new Error(`unknown variant "${cmdOpts.variant}" (available: ${names.join(", ")})`);
        }
      }

      let chords: ArpChordSpan[];
      let bars: number;
      let sourceLine: string;

      if (chordClipPath !== undefined) {
        const detail = (await op(opts, "clip.get", { path: chordClipPath })) as ClipDetail;
        if (detail.kind !== "midi" || !detail.notes) {
          throw new Error(`${chordClipPath} is not a MIDI clip`);
        }
        const result = chordsFromNotes(detail.notes);
        // NEGATIVE CONTROL: a melody (no simultaneities) is a state, not
        // garbage 1-note-chord output (docs/lessons-learned.md #5).
        if (result.kind === "melody") {
          output(opts, { chordClipPath, created: false }, () =>
            `${chordClipPath} has no chords (no simultaneous notes) — this looks like a melody, ` +
              "not something to arpeggiate. Write or transcribe a chord clip first (e.g. `awh chords`).",
          );
          return;
        }
        chords = result.chords;
        bars = cmdOpts.bars !== undefined ? Number(cmdOpts.bars) : Math.max(1, Math.round(detail.duration / ARP_BEATS_PER_BAR));
        sourceLine = `chord clip ${chordClipPath} (${result.chords.length} chords)`;
      } else {
        const summary = (await op(opts, "set.summary")) as SetSummary;
        const keyCtx = resolveKey(summary, cmdOpts.key);
        const parsedChords = parseProgression(cmdOpts.prog!, keyCtx);
        const voiced = voiceProgression(parsedChords, {
          style: cmdOpts.voicing,
          center: Number(cmdOpts.center),
        });
        bars = cmdOpts.bars !== undefined ? Number(cmdOpts.bars) : voiced.length; // one bar per chord default
        const segmentLen = (bars * ARP_BEATS_PER_BAR) / voiced.length;
        chords = voiced.map((v, i) => ({
          pitches: [...v.pitches].sort((a, b) => a - b),
          startBeat: i * segmentLen,
          endBeat: (i + 1) * segmentLen,
        }));
        sourceLine = `--prog "${cmdOpts.prog}" (${keyCtx.label}, ${cmdOpts.voicing})`;
      }

      const { notes, meta } = generateArp(chords, spec, {
        seed: Number(cmdOpts.seed),
        bars,
        ...(variant !== undefined ? { variant } : {}),
      });
      const lengthBeats = bars * ARP_BEATS_PER_BAR;
      const specLine =
        `style ${cmdOpts.style}${styleTier ? ` [${styleTier}]` : ""} — contour ${meta.contour}, ` +
        `patternLength ${meta.patternLength}, rotate ${meta.rotate}, seed ${meta.seed}`;

      const isSlot = /\/slot:\d+$/.test(target);
      if (!isSlot && cmdOpts.atBar === undefined) {
        throw new Error("track targets need --at-bar (or pass a slot path)");
      }

      if (cmdOpts.dryRun) {
        output(opts, { notes, lengthBeats, meta }, () =>
          [
            `dry run: ${sourceLine} -> ${target} (${bars} bars, ${notes.length} notes; ${specLine}):`,
            serializeNotation(notes, { beatsPerBar: ARP_BEATS_PER_BAR }),
          ].join("\n"),
        );
        return;
      }

      const targetSpec = isSlot
        ? { type: "session", slotPath: target }
        : {
            type: "arrangement",
            trackPath: target,
            startBeat: (Number(cmdOpts.atBar) - 1) * ARP_BEATS_PER_BAR,
          };
      const result = (await op(opts, "clip.create-midi", {
        target: targetSpec,
        lengthBeats,
        notes,
        name: cmdOpts.name ?? `${cmdOpts.style}-arp`,
      })) as { path: string };

      output(opts, { path: result.path, notes: notes.length, meta }, () =>
        [
          `${sourceLine} -> ${result.path} (${bars} bars, ${notes.length} notes)`,
          specLine,
          "this is a generated pattern — audition it, then shape/vary from there.",
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

const endless = program
  .command("endless")
  .description(
    "Endless player (M10): seeded, ever-different arrangements built from YOUR own " +
      "produced/mixed stems — see docs/design/endless-player.md",
  );

endless
  .command("plan")
  .description(
    "Emit a fully-commented endless.yaml starter scaffold — from --sections \"id:bars,...\" " +
      "or --from-ref <name> (reuses a saved reference's corrected section map, M8)",
  )
  .option("--sections <spec>", 'section list, e.g. "intro:8,build:8,drop:16,break:8"')
  .option(
    "--from-ref <file>",
    "a saved library/references/<name>.json, or a `ref sections read -o <file>` JSON — " +
      "mutually exclusive with --sections",
  )
  .option("--name <name>", 'song name for the spec (default: derived, or "my-song")')
  .option("--bpm <bpm>", "tempo — required with --sections; taken from the reference with --from-ref")
  .option("-o, --out <file>", "output path", "endless.yaml")
  .option("--force", "overwrite an existing file")
  .action(
    async (cmdOpts: {
      sections?: string;
      fromRef?: string;
      name?: string;
      bpm?: string;
      out: string;
      force?: boolean;
    }) => {
      const opts = program.opts<GlobalOpts>();
      if (!cmdOpts.sections === !cmdOpts.fromRef) {
        throw new Error('pass exactly one of --sections "id:bars,..." or --from-ref <file>');
      }
      if (existsSync(cmdOpts.out) && !cmdOpts.force) {
        throw new Error(`${cmdOpts.out} already exists — refusing to overwrite (pass --force)`);
      }

      let sections: { id: string; bars: number }[];
      let bpm: number;
      let name: string;
      if (cmdOpts.sections) {
        sections = parseSectionsArg(cmdOpts.sections);
        if (!cmdOpts.bpm) throw new Error("--bpm is required with --sections");
        bpm = Number(cmdOpts.bpm);
        if (!Number.isFinite(bpm) || bpm <= 0) throw new Error(`--bpm must be a positive number`);
        name = cmdOpts.name ?? "my-song";
      } else {
        const requested = cmdOpts.fromRef!;
        let refFile = requested;
        if (!existsSync(refFile)) {
          const candidate = join(findLibraryRoot(), "references", `${requested}.json`);
          if (!existsSync(candidate)) {
            throw new Error(`--from-ref: no file at "${requested}" or "${candidate}"`);
          }
          refFile = candidate;
        }
        const parsed = JSON.parse(await readFile(refFile, "utf8")) as {
          sections?: RefSectionLike[];
          bpm?: number;
          reference?: { sections: RefSectionLike[]; bpm: number };
        };
        const refSections = parsed.reference?.sections ?? parsed.sections;
        const refBpm = parsed.reference?.bpm ?? parsed.bpm;
        if (!refSections) throw new Error(`${refFile} has no sections`);
        sections = sectionsFromReference(refSections);
        if (cmdOpts.bpm) {
          bpm = Number(cmdOpts.bpm);
          if (!Number.isFinite(bpm) || bpm <= 0) throw new Error(`--bpm must be a positive number`);
        } else if (refBpm) {
          bpm = Math.round(refBpm * 100) / 100;
        } else {
          throw new Error(`${refFile} has no bpm — pass --bpm to set one`);
        }
        name = cmdOpts.name ?? basename(refFile).replace(/\.json$/, "");
      }

      const yamlText = buildEndlessPlanYaml({ name, bpm, sections });
      await writeFile(cmdOpts.out, yamlText, "utf8");
      output(opts, { path: cmdOpts.out, name, bpm, sections: sections.length }, () =>
        [
          `wrote ${cmdOpts.out} (${sections.length} section(s), ${bpm} BPM) — fill in the pools, then:`,
          `  awh endless build ${cmdOpts.out} -o dist/${name}`,
        ].join("\n"),
      );
    },
  );

endless
  .command("build <spec>")
  .description(
    "Validate an endless.yaml LOUDLY — every file, duration, reachability, empty-pool " +
      "problem at once, before writing anything — then emit the player",
  )
  .requiredOption("-o, --out <dir>", "output directory")
  .option("--single-file", "inline player.js + every audio file as data: URIs into one index.html")
  .action(async (specPath: string, cmdOpts: { out: string; singleFile?: boolean }) => {
    const opts = program.opts<GlobalOpts>();
    const result = await buildEndlessPlayer(specPath, cmdOpts.out, { singleFile: cmdOpts.singleFile });
    const sizeNote =
      result.singleFileBytes !== undefined
        ? ` (${(result.singleFileBytes / (1024 * 1024)).toFixed(1)} MB${
            result.singleFileBytes > SINGLE_FILE_WARN_BYTES ? ", over the 12 MB single-file guideline" : ""
          })`
        : "";
    output(opts, result, () =>
      [
        `built -> ${result.outDir}${sizeNote}`,
        cmdOpts.singleFile
          ? `open ${join(result.outDir, "index.html")} directly — no server needed`
          : `serve it (fetch() is blocked on file://): cd ${result.outDir} && python3 -m http.server 8000`,
      ].join("\n"),
    );
  });

endless
  .command("demo")
  .description("Generate a tiny synthetic 3-layer song (kick/hat + bass + pads) + spec, and build it")
  .requiredOption("-o, --out <dir>", "output directory")
  .action(async (cmdOpts: { out: string }) => {
    const opts = program.opts<GlobalOpts>();
    const result = await buildEndlessDemo(cmdOpts.out);
    output(opts, result, () =>
      [
        `demo built -> ${result.outDir} (spec: ${result.specPath})`,
        `serve it: cd ${result.outDir} && python3 -m http.server 8000`,
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
