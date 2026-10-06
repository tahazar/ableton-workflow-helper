import { createSocket, type Socket } from "node:dgram";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGatewayServer,
  FakeLiveBridge,
  LibraryStore,
  type ClipEntry,
  type GatewayServer,
} from "@awh/core";
import { decodeOscMessage, encodeOscMessage, oscFloat } from "../src/osc.js";
import type { OpCaller } from "../src/op.js";
import {
  auditionEnd,
  auditionSlug,
  parseLaunchTarget,
  remoteFire,
  remoteJump,
  remotePing,
  remotePlay,
  remoteScene,
  remoteStop,
  remoteStopClips,
} from "../src/remote.js";

/**
 * AWH Remote (m4l/) verification: OSC byte checks for the replying messages,
 * integration against a fake UDP device (records the message sequence,
 * replies pong v2 + status/error), a negative control (no listener -> clear
 * error, fast, no hang), and `lib audition` end-to-end against a real fake
 * gateway (serve-fake style) and a fake UDP device together, as in
 * duck.test.ts/op.test.ts. docs/design/live-remote.md is the spec.
 */

// ---------------------------------------------------------------------------
// OSC byte checks (independent reference encoder, same discipline as
// packages/cli/test/osc.test.ts, not a tautological re-use of encodeOscMessage).
// ---------------------------------------------------------------------------

function padTo4(buf: Buffer): Buffer {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}
function refString(s: string): Buffer {
  return padTo4(Buffer.concat([Buffer.from(s, "ascii"), Buffer.alloc(1)]));
}
type TaggedArg =
  | { tag: "i"; value: number }
  | { tag: "f"; value: number }
  | { tag: "s"; value: string };
function refEncode(address: string, args: TaggedArg[]): Buffer {
  const parts: Buffer[] = [refString(address), refString(`,${args.map((a) => a.tag).join("")}`)];
  for (const a of args) {
    if (a.tag === "s") {
      parts.push(refString(a.value));
    } else {
      const b = Buffer.alloc(4);
      if (a.tag === "i") b.writeInt32BE(a.value);
      else b.writeFloatBE(a.value);
      parts.push(b);
    }
  }
  return Buffer.concat(parts);
}

describe("AWH Remote OSC byte checks", () => {
  it("/awh/fire <trackIdx> <slotIdx> — two plain ints", () => {
    const got = encodeOscMessage("/awh/fire", [2, 5]);
    const want = refEncode("/awh/fire", [
      { tag: "i", value: 2 },
      { tag: "i", value: 5 },
    ]);
    expect(got).toEqual(want);
  });

  it("/awh/scene <sceneIdx> — one plain int", () => {
    const got = encodeOscMessage("/awh/scene", [1]);
    const want = refEncode("/awh/scene", [{ tag: "i", value: 1 }]);
    expect(got).toEqual(want);
  });

  it("/awh/stopclips <trackIdx> — supports -1 (all)", () => {
    const got = encodeOscMessage("/awh/stopclips", [-1]);
    const want = refEncode("/awh/stopclips", [{ tag: "i", value: -1 }]);
    expect(got).toEqual(want);
  });

  it("/awh/jump <beats> — forced float even at a whole-number value", () => {
    const got = encodeOscMessage("/awh/jump", [oscFloat(32)]);
    const want = refEncode("/awh/jump", [{ tag: "f", value: 32 }]);
    expect(got).toEqual(want);
  });
});

// ---------------------------------------------------------------------------
// Fake AWH Remote device (integration + negative control)
// ---------------------------------------------------------------------------

interface FakeRemote {
  received: { address: string; args: (string | number)[] }[];
  rawFireBuffer?: Buffer;
  close: () => Promise<void>;
}

/** Binds `port`, records every decoded message, and replies like the real
 *  device: ping -> pong <version>; fire/scene/stopclips/jump -> status
 *  <action> <args...> (or error, when `errorOn` names that action). */
function fakeRemote(
  port: number,
  replyPort: number,
  opts: { version?: string; errorOn?: string } = {},
): FakeRemote {
  const version = opts.version ?? "2";
  const socket: Socket = createSocket("udp4");
  const received: FakeRemote["received"] = [];
  let rawFireBuffer: Buffer | undefined;
  socket.on("message", (msg) => {
    const decoded = decodeOscMessage(msg);
    received.push(decoded);
    if (decoded.address === "/awh/fire") rawFireBuffer = Buffer.from(msg);
    if (decoded.address === "/awh/ping") {
      socket.send(encodeOscMessage("/awh/pong", [version]), replyPort, "127.0.0.1");
      return;
    }
    const action = decoded.address.replace("/awh/", "");
    if (["fire", "scene", "stopclips", "jump"].includes(action)) {
      if (opts.errorOn === action) {
        socket.send(
          encodeOscMessage("/awh/error", [`bad ${action} index`]),
          replyPort,
          "127.0.0.1",
        );
      } else {
        socket.send(
          encodeOscMessage("/awh/status", [action, ...decoded.args]),
          replyPort,
          "127.0.0.1",
        );
      }
    }
  });
  socket.bind(port, "127.0.0.1");
  return {
    received,
    get rawFireBuffer() {
      return rawFireBuffer;
    },
    close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  if (cleanup) await cleanup();
  cleanup = undefined;
});

