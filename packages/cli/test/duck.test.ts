import { createSocket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";
import { decodeOscMessage, encodeOscMessage } from "../src/osc.js";
import { pushDuck, shapeFromFitJson, type DuckShape, type DuckTriggerSet } from "../src/duck.js";

/** A fake AWH Ducker device: binds `port`, records every decoded message it
 * receives, and replies to /awh/duck/ping with /awh/duck/pong <version> on
 * `replyPort`. Enough to drive the real push flow end to end without Max. */
function fakeDucker(port: number, replyPort: number, version = "1"): { received: { address: string; args: (string | number)[] }[]; close: () => Promise<void> } {
  const socket = createSocket("udp4");
  const received: { address: string; args: (string | number)[] }[] = [];
  socket.on("message", (msg) => {
    const decoded = decodeOscMessage(msg);
    received.push(decoded);
    if (decoded.address === "/awh/duck/ping") {
      socket.send(encodeOscMessage("/awh/duck/pong", [version]), replyPort, "127.0.0.1");
    }
  });
  socket.bind(port, "127.0.0.1");
  return {
    received,
    close: () =>
      new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  if (cleanup) await cleanup();
  cleanup = undefined;
});

const shape: DuckShape = { attackMs: 2, holdMs: 0, releaseMs: 150, depthDb: 6 };
const triggers: DuckTriggerSet = { patternLengthBeats: 4, beats: [0, 1, 2, 3] };

describe("pushDuck — integration against a fake UDP Ducker", () => {
  it("pings, then sends triggers, shape, and on — in that order", async () => {
    const port = 39722;
    const replyPort = 39723;
    const fake = fakeDucker(port, replyPort);
    cleanup = fake.close;

    const result = await pushDuck({ port, replyPort, shape, triggers, timeoutMs: 800 });

    expect(result).toEqual({
      sent: true,
      on: true,
      port,
      replyPort,
      version: "1",
      shape,
      triggerCount: 4,
      patternLengthBeats: 4,
    });

    // pushDuck's promise resolves right after the last UDP send() callback
    // fires; give the (separate, local) receiving socket a moment to have
    // actually processed the datagrams before asserting on them.
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received.map((m) => m.address)).toEqual([
      "/awh/duck/ping",
      "/awh/duck/triggers",
      "/awh/duck/shape",
      "/awh/duck/on",
    ]);
    expect(fake.received[1]!.args).toEqual([4, 0, 1, 2, 3]);
    expect(fake.received[2]!.args).toEqual([2, 0, 150, 6]);
    expect(fake.received[3]!.args).toEqual([1]);
  });

  it("--off sends only ping + on 0", async () => {
    const port = 39724;
    const replyPort = 39725;
    const fake = fakeDucker(port, replyPort, "2");
    cleanup = fake.close;

    const result = await pushDuck({ port, replyPort, off: true, timeoutMs: 800 });

    expect(result).toEqual({ sent: true, on: false, port, replyPort, version: "2" });
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received.map((m) => m.address)).toEqual(["/awh/duck/ping", "/awh/duck/on"]);
    expect(fake.received[1]!.args).toEqual([0]);
  });

  it("zero triggers is a no-op state: nothing is sent, no ping either", async () => {
    const port = 39726;
    const replyPort = 39727;
    const fake = fakeDucker(port, replyPort);
    cleanup = fake.close;

    const result = await pushDuck({
      port,
      replyPort,
      shape,
      triggers: { patternLengthBeats: 4, beats: [] },
      timeoutMs: 800,
    });

    expect(result).toEqual({ sent: false, on: false, port, replyPort });
    // give any stray packet a moment to arrive before asserting silence
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received).toEqual([]);
  });

  it("NEGATIVE CONTROL: no listener on the port -> rejects within the timeout with a clear error", async () => {
    const port = 39728; // nothing bound here
    const replyPort = 39729;
    await expect(
      pushDuck({ port, replyPort, shape, triggers, timeoutMs: 150 }),
    ).rejects.toThrow(/AWH Ducker device|not loaded|no reply/i);
  });
});

describe("shapeFromFitJson", () => {
  it("reads a duck-fit --json shape (recommendation.*)", () => {
    const fit = {
      recommendation: {
        depth_db: 7.5,
        attack_ms: 0,
        hold_ms: 40,
        release_ms: 180,
      },
    };
    expect(shapeFromFitJson(fit)).toEqual({
      attackMs: 0,
      holdMs: 40,
      releaseMs: 180,
      depthDb: 7.5,
    });
  });

  it("rejects a file that isn't a duck-fit shape", () => {
    expect(() => shapeFromFitJson({ foo: "bar" })).toThrow(/recommendation/);
  });
});
