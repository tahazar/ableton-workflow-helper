import {
  BridgeError,
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
  type SetSummary,
  type TrackSummary,
  type UpdateClipArgs,
  type UpdateTrackArgs,
} from "../bridge/types.js";
import { indexAt, parsePath, type PathSegment } from "../bridge/paths.js";

/**
 * In-memory LiveBridge for tests and Live-less development (`awh serve-fake`).
 * Mirrors the SDK's semantics where they matter (clearClipsInRange truncation,
 * session slots vs arrangement clips, drum-rack chains) so core logic and the
 * CLI are exercised realistically in CI. Every op added to the real adapter
 * gets a fake implementation here first.
 */

interface FakeClip {
  kind: "midi" | "audio";
  name: string;
  startTime: number; // arrangement position; 0 for session clips
  duration: number;
  looping: boolean;
  muted: boolean;
  notes: NoteSpec[];
  filePath?: string;
  warping?: boolean;
}

interface FakeParam {
  name: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  isQuantized: boolean;
}

interface FakeChain {
  name: string;
  receivingNote?: number;
  devices: FakeDevice[];
}

interface FakeDevice {
  name: string;
  kind: DeviceSummary["kind"];
  params: FakeParam[];
  chains?: FakeChain[];
  sampleFile?: string;
}

interface FakeTrack {
  kind: "midi" | "audio" | "return" | "main";
  name: string;
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  slots: (FakeClip | null)[];
  arrangement: FakeClip[];
  lanes: { name: string; clips: FakeClip[] }[];
  devices: FakeDevice[];
  mixer: { volume: FakeParam; pan: FakeParam; sends: FakeParam[] };
}

function param(name: string, value: number, min = 0, max = 1): FakeParam {
  return { name, value, min, max, defaultValue: value, isQuantized: false };
}

function makeTrack(kind: FakeTrack["kind"], name: string, slots: number): FakeTrack {
  return {
    kind,
    name,
    muted: false,
    soloed: false,
    armed: false,
    slots: Array.from({ length: slots }, () => null),
    arrangement: [],
    lanes: [],
    devices: [],
    mixer: {
      volume: param("Volume", 0.85),
      pan: param("Pan", 0, -1, 1),
      sends: [param("Send A", 0), param("Send B", 0)],
    },
  };
}

function makeStockDevice(name: string): FakeDevice {
  const lower = name.toLowerCase();
  if (lower === "drum rack") {
    return {
      name,
      kind: "drumRack",
      params: [param("Macro 1", 0.5)],
      chains: [],
    };
  }
  if (lower === "simpler") {
    return { name, kind: "simpler", params: [param("Transpose", 0.5)] };
  }
  return {
    name,
    kind: "device",
    params: [
      param("Device On", 1, 0, 1),
      param("Dry/Wet", 1),
      param("Freq", 0.5),
      param("Gain", 0.5),
    ],
  };
}

export class FakeLiveBridge implements LiveBridge {
  private tracks: FakeTrack[] = [];
  private returns: FakeTrack[] = [];
  private main: FakeTrack;
  private scenes: { name: string }[] = [];
  private tempo = 128;

  constructor(opts: { tracks?: number; scenes?: number } = {}) {
    const trackCount = opts.tracks ?? 4;
    const sceneCount = opts.scenes ?? 4;
    for (let i = 0; i < trackCount; i++) {
      this.tracks.push(
        makeTrack(i % 2 === 0 ? "midi" : "audio", `${i + 1} Track`, sceneCount),
      );
    }
    this.returns.push(makeTrack("return", "A Return", 0));
    this.main = makeTrack("main", "Main", 0);
    for (let i = 0; i < sceneCount; i++) this.scenes.push({ name: "" });
  }

  describe(): Promise<BridgeInfo> {
    return Promise.resolve({ kind: "fake", name: "FakeLiveBridge" });
  }

  // -- path resolution ------------------------------------------------------

