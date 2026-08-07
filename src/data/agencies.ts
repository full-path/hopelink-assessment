import type { Agency } from "./types";
import { normalizeWhitespace } from "./text";

/**
 * The canonical agency roster — the single place agency naming is reconciled, shared by
 * every CSV in `/data`.
 *
 * Aliases cover casing and wording variants observed in the raw exports (see CLAUDE.md
 * Section 3) so the resolver stays correct even if a future CSV edit reintroduces that drift.
 * ORCA program variants are kept as distinct agencies per CLAUDE.md Section 11, item 1.
 *
 * `kind` exists because the roster mixes two things that look alike in the intake sheet but
 * are not comparable: organizations that operate vehicles, and fare/pass programs that only
 * determine eligibility. Vehicle capabilities (`data/capabilities.csv`) are meaningful for the
 * former and meaningless for the latter — without this distinction the capabilities view would
 * report "no capability data" for ORCA and SAP as though it were a gap in the survey rather
 * than a category error. The classification is an assumption; see CLAUDE.md Section 11, item 9.
 */
export const CANONICAL_AGENCIES: Agency[] = [
  {
    id: "hyde-shuttle",
    displayName: "Hyde Shuttle",
    kind: "ride_provider",
    aliases: ["Hyde Shuttle"],
  },
  {
    id: "northshore-senior-center",
    displayName: "Northshore Senior Center",
    kind: "ride_provider",
    aliases: ["Northshore Senior Center", "Northshore senior Center"],
  },
  {
    id: "beyond-the-borders",
    displayName: "Beyond the Borders",
    kind: "ride_provider",
    aliases: ["Beyond the Borders", "Beyond the borders"],
  },
  {
    id: "access-paratransit",
    displayName: "Access Paratransit",
    kind: "ride_provider",
    aliases: ["Access Paratransit", "Access paratransit"],
  },
  {
    id: "metro-transit-instruction",
    displayName: "Metro Transit Instruction",
    kind: "travel_training",
    aliases: ["Metro Transit Instruction"],
  },
  { id: "orca", displayName: "ORCA", kind: "fare_program", aliases: ["ORCA"] },
  {
    id: "orca-senior",
    displayName: "ORCA (Senior)",
    kind: "fare_program",
    aliases: ["ORCA (Senior)"],
  },
  {
    id: "orca-disabled",
    displayName: "ORCA (Disabled)",
    kind: "fare_program",
    aliases: ["ORCA (Disabled)", "ORCA (disabled)"],
  },
  { id: "orca-lift", displayName: "ORCA LIFT", kind: "fare_program", aliases: ["ORCA LIFT"] },
  {
    id: "homage-tap",
    displayName: "Homage TAP",
    kind: "ride_provider",
    aliases: ["Homage TAP", "Homage Tap"],
  },
  {
    id: "sound-generations-vts",
    displayName: "Sound Generations VTS",
    kind: "ride_provider",
    // "SG VTS" is the spelling used in data/capabilities.csv.
    aliases: ["Sound Generations VTS", "SG VTS"],
  },
  { id: "sap", displayName: "SAP", kind: "fare_program", aliases: ["SAP"] },
  {
    id: "snow-goose-transit",
    displayName: "Snow Goose Transit",
    kind: "ride_provider",
    aliases: ["Snow Goose Transit"],
  },
  { id: "metroflex", displayName: "MetroFlex", kind: "ride_provider", aliases: ["MetroFlex"] },
  {
    id: "pierce-runner",
    displayName: "Pierce Runner",
    kind: "ride_provider",
    aliases: ["Pierce Runner"],
  },
  {
    id: "zip-shuttle",
    displayName: "Zip Shuttle",
    kind: "ride_provider",
    aliases: ["Zip Shuttle"],
  },
  {
    id: "community-van",
    displayName: "Community Van",
    kind: "ride_provider",
    // Appears only in data/capabilities.csv — it reports vehicle capabilities but no intake
    // questions. Views that list agencies per question derive their own list from the question
    // data so this does not show up as "does not ask" on all 42 questions; the capabilities
    // coverage view names it explicitly instead. See CLAUDE.md Section 11, item 8.
    aliases: ["Community Van"],
  },
];

function buildAliasLookup(agencies: Agency[]): Map<string, string> {
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
  return lookup;
}

const ALIAS_LOOKUP = buildAliasLookup(CANONICAL_AGENCIES);

/** Resolves a raw agency string from any source CSV to a canonical agency id. Throws on anything unrecognized. */
export function resolveAgencyId(raw: string): string {
  const key = normalizeWhitespace(raw).toLowerCase();
  const id = ALIAS_LOOKUP.get(key);
  if (id === undefined) {
    throw new Error(
      `Unrecognized agency name "${raw}". Add it to CANONICAL_AGENCIES in src/data/agencies.ts.`,
    );
  }
  return id;
}
