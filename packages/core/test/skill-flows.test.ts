import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Release gate (docs/lessons-learned.md rule 1).
 *
 * An agent answering "how do I do X" works from the SKILL.md "Typical flows"
 * playbook. A feature with a dedicated SKILL.md section but no Typical flows
 * entry gets bypassed in favor of hand-composing older primitives (this
 * happened for vary, sections, lib place and ref). So every feature section
 * header that names `awh <cmd>` commands must have each of those commands
 * referenced in the Typical flows region.
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
