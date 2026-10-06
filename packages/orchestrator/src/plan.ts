/**
 * Reads and updates docs/quality-plan.md. Items start at column 0 with their
 * id ("L10. `build...`", "5. `test: ...`") and continue on indented lines; a
 * section is everything under a "## " heading up to the next one.
 */

function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function itemBounds(plan: string, id: string): { start: number; end: number } | undefined {
  const lines = plan.split("\n");
  const head = new RegExp(String.raw`^${escapeRegExp(id)}\. `, "u");
  const start = lines.findIndex((l) => head.test(l));
  if (start === -1) return undefined;
  let end = start + 1;
  while (end < lines.length && (lines[end] === "" || /^\s/u.test(lines[end]!))) end++;
  // Trailing blank lines belong to the gap, not the item.
  while (end > start + 1 && lines[end - 1] === "") end--;
  return { start, end };
}

/** The item's full text, or undefined when the plan has no such item. */
export function extractItem(plan: string, id: string): string | undefined {
  const bounds = itemBounds(plan, id);
  if (!bounds) return undefined;
  return plan.split("\n").slice(bounds.start, bounds.end).join("\n");
}

/** Body of the "## <heading>" section, without the heading line. */
export function extractSection(plan: string, heading: string): string | undefined {
  const lines = plan.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return undefined;
  let end = start + 1;
  while (end < lines.length && !lines[end]!.startsWith("## ")) end++;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/**
 * Replaces an item with the worker's record of what was done. The record
 * must start with the item's own id so the plan keeps its numbering.
 */
export function applyRecord(plan: string, id: string, record: string): string {
  const bounds = itemBounds(plan, id);
  if (!bounds) throw new Error(`cannot record item ${id}: not found in the plan`);
  if (!record.startsWith(`${id}. `)) {
    throw new Error(`cannot record item ${id}: the record must start with "${id}. "`);
  }
  const lines = plan.split("\n");
  lines.splice(bounds.start, bounds.end - bounds.start, ...record.trimEnd().split("\n"));
  return lines.join("\n");
}
