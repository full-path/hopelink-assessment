import Papa from "papaparse";
import type { AgencyRequirement, IntakeQuestion, NormalizedData } from "./types";
import { CANONICAL_AGENCIES, resolveAgencyId } from "./agencies";
import { normalizeWhitespace, slugify } from "./text";

/**
 * `data/eligibility-questions.csv` → NormalizedData, shared by two callers:
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

  /**
   * An Upstream/Downstream cell may name more than one question. References are
   * semicolon-delimited, matching the convention the Burden-of-Proof cell already uses and
   * for the same reason: question text can itself contain commas (e.g. "Special directions
   * (gate code, etc)"), so a comma is not a safe separator. Each reference must match another
   * row's question text exactly; anything else is reported as unresolved rather than guessed at.
   */
  function resolveLink(raw: string): { resolved: string[]; unresolved: string[] } {
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const segment of raw.split(";")) {
      const text = normalizeWhitespace(segment);
      if (!text) {
        continue;
      }
      const id = textToId.get(text);
      if (id !== undefined) {
        resolved.push(id);
      } else {
        unresolved.push(text);
      }
    }
    return { resolved, unresolved };
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
