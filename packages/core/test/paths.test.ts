import { describe, expect, it } from "vitest";
import { parsePath, formatPath } from "../src/bridge/paths.js";
import { BridgeError } from "../src/bridge/types.js";

describe("path parsing", () => {
  it("round-trips valid paths", () => {
    for (const path of [
      "track:0",
      "return:1",
      "main",
      "scene:3",
      "track:2/slot:4",
      "track:2/arr:0",
      "track:2/lane:1",
      "track:0/dev:1",
      "track:0/dev:0/chain:3",
      "track:0/dev:0/chain:3/dev:1",
    ]) {
      expect(formatPath(parsePath(path))).toBe(path);
    }
  });

  it("rejects malformed paths", () => {
    for (const path of ["", "track", "track:x", "slot:1", "track:1/main", "bogus:0", "track:1/track:2"]) {
      expect(() => parsePath(path), path).toThrowError(BridgeError);
    }
  });
});
