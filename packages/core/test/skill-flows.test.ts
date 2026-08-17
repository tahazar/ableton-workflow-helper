import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * MECHANIZED RELEASE GATE (docs/lessons-learned.md rule 1).
 *
 * Four separate times (vary/M3, sections/M4, lib place/B3, ref/M8) a feature
 * shipped with a good dedicated SKILL.md section but NO "Typical flows"
 * entry — and each time a fresh agent, answering "how do I do X" from the
 * flows playbook, bypassed the tool and hand-composed with older primitives.
 * The written definition-of-done did not stop the 4th occurrence, so the
 * gate is now a test: every feature section header that names `awh <cmd>`
 * commands must have each of those commands referenced in the Typical
 * flows region.
 */
const SKILL_PATH = fileURLToPath(
  new URL("../../../.claude/skills/awh/SKILL.md", import.meta.url),
);

describe("SKILL.md typical-flows coverage", () => {
  const skill = readFileSync(SKILL_PATH, "utf8");
  const flowsStart = skill.indexOf("## Typical flows");
  it("has a Typical flows section", () => {
    expect(flowsStart).toBeGreaterThan(-1);
  });
  const flows = skill.slice(flowsStart);

  // Feature sections look like: ## <Title> (`awh vary` / `awh other`) — ...
  const featureHeaders = [...skill.matchAll(/^## .*?\((`awh [^)]+)\)/gm)];
  it("finds the feature sections (guard against format drift)", () => {
    expect(featureHeaders.length).toBeGreaterThanOrEqual(6);
  });

  for (const header of featureHeaders) {
    const commands = [...header[1]!.matchAll(/`awh ([a-z-]+)/g)].map((m) => m[1]!);
    for (const command of commands) {
      it(`flows reference \`awh ${command}\` (from section: ${header[0]!.slice(3, 50)}…)`, () => {
        expect(
          flows.includes(`awh ${command}`),
          `"awh ${command}" has a dedicated section but NO Typical flows mention — ` +
            "fresh agents will not find it. Add a flow entry (hard release gate).",
        ).toBe(true);
      });
    }
  }
});
