export type RequirementLevel = "required" | "optional" | "self_attestation" | "proof_required";

export interface AgencyRequirement {
  agencyId: string; // canonical, resolved from alias table
  level: RequirementLevel;
  proofDetail?: string; // populated only when level === "proof_required"
  /**
   * Set on a self-attestation / proof entry when the agency never said whether it asks the
   * question as required or optional (the Requirements tab's `Asked: Unknown`). There is then
   * no required/optional entry for the agency, and the UI says so rather than implying one.
   */
  askedUnknown?: true;
}

export interface IntakeQuestion {
  id: string; // assigned once in the Questions tab and never edited, so rewording keeps it
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
 * at the top of `agencies.ts`.
 */
export type AgencyKind = "ride_provider" | "fare_program" | "travel_training";

export interface Agency {
  id: string;
  displayName: string;
  kind: AgencyKind;
  aliases: string[]; // raw strings from source CSVs mapped to this agency
  /**
   * Whether the agency returned the capability survey. Stated in the roster rather than
   * inferred from the capability answers, because "returned it blank" and "never surveyed" look
   * identical in a tab that only lists answers, and the capabilities view reports them
   * differently.
   */
  capabilitySurvey: "returned" | "not_surveyed";
}

/**
 * A named set of agencies that Hopelink staff define (e.g. "Paratransit providers"), so a reader
 * can show or hide them together. Purely a viewing aid: groups carry no analytical meaning, and
 * an agency may belong to any number of them.
 */
export interface AgencyGroup {
  id: string; // slug of the name; nothing persistent is keyed by it
  name: string;
  agencyIds: string[]; // in roster order, so a group always lists its members the same way
}

/** Everything about agencies, independent of the questions: who they are and how staff group them. */
export interface Roster {
  agencies: Agency[];
  agencyGroups: AgencyGroup[];
}

export interface NormalizedData extends Roster {
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
 * One agency's capability answers. Only agencies whose roster row says they returned the survey
 * have a profile; an agency that was never surveyed has none. That is a different fact from a
 * profile whose values are all "unknown" (surveyed, returned nothing), and the coverage view
 * reports the two separately.
 */
export interface AgencyCapabilityProfile {
  agencyId: string;
  capabilities: AgencyCapability[];
}

/**
 * An editorial claim, from `data/question-capability-map.csv`, that an intake question exists in
 * order to determine a given provider capability. Not derivable from the other tabs — a human
 * asserts it, and `note` records why. Resolved against the displayed question set at runtime, so
 * an uploaded preview that drops a question reports the link as unmatched rather than breaking.
 */
export interface QuestionCapabilityLink {
  questionId: string;
  capabilityId: string;
  note?: string;
}

export interface CapabilityData {
  capabilities: Capability[];
  profiles: AgencyCapabilityProfile[];
  questionLinks: QuestionCapabilityLink[];
}
