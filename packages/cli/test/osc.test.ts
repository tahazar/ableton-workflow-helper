import { describe, expect, it } from "vitest";
import { decodeOscMessage, encodeOscMessage, oscFloat } from "../src/osc.js";

/**
 * Independent reference encoder: builds OSC bytes from scratch (not by
 * calling encodeOscMessage) so the tests are a real byte-check, not a
 * tautology. Mirrors the OSC 1.0 spec: null-terminated strings padded to a
 * 4-byte boundary, then typed args in address order.
 */
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

describe("encodeOscMessage", () => {
  it("byte-checks a single int arg (/awh/duck/on 1)", () => {
    const got = encodeOscMessage("/awh/duck/on", [1]);
    const want = refEncode("/awh/duck/on", [{ tag: "i", value: 1 }]);
    expect(got).toEqual(want);
    expect(got.length).toBe(24); // "/awh/duck/on\0\0\0\0" (16) + ",i\0\0" (4) + int32 (4)
  });

  it("byte-checks all-float args, forced via oscFloat (/awh/duck/shape)", () => {
    // attackMs/holdMs/releaseMs/depthDb are all whole numbers here. Without
    // oscFloat() the plain-number heuristic would tag them 'i', but the
    // Ducker protocol requires floats (m4l/README.md), so duck.ts always
    // wraps these in oscFloat().
    const got = encodeOscMessage("/awh/duck/shape", [
      oscFloat(2),
      oscFloat(0),
      oscFloat(150),
      oscFloat(6),
    ]);
    const want = refEncode("/awh/duck/shape", [
      { tag: "f", value: 2 },
      { tag: "f", value: 0 },
      { tag: "f", value: 150 },
      { tag: "f", value: 6 },
    ]);
    expect(got).toEqual(want);
  });

  it("byte-checks a variable-length float list (/awh/duck/triggers)", () => {
    const beats = [4, 0, 1, 2, 3];
    const got = encodeOscMessage("/awh/duck/triggers", beats.map(oscFloat));
    const want = refEncode(
      "/awh/duck/triggers",
      beats.map((v) => ({ tag: "f" as const, value: v })),
    );
    expect(got).toEqual(want);
  });

  it("byte-checks a mixed int/float/string arg list (status-style reply)", () => {
    // on(int) attackMs(forced float, whole) name(string) depthDb(auto float,
    // non-integer): exercises all three tag paths in one message.
    const got = encodeOscMessage("/awh/duck/status", [1, oscFloat(2), "kick-bus", 6.5]);
    const want = refEncode("/awh/duck/status", [
      { tag: "i", value: 1 },
      { tag: "f", value: 2 },
      { tag: "s", value: "kick-bus" },
      { tag: "f", value: 6.5 },
    ]);
    expect(got).toEqual(want);
  });

  it("byte-checks a message with no args", () => {
    const got = encodeOscMessage("/awh/duck/ping", []);
    const want = refEncode("/awh/duck/ping", []);
    expect(got).toEqual(want);
  });
});

describe("decodeOscMessage", () => {
  it("round-trips a mixed int/float/string message", () => {
    const buf = encodeOscMessage("/awh/duck/status", [1, oscFloat(2), "kick-bus", 6.5]);
    const decoded = decodeOscMessage(buf);
    expect(decoded.address).toBe("/awh/duck/status");
    expect(decoded.args).toEqual([1, 2, "kick-bus", 6.5]);
  });

  it("round-trips a variable-length float trigger list", () => {
    const beats = [4, 0, 1, 2, 3];
    const buf = encodeOscMessage("/awh/duck/triggers", beats.map(oscFloat));
    const decoded = decodeOscMessage(buf);
    expect(decoded.address).toBe("/awh/duck/triggers");
    expect(decoded.args).toEqual(beats);
  });

  it("round-trips a bare address with no args", () => {
    const buf = encodeOscMessage("/awh/duck/ping", []);
    const decoded = decodeOscMessage(buf);
    expect(decoded).toEqual({ address: "/awh/duck/ping", args: [] });
  });

  it("decodes the pong reply shape", () => {
    const buf = encodeOscMessage("/awh/duck/pong", ["1"]);
    const decoded = decodeOscMessage(buf);
    expect(decoded).toEqual({ address: "/awh/duck/pong", args: ["1"] });
  });
});
