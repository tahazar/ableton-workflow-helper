import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_VENV_PYTHON, reportAnalysisPython, resolveAnalysisPython } from "./analysis-venv.js";

const present = (): boolean => true;
const absent = (): boolean => false;

describe("resolveAnalysisPython", () => {
  it("resolves the venv from the repo root, not a fixed machine path", () => {
    const repoRoot = dirname(dirname(dirname(REPO_VENV_PYTHON)));
    expect(existsSync(join(repoRoot, "analysis", "pyproject.toml"))).toBe(true);
  });

  it("uses AWH_PYTHON when set, even over a built venv", () => {
    expect(resolveAnalysisPython({ AWH_PYTHON: "python3" }, present)).toEqual({
      python: "python3",
    });
  });

  it("uses the repo venv when AWH_PYTHON is unset and the venv exists", () => {
    const seen: string[] = [];
    const lookup = resolveAnalysisPython({}, (path) => {
      seen.push(path);
      return true;
    });
    expect(lookup).toEqual({ python: REPO_VENV_PYTHON });
    expect(seen).toEqual([REPO_VENV_PYTHON]);
  });

  it("gives a skip reason naming the venv path and AWH_PYTHON when neither is there", () => {
    const lookup = resolveAnalysisPython({}, absent);
    expect(lookup.python).toBeUndefined();
    expect(lookup.skipReason).toContain(REPO_VENV_PYTHON);
    expect(lookup.skipReason).toContain("AWH_PYTHON");
  });
});

describe("reportAnalysisPython", () => {
  it("is silent when a Python was found", () => {
    const warnings: string[] = [];
    reportAnalysisPython({ python: REPO_VENV_PYTHON }, { AWH_REQUIRE_INTEG: "1" }, (m) =>
      warnings.push(m),
    );
    expect(warnings).toEqual([]);
  });

  it("warns with the reason when the integ tests will skip", () => {
    const warnings: string[] = [];
    reportAnalysisPython({ skipReason: "no venv here" }, {}, (m) => warnings.push(m));
    expect(warnings).toEqual(['Skipping "integ:" tests: no venv here']);
  });

  it("throws instead of skipping when AWH_REQUIRE_INTEG=1", () => {
    const warnings: string[] = [];
    expect(() =>
      reportAnalysisPython({ skipReason: "no venv here" }, { AWH_REQUIRE_INTEG: "1" }, (m) =>
        warnings.push(m),
      ),
    ).toThrow(/AWH_REQUIRE_INTEG=1 but no analysis Python: no venv here/);
    expect(warnings).toEqual([]);
  });
});
