/**
 * Operator assistant (B2) engine: recipe validate/apply flow, split out of
 * packages/cli/src/index.ts so it's unit-testable against a real (fake-
 * backed) gateway without spawning the CLI itself — see test/op.test.ts,
 * same spirit as duck.ts. docs/design/operator-assistant.md is the spec.
 *
 * Validate-first, fail loudly, zero partial writes (docs/lessons-learned.md
 * #3/#4): `planRecipeApply` reads the device ONCE and reports every param
 * name the recipe references that the live device doesn't have; if any are
 * unknown, `applyRecipePlan` refuses to write ANYTHING.
 */
import type { DeviceDetail, OperatorRecipe, StoredKnowledgeEntry } from "@awh/core";
import { extractFencedBlock, parseOperatorRecipe } from "@awh/core";

/** Minimal shape of the CLI's `op(opts, name, args)` gateway caller —
 *  op.ts stays decoupled from GlobalOpts/commander so it's testable with
 *  any caller (a real gateway fetch, or a fake one in tests). */
export type OpCaller = (name: string, args?: unknown) => Promise<unknown>;

/** Typed wrapper for device.param (docs/lessons-learned.md #4: a wrong
 *  field name must fail at compile time, not only at runtime inside Live). */
export async function setDeviceParam(
  caller: OpCaller,
  path: string,
  param: string,
  value: number,
): Promise<void> {
  await caller("device.param", { path, param, value });
}

export interface RecipeMove {
  param: string;
  from: number;
  to: number;
}

export interface RecipePlan {
  devicePath: string;
  recipeName: string;
  moves: RecipeMove[];
  /** Recipe param names the live device does NOT have — non-empty means
   *  `applyRecipePlan` refuses to write anything. */
  unknownParams: string[];
  knownParamNames: string[];
}

/** Validate a recipe's param names against a device.get read — device.get
 *  is called ONCE by the caller BEFORE this, so this function is pure and
 *  synchronous: no I/O, easy to unit-test independent of any gateway. */
export function planRecipeApply(
  detail: DeviceDetail,
  recipe: OperatorRecipe,
  devicePath: string,
): RecipePlan {
  const byName = new Map(detail.params.map((p) => [p.name, p]));
  const unknownParams = Object.keys(recipe.params).filter((n) => !byName.has(n));
  const moves: RecipeMove[] =
    unknownParams.length === 0
      ? Object.entries(recipe.params).map(([param, to]) => ({
          param,
          from: byName.get(param)!.value,
          to,
        }))
      : [];
  return {
    devicePath,
    recipeName: recipe.name,
    moves,
    unknownParams,
    knownParamNames: detail.params.map((p) => p.name),
  };
}

export interface RecipeWriteResult {
  param: string;
  target: number;
  actual: number;
  matched: boolean;
}

const WRITE_MATCH_TOLERANCE = 1e-6;

/**
 * Write every move in the plan via setDeviceParam, then read the device
 * back once and report per-param target vs. actual (mismatches are NOT
 * thrown — the caller decides how to surface them, matching `duck
 * calibrate`'s report-don't-guess convention). Refuses (throws, writes
 * NOTHING) if the plan carries any unknownParams — the caller should
 * normally have already checked this before calling (for a --dry-run early
 * exit), but this function re-checks so it's safe to call directly too.
 */
export async function applyRecipePlan(
  caller: OpCaller,
  plan: RecipePlan,
): Promise<RecipeWriteResult[]> {
  if (plan.unknownParams.length > 0) {
    throw new Error(
      `recipe "${plan.recipeName}" references params not on ${plan.devicePath}: ` +
        `${plan.unknownParams.join(", ")} — known params: ${plan.knownParamNames.join(", ")}`,
    );
  }
  for (const move of plan.moves) {
    await setDeviceParam(caller, plan.devicePath, move.param, move.to);
  }
  const after = (await caller("device.get", { path: plan.devicePath })) as DeviceDetail;
  const afterByName = new Map(after.params.map((p) => [p.name, p]));
  return plan.moves.map((move) => {
    const actual = afterByName.get(move.param)!.value;
    return {
      param: move.param,
      target: move.to,
      actual,
      matched: Math.abs(actual - move.to) < WRITE_MATCH_TOLERANCE,
    };
  });
}

// ---------------------------------------------------------------------------
// `op recipes` — list operator-recipe-* knowledge entries
// ---------------------------------------------------------------------------

export const RECIPE_SLUG_PREFIX = "operator-recipe-";

export interface RecipeSummary {
  slug: string;
  title: string;
  tier: string;
  paramCount: number;
  hasPlayNotes: boolean;
}

/**
 * Pure summarizer over already-loaded knowledge entries (no filesystem
 * I/O here — the caller reads via KnowledgeStore, same discovery/tiering
 * conventions as `kb list`). Throws loudly (a bad recipe entry is a data
 * bug, not a state to silently skip) if a matching entry has no
 * ```awh-operator-patch``` block or fails to parse.
 */
export function summarizeRecipeEntries(entries: StoredKnowledgeEntry[]): RecipeSummary[] {
  return entries
    .filter((e) => e.slug.startsWith(RECIPE_SLUG_PREFIX))
    .map((e) => {
      const text = extractFencedBlock(e.body, "awh-operator-patch");
      if (!text) {
        throw new Error(
          `knowledge entry ${e.relPath} (slug "${e.slug}") has no \`\`\`awh-operator-patch block`,
        );
      }
      const recipe = parseOperatorRecipe(text);
      return {
        slug: e.slug,
        title: e.title,
        tier: e.tier,
        paramCount: Object.keys(recipe.params).length,
        hasPlayNotes: recipe.playNotes !== undefined,
      };
    });
}

/** Load + parse one recipe's patch by knowledge-entry slug (already
 *  resolved to "operator-recipe-<name>" by the caller). */
export function loadRecipeFromEntry(entry: StoredKnowledgeEntry): OperatorRecipe {
  const text = extractFencedBlock(entry.body, "awh-operator-patch");
  if (!text) {
    throw new Error(`knowledge entry ${entry.relPath} has no \`\`\`awh-operator-patch block`);
  }
  return parseOperatorRecipe(text);
}
