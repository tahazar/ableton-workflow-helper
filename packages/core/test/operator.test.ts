import { describe, expect, it } from "vitest";
import { parseOperatorRecipe } from "../src/operator/recipe.js";

const GOOD = `
name: growl-bass
device: Operator
params:
  Algorithm: 0.09
  "Osc-A Coarse": 0.5
  "Ae Attack": 0.0
playNotes: "1|1 F1 1 v110"
`;

describe("parseOperatorRecipe", () => {
  it("parses a well-formed recipe", () => {
    const recipe = parseOperatorRecipe(GOOD);
    expect(recipe).toEqual({
      name: "growl-bass",
      device: "Operator",
      params: { Algorithm: 0.09, "Osc-A Coarse": 0.5, "Ae Attack": 0.0 },
      playNotes: "1|1 F1 1 v110",
    });
  });

  it("playNotes is optional", () => {
    const recipe = parseOperatorRecipe(`
name: pluck
device: Operator
params:
  Volume: 0.7
`);
    expect(recipe.playNotes).toBeUndefined();
  });

  it("rejects an unknown top-level key (typo protection)", () => {
    expect(() =>
      parseOperatorRecipe(`
name: growl-bass
device: Operator
prams:
  Algorithm: 0.09
`),
    ).toThrowError(/unknown field "prams"/);
  });

  it("rejects a missing name", () => {
    expect(() =>
      parseOperatorRecipe(`
device: Operator
params:
  Algorithm: 0.09
`),
    ).toThrowError(/"name" must be a non-empty string/);
  });

  it("rejects a missing device", () => {
    expect(() =>
      parseOperatorRecipe(`
name: growl-bass
params:
  Algorithm: 0.09
`),
    ).toThrowError(/"device" must be a non-empty string/);
  });

  it("rejects params that isn't a mapping", () => {
    expect(() =>
      parseOperatorRecipe(`
name: growl-bass
device: Operator
params: []
`),
    ).toThrowError(/"params" must be a mapping/);
  });

  it("rejects an empty params map", () => {
    expect(() =>
      parseOperatorRecipe(`
name: growl-bass
device: Operator
params: {}
`),
    ).toThrowError(/at least one entry/);
  });

  it("rejects a non-numeric param value (typo protection: display string instead of raw)", () => {
    expect(() =>
      parseOperatorRecipe(`
name: growl-bass
device: Operator
params:
  Algorithm: "0.09"
`),
    ).toThrowError(/params\["Algorithm"\] must be a number/);
  });

  it("rejects a blank playNotes", () => {
    expect(() =>
      parseOperatorRecipe(`
name: growl-bass
device: Operator
params:
  Algorithm: 0.09
playNotes: "   "
`),
    ).toThrowError(/"playNotes" must be a non-empty string/);
  });

  it("rejects a top-level that isn't a mapping", () => {
    expect(() => parseOperatorRecipe(`- 1\n- 2\n`)).toThrowError(/expected a YAML mapping/);
  });
});
