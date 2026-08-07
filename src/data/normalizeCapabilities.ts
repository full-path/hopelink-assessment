import Papa from "papaparse";
import type {
  AgencyCapability,
  AgencyCapabilityProfile,
  Capability,
  CapabilityData,
  CapabilityValue,
  IntakeQuestion,
  QuestionCapabilityLink,
} from "./types";
import { resolveAgencyId } from "./agencies";
import { normalizeWhitespace, slugify } from "./text";

/**
 * `data/capabilities.csv` + `data/question-capability-map.csv` → CapabilityData.
 *
 * Sibling of `normalize.ts`, following the same rules: one shared module, no Node imports (it
 * runs in the browser too), strict about anything it cannot resolve. Between them they share
 * only the agency roster (`agencies.ts`) and string helpers (`text.ts`).
 *
 * The capabilities sheet is a matrix: one row per agency, one column per capability, free-text
 * answers. Nothing here coerces a blank into a "no" — see the `CapabilityValue` docs in
 * `types.ts` for why that distinction is load-bearing.
 */

/** The one column of `capabilities.csv` that is not a capability. */
const AGENCY_COLUMN = "Agency Name";

/** Captures a trailing parenthetical qualifier, e.g. `Yes (Language line)` → `Yes` + `Language line`. */
const QUALIFIER_PATTERN = /^(.*?)\s*\(([^)]*)\)\s*$/;

export interface ParsedCapabilityValue {
  value: CapabilityValue;
  qualifier?: string;
}

/**
 * Maps one free-text capability cell to the canonical vocabulary.
 *
 * A bare "yes"/"no" (in any casing) is taken at face value. Everything else that isn't blank —
 * "Probably yes", "Depends on vehicle" — is `conditional`, because a hedged answer is not the
 * same claim as an unqualified one and flattening it would overstate what the agency said. In
 * every case the agency's own wording is preserved in `qualifier`.
 */
export function parseCapabilityValue(raw: string): ParsedCapabilityValue {
  const text = normalizeWhitespace(raw);
  if (!text) {
    return { value: "unknown" };
  }

  const match = QUALIFIER_PATTERN.exec(text);
  const base = match ? normalizeWhitespace(match[1] ?? "") : text;
  const parenthetical = match ? normalizeWhitespace(match[2] ?? "") : "";

  const canonical = base.toLowerCase();
  if (canonical === "yes" || canonical === "no") {
    const value: CapabilityValue = canonical === "yes" ? "yes" : "no";
    return parenthetical ? { value, qualifier: parenthetical } : { value };
  }

  // Anything else is a hedge or a condition; keep the whole phrase as the qualifier so the
  // UI can show what the agency actually wrote rather than a lossy summary of it.
  return { value: "conditional", qualifier: text };
}

/** One row of the capabilities matrix: the agency column plus one column per capability. */
type CapabilityRow = Record<string, string>;

function parseMatrixCsv(csvText: string): {
  capabilities: Capability[];
  profiles: AgencyCapabilityProfile[];
} {
  const result = Papa.parse<CapabilityRow>(csvText, { header: true, skipEmptyLines: true });
  if (result.errors.length > 0) {
    const details = result.errors
      .map((e) => `${e.type}: ${e.message} (row ${String(e.row)})`)
      .join("\n");
    throw new Error(`Capabilities CSV parse errors:\n${details}`);
  }

  const header = (result.meta.fields ?? []).map(normalizeWhitespace);
  if (header[0] !== AGENCY_COLUMN) {
    throw new Error(
      `Capabilities CSV must start with an "${AGENCY_COLUMN}" column. Found: ` +
        header.map((c) => `"${c}"`).join(", "),
    );
  }

  const capabilityColumns = header.slice(1).filter((column) => column.length > 0);
  if (capabilityColumns.length === 0) {
    throw new Error(`Capabilities CSV has an "${AGENCY_COLUMN}" column but no capability columns.`);
  }

  const capabilities: Capability[] = capabilityColumns.map((label) => ({
    id: slugify(label),
    label,
  }));

  const seenIds = new Set<string>();
  for (const capability of capabilities) {
    if (seenIds.has(capability.id)) {
      throw new Error(
        `Duplicate capability id "${capability.id}" from column "${capability.label}"`,
      );
    }
    seenIds.add(capability.id);
  }

  const seenAgencies = new Set<string>();
  const profiles: AgencyCapabilityProfile[] = [];
  for (const row of result.data) {
    const rawName = normalizeWhitespace(row[AGENCY_COLUMN] ?? "");
    if (!rawName) {
      continue;
    }
    const agencyId = resolveAgencyId(rawName);
    if (seenAgencies.has(agencyId)) {
      throw new Error(`Capabilities CSV has more than one row for agency "${rawName}"`);
    }
    seenAgencies.add(agencyId);

    const entries: AgencyCapability[] = capabilityColumns.map((label, index) => {
      const capability = capabilities[index];
      if (capability === undefined) {
        throw new Error(`Internal error: no capability for column "${label}"`);
      }
      const parsed = parseCapabilityValue(row[label] ?? "");
      return {
        capabilityId: capability.id,
        value: parsed.value,
        ...(parsed.qualifier !== undefined ? { qualifier: parsed.qualifier } : {}),
      };
    });

    profiles.push({ agencyId, capabilities: entries });
  }

  return { capabilities, profiles };
}

