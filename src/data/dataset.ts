import type { CapabilityData, NormalizedData } from "./types";
import { parseAgencyRoster } from "./agencies";
import { normalizeCsv } from "./normalize";
import { normalizeCapabilitiesCsv } from "./normalizeCapabilities";

/**
 * All four source CSVs → everything the app displays, in one call.
 *
 * This is the single entry point for a *whole* dataset, used by both the build script (from the
 * snapshot CSVs in `/data`) and the live sheet loader (from the published Google Sheet). Routing
 * both through one function is what guarantees a sheet edit is held to exactly the standard a
 * build is: if this throws on the sheet, it would have failed the build too.
 *
 * The roster is parsed first because both normalizers resolve agency names against it.
 */

/** The raw CSV text of each source, keyed by role. The file/tab each comes from is the caller's concern. */
export interface SourceTexts {
  agencies: string;
  questions: string;
  capabilities: string;
  capabilityMap: string;
}

export interface Dataset {
  data: NormalizedData;
  capabilities: CapabilityData;
}

export function normalizeDataset(sources: SourceTexts): Dataset {
  const agencies = parseAgencyRoster(sources.agencies);
  return {
    data: normalizeCsv(sources.questions, agencies),
    capabilities: normalizeCapabilitiesCsv(sources.capabilities, sources.capabilityMap, agencies),
  };
}