  private trackAt(segments: PathSegment[], path: string): FakeTrack {
    const root = segments[0];
    if (!root) throw new BridgeError("bad_request", `empty path`);
    if (root.kind === "main") return this.main;
    if (root.kind === "track" || root.kind === "return") {
      const list = root.kind === "track" ? this.tracks : this.returns;
      const track = list[root.index];
      if (!track) throw new BridgeError("not_found", `no ${root.kind} ${root.index} (${path})`);
      return track;
    }
    throw new BridgeError("bad_request", `expected a track path: ${path}`);
  }

  private clipAt(path: string): { clip: FakeClip; track: FakeTrack; segments: PathSegment[] } {
    const segments = parsePath(path);
    const track = this.trackAt(segments, path);
    const sub = segments[1];
    if (sub?.kind === "slot") {
      const clip = track.slots[sub.index];
      if (clip === undefined) throw new BridgeError("not_found", `no slot ${sub.index} (${path})`);
      if (clip === null) throw new BridgeError("not_found", `slot is empty (${path})`);
      return { clip, track, segments };
    }
    if (sub?.kind === "arr") {
      const clip = track.arrangement[sub.index];
      if (!clip) throw new BridgeError("not_found", `no arrangement clip ${sub.index} (${path})`);
      return { clip, track, segments };
    }
    throw new BridgeError("bad_request", `expected a clip path (slot/arr): ${path}`);
  }

