/**
 * LiveBridge is the seam between everything we build and whatever talks to
 * Ableton Live. The SDK-coupled extension shell implements it against the
 * Ableton Extensions SDK; FakeLiveBridge implements it for tests and offline
 * development. Nothing outside packages/extension may import the SDK (ADR-001).
 *
 * All times are in beats. All indices are 0-based. Objects are addressed by
 * stable-format path strings (see paths.ts) that are re-resolved on every
 * call. Indices shift when the user moves/deletes things, so paths are
 * cheap addresses, not durable identities.
 */

export interface BridgeInfo {
  kind: "sdk" | "fake";
  name: string;
  liveApiVersion?: string;
}

// ---------------------------------------------------------------------------
// Notes (wire format; bar|beat text notation lives above the bridge, in
// notation/barbeat.ts)
// ---------------------------------------------------------------------------

export interface NoteSpec {
  /** MIDI note number 0–127. */
  pitch: number;
  /** Onset in beats from clip start. */
  start: number;
  /** Length in beats. */
  duration: number;
  /** 1–127; default 100. */
  velocity?: number;
  /** 0–1 chance the note plays. */
  probability?: number;
  velocityDeviation?: number;
  releaseVelocity?: number;
  muted?: boolean;
}

// ---------------------------------------------------------------------------
// Summaries (token-frugal read model)
// ---------------------------------------------------------------------------

export interface ClipSummary {
  path: string;
  kind: "midi" | "audio";
  name: string;
  /** Arrangement clips only: position on the timeline, beats. */
  startTime?: number;
  endTime?: number;
  /** Session clips: loop length. */
  duration: number;
  looping: boolean;
  muted: boolean;
  noteCount?: number;
}

export interface DrumPadSummary {
  chainPath: string;
  /** MIDI note the pad responds to. */
  note: number;
  /**
   * Best-effort only: the real SDK's DrumChain has no name accessor, so the
   * SDK adapter derives this from the chain's first device (if any).
   */
  name?: string;
}

export interface DeviceSummary {
  path: string;
  name: string;
  kind: "device" | "rack" | "drumRack" | "simpler";
  paramCount: number;
  /** Drum racks only. */
  drumPads?: DrumPadSummary[];
}

export type TrackKind = "midi" | "audio" | "return" | "main";

export interface TrackSummary {
  path: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  slotCount: number;
  /** Occupied session slots only. */
  sessionClips: ClipSummary[];
  arrangementClips: ClipSummary[];
  devices: DeviceSummary[];
}

export interface SceneSummary {
  path: string;
  name: string;
}

export interface SetSummary {
  tempo: number;
  scale: { rootNote: number; name: string; active: boolean; intervals: number[] };
  trackCount: number;
  sceneCount: number;
  tracks: TrackSummary[];
  returnTracks: TrackSummary[];
  scenes: SceneSummary[];
}

export interface ClipDetail extends ClipSummary {
  /** MIDI clips only: the full note array. */
  notes?: NoteSpec[];
  /** Audio clips only. */
  filePath?: string;
  warping?: boolean;
}

export interface DeviceParamInfo {
  index: number;
  name: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  isQuantized: boolean;
  /** Labels for quantized params. */
  valueItems?: string[];
}

export interface DeviceDetail {
  path: string;
  name: string;
  kind: DeviceSummary["kind"];
  params: DeviceParamInfo[];
  drumPads?: DrumPadSummary[];
}

// ---------------------------------------------------------------------------
// Write arguments
// ---------------------------------------------------------------------------

export type MidiClipTarget =
  | { type: "session"; slotPath: string }
  | { type: "arrangement"; trackPath: string; startBeat: number }
  | { type: "takeLane"; lanePath: string; startBeat: number };

export interface CreateMidiClipArgs {
  target: MidiClipTarget;
  lengthBeats: number;
  notes?: NoteSpec[];
  name?: string;
}

export interface CreateAudioClipArgs {
  trackPath: string;
  /** Must be a path Live manages (importIntoProject first on the SDK side). */
  filePath: string;
  startBeat: number;
  durationBeats?: number;
  isWarped?: boolean;
}

export interface UpdateClipArgs {
  path: string;
  name?: string;
  muted?: boolean;
  looping?: boolean;
}

export interface UpdateTrackArgs {
  path: string;
  name?: string;
  muted?: boolean;
  soloed?: boolean;
  armed?: boolean;
}

export interface MixerArgs {
  path: string;
  /** Raw DeviceParameter values on Live's internal scale, not dB/pan units
   *  (see docs/research/mixer-calibration.md for measured raw-to-dB pairs). */
  volume?: number;
  pan?: number;
  /** Send index → raw value. */
  sends?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/**
 * A clip captured from Live's UI via the right-click "save to library"
 * action. Buffered extension-side (storageDirectory outbox) because
 * the extension sandbox cannot write into the repo; `awh lib import` drains.
 */
export interface OutboxEntry {
  name: string;
  notes: NoteSpec[];
  lengthBeats: number;
  looping: boolean;
  tempo: number;
  scale: { rootNote: number; name: string; active: boolean } | null;
  capturedAt: string;
}

export interface LiveBridge {
  describe(): Promise<BridgeInfo>;

  // reads
  getSetSummary(): Promise<SetSummary>;
  getClip(path: string): Promise<ClipDetail>;
  getDevice(path: string): Promise<DeviceDetail>;

  // set
  setTempo(bpm: number): Promise<void>;

  // tracks
  createTrack(kind: "midi" | "audio", name?: string): Promise<{ path: string }>;
  updateTrack(args: UpdateTrackArgs): Promise<void>;
  deleteTrack(path: string): Promise<void>;
  duplicateTrack(path: string): Promise<{ path: string }>;
  clearArrangementRange(
    trackPath: string,
    startBeat: number,
    endBeat: number,
  ): Promise<void>;
  /** Render an audio track's pre-FX signal between two beat positions to a
   *  WAV in the extension temp dir. SDK constraint: audio tracks only, pre-FX
   *  only; the SDK has no post-FX capture. */
  renderPreFxAudio(
    trackPath: string,
    startBeat: number,
    endBeat: number,
  ): Promise<{ audioPath: string }>;

  /** Drain (return + clear) right-click library captures. See OutboxEntry. */
  drainOutbox(): Promise<OutboxEntry[]>;

  // scenes
  createScene(index?: number): Promise<{ path: string }>;
  deleteScene(path: string): Promise<void>;
  duplicateScene(path: string): Promise<{ path: string }>;

  // clips
  createMidiClip(args: CreateMidiClipArgs): Promise<{ path: string }>;
  createAudioClip(args: CreateAudioClipArgs): Promise<{ path: string }>;
  setClipNotes(path: string, notes: NoteSpec[]): Promise<void>;
  updateClip(args: UpdateClipArgs): Promise<void>;
  deleteClip(path: string): Promise<void>;

  // devices
  insertDevice(
    ownerPath: string,
    deviceName: string,
    index?: number,
  ): Promise<{ path: string }>;
  deleteDevice(path: string): Promise<void>;
  setDeviceParam(
    devicePath: string,
    paramName: string,
    value: number,
  ): Promise<void>;
  setMixer(args: MixerArgs): Promise<void>;

  // drum racks & simpler
  setDrumPadNote(chainPath: string, note: number): Promise<void>;
  replaceSimplerSample(devicePath: string, filePath: string): Promise<void>;
}

/** Typed gateway error the server maps to HTTP status codes. */
export class BridgeError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "bad_request"
      | "unavailable"
      | "internal",
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}
