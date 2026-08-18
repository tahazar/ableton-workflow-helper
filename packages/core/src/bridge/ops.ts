import {
  BridgeError,
  type CreateAudioClipArgs,
  type CreateMidiClipArgs,
  type LiveBridge,
  type MidiClipTarget,
  type NoteSpec,
} from "./types.js";

export interface OpContext {
  bridge: LiveBridge;
}

export type OpHandler = (args: unknown, ctx: OpContext) => Promise<unknown>;

export interface OpDefinition {
  name: string;
  description: string;
  handler: OpHandler;
}

// -- tiny validation helpers (no schema library: keep the extension bundle lean)

function obj(args: unknown, op: string): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new BridgeError("bad_request", `${op}: arguments must be a JSON object`);
  }
  return args as Record<string, unknown>;
}

function str(a: Record<string, unknown>, key: string, op: string): string {
  const v = a[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new BridgeError("bad_request", `${op}: "${key}" must be a non-empty string`);
  }
  return v;
}

function num(a: Record<string, unknown>, key: string, op: string): number {
  const v = a[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new BridgeError("bad_request", `${op}: "${key}" must be a finite number`);
  }
  return v;
}

function optNum(a: Record<string, unknown>, key: string, op: string): number | undefined {
  return a[key] === undefined ? undefined : num(a, key, op);
}

function optStr(a: Record<string, unknown>, key: string, op: string): string | undefined {
  return a[key] === undefined ? undefined : str(a, key, op);
}

function optBool(a: Record<string, unknown>, key: string, op: string): boolean | undefined {
  const v = a[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") {
    throw new BridgeError("bad_request", `${op}: "${key}" must be a boolean`);
  }
  return v;
}

function notes(a: Record<string, unknown>, key: string, op: string): NoteSpec[] {
  const v = a[key];
  if (!Array.isArray(v)) {
    throw new BridgeError("bad_request", `${op}: "${key}" must be an array of notes`);
  }
  return v.map((n, i) => {
    const note = obj(n, `${op}.${key}[${i}]`);
    const pitch = num(note, "pitch", op);
    const start = num(note, "start", op);
    const duration = num(note, "duration", op);
    if (pitch < 0 || pitch > 127) {
      throw new BridgeError("bad_request", `${op}: note ${i} pitch ${pitch} outside 0-127`);
    }
    if (start < 0 || duration <= 0) {
      throw new BridgeError("bad_request", `${op}: note ${i} needs start >= 0 and duration > 0`);
    }
    const spec: NoteSpec = { pitch, start, duration };
    const velocity = optNum(note, "velocity", op);
    if (velocity !== undefined) spec.velocity = velocity;
    const probability = optNum(note, "probability", op);
    if (probability !== undefined) spec.probability = probability;
    const velocityDeviation = optNum(note, "velocityDeviation", op);
    if (velocityDeviation !== undefined) spec.velocityDeviation = velocityDeviation;
    const releaseVelocity = optNum(note, "releaseVelocity", op);
    if (releaseVelocity !== undefined) spec.releaseVelocity = releaseVelocity;
    const muted = optBool(note, "muted", op);
    if (muted !== undefined) spec.muted = muted;
    return spec;
  });
}

function midiClipTarget(a: Record<string, unknown>, op: string): MidiClipTarget {
  const t = obj(a.target, `${op}.target`);
  const type = str(t, "type", op);
  if (type === "session") return { type, slotPath: str(t, "slotPath", op) };
  if (type === "arrangement") {
    return { type, trackPath: str(t, "trackPath", op), startBeat: num(t, "startBeat", op) };
  }
  if (type === "takeLane") {
    return { type, lanePath: str(t, "lanePath", op), startBeat: num(t, "startBeat", op) };
  }
  throw new BridgeError("bad_request", `${op}: unknown target type "${type}"`);
}

// -- the registry ----------------------------------------------------------

/**
 * Deterministic operation registry: one op = one logical, undoable action.
 * (SDK constraint: create-then-configure ops such as clip.create-midi with
 * notes land as two undo steps — create, then configure — because the
 * instance only resolves after the async create.)
 */