  private deviceAt(path: string): { device: FakeDevice; owner: FakeTrack | FakeChain } {
    const segments = parsePath(path);
    const track = this.trackAt(segments, path);
    let owner: FakeTrack | FakeChain = track;
    let devices = track.devices;
    let device: FakeDevice | undefined;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!;
      if (seg.kind === "dev") {
        device = devices[seg.index];
        if (!device) throw new BridgeError("not_found", `no device at ${path}`);
      } else if (seg.kind === "chain") {
        if (!device?.chains) throw new BridgeError("bad_request", `not a rack: ${path}`);
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

  private chainAt(path: string): FakeChain {
    const segments = parsePath(path);
    const last = segments[segments.length - 1];
    if (last?.kind !== "chain") {
      throw new BridgeError("bad_request", `expected a chain path: ${path}`);
    }
    const devicePathSegs = segments.slice(0, -1);
    const { device } = this.deviceAt(
      devicePathSegs.map((s) => ("index" in s ? `${s.kind}:${s.index}` : s.kind)).join("/"),
    );
    const chain = device.chains?.[last.index];
    if (!chain) throw new BridgeError("not_found", `no chain at ${path}`);
    return chain;
  }

  // -- reads ----------------------------------------------------------------

  getSetSummary(): Promise<SetSummary> {
    const trackSummary = (t: FakeTrack, path: string): TrackSummary => ({
      path,
      kind: t.kind,
      name: t.name,
      muted: t.muted,
      soloed: t.soloed,
      armed: t.armed,
      slotCount: t.slots.length,
      sessionClips: t.slots
        .map((clip, i) => (clip ? this.clipSummary(clip, `${path}/slot:${i}`) : null))
        .filter((c): c is ClipSummary => c !== null),
      arrangementClips: t.arrangement.map((c, i) =>
        this.clipSummary(c, `${path}/arr:${i}`, true),
      ),
      devices: t.devices.map((d, i) => this.deviceSummary(d, `${path}/dev:${i}`)),
    });

    return Promise.resolve({
      tempo: this.tempo,
      scale: { rootNote: 0, name: "Major", active: false },
      trackCount: this.tracks.length,
      sceneCount: this.scenes.length,
      tracks: this.tracks.map((t, i) => trackSummary(t, `track:${i}`)),
      returnTracks: this.returns.map((t, i) => trackSummary(t, `return:${i}`)),
      scenes: this.scenes.map((s, i) => ({ path: `scene:${i}`, name: s.name })),
    });
  }

  private clipSummary(clip: FakeClip, path: string, arrangement = false): ClipSummary {
    return {
      path,
      kind: clip.kind,
      name: clip.name,
      ...(arrangement
        ? { startTime: clip.startTime, endTime: clip.startTime + clip.duration }
        : {}),
      duration: clip.duration,
      looping: clip.looping,
      muted: clip.muted,
      ...(clip.kind === "midi" ? { noteCount: clip.notes.length } : {}),
    };
  }

  private deviceSummary(device: FakeDevice, path: string): DeviceSummary {
    return {
      path,
      name: device.name,
      kind: device.kind,
      paramCount: device.params.length,
      ...(device.kind === "drumRack" && device.chains
        ? {
            drumPads: device.chains.map((c, i) => ({
              chainPath: `${path}/chain:${i}`,
              note: c.receivingNote ?? 0,
              name: c.name,
            })),
          }
        : {}),
    };
  }

  getClip(path: string): Promise<ClipDetail> {
    const { clip, segments } = this.clipAt(path);
    const arrangement = segments[1]?.kind === "arr";
    return Promise.resolve({
      ...this.clipSummary(clip, path, arrangement),
      ...(clip.kind === "midi" ? { notes: [...clip.notes] } : {}),
      ...(clip.kind === "audio"
        ? { filePath: clip.filePath, warping: clip.warping }
        : {}),
    });
  }

  getDevice(path: string): Promise<DeviceDetail> {
    const { device } = this.deviceAt(path);
    return Promise.resolve({
      path,
      name: device.name,
      kind: device.kind,
      params: device.params.map((p, index) => ({
        index,
        name: p.name,
        value: p.value,
        min: p.min,
        max: p.max,
        defaultValue: p.defaultValue,
        isQuantized: p.isQuantized,
      })),
      ...(device.kind === "drumRack" && device.chains
        ? {
            drumPads: device.chains.map((c, i) => ({
              chainPath: `${path}/chain:${i}`,
              note: c.receivingNote ?? 0,
              name: c.name,
            })),
          }
        : {}),
    });
  }

  // -- set ------------------------------------------------------------------

  setTempo(bpm: number): Promise<void> {
    if (bpm < 20 || bpm > 999) throw new BridgeError("bad_request", `tempo out of range: ${bpm}`);
    this.tempo = bpm;
    return Promise.resolve();
  }

  // -- tracks ---------------------------------------------------------------

  createTrack(kind: "midi" | "audio", name?: string): Promise<{ path: string }> {
    const track = makeTrack(kind, name ?? `${this.tracks.length + 1} Track`, this.scenes.length);
    this.tracks.push(track);
    return Promise.resolve({ path: `track:${this.tracks.length - 1}` });
  }

  updateTrack(args: UpdateTrackArgs): Promise<void> {
    const track = this.trackAt(parsePath(args.path), args.path);
    if (args.name !== undefined) track.name = args.name;
    if (args.muted !== undefined) track.muted = args.muted;
    if (args.soloed !== undefined) track.soloed = args.soloed;
    if (args.armed !== undefined) track.armed = args.armed;
    return Promise.resolve();
  }

  deleteTrack(path: string): Promise<void> {
    const segments = parsePath(path);
    const index = indexAt(segments, 0, "track", path);
    if (!this.tracks[index]) throw new BridgeError("not_found", `no track ${index}`);
    this.tracks.splice(index, 1);
    return Promise.resolve();
  }

  duplicateTrack(path: string): Promise<{ path: string }> {
    const segments = parsePath(path);
    const index = indexAt(segments, 0, "track", path);
    const track = this.tracks[index];
    if (!track) throw new BridgeError("not_found", `no track ${index}`);
    this.tracks.splice(index + 1, 0, structuredClone(track));
    return Promise.resolve({ path: `track:${index + 1}` });
  }

  clearArrangementRange(trackPath: string, startBeat: number, endBeat: number): Promise<void> {
    const track = this.trackAt(parsePath(trackPath), trackPath);
    // SDK semantics: clips fully inside the range are deleted; clips
    // overlapping a boundary are truncated, not removed.
    track.arrangement = track.arrangement.flatMap((clip) => {
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      if (clipStart >= endBeat || clipEnd <= startBeat) return [clip];
      if (clipStart >= startBeat && clipEnd <= endBeat) return [];
      const pieces: FakeClip[] = [];
      if (clipStart < startBeat) {
        pieces.push({ ...clip, duration: startBeat - clipStart });
      }
      if (clipEnd > endBeat) {
        pieces.push({ ...clip, startTime: endBeat, duration: clipEnd - endBeat });
      }
      return pieces;
    });
    return Promise.resolve();
  }

  // -- scenes ---------------------------------------------------------------

  createScene(index?: number): Promise<{ path: string }> {
    const at = index === undefined || index === -1 ? this.scenes.length : index;
    if (at < 0 || at > this.scenes.length) {
      throw new BridgeError("bad_request", `scene index out of range: ${at}`);
    }
    this.scenes.splice(at, 0, { name: "" });
    for (const track of [...this.tracks]) track.slots.splice(at, 0, null);
    return Promise.resolve({ path: `scene:${at}` });
  }

  deleteScene(path: string): Promise<void> {
    const index = indexAt(parsePath(path), 0, "scene", path);
    if (!this.scenes[index]) throw new BridgeError("not_found", `no scene ${index}`);
    this.scenes.splice(index, 1);
    for (const track of this.tracks) track.slots.splice(index, 1);
    return Promise.resolve();
  }

  duplicateScene(path: string): Promise<{ path: string }> {
    const index = indexAt(parsePath(path), 0, "scene", path);
    const scene = this.scenes[index];
    if (!scene) throw new BridgeError("not_found", `no scene ${index}`);
    this.scenes.splice(index + 1, 0, { ...scene });
    for (const track of this.tracks) {
      track.slots.splice(index + 1, 0, structuredClone(track.slots[index] ?? null));
    }
    return Promise.resolve({ path: `scene:${index + 1}` });
  }

  // -- clips ----------------------------------------------------------------

  createMidiClip(args: CreateMidiClipArgs): Promise<{ path: string }> {
    const clip: FakeClip = {
      kind: "midi",
      name: args.name ?? "",
      startTime: 0,
      duration: args.lengthBeats,
      looping: true,
      muted: false,
      notes: args.notes ? [...args.notes] : [],
    };
    if (args.target.type === "session") {
      const segments = parsePath(args.target.slotPath);
      const track = this.trackAt(segments, args.target.slotPath);
      if (track.kind !== "midi") {
        throw new BridgeError("bad_request", `not a MIDI track: ${args.target.slotPath}`);
      }
      const slot = indexAt(segments, 1, "slot", args.target.slotPath);
      if (slot >= track.slots.length) {
        throw new BridgeError("not_found", `no slot ${slot} (${args.target.slotPath})`);
      }
      track.slots[slot] = clip;
      return Promise.resolve({ path: args.target.slotPath });
    }
    if (args.target.type === "arrangement") {
      const track = this.trackAt(parsePath(args.target.trackPath), args.target.trackPath);
      if (track.kind !== "midi") {
        throw new BridgeError("bad_request", `not a MIDI track: ${args.target.trackPath}`);
      }
      clip.startTime = args.target.startBeat;
      clip.looping = false;
      track.arrangement.push(clip);
      track.arrangement.sort((a, b) => a.startTime - b.startTime);
      const index = track.arrangement.indexOf(clip);
      return Promise.resolve({ path: `${args.target.trackPath}/arr:${index}` });
    }
    throw new BridgeError("bad_request", `take-lane targets not yet supported by the fake`);
  }

  createAudioClip(args: CreateAudioClipArgs): Promise<{ path: string }> {
    const track = this.trackAt(parsePath(args.trackPath), args.trackPath);
    if (track.kind !== "audio") {
      throw new BridgeError("bad_request", `not an audio track: ${args.trackPath}`);
    }
    const clip: FakeClip = {
      kind: "audio",
      name: "",
      startTime: args.startBeat,
      duration: args.durationBeats ?? 4,
      looping: false,
      muted: false,
      notes: [],
      filePath: args.filePath,
      warping: args.isWarped ?? false,
    };
    track.arrangement.push(clip);
    track.arrangement.sort((a, b) => a.startTime - b.startTime);
    return Promise.resolve({
      path: `${args.trackPath}/arr:${track.arrangement.indexOf(clip)}`,
    });
  }

  setClipNotes(path: string, notes: NoteSpec[]): Promise<void> {
    const { clip } = this.clipAt(path);
    if (clip.kind !== "midi") throw new BridgeError("bad_request", `not a MIDI clip: ${path}`);
    clip.notes = [...notes];
    return Promise.resolve();
  }

  updateClip(args: UpdateClipArgs): Promise<void> {
    const { clip } = this.clipAt(args.path);
    if (args.name !== undefined) clip.name = args.name;
    if (args.muted !== undefined) clip.muted = args.muted;
    if (args.looping !== undefined) clip.looping = args.looping;
    return Promise.resolve();
  }

  deleteClip(path: string): Promise<void> {
    const { track, segments } = this.clipAt(path);
    const sub = segments[1]!;
    if (sub.kind === "slot") track.slots[sub.index] = null;
    else if (sub.kind === "arr") track.arrangement.splice(sub.index, 1);
    return Promise.resolve();
  }

  // -- devices --------------------------------------------------------------

  insertDevice(ownerPath: string, deviceName: string, index?: number): Promise<{ path: string }> {
    const segments = parsePath(ownerPath);
    const last = segments[segments.length - 1];
    let devices: FakeDevice[];
    if (last?.kind === "chain") {
      devices = this.chainAt(ownerPath).devices;
    } else {
      devices = this.trackAt(segments, ownerPath).devices;
    }
    const at = index ?? devices.length;
    if (at < 0 || at > devices.length) {
      throw new BridgeError("bad_request", `device index out of range: ${at}`);
    }
    devices.splice(at, 0, makeStockDevice(deviceName));
    return Promise.resolve({ path: `${ownerPath}/dev:${at}` });
  }

  deleteDevice(path: string): Promise<void> {
    const segments = parsePath(path);
    const last = segments[segments.length - 1];
    if (last?.kind !== "dev") throw new BridgeError("bad_request", `expected a device path: ${path}`);
    const { owner } = this.deviceAt(path);
    const devices = "devices" in owner ? owner.devices : [];
    devices.splice(last.index, 1);
    return Promise.resolve();
  }

  setDeviceParam(devicePath: string, paramName: string, value: number): Promise<void> {
    const { device } = this.deviceAt(devicePath);
    const p = device.params.find((x) => x.name === paramName);
    if (!p) throw new BridgeError("not_found", `no param "${paramName}" on ${devicePath}`);
    if (value < p.min || value > p.max) {
      throw new BridgeError("bad_request", `value ${value} outside [${p.min}, ${p.max}] for "${paramName}"`);
    }
    p.value = value;
    return Promise.resolve();
  }

  setMixer(args: MixerArgs): Promise<void> {
    const track = this.trackAt(parsePath(args.path), args.path);
    if (args.volume !== undefined) track.mixer.volume.value = args.volume;
    if (args.pan !== undefined) track.mixer.pan.value = args.pan;
    if (args.sends) {
      for (const [key, value] of Object.entries(args.sends)) {
        const send = track.mixer.sends[Number(key)];
        if (!send) throw new BridgeError("not_found", `no send ${key} on ${args.path}`);
        send.value = value;
      }
    }
    return Promise.resolve();
  }

  // -- drum racks & simpler -------------------------------------------------

  setDrumPadNote(chainPath: string, note: number): Promise<void> {
    const chain = this.chainAt(chainPath);
    chain.receivingNote = note;
    return Promise.resolve();
  }

  /** Test helper: add a chain to a drum rack (the SDK does this via insertChain). */
  addDrumChain(devicePath: string, name: string, note: number): void {
    const { device } = this.deviceAt(devicePath);
    if (!device.chains) throw new BridgeError("bad_request", `not a rack: ${devicePath}`);
    device.chains.push({ name, receivingNote: note, devices: [] });
  }

  replaceSimplerSample(devicePath: string, filePath: string): Promise<void> {
    const { device } = this.deviceAt(devicePath);
    if (device.kind !== "simpler") {
      throw new BridgeError("bad_request", `not a Simpler: ${devicePath}`);
    }
    device.sampleFile = filePath;
    return Promise.resolve();
  }
}
