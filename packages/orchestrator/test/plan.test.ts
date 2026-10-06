import { describe, expect, it } from "vitest";
import { applyRecord, extractItem, extractSection } from "../src/plan.js";

const PLAN = `# Plan

## Ground rules for every commit

- one change per commit

## Track L

L1. \`build: one\` (done)
    Record of one.
L10. \`build: ten\`
    First line.

    Second paragraph.

L11. \`build: eleven\`
    Body.

## Phase 1

5. \`test: five\`
   Body of five.
`;

describe("extractItem", () => {
  it("returns the item with its indented continuation, not trailing blanks", () => {
    expect(extractItem(PLAN, "L10")).toBe(
      "L10. `build: ten`\n    First line.\n\n    Second paragraph.",
    );
  });

  it("does not match a longer id that starts the same way", () => {
    expect(extractItem(PLAN, "L1")).toBe("L1. `build: one` (done)\n    Record of one.");
  });

  it("returns undefined for a missing item", () => {
    expect(extractItem(PLAN, "L99")).toBeUndefined();
  });
});

describe("extractSection", () => {
  it("returns the body up to the next heading", () => {
    expect(extractSection(PLAN, "Ground rules for every commit")).toBe("- one change per commit");
    expect(extractSection(PLAN, "Missing")).toBeUndefined();
  });
});

describe("applyRecord", () => {
  it("replaces only the item", () => {
    const out = applyRecord(PLAN, "L10", "L10. `build: ten` (done)\n    Did it.\n");
    expect(extractItem(out, "L10")).toBe("L10. `build: ten` (done)\n    Did it.");
    expect(extractItem(out, "L11")).toBe(extractItem(PLAN, "L11"));
    expect(out).toContain("    Did it.\n\nL11.");
  });

  it("rejects a record for another item and a missing item", () => {
    expect(() => applyRecord(PLAN, "L10", "L11. x")).toThrow(/must start with "L10. "/);
    expect(() => applyRecord(PLAN, "L99", "L99. x")).toThrow(/not found/);
  });
});