export function buildOpRegistry(): Map<string, OpDefinition> {
  const ops = new Map<string, OpDefinition>();
  const add = (op: OpDefinition) => ops.set(op.name, op);

  add({
    name: "ping",
    description: "Gateway liveness + bridge identity",
    handler: async (_args, ctx) => ({
      service: "awh-gateway",
      bridge: await ctx.bridge.describe(),
    }),
  });

  add({
    name: "set.summary",
    description: "Compact summary of the open Live Set (tracks, clips, devices, scenes)",
    handler: async (_args, ctx) => ctx.bridge.getSetSummary(),
  });

  add({
    name: "library.outbox",
    description: "Drain right-click library captures (returns entries and clears the outbox)",
    handler: async (_args, ctx) => ctx.bridge.drainOutbox(),
  });

  add({
    name: "set.tempo",
    description: "Set the Set tempo. Args: {bpm}",
    handler: async (args, ctx) => ctx.bridge.setTempo(num(obj(args, "set.tempo"), "bpm", "set.tempo")),
  });

  add({
    name: "clip.get",
    description: "Read one clip incl. MIDI notes. Args: {path}",
    handler: async (args, ctx) => ctx.bridge.getClip(str(obj(args, "clip.get"), "path", "clip.get")),
  });

  add({
    name: "clip.create-midi",
    description:
      "Create a MIDI clip. Args: {target: {type: session|arrangement|takeLane, ...}, lengthBeats, notes?, name?}",
    handler: async (args, ctx) => {
      const a = obj(args, "clip.create-midi");
      const parsed: CreateMidiClipArgs = {
        target: midiClipTarget(a, "clip.create-midi"),
        lengthBeats: num(a, "lengthBeats", "clip.create-midi"),
      };
      if (a.notes !== undefined) parsed.notes = notes(a, "notes", "clip.create-midi");
      const name = optStr(a, "name", "clip.create-midi");
      if (name !== undefined) parsed.name = name;
      return ctx.bridge.createMidiClip(parsed);
    },
  });

  add({
    name: "clip.create-audio",
    description:
      "Place an audio file as an arrangement clip. Args: {trackPath, filePath, startBeat, durationBeats?, isWarped?}",
    handler: async (args, ctx) => {
      const a = obj(args, "clip.create-audio");
      const parsed: CreateAudioClipArgs = {
        trackPath: str(a, "trackPath", "clip.create-audio"),
        filePath: str(a, "filePath", "clip.create-audio"),
        startBeat: num(a, "startBeat", "clip.create-audio"),
      };
      const durationBeats = optNum(a, "durationBeats", "clip.create-audio");
      if (durationBeats !== undefined) parsed.durationBeats = durationBeats;
      const isWarped = optBool(a, "isWarped", "clip.create-audio");
      if (isWarped !== undefined) parsed.isWarped = isWarped;
      return ctx.bridge.createAudioClip(parsed);
    },
  });

  add({
    name: "clip.notes",
    description: "Replace ALL notes of a MIDI clip. Args: {path, notes}",
    handler: async (args, ctx) => {
      const a = obj(args, "clip.notes");
      return ctx.bridge.setClipNotes(str(a, "path", "clip.notes"), notes(a, "notes", "clip.notes"));
    },
  });

  add({
    name: "clip.update",
    description: "Update clip properties. Args: {path, name?, muted?, looping?}",
    handler: async (args, ctx) => {
      const a = obj(args, "clip.update");
      return ctx.bridge.updateClip({
        path: str(a, "path", "clip.update"),
        name: optStr(a, "name", "clip.update"),
        muted: optBool(a, "muted", "clip.update"),
        looping: optBool(a, "looping", "clip.update"),
      });
    },
  });

  add({
    name: "clip.delete",
    description: "Delete a clip (session slot or arrangement). Args: {path}",
    handler: async (args, ctx) =>
      ctx.bridge.deleteClip(str(obj(args, "clip.delete"), "path", "clip.delete")),
  });

  add({
    name: "track.create",
    description: 'Create a track. Args: {kind: "midi"|"audio", name?}',
    handler: async (args, ctx) => {
      const a = obj(args, "track.create");
      const kind = str(a, "kind", "track.create");
      if (kind !== "midi" && kind !== "audio") {
        throw new BridgeError("bad_request", `track.create: kind must be "midi" or "audio"`);
      }
      return ctx.bridge.createTrack(kind, optStr(a, "name", "track.create"));
    },
  });

  add({
    name: "track.update",
    description: "Update track properties. Args: {path, name?, muted?, soloed?, armed?}",
    handler: async (args, ctx) => {
      const a = obj(args, "track.update");
      return ctx.bridge.updateTrack({
        path: str(a, "path", "track.update"),
        name: optStr(a, "name", "track.update"),
        muted: optBool(a, "muted", "track.update"),
        soloed: optBool(a, "soloed", "track.update"),
        armed: optBool(a, "armed", "track.update"),
      });
    },
  });

  add({
    name: "track.delete",
    description: "Delete a track. Args: {path}",
    handler: async (args, ctx) =>
      ctx.bridge.deleteTrack(str(obj(args, "track.delete"), "path", "track.delete")),
  });

  add({
    name: "track.duplicate",
    description: "Duplicate a track (inserted after the original). Args: {path}",
    handler: async (args, ctx) =>
      ctx.bridge.duplicateTrack(str(obj(args, "track.duplicate"), "path", "track.duplicate")),
  });

  add({
    name: "track.clear-range",
    description:
      "Clear arrangement clips in a beat range (overlapping clips are truncated). Args: {path, startBeat, endBeat}",
    handler: async (args, ctx) => {
      const a = obj(args, "track.clear-range");
      return ctx.bridge.clearArrangementRange(
        str(a, "path", "track.clear-range"),
        num(a, "startBeat", "track.clear-range"),
        num(a, "endBeat", "track.clear-range"),
      );
    },
  });

  add({
    name: "track.render-prefx",
    description:
      "Render an AUDIO track pre-FX to an audio file in Live's configured render format (beats range). Args: {path, startBeat, endBeat}. Returns {audioPath}",
    handler: async (args, ctx) => {
      const a = obj(args, "track.render-prefx");
      const startBeat = num(a, "startBeat", "track.render-prefx");
      const endBeat = num(a, "endBeat", "track.render-prefx");
      if (endBeat <= startBeat) {
        throw new BridgeError("bad_request", "track.render-prefx: endBeat must be > startBeat");
      }
      return ctx.bridge.renderPreFxAudio(str(a, "path", "track.render-prefx"), startBeat, endBeat);
    },
  });

  add({
    name: "track.mixer",
    description:
      "Set mixer params (RAW Live-internal values for now — dB calibration is a documented follow-up). Args: {path, volume?, pan?, sends?}",
    handler: async (args, ctx) => {
      const a = obj(args, "track.mixer");
      const parsed: Parameters<LiveBridge["setMixer"]>[0] = {
        path: str(a, "path", "track.mixer"),
      };
      const volume = optNum(a, "volume", "track.mixer");
      if (volume !== undefined) parsed.volume = volume;
      const pan = optNum(a, "pan", "track.mixer");
      if (pan !== undefined) parsed.pan = pan;
      if (a.sends !== undefined) {
        const sends = obj(a.sends, "track.mixer.sends");
        const parsedSends: Record<string, number> = {};
        for (const [k, v] of Object.entries(sends)) {
          if (typeof v !== "number") {
            throw new BridgeError("bad_request", `track.mixer: send "${k}" must be a number`);
          }
          parsedSends[k] = v;
        }
        parsed.sends = parsedSends;
      }
      return ctx.bridge.setMixer(parsed);
    },
  });

  add({
    name: "scene.create",
    description: "Create a scene. Args: {index?} (-1 or omitted appends)",
    handler: async (args, ctx) => {
      const a = args === undefined ? {} : obj(args, "scene.create");
      return ctx.bridge.createScene(optNum(a, "index", "scene.create"));
    },
  });

  add({
    name: "scene.delete",
    description: "Delete a scene. Args: {path}",
    handler: async (args, ctx) =>
      ctx.bridge.deleteScene(str(obj(args, "scene.delete"), "path", "scene.delete")),
  });

  add({
    name: "scene.duplicate",
    description: "Duplicate a scene. Args: {path}",
    handler: async (args, ctx) =>
      ctx.bridge.duplicateScene(str(obj(args, "scene.duplicate"), "path", "scene.duplicate")),
  });

  add({
    name: "device.get",
    description: "Read a device's parameters (name/value/min/max). Args: {path}",
    handler: async (args, ctx) =>
      ctx.bridge.getDevice(str(obj(args, "device.get"), "path", "device.get")),
  });

  add({
    name: "device.insert",
    description:
      'Insert a BUILT-IN Live device (e.g. "EQ Eight", "Compressor") on a track or chain. Args: {ownerPath, name, index?}',
    handler: async (args, ctx) => {
      const a = obj(args, "device.insert");
      return ctx.bridge.insertDevice(
        str(a, "ownerPath", "device.insert"),
        str(a, "name", "device.insert"),
        optNum(a, "index", "device.insert"),
      );
    },
  });

  add({
    name: "device.delete",
    description: "Delete a device. Args: {path}",
    handler: async (args, ctx) =>
      ctx.bridge.deleteDevice(str(obj(args, "device.delete"), "path", "device.delete")),
  });

  add({
    name: "device.param",
    description:
      "Set a device parameter by name (RAW value within [min, max] from device.get). Args: {path, param, value}",
    handler: async (args, ctx) => {
      const a = obj(args, "device.param");
      return ctx.bridge.setDeviceParam(
        str(a, "path", "device.param"),
        str(a, "param", "device.param"),
        num(a, "value", "device.param"),
      );
    },
  });

  add({
    name: "drum.pad-note",
    description: "Set the MIDI note a drum-rack chain responds to. Args: {chainPath, note}",
    handler: async (args, ctx) => {
      const a = obj(args, "drum.pad-note");
      return ctx.bridge.setDrumPadNote(
        str(a, "chainPath", "drum.pad-note"),
        num(a, "note", "drum.pad-note"),
      );
    },
  });

  add({
    name: "simpler.sample",
    description: "Load a sample into a Simpler. Args: {devicePath, filePath}",
    handler: async (args, ctx) => {
      const a = obj(args, "simpler.sample");
      return ctx.bridge.replaceSimplerSample(
        str(a, "devicePath", "simpler.sample"),
        str(a, "filePath", "simpler.sample"),
      );
    },
  });

  return ops;
}