describe("remote.ts — integration against a fake UDP AWH Remote device", () => {
  it("remotePing resolves with the reported version", async () => {
    const port = 39820;
    const replyPort = 39821;
    const fake = fakeRemote(port, replyPort, { version: "2" });
    cleanup = fake.close;
    await expect(remotePing({ port, replyPort, timeoutMs: 800 })).resolves.toBe("2");
  });

  it("remotePlay pings then sends /awh/play 1 (no --from-bar: no jump sent)", async () => {
    const port = 39822;
    const replyPort = 39823;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;
    const result = await remotePlay({ port, replyPort, timeoutMs: 800 });
    expect(result.jumped).toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received.map((m) => m.address)).toEqual(["/awh/ping", "/awh/play"]);
    expect(fake.received[1]!.args).toEqual([1]);
  });

  it("remotePlay with fromBeats: ping -> jump (awaits status) -> play 1", async () => {
    const port = 39824;
    const replyPort = 39825;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;
    const result = await remotePlay({ port, replyPort, timeoutMs: 800, fromBeats: 32 });
    expect(result.jumped).toEqual(["jump", 32]);
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received.map((m) => m.address)).toEqual([
      "/awh/ping",
      "/awh/ping",
      "/awh/jump",
      "/awh/play",
    ]);
    expect(fake.received[3]!.args).toEqual([1]);
  });

  it("remoteStop pings then sends /awh/play 0", async () => {
    const port = 39826;
    const replyPort = 39827;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;
    await remoteStop({ port, replyPort, timeoutMs: 800 });
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received.map((m) => m.address)).toEqual(["/awh/ping", "/awh/play"]);
    expect(fake.received[1]!.args).toEqual([0]);
  });

  it("remoteJump awaits /awh/status jump <beats>", async () => {
    const port = 39828;
    const replyPort = 39829;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;
    const reply = await remoteJump({ beats: 64, port, replyPort, timeoutMs: 800 });
    expect(reply).toEqual(["jump", 64]);
  });

  it("remoteFire sends the exact byte-checked message and awaits status", async () => {
    const port = 39830;
    const replyPort = 39831;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;
    const reply = await remoteFire({ trackIdx: 2, slotIdx: 5, port, replyPort, timeoutMs: 800 });
    expect(reply).toEqual(["fire", 2, 5]);
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.rawFireBuffer).toEqual(
      refEncode("/awh/fire", [
        { tag: "i", value: 2 },
        { tag: "i", value: 5 },
      ]),
    );
  });

  it("remoteScene awaits /awh/status scene <sceneIdx>", async () => {
    const port = 39832;
    const replyPort = 39833;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;
    const reply = await remoteScene({ sceneIdx: 1, port, replyPort, timeoutMs: 800 });
    expect(reply).toEqual(["scene", 1]);
  });

  it("remoteStopClips(-1) means the whole Set", async () => {
    const port = 39834;
    const replyPort = 39835;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;
    const reply = await remoteStopClips({ trackIdx: -1, port, replyPort, timeoutMs: 800 });
    expect(reply).toEqual(["stopclips", -1]);
  });

  it("bad indices: an /awh/error reply is thrown as a clear Error, not swallowed", async () => {
    const port = 39836;
    const replyPort = 39837;
    const fake = fakeRemote(port, replyPort, { errorOn: "fire" });
    cleanup = fake.close;
    await expect(
      remoteFire({ trackIdx: 99, slotIdx: 0, port, replyPort, timeoutMs: 800 }),
    ).rejects.toThrow(/bad fire index/i);
  });

  it("NEGATIVE CONTROL: no listener on the port -> rejects within the timeout, fast, with a clear error", async () => {
    const port = 39838; // nothing bound here
    const replyPort = 39839;
    const start = Date.now();
    await expect(remotePing({ port, replyPort, timeoutMs: 150 })).rejects.toThrow(
      /AWH Remote device|no reply/i,
    );
    expect(Date.now() - start).toBeLessThan(1000); // fast, no hang
  });

  it("NEGATIVE CONTROL: remoteFire with no listener also fails clearly and fast", async () => {
    const port = 39840;
    const replyPort = 39841;
    const start = Date.now();
    await expect(
      remoteFire({ trackIdx: 0, slotIdx: 0, port, replyPort, timeoutMs: 150 }),
    ).rejects.toThrow(/AWH Remote device|no reply/i);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("parseLaunchTarget", () => {
  it("parses a fire target (track:N/slot:M)", () => {
    expect(parseLaunchTarget("track:2/slot:5")).toEqual({ kind: "fire", trackIdx: 2, slotIdx: 5 });
  });
  it("parses a scene target (scene:N)", () => {
    expect(parseLaunchTarget("scene:1")).toEqual({ kind: "scene", sceneIdx: 1 });
  });
  it("rejects anything else", () => {
    expect(() => parseLaunchTarget("track:2")).toThrow(/awh launch needs a target/);
    expect(() => parseLaunchTarget("bogus")).toThrow(/awh launch needs a target/);
  });
});

// ---------------------------------------------------------------------------
// `awh lib audition` end-to-end: real fake gateway (serve-fake style) + a
// fake UDP AWH Remote device running together.
// ---------------------------------------------------------------------------

interface GatewayBody {
  result?: unknown;
  error?: string;
  message?: string;
}

let server: GatewayServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function startFakeGateway(): Promise<OpCaller> {
  server = createGatewayServer(new FakeLiveBridge(), { port: 0 });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;
  return async (name, args) => {
    const res = await fetch(`${base}/api/ops/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: args === undefined ? undefined : JSON.stringify(args),
    });
    const body = (await res.json()) as GatewayBody;
    if (!res.ok) {
      throw new Error(`${body.error ?? "gateway error"}${body.message ? `: ${body.message}` : ""}`);
    }
    return body.result;
  };
}

const KICK_SOURCE = {
  slug: "kick-verified",
  notation: "1|1 C1 1/4 v100",
  lengthBeats: 4,
  beatsPerBar: 4,
};

describe("auditionSlug/auditionEnd — end-to-end (fake gateway + fake UDP device)", () => {
  it("places into an empty slot on track:0 and fires it", async () => {
    const caller = await startFakeGateway();
    const port = 39850;
    const replyPort = 39851;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;

    const result = await auditionSlug({
      caller,
      source: KICK_SOURCE,
      trackPath: "track:0",
      osc: { port, replyPort, timeoutMs: 800 },
    });

    expect(result.trackIdx).toBe(0);
    expect(result.slotIdx).toBe(0);
    expect(result.path).toBe("track:0/slot:0");
    expect(result.name).toBe("audition: kick-verified");
    expect(result.swept).toBeUndefined();
    expect(result.nextPending).toEqual({
      trackPath: "track:0",
      name: "audition: kick-verified",
      slug: "kick-verified",
    });

    // The clip was created: read it back via the same gateway.
    const clip = (await caller("clip.get", { path: "track:0/slot:0" })) as {
      name: string;
      notes: unknown[];
    };
    expect(clip.name).toBe("audition: kick-verified");
    expect(clip.notes).toHaveLength(1);

    // fired over OSC with the right indices.
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received.map((m) => m.address)).toEqual(["/awh/ping", "/awh/fire"]);
    expect(fake.received[1]!.args).toEqual([0, 0]);
  });

  it("--keep: nextPending is undefined (nothing to auto-sweep)", async () => {
    const caller = await startFakeGateway();
    const port = 39852;
    const replyPort = 39853;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;

    const result = await auditionSlug({
      caller,
      source: KICK_SOURCE,
      trackPath: "track:0",
      keep: true,
      osc: { port, replyPort, timeoutMs: 800 },
    });
    expect(result.nextPending).toBeUndefined();
  });

  it("auditioning the next slug sweeps the previous one by its EXACT name", async () => {
    const caller = await startFakeGateway();
    const port = 39854;
    const replyPort = 39855;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;

    // A same-prefix (but not exact-name) clip must survive the sweep.
    await caller("clip.create-midi", {
      target: { type: "session", slotPath: "track:0/slot:3" },
      lengthBeats: 4,
      notes: [{ pitch: 60, start: 0, duration: 1 }],
      name: "audition: kick-verified-longer-name",
    });

    const first = await auditionSlug({
      caller,
      source: KICK_SOURCE,
      trackPath: "track:0",
      osc: { port, replyPort, timeoutMs: 800 },
    });
    expect(first.path).toBe("track:0/slot:0");

    const second = await auditionSlug({
      caller,
      source: { ...KICK_SOURCE, slug: "snare-draft" },
      trackPath: "track:0",
      pending: first.nextPending,
      osc: { port, replyPort, timeoutMs: 800 },
    });

    expect(second.swept).toEqual(["track:0/slot:0"]);
    // Sweeping freed slot:0 and the second audition reclaimed it
    // (sweep-before-place makes that possible), so slot:0 now holds the new
    // clip, not the old one.
    expect(second.path).toBe("track:0/slot:0");
    const nowThere = (await caller("clip.get", { path: "track:0/slot:0" })) as { name: string };
    expect(nowThere.name).toBe("audition: snare-draft");
    // ...the prefix-similar clip survives untouched (never a prefix sweep).
    const survivor = (await caller("clip.get", { path: "track:0/slot:3" })) as { name: string };
    expect(survivor.name).toBe("audition: kick-verified-longer-name");
  });

  it("--end sweeps the pending audition and reports what was swept", async () => {
    const caller = await startFakeGateway();
    const port = 39856;
    const replyPort = 39857;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;

    const placed = await auditionSlug({
      caller,
      source: KICK_SOURCE,
      trackPath: "track:0",
      osc: { port, replyPort, timeoutMs: 800 },
    });
    const swept = await auditionEnd({ caller, pending: placed.nextPending });
    expect(swept).toEqual(["track:0/slot:0"]);
    await expect(caller("clip.get", { path: "track:0/slot:0" })).rejects.toThrow(/slot is empty/);
  });

  it("--end with nothing pending is a STATE, not an error (undefined, no gateway calls)", async () => {
    const caller = await startFakeGateway();
    const swept = await auditionEnd({ caller, pending: undefined });
    expect(swept).toBeUndefined();
  });

  it("ZERO-EMPTY-SLOTS: throws a clear error instead of silently overwriting", async () => {
    const caller = await startFakeGateway();
    const port = 39858;
    const replyPort = 39859;
    const fake = fakeRemote(port, replyPort);
    cleanup = fake.close;

    // FakeLiveBridge's default track:0 has 4 session slots; fill them all.
    for (let i = 0; i < 4; i++) {
      await caller("clip.create-midi", {
        target: { type: "session", slotPath: `track:0/slot:${i}` },
        lengthBeats: 4,
        notes: [{ pitch: 60, start: 0, duration: 1 }],
        name: `filler-${i}`,
      });
    }

    await expect(
      auditionSlug({
        caller,
        source: KICK_SOURCE,
        trackPath: "track:0",
        osc: { port, replyPort, timeoutMs: 800 },
      }),
    ).rejects.toThrow(/no empty session slot/i);

    // Nothing was fired: the failure happened before any OSC traffic.
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received).toEqual([]);
  });

  it("rejects a non-track target (session-clip fire needs a plain track path)", async () => {
    const caller = await startFakeGateway();
    await expect(
      auditionSlug({ caller, source: KICK_SOURCE, trackPath: "return:0" }),
    ).rejects.toThrow(/plain track path/i);
  });

  it("placed but not fired: no listener -> clear error, clip stays placed (not lost)", async () => {
    const caller = await startFakeGateway();
    const result = await auditionSlug({
      caller,
      source: KICK_SOURCE,
      trackPath: "track:0",
      osc: { port: 39860, replyPort: 39861, timeoutMs: 150 }, // nothing listening
    }).catch((err: Error) => err);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/could not fire it/i);
    // The clip was still created: an OSC failure doesn't lose the placement.
    const clip = (await caller("clip.get", { path: "track:0/slot:0" })) as { name: string };
    expect(clip.name).toBe("audition: kick-verified");
  });
});

describe("UNKNOWN-SLUG state: LibraryStore.loadClip on a nonexistent slug", () => {
  it("throws a clear, greppable error (same as `lib place`'s convention)", async () => {
    const root = await mkdtemp(join(tmpdir(), "awh-audition-lib-"));
    try {
      const store = new LibraryStore(root);
      const entry: ClipEntry = {
        slug: "kick-verified",
        kind: "midi",
        category: "kicks",
        tags: [],
        lengthBeats: 4,
        tier: "verified",
        title: "Kick",
        notation: "1|1 C1 1/4 v100",
      };
      await store.saveClip(entry);
      await expect(store.loadClip("no-such-slug")).rejects.toThrow(/No library clip with slug/);
      // the real slug still resolves fine (sanity check the fixture is valid).
      await expect(store.loadClip("kick-verified")).resolves.toMatchObject({
        slug: "kick-verified",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
