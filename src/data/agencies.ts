import Papa from "papaparse";
import type { Agency, AgencyKind } from "./types";
import { normalizeWhitespace, slugify } from "./text";

/**
 * The agency roster — the single place agency naming is reconciled, shared by every other CSV.
 *
 * The roster is data, not code: `data/agencies.csv` (or the Agencies tab of the live sheet), so
 * program staff can add an agency or tolerate a new spelling without a developer. This module
 * parses it and builds the resolver the two normalizers use to turn any raw agency string into a
 * canonical id.
 *
 * Aliases cover casing and wording variants observed in the raw exports (see CLAUDE.md
 * Section 3). ORCA program variants are distinct rows per CLAUDE.md Section 11, item 1.
 *
 * `kind` exists because the roster mixes two things that look alike in the intake sheet but
 * are not comparable: organizations that operate vehicles, and fare/pass programs that only
 * determine eligibility. Vehicle capabilities are meaningful for the former and meaningless for
 * the latter — without this distinction the capabilities view would report "no capability data"
 * for ORCA and SAP as though it were a gap in the survey rather than a category error. The
 * classification is an assumption; see CLAUDE.md Section 11, item 9.
 */

/** Takes any raw agency string from a source CSV and returns its canonical id, or throws. */
export type AgencyResolver = (raw: string) => string;

interface RosterRow {
  Agency: string;
  Kind: string;
  Aliases?: string;
  Note?: string;
}

const ROSTER_REQUIRED_COLUMNS: (keyof RosterRow)[] = ["Agency", "Kind"];

/**
 * The words staff type in the Kind column, mapped to the contract's values. Matched
 * case-insensitively with spaces and underscores treated alike, so both the sheet's
 * "Ride provider" and the contract's own "ride_provider" are accepted.
 */
const KIND_BY_LABEL = new Map<string, AgencyKind>([
  ["ride provider", "ride_provider"],
  ["fare program", "fare_program"],
  ["travel training", "travel_training"],
]);

function parseKind(raw: string, agencyName: string): AgencyKind {
  const label = normalizeWhitespace(raw.replace(/_/g, " ")).toLowerCase();
  const kind = KIND_BY_LABEL.get(label);
  if (kind === undefined) {
    throw new Error(
      `Agency "${agencyName}" has Kind "${raw}". Expected one of: ` +
        ["Ride provider", "Fare program", "Travel training"].map((k) => `"${k}"`).join(", "),
    );
  }
  return kind;
}

/**
 * `data/agencies.csv` → the roster. One row per agency; `Aliases` is semicolon-delimited, the
 * same convention every other multi-value cell in `/data` uses where a comma would be ambiguous.
 * The display name is always an alias of itself, so a row needs no aliases to be resolvable.
 *
 * The id is the slug of the display name. Nothing persistent is keyed by agency id (comments
 * target questions and capabilities), so renaming an agency is safe.
 */
export function parseAgencyRoster(csvText: string): Agency[] {
  const result = Papa.parse<RosterRow>(csvText, { header: true, skipEmptyLines: true });
  if (result.errors.length > 0) {
    const details = result.errors
      .map((e) => `${e.type}: ${e.message} (row ${String(e.row)})`)
      .join("\n");
    throw new Error(`Agency roster parse errors:\n${details}`);
  }

  const header = result.meta.fields ?? [];
  const missing = ROSTER_REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `Agency roster is missing expected column(s): ${missing.map((c) => `"${c}"`).join(", ")}`,
    );
  }

  const agencies: Agency[] = [];
  const seenIds = new Map<string, string>();
  for (const row of result.data) {
    const displayName = normalizeWhitespace(row.Agency);
    if (!displayName) {
      continue;
    }

    const id = slugify(displayName);
    const existing = seenIds.get(id);
    if (existing !== undefined) {
      throw new Error(
        `Agency roster has two rows that produce the id "${id}": "${existing}" and "${displayName}"`,
      );
    }
    seenIds.set(id, displayName);

    const aliases = (row.Aliases ?? "")
      .split(";")
      .map(normalizeWhitespace)
      .filter((alias) => alias.length > 0);

    agencies.push({
      id,
      displayName,
      kind: parseKind(row.Kind, displayName),
      aliases: [displayName, ...aliases.filter((alias) => alias !== displayName)],
    });
  }

  if (agencies.length === 0) {
    throw new Error("Agency roster has no agencies.");
  }
  return agencies;
}

/**
 * Builds the resolver for a roster. Matching is case-insensitive and whitespace-normalized, and
 * an alias claimed by two agencies is an error rather than a coin toss.
 */
export function createAgencyResolver(agencies: Agency[]): AgencyResolver {
  const lookup = new Map<string, string>();
  for (const agency of agencies) {
    for (const alias of agency.aliases) {
      const key = normalizeWhitespace(alias).toLowerCase();
      const existing = lookup.get(key);
      if (existing !== undefined && existing !== agency.id) {
        throw new Error(
          `Alias collision: "${alias}" maps to both "${existing}" and "${agency.id}"`,
        );
      }
      lookup.set(key, agency.id);
    }
  }

  return (raw) => {
    const id = lookup.get(normalizeWhitespace(raw).toLowerCase());
    if (id === undefined) {
      throw new Error(
        `Unrecognized agency name "${raw}". Add it, or add it as an alias of an existing ` +
          `agency, in the agency roster (data/agencies.csv, or the Agencies tab of the sheet).`,
      );
    }
    return id;
  };
}
