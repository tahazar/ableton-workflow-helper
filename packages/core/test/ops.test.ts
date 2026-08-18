import { beforeEach, describe, expect, it } from "vitest";
import { FakeLiveBridge } from "../src/fake/fakeLiveBridge.js";
import { buildOpRegistry, type OpDefinition } from "../src/bridge/ops.js";
import { BridgeError, type ClipDetail, type SetSummary } from "../src/bridge/types.js";

let bridge: FakeLiveBridge;
let ops: Map<string, OpDefinition>;

const call = (name: string, args?: unknown) => {
  const op = ops.get(name);
  if (!op) throw new Error(`unknown op ${name}`);
  return op.handler(args, { bridge });
};

beforeEach(() => {
  bridge = new FakeLiveBridge(); // 4 tracks (midi/audio alternating), 4 scenes
  ops = buildOpRegistry();
});

describe("set ops", () => {
  it("summarises the set", async () => {
    const s = (await call("set.summary")) as SetSummary;
    expect(s.tempo).toBe(128);
    expect(s.tracks).toHaveLength(4);
    expect(s.tracks[0]!.path).toBe("track:0");
    expect(s.tracks[0]!.kind).toBe("midi");
    expect(s.returnTracks).toHaveLength(1);
    expect(s.scenes).toHaveLength(4);
  });

  it("sets tempo and rejects nonsense", async () => {
    await call("set.tempo", { bpm: 140 });
    const s = (await call("set.summary")) as SetSummary;
    expect(s.tempo).toBe(140);
    await expect(call("set.tempo", { bpm: 5 })).rejects.toThrowError(BridgeError);
    await expect(call("set.tempo", {})).rejects.toThrowError(/bpm/);
  });
});

describe("MIDI clips", () => {
  it("M1 exit criterion: writes a clip into arrangement bar 33 and reads it back", async () => {
    // bar 33 in 4/4 = beat 128
    const { path } = (await call("clip.create-midi", {
      target: { type: "arrangement", trackPath: "track:0", startBeat: 128 },
      lengthBeats: 4,
      name: "bar-33 motif",
      notes: [
        { pitch: 60, start: 0, duration: 1, velocity: 100 },
        { pitch: 63, start: 1, duration: 1 },
        { pitch: 67, start: 2, duration: 2, probability: 0.8 },
      ],
    })) as { path: string };

    const clip = (await call("clip.get", { path })) as ClipDetail;
    expect(clip.startTime).toBe(128);
    expect(clip.endTime).toBe(132);
    expect(clip.name).toBe("bar-33 motif");
    expect(clip.notes).toHaveLength(3);
    expect(clip.notes![2]!.probability).toBe(0.8);
  });

  it("creates session clips and replaces notes", async () => {
    const { path } = (await call("clip.create-midi", {
      target: { type: "session", slotPath: "track:0/slot:2" },
      lengthBeats: 8,
    })) as { path: string };
    expect(path).toBe("track:0/slot:2");

    await call("clip.notes", {
      path,
      notes: [{ pitch: 36, start: 0, duration: 0.5 }],
    });
    const clip = (await call("clip.get", { path })) as ClipDetail;
    expect(clip.notes).toEqual([{ pitch: 36, start: 0, duration: 0.5 }]);
  });

  it("rejects MIDI clips on audio tracks and bad notes", async () => {
    await expect(
      call("clip.create-midi", {
        target: { type: "arrangement", trackPath: "track:1", startBeat: 0 },
        lengthBeats: 4,
      }),
    ).rejects.toThrowError(/not a MIDI track/);
    await expect(
      call("clip.create-midi", {
        target: { type: "session", slotPath: "track:0/slot:0" },
        lengthBeats: 4,
        notes: [{ pitch: 200, start: 0, duration: 1 }],
      }),
    ).rejects.toThrowError(/pitch/);
  });

  it("updates and deletes clips", async () => {
    await call("clip.create-midi", {
      target: { type: "session", slotPath: "track:0/slot:0" },
      lengthBeats: 4,
    });
    await call("clip.update", { path: "track:0/slot:0", name: "renamed", muted: true });
    const clip = (await call("clip.get", { path: "track:0/slot:0" })) as ClipDetail;
    expect(clip.name).toBe("renamed");
    expect(clip.muted).toBe(true);

    await call("clip.delete", { path: "track:0/slot:0" });
    await expect(call("clip.get", { path: "track:0/slot:0" })).rejects.toThrowError(/empty/);
  });
});

describe("arrangement range clearing", () => {
  it("deletes contained clips and truncates overlapping ones (SDK semantics)", async () => {
    const mk = (startBeat: number, lengthBeats: number) =>
      call("clip.create-midi", {
        target: { type: "arrangement", trackPath: "track:0", startBeat },
        lengthBeats,
      });
    await mk(0, 8); // overlaps range start -> truncated to [0,4)
    await mk(8, 4); // fully inside -> deleted
    await mk(14, 8); // overlaps range end -> truncated to [16,22)

    await call("track.clear-range", { path: "track:0", startBeat: 4, endBeat: 16 });

    const s = (await call("set.summary")) as SetSummary;
    const clips = s.tracks[0]!.arrangementClips;
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ startTime: 0, endTime: 4 });
    expect(clips[1]).toMatchObject({ startTime: 16, endTime: 22 });
  });
});

