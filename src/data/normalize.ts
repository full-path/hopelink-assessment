import Papa from "papaparse";
import type { Agency, AgencyRequirement, IntakeQuestion, NormalizedData } from "./types";

/**
 * CSV → NormalizedData logic, shared by two callers:
 *
 *  - `scripts/build-data.ts`, which generates the committed `questions.json` at build time
 *    from the source-of-record CSV in `/data`; and
 *  - the in-browser upload preview (`src/main.ts`), which lets a user point the running app
 *    at a replacement CSV for the current session without rebuilding.
 *
 * Because this module runs in the browser, it must stay free of Node imports.
 */

export interface SourceRow {
  Question: string;
  "Providers Required": string;
  "Providers Optional": string;
  "Providers Self Attestation": string;
  "Providers Burden of Proof": string;
  "Upstream Q's": string;
  "Downstream Q's": string;
  "Data Quality Notes"?: string;
}

/**
 * Canonical agency roster. Aliases cover casing/wording variants observed in past
 * revisions of the source CSV (see CLAUDE.md Section 3) so the resolver stays
 * correct even if a future CSV edit reintroduces that drift. ORCA program variants
 * are kept as distinct agencies per CLAUDE.md Section 11, item 1.
 */
export const CANONICAL_AGENCIES: Agency[] = [
  { id: "hyde-shuttle", displayName: "Hyde Shuttle", aliases: ["Hyde Shuttle"] },
  {
    id: "northshore-senior-center",
    displayName: "Northshore Senior Center",
    aliases: ["Northshore Senior Center", "Northshore senior Center"],
  },
  {
    id: "beyond-the-borders",
    displayName: "Beyond the Borders",
    aliases: ["Beyond the Borders", "Beyond the borders"],
  },
  {
    id: "access-paratransit",
    displayName: "Access Paratransit",
    aliases: ["Access Paratransit", "Access paratransit"],
  },
  {
    id: "metro-transit-instruction",
    displayName: "Metro Transit Instruction",
    aliases: ["Metro Transit Instruction"],
  },
  { id: "orca", displayName: "ORCA", aliases: ["ORCA"] },
  { id: "orca-senior", displayName: "ORCA (Senior)", aliases: ["ORCA (Senior)"] },
  {
    id: "orca-disabled",
    displayName: "ORCA (Disabled)",
    aliases: ["ORCA (Disabled)", "ORCA (disabled)"],
  },
  { id: "orca-lift", displayName: "ORCA LIFT", aliases: ["ORCA LIFT"] },
  { id: "homage-tap", displayName: "Homage TAP", aliases: ["Homage TAP", "Homage Tap"] },
];

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

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

/** Resolves a raw agency string from the CSV to a canonical agency id. Throws on anything unrecognized. */
export function resolveAgencyId(raw: string): string {
  const key = normalizeWhitespace(raw).toLowerCase();
  const id = ALIAS_LOOKUP.get(key);
  if (id === undefined) {
    throw new Error(
      `Unrecognized agency name "${raw}". Add it to CANONICAL_AGENCIES in src/data/normalize.ts.`,
    );
  }
  return id;
}

/** Splits a simple comma-delimited agency-list cell (Required / Optional / Self-Attestation) into agency ids. */
export function parseAgencyList(cell: string): string[] {
  if (!cell.trim()) {
    return [];
  }
  return cell
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map(resolveAgencyId);
}

const PROOF_SEGMENT_PATTERN = /^(.+?)\s*\(([\s\S]*)\)$/;

/**
 * Splits the "Providers Burden of Proof" cell into per-agency proof detail. Segments are
 * semicolon-delimited (the source CSV uses ";" here specifically to avoid ambiguity with
 * proof-detail text that itself contains commas — see CLAUDE.md Section 3).
 */
export function parseBurdenOfProof(cell: string): AgencyRequirement[] {
  if (!cell.trim()) {
    return [];
  }
  return cell
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const match = PROOF_SEGMENT_PATTERN.exec(segment);
      if (!match) {
        return { agencyId: resolveAgencyId(segment), level: "proof_required" as const };
      }
      const [, name, detail] = match as unknown as [string, string, string];
      return {
        agencyId: resolveAgencyId(name),
        level: "proof_required" as const,
        proofDetail: detail.trim(),
      };
    });
}

/** Generates a stable, URL-safe slug id from question text. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalize(rows: SourceRow[]): NormalizedData {
  const textToId = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const row of rows) {
    const text = normalizeWhitespace(row.Question);
    const id = slugify(text);
    if (usedIds.has(id)) {
      throw new Error(`Duplicate question id "${id}" produced from question text "${text}"`);
    }
    usedIds.add(id);
    textToId.set(text, id);
  }

  function resolveLink(raw: string): { resolved: string[]; unresolved: string[] } {
    const text = normalizeWhitespace(raw);
    if (!text) {
      return { resolved: [], unresolved: [] };
    }
    const id = textToId.get(text);
    return id !== undefined
      ? { resolved: [id], unresolved: [] }
      : { resolved: [], unresolved: [text] };
  }

  const questions: IntakeQuestion[] = rows.map((row) => {
    const text = normalizeWhitespace(row.Question);
    const id = textToId.get(text);
    if (id === undefined) {
      throw new Error(`Internal error: no id computed for question "${text}"`);
    }

    const requirements: AgencyRequirement[] = [
      ...parseAgencyList(row["Providers Required"]).map((agencyId): AgencyRequirement => ({
        agencyId,
        level: "required",
      })),
      ...parseAgencyList(row["Providers Optional"]).map((agencyId): AgencyRequirement => ({
        agencyId,
        level: "optional",
      })),
      ...parseAgencyList(row["Providers Self Attestation"]).map((agencyId): AgencyRequirement => ({
        agencyId,
        level: "self_attestation",
      })),
      ...parseBurdenOfProof(row["Providers Burden of Proof"]),
    ];

    const upstream = resolveLink(row["Upstream Q's"]);
    const downstream = resolveLink(row["Downstream Q's"]);
    const unresolvedLinks = [...upstream.unresolved, ...downstream.unresolved];

    const dataQualityNote = row["Data Quality Notes"]?.trim();

    const question: IntakeQuestion = {
      id,
      text,
      requirements,
      upstreamRefs: upstream.resolved,
      downstreamRefs: downstream.resolved,
      ...(unresolvedLinks.length > 0 ? { unresolvedLinks } : {}),
      ...(dataQualityNote ? { dataQualityNote } : {}),
    };
    return question;
  });

  return { agencies: CANONICAL_AGENCIES, questions };
}

const REQUIRED_COLUMNS: (keyof SourceRow)[] = [
  "Question",
  "Providers Required",
  "Providers Optional",
  "Providers Self Attestation",
  "Providers Burden of Proof",
  "Upstream Q's",
  "Downstream Q's",
];

export function parseCsv(csvText: string): SourceRow[] {
  const result = Papa.parse<SourceRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (result.errors.length > 0) {
    const details = result.errors
      .map((e) => `${e.type}: ${e.message} (row ${String(e.row)})`)
      .join("\n");
    throw new Error(`CSV parse errors:\n${details}`);
  }

  const header = result.meta.fields ?? [];
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `CSV is missing expected column(s): ${missing.map((c) => `"${c}"`).join(", ")}. ` +
        `Found: ${header.map((c) => `"${c}"`).join(", ")}`,
    );
  }

  return result.data.filter((row) => normalizeWhitespace(row.Question).length > 0);
}

/** One-call convenience for callers that start from raw CSV text (the upload path). */
export function normalizeCsv(csvText: string): NormalizedData {
  return normalize(parseCsv(csvText));
}
