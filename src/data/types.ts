export type RequirementLevel = "required" | "optional" | "self_attestation" | "proof_required";

export interface AgencyRequirement {
  agencyId: string; // canonical, resolved from alias table
  level: RequirementLevel;
  proofDetail?: string; // populated only when level === "proof_required"
}

export interface IntakeQuestion {
  id: string; // stable slug generated from question text
  text: string;
  requirements: AgencyRequirement[];
  upstreamRefs: string[]; // resolved question ids; empty array if unresolved/unmatched
  downstreamRefs: string[];
  unresolvedLinks?: string[]; // raw text that could not be matched to a question id — surfaced, not hidden
  dataQualityNote?: string; // carried verbatim from the source CSV's "Data Quality Notes" column, if present
}

/**
 * What sort of entity an agency is. The intake sheet lists vehicle operators and fare/pass
 * programs side by side, but only the former can have vehicle capabilities — see the comment
 * on CANONICAL_AGENCIES in `agencies.ts`.
 */
export type AgencyKind = "ride_provider" | "fare_program" | "travel_training";

export interface Agency {
  id: string;
  displayName: string;
  kind: AgencyKind;
  aliases: string[]; // raw strings from source CSVs mapped to this agency
}

export interface NormalizedData {
  agencies: Agency[];
  questions: IntakeQuestion[];
}

/**
 * Canonical vocabulary for a capability cell. The source sheet answers in free text
 * ("Yes", "no", "Probably yes", "Depends on vehicle", "Yes (1)", blank), so the canonical value
 * carries the comparison and `qualifier` preserves the agency's own words verbatim — the same
 * split used for `AgencyRequirement.proofDetail`.
 *
 * "unknown" means the sheet gave no answer. It is deliberately NOT folded into "no": three
 * agencies returned an entirely blank row, and reporting that as "does not offer wheelchair
 * access" would be actively false.
 */
export type CapabilityValue = "yes" | "no" | "conditional" | "unknown";

export interface Capability {
  id: string; // slug of the source column header
  label: string; // column header verbatim
}

export interface AgencyCapability {
  capabilityId: string;
  value: CapabilityValue;
  qualifier?: string; // the agency's own wording where it added one, e.g. "1", "Language line"
}

/**
 * One row of `data/capabilities.csv`. An agency with no row at all has no profile — that is a
 * different fact from a profile whose values are all "unknown" (surveyed, returned nothing),
 * and the coverage view reports the two separately.
 */
export interface AgencyCapabilityProfile {
  agencyId: string;
  capabilities: AgencyCapability[];
}

/**
 * An editorial claim, from `data/question-capability-map.csv`, that an intake question exists in
 * order to determine a given provider capability. Not derivable from either CSV — a human
 * asserts it, and `note` records why. Stored against question *text* rather than id so it can be
 * re-resolved against an uploaded question set at runtime.
 */
export interface QuestionCapabilityLink {
  questionText: string;
  capabilityId: string;
  note?: string;
}

export interface CapabilityData {
  capabilities: Capability[];
  profiles: AgencyCapabilityProfile[];
  questionLinks: QuestionCapabilityLink[];
}