describe("tracks and scenes", () => {
  it("creates, renames, duplicates, deletes tracks", async () => {
    const { path } = (await call("track.create", { kind: "midi", name: "Bass" })) as {
      path: string;
    };
    expect(path).toBe("track:4");
    await call("track.update", { path, muted: true });

    const dup = (await call("track.duplicate", { path })) as { path: string };
    expect(dup.path).toBe("track:5");

    await call("track.delete", { path: "track:5" });
    const s = (await call("set.summary")) as SetSummary;
    expect(s.trackCount).toBe(5);
    expect(s.tracks[4]!.name).toBe("Bass");
    expect(s.tracks[4]!.muted).toBe(true);
  });

  it("scene create/duplicate/delete keeps slot grids in sync", async () => {
    await call("clip.create-midi", {
      target: { type: "session", slotPath: "track:0/slot:1" },
      lengthBeats: 4,
    });
    await call("scene.duplicate", { path: "scene:1" });
    const clip = (await call("clip.get", { path: "track:0/slot:2" })) as ClipDetail;
    expect(clip.kind).toBe("midi");

    await call("scene.delete", { path: "scene:0" });
    const s = (await call("set.summary")) as SetSummary;
    expect(s.sceneCount).toBe(4);
    expect(s.tracks[0]!.slotCount).toBe(4);
  });
});

describe("devices", () => {
  it("inserts devices, reads and sets params", async () => {
    const { path } = (await call("device.insert", {
      ownerPath: "track:0",
      name: "EQ Eight",
    })) as { path: string };
    expect(path).toBe("track:0/dev:0");

    const device = (await call("device.get", { path })) as {
      params: { name: string; value: number; min: number; max: number }[];
    };
    const freq = device.params.find((p) => p.name === "Freq")!;
    expect(freq).toBeDefined();

    await call("device.param", { path, param: "Freq", value: 0.25 });
    const after = (await call("device.get", { path })) as typeof device;
    expect(after.params.find((p) => p.name === "Freq")!.value).toBe(0.25);

    await expect(
      call("device.param", { path, param: "Freq", value: 99 }),
    ).rejects.toThrowError(/outside/);
    await expect(
      call("device.param", { path, param: "Nope", value: 0.5 }),
    ).rejects.toThrowError(/no param/);
  });

  it("supports drum racks: chains, pad notes, nested devices", async () => {
    const { path } = (await call("device.insert", {
      ownerPath: "track:0",
      name: "Drum Rack",
    })) as { path: string };
    bridge.addDrumChain(path, "Kick", 36);
    bridge.addDrumChain(path, "Snare", 38);

    await call("drum.pad-note", { chainPath: `${path}/chain:1`, note: 39 });
    const detail = (await call("device.get", { path })) as {
      drumPads: { note: number; name: string }[];
    };
    expect(detail.drumPads.map((p) => p.note)).toEqual([36, 39]);

    const nested = (await call("device.insert", {
      ownerPath: `${path}/chain:0`,
      name: "Simpler",
    })) as { path: string };
    await call("simpler.sample", { devicePath: nested.path, filePath: "/tmp/kick.wav" });
  });

  it("sets mixer values", async () => {
    await call("track.mixer", { path: "track:0", volume: 0.7, pan: -0.5, sends: { "0": 0.3 } });
    await expect(
      call("track.mixer", { path: "track:0", sends: { "9": 0.1 } }),
    ).rejects.toThrowError(/no send/);
  });
});

describe("audio clips", () => {
  it("places audio on audio tracks only", async () => {
    const { path } = (await call("clip.create-audio", {
      trackPath: "track:1",
      filePath: "/samples/loop.wav",
      startBeat: 16,
      durationBeats: 8,
    })) as { path: string };
    const clip = (await call("clip.get", { path })) as ClipDetail;
    expect(clip.kind).toBe("audio");
    expect(clip.filePath).toBe("/samples/loop.wav");

    await expect(
      call("clip.create-audio", { trackPath: "track:0", filePath: "/x.wav", startBeat: 0 }),
    ).rejects.toThrowError(/not an audio track/);
  });
});

describe("library.outbox", () => {
  it("drains right-click captures once (drain clears)", async () => {
    const bridge = new FakeLiveBridge();
    const registry = buildOpRegistry();
    const outboxOp = registry.get("library.outbox")!;
    bridge.addOutboxEntry({
      name: "Captured Hats",
      notes: [{ pitch: 42, start: 0, duration: 0.25, velocity: 90 }],
      lengthBeats: 4,
      looping: true,
      tempo: 128,
      scale: { rootNote: 9, name: "Minor", active: true },
      capturedAt: "2026-08-18T00:00:00.000Z",
    });
    const first = (await outboxOp.handler({}, { bridge })) as unknown[];
    expect(first).toHaveLength(1);
    const second = (await outboxOp.handler({}, { bridge })) as unknown[];
    expect(second).toHaveLength(0);
  });
});