interface MapRow {
  Question: string;
  Capability: string;
  Note?: string;
}

const MAP_REQUIRED_COLUMNS: (keyof MapRow)[] = ["Question", "Capability"];

/**
 * Parses the editorial question → capability map. Capability labels must match a column of the
 * capabilities sheet exactly (an unknown one fails the build rather than being dropped), but
 * question text is stored as written and resolved later — see `resolveQuestionCapabilityLinks`.
 */
function parseQuestionCapabilityMap(csvText: string, capabilities: Capability[]) {
  const result = Papa.parse<MapRow>(csvText, { header: true, skipEmptyLines: true });
  if (result.errors.length > 0) {
    const details = result.errors
      .map((e) => `${e.type}: ${e.message} (row ${String(e.row)})`)
      .join("\n");
    throw new Error(`Question/capability map parse errors:\n${details}`);
  }

  const header = result.meta.fields ?? [];
  const missing = MAP_REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      "Question/capability map is missing expected column(s): " +
        missing.map((c) => `"${c}"`).join(", "),
    );
  }

  const labelToId = new Map(
    capabilities.map((capability) => [capability.label.toLowerCase(), capability.id]),
  );

  const links: QuestionCapabilityLink[] = [];
  for (const row of result.data) {
    const questionText = normalizeWhitespace(row.Question);
    const capabilityLabel = normalizeWhitespace(row.Capability);
    if (!questionText && !capabilityLabel) {
      continue;
    }

    const capabilityId = labelToId.get(capabilityLabel.toLowerCase());
    if (capabilityId === undefined) {
      throw new Error(
        `Question/capability map references unknown capability "${capabilityLabel}". ` +
          `Known capabilities: ${capabilities.map((c) => `"${c.label}"`).join(", ")}`,
      );
    }

    const note = normalizeWhitespace(row.Note ?? "");
    links.push({ questionText, capabilityId, ...(note ? { note } : {}) });
  }

  return links;
}

export function normalizeCapabilitiesCsv(
  capabilitiesCsvText: string,
  questionMapCsvText: string,
): CapabilityData {
  const { capabilities, profiles } = parseMatrixCsv(capabilitiesCsvText);
  const questionLinks = parseQuestionCapabilityMap(questionMapCsvText, capabilities);
  return { capabilities, profiles, questionLinks };
}

export interface ResolvedQuestionCapabilityLinks {
  /** Links keyed by the id of the question they matched. */
  byQuestionId: Map<string, QuestionCapabilityLink[]>;
  /** Links whose question text matched no question in the active dataset. */
  unmatched: QuestionCapabilityLink[];
}

/**
 * Matches the map's question text against a question set, exactly and case-sensitively — the
 * same discipline `normalize.ts` applies to upstream/downstream references, and for the same
 * reason: a near-miss is a data error someone needs to see, not something to guess at.
 *
 * This runs against whatever question set is currently displayed, so an uploaded CSV that
 * renames or removes a question simply loses that link (reported as unmatched) instead of
 * breaking the view.
 */
export function resolveQuestionCapabilityLinks(
  links: QuestionCapabilityLink[],
  questions: IntakeQuestion[],
): ResolvedQuestionCapabilityLinks {
  const textToId = new Map(questions.map((question) => [question.text, question.id]));
  const byQuestionId = new Map<string, QuestionCapabilityLink[]>();
  const unmatched: QuestionCapabilityLink[] = [];

  for (const link of links) {
    const questionId = textToId.get(link.questionText);
    if (questionId === undefined) {
      unmatched.push(link);
      continue;
    }
    const existing = byQuestionId.get(questionId);
    if (existing) {
      existing.push(link);
    } else {
      byQuestionId.set(questionId, [link]);
    }
  }

  return { byQuestionId, unmatched };
}
