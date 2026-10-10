import type { CapabilityData, NormalizedData } from "./types";
import { parseAgencyRoster } from "./agencies";
import { normalizeQuestions, type QuestionSourceTexts } from "./normalize";
import { normalizeCapabilities, type CapabilitySourceTexts } from "./normalizeCapabilities";

/**
 * Every tab → everything the app displays, in one call.
 *
 * This is the single entry point for a *whole* dataset, used by both the build script (from the
 * snapshot CSVs in `/data`) and the live sheet loader (from the published Google Sheet). Routing
 * both through one function is what guarantees a sheet edit is held to exactly the standard a
 * build is: if this throws on the sheet, it would have failed the build too.
 *
 * The roster is parsed first because both normalizers resolve agency names against it.
 */

/** The raw CSV text of each tab, keyed by role. The file/tab each comes from is the caller's concern. */
export interface SourceTexts extends QuestionSourceTexts, CapabilitySourceTexts {
  agencies: string;
}

/** Every role, in the order tabs are listed to staff. */
export const SOURCE_ROLES = [
  "agencies",
  "questions",
  "requirements",
  "questionLinks",
  "capabilities",
  "providerCapabilities",
  "capabilityMap",
] as const satisfies readonly (keyof SourceTexts)[];

/** Each role's snapshot file in `/data`, which `pull-sheet` writes and `build-data` reads. */
export const SOURCE_FILES: Record<keyof SourceTexts, string> = {
  agencies: "agencies.csv",
  questions: "questions.csv",
  requirements: "requirements.csv",
  questionLinks: "question-links.csv",
  capabilities: "capabilities.csv",
  providerCapabilities: "provider-capabilities.csv",
  capabilityMap: "question-capability-map.csv",
};

export interface Dataset {
  data: NormalizedData;
  capabilities: CapabilityData;
}

export function normalizeDataset(sources: SourceTexts): Dataset {
  const agencies = parseAgencyRoster(sources.agencies);
  return {
    data: normalizeQuestions(sources, agencies),
    capabilities: normalizeCapabilities(sources, agencies),
  };
}
