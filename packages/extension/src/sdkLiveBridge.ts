import {
  AudioClip,
  AudioTrack,
  Chain,
  DrumRack,
  MidiClip,
  MidiTrack,
  RackDevice,
  Simpler,
  type Clip,
  type Device,
  type DeviceParameter,
  type ExtensionContext,
  type NoteDescription,
  type Song,
  type Track,
} from "@ableton-extensions/sdk";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BridgeError,
  parsePath,
  type BridgeInfo,
  type ClipDetail,
  type ClipSummary,
  type CreateAudioClipArgs,
  type CreateMidiClipArgs,
  type DeviceDetail,
  type DeviceSummary,
  type LiveBridge,
  type MixerArgs,
  type NoteSpec,
  type OutboxEntry,
  type PathSegment,
  type SetSummary,
  type TrackSummary,
  type UpdateClipArgs,
  type UpdateTrackArgs,
} from "@awh/core";

const LIVE_API_VERSION = "1.0.0";

/**
 * LiveBridge adapter over the Ableton Extensions SDK. This file and main.ts
 * are the only places the SDK may be touched (ADR-001).
 *
 * Design rules (see docs/dev-loop.md guardrails):
 * - Paths are re-resolved from `application.song` on every call. Never cache
 *   SDK objects or handles across operations (they invalidate on move/delete).
 * - Each op wraps its mutations in one `withinTransaction`; async creates are
 *   grouped by returning the promise from the transaction callback. Ops that
 *   create-then-configure necessarily land as two undo steps.
 * - Times are beats; note conversion NoteSpec <-> NoteDescription is 1:1 with
 *   field renames (start <-> startTime).
 */
export class SdkLiveBridge implements LiveBridge {
  constructor(private readonly ctx: ExtensionContext) {}

  private get song(): Song {
    return this.ctx.application.song;
  }

  describe(): Promise<BridgeInfo> {
    return Promise.resolve({
      kind: "sdk",
      name: "AWH Gateway (Ableton Extensions SDK)",
      liveApiVersion: LIVE_API_VERSION,
    });
  }

  // -- path resolution ------------------------------------------------------

  private trackAt(segments: PathSegment[], path: string): Track {
    const root = segments[0];
    if (!root) throw new BridgeError("bad_request", "empty path");
    if (root.kind === "main") return this.song.mainTrack;
    if (root.kind === "track" || root.kind === "return") {
      const list = root.kind === "track" ? this.song.tracks : this.song.returnTracks;
      const track = list[root.index];
      if (!track) throw new BridgeError("not_found", `no ${root.kind} ${root.index} (${path})`);
      return track;
    }
    throw new BridgeError("bad_request", `expected a track path: ${path}`);
  }

  private clipAt(path: string): { clip: Clip; track: Track; sub: PathSegment } {
    const segments = parsePath(path);
    const track = this.trackAt(segments, path);
    const sub = segments[1];
    if (sub?.kind === "slot") {
      const slot = track.clipSlots[sub.index];
      if (!slot) throw new BridgeError("not_found", `no slot ${sub.index} (${path})`);
      if (!slot.clip) throw new BridgeError("not_found", `slot is empty (${path})`);
      return { clip: slot.clip, track, sub };
    }
    if (sub?.kind === "arr") {
      const clip = track.arrangementClips[sub.index];
      if (!clip) throw new BridgeError("not_found", `no arrangement clip ${sub.index} (${path})`);
      return { clip, track, sub };
    }
    throw new BridgeError("bad_request", `expected a clip path (slot/arr): ${path}`);
  }

