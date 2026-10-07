import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeStore, type DeviceDetail, type OperatorRecipe } from "@awh/core";
import {
  applyRecipePlan,
  planRecipeApply,
  setDeviceParam,
  summarizeRecipeEntries,
  type OpCaller,
} from "../src/op.js";
import { startFakeGateway } from "./helpers.js";

/**
 * Fake-Operator apply engine tests (against a real gateway server backed by
 * FakeLiveBridge, as in packages/core/test/server.test.ts) and `op recipes`
 * listing tests (against an isolated tmp KnowledgeStore, as in
 * packages/core/test/knowledge.test.ts). See docs/design/
 * operator-assistant.md's verification bar.
 */

async function insertOperator(caller: OpCaller): Promise<string> {
  const inserted = (await caller("device.insert", { ownerPath: "track:0", name: "Operator" })) as {
    path: string;
  };
  return inserted.path;
}

describe("op apply engine (fake Operator device, real naming style)", () => {
  it("happy path: validates, writes every param, reads back — all matched", async () => {
    const { caller } = await startFakeGateway();
    const devicePath = await insertOperator(caller);
    const recipe: OperatorRecipe = {
      name: "test-growl",
      device: "Operator",
      params: { Algorithm: 0.2, "Osc-A Coarse": 0.6, "Ae Attack": 0.1 },
    };
    const detail = (await caller("device.get", { path: devicePath })) as DeviceDetail;
    const plan = planRecipeApply(detail, recipe, devicePath);
    expect(plan.unknownParams).toEqual([]);
    expect(plan.moves).toHaveLength(3);

    const results = await applyRecipePlan(caller, plan);
    expect(results.every((r) => r.matched)).toBe(true);
    expect(results.map((r) => r.param).toSorted()).toEqual([
      "Ae Attack",
      "Algorithm",
      "Osc-A Coarse",
    ]);

    const after = (await caller("device.get", { path: devicePath })) as DeviceDetail;
    const byName = new Map(after.params.map((p) => [p.name, p.value]));
    expect(byName.get("Algorithm")).toBe(0.2);
    expect(byName.get("Osc-A Coarse")).toBe(0.6);
    expect(byName.get("Ae Attack")).toBe(0.1);
  });

  it("unknown param name: fails loudly and writes NOTHING (zero param changes)", async () => {
    const { caller } = await startFakeGateway();
    const devicePath = await insertOperator(caller);
    const before = (await caller("device.get", { path: devicePath })) as DeviceDetail;
    const beforeValues = new Map(before.params.map((p) => [p.name, p.value]));

    // "Osc-A Corase" is a typo for "Osc-A Coarse". Instead of skipping that
    // one param while writing the rest, the whole apply is refused.
    const recipe: OperatorRecipe = {
      name: "typo-recipe",
      device: "Operator",
      params: { "Osc-A Corase": 0.5, Volume: 0.9 },
    };
    const plan = planRecipeApply(before, recipe, devicePath);
    expect(plan.unknownParams).toEqual(["Osc-A Corase"]);
    expect(plan.moves).toEqual([]); // planRecipeApply itself computes zero moves on any unknown

    await expect(applyRecipePlan(caller, plan)).rejects.toThrow(/Osc-A Corase/);

    const after = (await caller("device.get", { path: devicePath })) as DeviceDetail;
    for (const p of after.params) {
      expect(p.value).toBe(beforeValues.get(p.name));
    }
  });

  it("dry-run: planRecipeApply computes the moves without any I/O", async () => {
    const { caller } = await startFakeGateway();
    const devicePath = await insertOperator(caller);
    const before = (await caller("device.get", { path: devicePath })) as DeviceDetail;
    const beforeVolume = before.params.find((p) => p.name === "Volume")!.value;

    const recipe: OperatorRecipe = {
      name: "dry-run-recipe",
      device: "Operator",
      params: { Volume: beforeVolume + 0.05 },
    };
    const plan = planRecipeApply(before, recipe, devicePath);
    expect(plan.moves).toEqual([{ param: "Volume", from: beforeVolume, to: beforeVolume + 0.05 }]);

    // dry-run never calls applyRecipePlan; confirm the live value is
    // untouched.
    const after = (await caller("device.get", { path: devicePath })) as DeviceDetail;
    expect(after.params.find((p) => p.name === "Volume")!.value).toBe(beforeVolume);
  });

  it("typed setDeviceParam wrapper sends the exact {path, param, value} shape", async () => {
    const { caller } = await startFakeGateway();
    const devicePath = await insertOperator(caller);
    await setDeviceParam(caller, devicePath, "Filter Freq", 0.33);
    const after = (await caller("device.get", { path: devicePath })) as DeviceDetail;
    expect(after.params.find((p) => p.name === "Filter Freq")!.value).toBeCloseTo(0.33);
  });

  it("mismatch reporting: a value outside the device's raw range fails at the gateway, not silently", async () => {
    const { caller } = await startFakeGateway();
    const devicePath = await insertOperator(caller);
    const before = (await caller("device.get", { path: devicePath })) as DeviceDetail;
    const recipe: OperatorRecipe = {
      name: "out-of-range",
      device: "Operator",
      params: { Volume: 5.0 },
    };
    const plan = planRecipeApply(before, recipe, devicePath);
    await expect(applyRecipePlan(caller, plan)).rejects.toThrow(/outside \[/);
  });
});

describe("op recipes listing (summarizeRecipeEntries)", () => {
  let base: string;
  let store: KnowledgeStore;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "awh-op-recipes-"));
    store = new KnowledgeStore(join(base, "knowledge"));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("zero entries is a state, not an error", async () => {
    const entries = await store.listEntries();
    expect(summarizeRecipeEntries(entries)).toEqual([]);
  });

  it("summarizes a saved operator-recipe-* entry: slug, tier, param count, playNotes", async () => {
    await store.saveEntry({
      slug: "operator-recipe-growl-bass",
      topic: "sound-design",
      tier: "draft",
      tags: ["operator", "bass"],
      sources: ["own analysis"],
      related: [],
      title: "Growl bass",
      body: [
        "## Executable",
        "```awh-operator-patch",
        "name: growl-bass",
        "device: Operator",
        "params:",
        "  Algorithm: 0.2",
        '  "Osc-A Coarse": 0.6',
        'playNotes: "1|1 F1 1 v110"',
        "```",
        "",
        "## The rule",
        "growl bass recipe",
      ].join("\n"),
    });

    const entries = await store.listEntries();
    expect(summarizeRecipeEntries(entries)).toEqual([
      {
        slug: "operator-recipe-growl-bass",
        title: "Growl bass",
        tier: "draft",
        paramCount: 2,
        hasPlayNotes: true,
      },
    ]);
  });

  it("ignores knowledge entries that aren't operator-recipe-* (no false positives)", async () => {
    await store.saveEntry({
      slug: "drum-style-house",
      topic: "rhythm",
      tier: "verified",
      tags: [],
      sources: [],
      related: [],
      title: "House style",
      body: "## Executable\nn/a\n\n## The rule\nnot a recipe",
    });
    expect(summarizeRecipeEntries(await store.listEntries())).toEqual([]);
  });

  it("throws loudly on an operator-recipe-* entry with a missing patch block (data bug, not a skip)", async () => {
    await store.saveEntry({
      slug: "operator-recipe-broken",
      topic: "sound-design",
      tier: "draft",
      tags: [],
      sources: [],
      related: [],
      title: "Broken recipe",
      body: "## Executable\n(forgot the fenced block)\n\n## The rule\nn/a",
    });
    await expect(async () => summarizeRecipeEntries(await store.listEntries())).rejects.toThrow(
      /no ```awh-operator-patch block/,
    );
  });
});
