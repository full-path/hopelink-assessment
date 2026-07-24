import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import type { Agency, AgencyRequirement, IntakeQuestion, NormalizedData } from "../src/data/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV_PATH = resolve(__dirname, "../data/eligibility-questions.csv");
const DEFAULT_OUTPUT_PATH = resolve(__dirname, "../src/data/questions.json");

interface SourceRow {
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
const CANONICAL_AGENCIES: Agency[] = [
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
      `Unrecognized agency name "${raw}". Add it to CANONICAL_AGENCIES in scripts/build-data.ts.`,
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
  return result.data.filter((row) => normalizeWhitespace(row.Question).length > 0);
}

function main(): void {
  const csvText = readFileSync(DEFAULT_CSV_PATH, "utf-8");
  const rows = parseCsv(csvText);
  const data = normalize(rows);
  writeFileSync(DEFAULT_OUTPUT_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(
    `Wrote ${String(data.questions.length)} questions and ${String(data.agencies.length)} agencies to ${DEFAULT_OUTPUT_PATH}`,
  );
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