  private deviceAt(path: string): { device: Device; owner: Track | Chain } {
    const segments = parsePath(path);
    const track = this.trackAt(segments, path);
    let owner: Track | Chain = track;
    let devices: Device[] = track.devices;
    let device: Device | undefined;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!;
      if (seg.kind === "dev") {
        device = devices[seg.index];
        if (!device) throw new BridgeError("not_found", `no device at ${path}`);
      } else if (seg.kind === "chain") {
        if (!(device instanceof RackDevice)) {
          throw new BridgeError("bad_request", `not a rack: ${path}`);
        }
        const chain = device.chains[seg.index];
        if (!chain) throw new BridgeError("not_found", `no chain at ${path}`);
        owner = chain;
        devices = chain.devices;
        device = undefined;
      } else {
        throw new BridgeError("bad_request", `unexpected segment in device path: ${path}`);
      }
    }
    if (!device) throw new BridgeError("bad_request", `expected a device path: ${path}`);
    return { device, owner };
  }

  // -- summaries ------------------------------------------------------------

  private clipSummary(clip: Clip, path: string, arrangement: boolean): ClipSummary {
    const isMidi = clip instanceof MidiClip;
    // clip.duration is unreliable for session-slot clips (observed negative
    // and unstable across calls on a clip that was never placed in the
    // arrangement; likely arrangement-relative under the hood). Session
    // clips use endMarker - startMarker instead, matching the documented
    // "Session clips: loop length" contract; arrangement clips keep
    // clip.duration (verified stable/correct against real placements).
    const duration = arrangement ? clip.duration : clip.endMarker - clip.startMarker;
    return {
      path,
      kind: isMidi ? "midi" : "audio",
      name: clip.name,
      ...(arrangement ? { startTime: clip.startTime, endTime: clip.endTime } : {}),
      duration,
      looping: clip.looping,
      muted: clip.muted,
      ...(isMidi ? { noteCount: clip.notes.length } : {}),
    };
  }

  private deviceSummary(device: Device, path: string): DeviceSummary {
    const kind = this.deviceKind(device);
    const summary: DeviceSummary = {
      path,
      name: device.name,
      kind,
      paramCount: device.parameters.length,
    };
    if (device instanceof DrumRack) {
      // DrumChain has no name accessor in the real SDK, only receivingNote.
      // Best-effort name from the pad's first device (Live typically names
      // the chain after its sampler/instrument).
      summary.drumPads = device.chains.map((chain, i) => ({
        chainPath: `${path}/chain:${i}`,
        note: chain.receivingNote,
        name: chain.devices[0]?.name,
      }));
    }
    return summary;
  }

  private deviceKind(device: Device): DeviceSummary["kind"] {
    if (device instanceof DrumRack) return "drumRack";
    if (device instanceof RackDevice) return "rack";
    if (device instanceof Simpler) return "simpler";
    return "device";
  }

  private trackSummary(track: Track, path: string): TrackSummary {
    const kind =
      path === "main"
        ? "main"
        : path.startsWith("return")
          ? "return"
          : track instanceof MidiTrack
            ? "midi"
            : "audio";
    return {
      path,
      kind,
      name: track.name,
      muted: track.mute,
      soloed: track.solo,
      armed: track.arm,
      slotCount: track.clipSlots.length,
      sessionClips: track.clipSlots
        .map((slot, i) =>
          slot.clip ? this.clipSummary(slot.clip, `${path}/slot:${i}`, false) : null,
        )
        .filter((c): c is ClipSummary => c !== null),
      arrangementClips: track.arrangementClips.map((clip, i) =>
        this.clipSummary(clip, `${path}/arr:${i}`, true),
      ),
      devices: track.devices.map((d, i) => this.deviceSummary(d, `${path}/dev:${i}`)),
    };
  }

  // -- reads ----------------------------------------------------------------

  getSetSummary(): Promise<SetSummary> {
    const song = this.song;
    return Promise.resolve({
      tempo: song.tempo,
      scale: {
        rootNote: song.rootNote,
        name: song.scaleName,
        active: song.scaleMode,
        intervals: song.scaleIntervals,
      },
      trackCount: song.tracks.length,
      sceneCount: song.scenes.length,
      tracks: song.tracks.map((t, i) => this.trackSummary(t, `track:${i}`)),
      returnTracks: song.returnTracks.map((t, i) => this.trackSummary(t, `return:${i}`)),
      scenes: song.scenes.map((s, i) => ({ path: `scene:${i}`, name: s.name })),
    });
  }

  getClip(path: string): Promise<ClipDetail> {
    const { clip, sub } = this.clipAt(path);
    const detail: ClipDetail = this.clipSummary(clip, path, sub.kind === "arr");
    if (clip instanceof MidiClip) {
      detail.notes = clip.notes.map(fromNoteDescription);
    } else if (clip instanceof AudioClip) {
      detail.filePath = clip.filePath;
      detail.warping = clip.warping;
    }
    return Promise.resolve(detail);
  }

  getDevice(path: string): Promise<DeviceDetail> {
    const { device } = this.deviceAt(path);
    const summary = this.deviceSummary(device, path);
    return (async () => {
      const params = await Promise.all(
        device.parameters.map(async (p, index) => ({
          index,
          name: p.name,
          value: await p.getValue(),
          min: p.min,
          max: p.max,
          defaultValue: p.defaultValue,
          isQuantized: p.isQuantized,
          ...(p.isQuantized ? { valueItems: p.valueItems.map((v) => v.name) } : {}),
        })),
      );
      const detail: DeviceDetail = {
        path,
        name: device.name,
        kind: summary.kind,
        params,
      };
      if (summary.drumPads) detail.drumPads = summary.drumPads;
      return detail;
    })();
  }

  // -- set ------------------------------------------------------------------

  setTempo(bpm: number): Promise<void> {
    this.ctx.withinTransaction(() => {
      this.song.tempo = bpm;
    });
    return Promise.resolve();
  }

  // -- tracks ---------------------------------------------------------------

  async createTrack(kind: "midi" | "audio", name?: string): Promise<{ path: string }> {
    const track = await this.ctx.withinTransaction(() =>
      kind === "midi" ? this.song.createMidiTrack() : this.song.createAudioTrack(),
    );
    if (name !== undefined) {
      // Create-then-configure: unavoidable second undo step (SDK constraint).
      this.ctx.withinTransaction(() => {
        track.name = name;
      });
    }
    const index = this.song.tracks.indexOf(track);
    return { path: `track:${index}` };
  }

  updateTrack(args: UpdateTrackArgs): Promise<void> {
    const track = this.trackAt(parsePath(args.path), args.path);
    this.ctx.withinTransaction(() => {
      if (args.name !== undefined) track.name = args.name;
      if (args.muted !== undefined) track.mute = args.muted;
      if (args.soloed !== undefined) track.solo = args.soloed;
      if (args.armed !== undefined) track.arm = args.armed;
    });
    return Promise.resolve();
  }

  async deleteTrack(path: string): Promise<void> {
    const segments = parsePath(path);
    if (segments[0]?.kind !== "track") {
      throw new BridgeError("bad_request", `only regular tracks can be deleted: ${path}`);
    }
    const track = this.trackAt(segments, path);
    await this.ctx.withinTransaction(() => this.song.deleteTrack(track));
  }

  async duplicateTrack(path: string): Promise<{ path: string }> {
    const segments = parsePath(path);
    if (segments[0]?.kind !== "track") {
      throw new BridgeError("bad_request", `only regular tracks can be duplicated: ${path}`);
    }
    const track = this.trackAt(segments, path);
    const copy = await this.ctx.withinTransaction(() => this.song.duplicateTrack(track));
    return { path: `track:${this.song.tracks.indexOf(copy)}` };
  }

  async clearArrangementRange(
    trackPath: string,
    startBeat: number,
    endBeat: number,
  ): Promise<void> {
    const track = this.trackAt(parsePath(trackPath), trackPath);
    await this.ctx.withinTransaction(() => track.clearClipsInRange(startBeat, endBeat));
  }

  async renderPreFxAudio(
    trackPath: string,
    startBeat: number,
    endBeat: number,
  ): Promise<{ audioPath: string }> {
    const track = this.trackAt(parsePath(trackPath), trackPath);
    if (!(track instanceof AudioTrack)) {
      throw new BridgeError(
        "bad_request",
        `renderPreFxAudio: not an audio track: ${trackPath} (SDK renders audio tracks only)`,
      );
    }
    const audioPath = await this.ctx.resources.renderPreFxAudio(track, startBeat, endBeat);
    return { audioPath };
  }

  // -- library outbox -------------------------------------------------------
  // Right-click captures are buffered in storageDirectory (the only place
  // the sandbox lets us persist); `awh lib import` drains via this op.

  private outboxFile(): string | undefined {
    const dir = this.ctx.environment.storageDirectory;
    return dir === undefined ? undefined : join(dir, "outbox.json");
  }

  async drainOutbox(): Promise<OutboxEntry[]> {
    const file = this.outboxFile();
    if (file === undefined) return [];
    let entries: OutboxEntry[] = [];
    try {
      entries = JSON.parse(await readFile(file, "utf8")) as OutboxEntry[];
    } catch {
      return []; // no outbox yet (or unreadable) — nothing captured
    }
    await rm(file, { force: true });
    return entries;
  }

  /**
   * Capture a right-clicked MIDI clip (by Handle) into the outbox. Called
   * by the context-menu command in main.ts. Uses the same verified
   * NoteDescription conversion as every other note read.
   */
  async captureClipToOutbox(
    handle: Parameters<ExtensionContext["getObjectFromHandle"]>[0],
  ): Promise<string> {
    const clip = this.ctx.getObjectFromHandle(handle, MidiClip);
    const lengthBeats =
      clip.endMarker - clip.startMarker > 0 ? clip.endMarker - clip.startMarker : clip.duration;
    await this.appendOutboxEntry({
      name: clip.name,
      notes: clip.notes.map(fromNoteDescription),
      lengthBeats,
      looping: clip.looping,
      tempo: this.song.tempo,
      scale: {
        rootNote: this.song.rootNote,
        name: this.song.scaleName,
        active: this.song.scaleMode,
      },
      capturedAt: new Date().toISOString(),
    });
    return clip.name;
  }

  /** Append one capture to the outbox (called by the context-menu command). */
  async appendOutboxEntry(entry: OutboxEntry): Promise<void> {
    const file = this.outboxFile();
    if (file === undefined) {
      throw new BridgeError("unavailable", "no storageDirectory — cannot buffer captures");
    }
    await mkdir(dirname(file), { recursive: true });
    let entries: OutboxEntry[] = [];
    try {
      entries = JSON.parse(await readFile(file, "utf8")) as OutboxEntry[];
    } catch {
      // first capture
    }
    entries.push(entry);
    await writeFile(file, JSON.stringify(entries, null, 2), "utf8");
  }

  // -- scenes ---------------------------------------------------------------

  async createScene(index?: number): Promise<{ path: string }> {
    const scene = await this.ctx.withinTransaction(() => this.song.createScene(index ?? -1));
    return { path: `scene:${this.song.scenes.indexOf(scene)}` };
  }

  async deleteScene(path: string): Promise<void> {
    const scene = this.sceneAt(path);
    await this.ctx.withinTransaction(() => this.song.deleteScene(scene));
  }

  async duplicateScene(path: string): Promise<{ path: string }> {
    const scene = this.sceneAt(path);
    const copy = await this.ctx.withinTransaction(() => this.song.duplicateScene(scene));
    return { path: `scene:${this.song.scenes.indexOf(copy)}` };
  }

  private sceneAt(path: string) {
    const segments = parsePath(path);
    const root = segments[0];
    if (root?.kind !== "scene")
      throw new BridgeError("bad_request", `expected a scene path: ${path}`);
    const scene = this.song.scenes[root.index];
    if (!scene) throw new BridgeError("not_found", `no scene ${root.index}`);
    return scene;
  }

  // -- clips ----------------------------------------------------------------

  async createMidiClip(args: CreateMidiClipArgs): Promise<{ path: string }> {
    let clip: MidiClip;
    let path: string;

    if (args.target.type === "session") {
      const slotPath = args.target.slotPath;
      const segments = parsePath(slotPath);
      const track = this.trackAt(segments, slotPath);
      if (!(track instanceof MidiTrack)) {
        throw new BridgeError("bad_request", `not a MIDI track: ${slotPath}`);
      }
      const sub = segments[1];
      if (sub?.kind !== "slot")
        throw new BridgeError("bad_request", `expected a slot path: ${slotPath}`);
      const slot = track.clipSlots[sub.index];
      if (!slot) throw new BridgeError("not_found", `no slot ${sub.index} (${slotPath})`);
      clip = await this.ctx.withinTransaction(() => slot.createMidiClip(args.lengthBeats));
      path = slotPath;
    } else if (args.target.type === "arrangement") {
      const { trackPath, startBeat } = args.target;
      const track = this.trackAt(parsePath(trackPath), trackPath);
      if (!(track instanceof MidiTrack)) {
        throw new BridgeError("bad_request", `not a MIDI track: ${trackPath}`);
      }
      clip = await this.ctx.withinTransaction(() =>
        track.createMidiClip(startBeat, args.lengthBeats),
      );
      path = `${trackPath}/arr:${track.arrangementClips.indexOf(clip)}`;
    } else {
      const { lanePath, startBeat } = args.target;
      const segments = parsePath(lanePath);
      const track = this.trackAt(segments, lanePath);
      const sub = segments[1];
      if (sub?.kind !== "lane")
        throw new BridgeError("bad_request", `expected a lane path: ${lanePath}`);
      const lane = track.takeLanes[sub.index];
      if (!lane) throw new BridgeError("not_found", `no take lane ${sub.index} (${lanePath})`);
      clip = await this.ctx.withinTransaction(() =>
        lane.createMidiClip(startBeat, args.lengthBeats),
      );
      path = lanePath; // lane clips are re-read via summary; no stable sub-index yet
    }

    // Create-then-configure: second undo step (SDK constraint, documented).
    if (args.notes?.length || args.name !== undefined) {
      this.ctx.withinTransaction(() => {
        if (args.notes?.length) clip.notes = args.notes.map(toNoteDescription);
        if (args.name !== undefined) clip.name = args.name;
      });
    }
    return { path };
  }

  async createAudioClip(args: CreateAudioClipArgs): Promise<{ path: string }> {
    const track = this.trackAt(parsePath(args.trackPath), args.trackPath);
    if (!(track instanceof AudioTrack)) {
      throw new BridgeError("bad_request", `not an audio track: ${args.trackPath}`);
    }
    // Bring the file under Live's management first: createAudioClip needs a
    // path Live manages; raw external paths fail or break later.
    const imported = await this.ctx.resources.importIntoProject(args.filePath);
    const clip = await this.ctx.withinTransaction(() =>
      track.createAudioClip({
        filePath: imported,
        startTime: args.startBeat,
        ...(args.durationBeats !== undefined ? { duration: args.durationBeats } : {}),
        ...(args.isWarped !== undefined ? { isWarped: args.isWarped } : {}),
      }),
    );
    return { path: `${args.trackPath}/arr:${track.arrangementClips.indexOf(clip)}` };
  }

  setClipNotes(path: string, noteSpecs: NoteSpec[]): Promise<void> {
    const { clip } = this.clipAt(path);
    if (!(clip instanceof MidiClip)) {
      throw new BridgeError("bad_request", `not a MIDI clip: ${path}`);
    }
    this.ctx.withinTransaction(() => {
      clip.notes = noteSpecs.map(toNoteDescription);
    });
    return Promise.resolve();
  }

  updateClip(args: UpdateClipArgs): Promise<void> {
    const { clip } = this.clipAt(args.path);
    this.ctx.withinTransaction(() => {
      if (args.name !== undefined) clip.name = args.name;
      if (args.muted !== undefined) clip.muted = args.muted;
      if (args.looping !== undefined) clip.looping = args.looping;
    });
    return Promise.resolve();
  }

  async deleteClip(path: string): Promise<void> {
    const segments = parsePath(path);
    const track = this.trackAt(segments, path);
    const sub = segments[1];
    if (sub?.kind === "slot") {
      const slot = track.clipSlots[sub.index];
      if (!slot) throw new BridgeError("not_found", `no slot ${sub.index} (${path})`);
      if (!slot.clip) throw new BridgeError("not_found", `slot is empty (${path})`);
      await this.ctx.withinTransaction(() => slot.deleteClip());
      return;
    }
    if (sub?.kind === "arr") {
      const clip = track.arrangementClips[sub.index];
      if (!clip) throw new BridgeError("not_found", `no arrangement clip ${sub.index} (${path})`);
      await this.ctx.withinTransaction(() => track.deleteClip(clip));
      return;
    }
    throw new BridgeError("bad_request", `expected a clip path (slot/arr): ${path}`);
  }

  // -- devices --------------------------------------------------------------

  async insertDevice(
    ownerPath: string,
    deviceName: string,
    index?: number,
  ): Promise<{ path: string }> {
    const segments = parsePath(ownerPath);
    const last = segments[segments.length - 1];
    if (last?.kind === "chain") {
      const { device } = this.deviceAt(ownerPath.slice(0, ownerPath.lastIndexOf("/")));
      if (!(device instanceof RackDevice)) {
        throw new BridgeError("bad_request", `not a rack: ${ownerPath}`);
      }
      const chain = device.chains[last.index];
      if (!chain) throw new BridgeError("not_found", `no chain at ${ownerPath}`);
      const at = index ?? chain.devices.length;
      await this.ctx.withinTransaction(() => chain.insertDevice(deviceName, at));
      return { path: `${ownerPath}/dev:${at}` };
    }
    const track = this.trackAt(segments, ownerPath);
    const at = index ?? track.devices.length;
    await this.ctx.withinTransaction(() => track.insertDevice(deviceName, at));
    return { path: `${ownerPath}/dev:${at}` };
  }

  async deleteDevice(path: string): Promise<void> {
    const { device, owner } = this.deviceAt(path);
    await this.ctx.withinTransaction(() => owner.deleteDevice(device));
  }

  async setDeviceParam(devicePath: string, paramName: string, value: number): Promise<void> {
    const { device } = this.deviceAt(devicePath);
    const param = device.parameters.find((p) => p.name === paramName);
    if (!param) throw new BridgeError("not_found", `no param "${paramName}" on ${devicePath}`);
    if (value < param.min || value > param.max) {
      throw new BridgeError(
        "bad_request",
        `value ${value} outside [${param.min}, ${param.max}] for "${paramName}"`,
      );
    }
    await this.ctx.withinTransaction(() => param.setValue(value));
  }

  async setMixer(args: MixerArgs): Promise<void> {
    const track = this.trackAt(parsePath(args.path), args.path);
    const mixer = track.mixer;
    const writes: Promise<void>[] = [];
    const queue = (param: DeviceParameter | undefined, value: number, label: string) => {
      if (!param) throw new BridgeError("not_found", `no ${label} on ${args.path}`);
      writes.push(param.setValue(value));
    };
    await this.ctx.withinTransaction(() => {
      if (args.volume !== undefined) queue(mixer.volume, args.volume, "volume");
      if (args.pan !== undefined) queue(mixer.panning, args.pan, "pan");
      if (args.sends) {
        for (const [key, value] of Object.entries(args.sends)) {
          queue(mixer.sends[Number(key)], value, `send ${key}`);
        }
      }
      return Promise.all(writes);
    });
  }

  // -- drum racks & simpler -------------------------------------------------

  setDrumPadNote(chainPath: string, note: number): Promise<void> {
    const segments = parsePath(chainPath);
    const last = segments[segments.length - 1];
    if (last?.kind !== "chain") {
      throw new BridgeError("bad_request", `expected a chain path: ${chainPath}`);
    }
    const { device } = this.deviceAt(chainPath.slice(0, chainPath.lastIndexOf("/")));
    if (!(device instanceof DrumRack)) {
      throw new BridgeError("bad_request", `not a drum rack: ${chainPath}`);
    }
    const chain = device.chains[last.index];
    if (!chain) throw new BridgeError("not_found", `no chain at ${chainPath}`);
    this.ctx.withinTransaction(() => {
      chain.receivingNote = note;
    });
    return Promise.resolve();
  }

  async replaceSimplerSample(devicePath: string, filePath: string): Promise<void> {
    const { device } = this.deviceAt(devicePath);
    if (!(device instanceof Simpler)) {
      throw new BridgeError("bad_request", `not a Simpler: ${devicePath}`);
    }
    const imported = await this.ctx.resources.importIntoProject(filePath);
    await this.ctx.withinTransaction(() => device.replaceSample(imported));
  }
}

// -- note conversion --------------------------------------------------------

function toNoteDescription(n: NoteSpec): NoteDescription {
  const out: NoteDescription = {
    pitch: n.pitch,
    startTime: n.start,
    duration: n.duration,
  };
  if (n.velocity !== undefined) out.velocity = n.velocity;
  if (n.velocityDeviation !== undefined) out.velocityDeviation = n.velocityDeviation;
  if (n.releaseVelocity !== undefined) out.releaseVelocity = n.releaseVelocity;
  if (n.probability !== undefined) out.probability = n.probability;
  if (n.muted !== undefined) out.muted = n.muted;
  return out;
}

function fromNoteDescription(n: NoteDescription): NoteSpec {
  const out: NoteSpec = {
    pitch: n.pitch,
    start: n.startTime,
    duration: n.duration,
  };
  if (n.velocity !== undefined) out.velocity = n.velocity;
  if (n.velocityDeviation !== undefined) out.velocityDeviation = n.velocityDeviation;
  if (n.releaseVelocity !== undefined) out.releaseVelocity = n.releaseVelocity;
  if (n.probability !== undefined) out.probability = n.probability;
  if (n.muted !== undefined) out.muted = n.muted;
  return out;
}

export { LIVE_API_VERSION };
