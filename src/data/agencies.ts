import type { Agency, AgencyKind } from "./types";
import { cell, dropdown, parseTab } from "./tabs";
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

const ROSTER_COLUMNS = ["Agency", "Kind", "Aliases", "Capability survey"];

/**
 * The words staff pick in the Kind column, mapped to the contract's values. Matched
 * case-insensitively; the contract's own spelling (`ride_provider`) is accepted too.
 */
const KIND = {
  "Ride provider": "ride_provider",
  "Fare program": "fare_program",
  "Travel training": "travel_training",
} as const satisfies Record<string, AgencyKind>;

/** Blank means not surveyed; there is no third state worth a word of its own. */
const CAPABILITY_SURVEY = { Returned: "returned" } as const;

/**
 * The Agencies tab → the roster. One row per agency; `Aliases` is semicolon-delimited, the same
 * convention the sheet uses wherever a comma would be ambiguous. The display name is always an
 * alias of itself, so a row needs no aliases to be resolvable.
 *
 * The id is the slug of the display name. Nothing persistent is keyed by agency id (comments
 * target questions and capabilities, and the other tabs name agencies by name), so renaming an
 * agency is safe — provided its old name is kept as an alias or the other tabs are updated.
 */
export function parseAgencyRoster(csvText: string): Agency[] {
  const agencies: Agency[] = [];
  const seenIds = new Map<string, string>();

  parseTab(csvText, "Agencies", ROSTER_COLUMNS).forEach((row, index) => {
    const where = `Agencies tab, row ${String(index + 2)}`;
    const displayName = cell(row, "Agency");
    if (!displayName) throw new Error(`${where} has no agency name.`);

    const id = slugify(displayName);
    const existing = seenIds.get(id);
    if (existing !== undefined) {
      throw new Error(
        `Agency roster has two rows that produce the id "${id}": "${existing}" and "${displayName}"`,
      );
    }
    seenIds.set(id, displayName);

    const kindLabel = cell(row, "Kind").replace(/_/g, " ");
    const kind = dropdown(kindLabel, KIND, () => `Agency "${displayName}": Kind`);
    if (kind === null) throw new Error(`Agency "${displayName}" has no Kind.`);

    const aliases = (row.Aliases ?? "")
      .split(";")
      .map(normalizeWhitespace)
      .filter((alias) => alias.length > 0);

    agencies.push({
      id,
      displayName,
      kind,
      aliases: [displayName, ...aliases.filter((alias) => alias !== displayName)],
      capabilitySurvey:
        dropdown(
          cell(row, "Capability survey"),
          CAPABILITY_SURVEY,
          () => `Agency "${displayName}": Capability survey`,
        ) ?? "not_surveyed",
    });
  });

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
