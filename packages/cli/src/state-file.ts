import { readFile } from "node:fs/promises";

/**
 * Reads a JSON file the CLI keeps between runs (`lib audition`'s pending
 * audition, `lib export-alc`'s mirror config).
 *
 * - Missing file: a first run, so `undefined` with no message.
 * - File that cannot be read (permissions, a directory): throws
 *   'reading the <what> at <file> failed: ...' with the read error as
 *   `cause`, because ignoring it would let the next save fail or clobber it.
 * - File that reads but is not valid state (bad JSON, or `isValid` rejects
 *   it): `warn` is called with the file and the reason, and the result is
 *   `undefined`, so the caller starts from its default. This fallback stays
 *   because the state is a convenience the next save rewrites; refusing to
 *   run would leave the user deleting the file by hand.
 */
export async function readStateFile<T>(
  file: string,
  what: string,
  isValid: (value: unknown) => value is T,
  warn: (message: string) => void,
): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`reading the ${what} at ${file} failed: ${(err as Error).message}`, {
      cause: err,
    });
  }
  let reason: string;
  try {
    const value: unknown = JSON.parse(text);
    if (isValid(value)) return value;
    reason = "unexpected fields or types";
  } catch (err) {
    reason = `invalid JSON: ${(err as Error).message}`;
  }
  warn(`${what} at ${file} is not valid (${reason}); ignoring it, and the next save replaces it`);
  return undefined;
}

/** True for a plain object whose `fields` are all of the given `typeof`. */
export function hasFields(
  value: unknown,
  fields: Record<string, "string" | "number">,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(fields).every(([key, type]) => typeof record[key] === type);
}
