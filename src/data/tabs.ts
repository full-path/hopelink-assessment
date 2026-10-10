import Papa from "papaparse";
import { normalizeWhitespace } from "./text";

/**
 * Reading the sheet's tabs, shared by every normalizer in this directory.
 *
 * Every tab follows the same rules — a header row, one value per cell, dropdown columns with a
 * fixed vocabulary, ids that are lowercase words joined by hyphens — so the mechanics of
 * enforcing them live here once, and each normalizer only states its own columns and meaning.
 */

export type Row = Record<string, string | undefined>;

/** Lowercase words joined by single hyphens — the shape of every id staff assign. */
export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Parses one tab, checks its required columns, and drops rows that are blank in every required
 * column. Extra columns are ignored, which is what lets the sheet carry helper columns (a lookup
 * showing the question text beside an id, say) without the app caring.
 */
export function parseTab(csvText: string, tab: string, requiredColumns: string[]): Row[] {
  // Comma always: a sheet exports CSV that way, and auto-detection misfires on a one-column tab.
  const result = Papa.parse<Row>(csvText, { header: true, skipEmptyLines: true, delimiter: "," });
  if (result.errors.length > 0) {
    const details = result.errors
      .map((e) => `${e.type}: ${e.message} (row ${String(e.row)})`)
      .join("\n");
    throw new Error(`${tab} tab parse errors:\n${details}`);
  }

  const header = (result.meta.fields ?? []).map(normalizeWhitespace);
  const missing = requiredColumns.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `${tab} tab is missing expected column(s): ${missing.map((c) => `"${c}"`).join(", ")}. ` +
        `Found: ${header.map((c) => `"${c}"`).join(", ")}`,
    );
  }

  return result.data.filter((row) =>
    requiredColumns.some((column) => normalizeWhitespace(row[column] ?? "").length > 0),
  );
}

/** A cell's value, whitespace-normalized; "" for a missing cell. */
export function cell(row: Row, column: string): string {
  return normalizeWhitespace(row[column] ?? "");
}

/**
 * Matches a dropdown cell against its allowed values, case-insensitively. Blank returns null —
 * whether blank is allowed is the caller's call.
 */
export function dropdown<T>(
  raw: string,
  allowed: Record<string, T>,
  describe: () => string,
): T | null {
  if (!raw) return null;
  const match = Object.entries(allowed).find(
    ([label]) => label.toLowerCase() === raw.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `${describe()} is "${raw}". Expected one of: ` +
        Object.keys(allowed)
          .map((label) => `"${label}"`)
          .join(", "),
    );
  }
  return match[1];
}
